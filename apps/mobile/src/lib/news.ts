import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import type { NewsBriefing, NewsItem } from './types';

const CACHE_KEY = 'aa.newsCache.v2';
const FALLBACK_URL = 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en';

type Cache = { at: number; items: NewsItem[] };
let memory: Cache | null = null;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m?.[1] ? decode(m[1]) : '';
}

/** Minimal RSS parser used only when the API news endpoint is unreachable. */
export function parseGoogleNews(xml: string): NewsItem[] {
  const out: NewsItem[] = [];
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of items) {
    const title = tag(block, 'title');
    if (!title) continue;
    const link = tag(block, 'link') || tag(block, 'guid');
    const summary = tag(block, 'description');
    const published = tag(block, 'pubDate');
    out.push({
      id: `direct-${out.length}`,
      title,
      summary: summary || '',
      source: 'Google News',
      category: 'India',
      link,
      published: published || null,
      published_iso: null,
    });
  }
  return out;
}

export async function directNews(limit = 10): Promise<NewsItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(FALLBACK_URL, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseGoogleNews(xml).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(): Promise<Cache | null> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    memory = c;
    return c;
  } catch {
    return null;
  }
}

async function writeCache(items: NewsItem[]) {
  const c = { at: Date.now(), items };
  memory = c;
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(c)).catch(() => undefined);
}

export type NewsResult = {
  items: NewsItem[];
  stale: boolean;
  /** 'api' | 'direct' | 'cache' */
  source: 'api' | 'direct' | 'cache';
  ageMinutes: number;
};

export async function loadNews(limit = 12, force = false): Promise<NewsResult> {
  if (!force && memory && Date.now() - memory.at < 5 * 60_000) {
    return { items: memory.items.slice(0, limit), stale: false, source: 'cache', ageMinutes: 0 };
  }
  try {
    const r = await api.news(limit);
    if (r.items.length) {
      await writeCache(r.items);
      return { items: r.items, stale: false, source: 'api', ageMinutes: 0 };
    }
  } catch {
    /* fall through */
  }
  const direct = await directNews(limit);
  if (direct.length) {
    await writeCache(direct);
    return { items: direct, stale: false, source: 'direct', ageMinutes: 0 };
  }
  const cached = await readCache();
  if (cached?.items?.length) {
    return {
      items: cached.items.slice(0, limit),
      stale: true,
      source: 'cache',
      ageMinutes: Math.max(0, Math.round((Date.now() - cached.at) / 60_000)),
    };
  }
  return { items: [], stale: true, source: 'cache', ageMinutes: 0 };
}

export async function loadBriefing(limit = 8): Promise<NewsBriefing> {
  try {
    const r = await api.newsBriefing(limit);
    if (r.briefing?.trim()) return r;
  } catch {
    /* fall through */
  }
  const n = await loadNews(limit);
  const items = n.items.slice(0, 5);
  const briefing = items.length
    ? 'Here are the top headlines. ' + items.map((i) => `From ${i.source}: ${i.title}.`).join(' ')
    : 'I could not load the news right now. Please check your internet connection and try again.';
  return { briefing, items: n.items };
}

export async function askNews(item: NewsItem, question: string): Promise<string> {
  try {
    const r = await api.askNews(item.title, item.summary, question);
    if (r.answer?.trim()) return r.answer;
  } catch {
    /* fall through */
  }
  return item.summary
    ? `I cannot reach the AI explainer right now. Here is the story summary: ${item.summary}`
    : 'I cannot reach the AI explainer right now. Try opening the full story.';
}
