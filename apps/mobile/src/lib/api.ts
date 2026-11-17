import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { getServerUrl } from './server';
import { speak } from './speech';
import { supabase } from './supabase';
import type {
  CommandResult,
  DestinationResult,
  Diagnostics,
  NewsBriefing,
  NewsItem,
  OcrResult,
  PlaceInfo,
  RoutePlan,
  VisionResult,
} from './types';

const FIRST_TIMEOUT_MS = 75_000;
const NORMAL_TIMEOUT_MS = 50_000;
const SLOW_NOTICE_MS = 5_000;

export const WAKING_MESSAGE = 'Waking up the server. This can take up to a minute.';

export class ApiError extends Error {
  /** Plain sentence that is safe to speak aloud. */
  spoken: string;
  status: number;
  code: string;
  constructor(spoken: string, status = 0, code = 'error') {
    super(spoken);
    this.spoken = spoken;
    this.status = status;
    this.code = code;
  }
}

export function errorToSpeech(e: unknown): string {
  if (e instanceof ApiError) return e.spoken;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

// ---- "server is waking up" notification channel -------------------------------
let slowCount = 0;
const slowListeners = new Set<(slow: boolean) => void>();
export function subscribeSlow(cb: (slow: boolean) => void) {
  slowListeners.add(cb);
  return () => {
    slowListeners.delete(cb);
  };
}
function bumpSlow(delta: number) {
  slowCount = Math.max(0, slowCount + delta);
  slowListeners.forEach((cb) => cb(slowCount > 0));
}

// ---- reachability -------------------------------------------------------------
let online: boolean | null = null;
const onlineListeners = new Set<(online: boolean | null) => void>();
export function subscribeOnline(cb: (online: boolean | null) => void) {
  onlineListeners.add(cb);
  cb(online);
  return () => {
    onlineListeners.delete(cb);
  };
}
function markOnline(value: boolean | null) {
  if (online === value) return;
  online = value;
  onlineListeners.forEach((cb) => cb(value));
}

let warm = false; // becomes true after the first successful response

type Options = {
  method?: 'GET' | 'POST';
  json?: unknown;
  form?: FormData;
  /** Called once if the request takes longer than 5 s (server probably waking up). */
  onSlow?: () => void;
  timeoutMs?: number;
  retry?: boolean;
};

async function getToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    const refreshed = await supabase.auth.refreshSession().catch(() => null);
    const t = refreshed?.data.session?.access_token;
    if (t) return t;
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Please sign in again.', 401, 'unauthenticated');
  return token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const base = await getServerUrl();
  const url = `${base}${path}`;
  if (!base) {
    throw new ApiError(
      'The server address is missing. Open Settings and check the server address.',
      0,
      'no_url',
    );
  }
  const isForm = !!opts.form;
  const retry = opts.retry ?? (!isForm && (opts.method ?? (opts.json ? 'POST' : 'GET')) === 'GET');
  const attempts = retry ? 2 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let token = await getToken(attempt > 0);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-AccessAble-Client': 'mobile/2',
    };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    const ctrl = new AbortController();
    const timeoutMs = opts.timeoutMs ?? (warm ? NORMAL_TIMEOUT_MS : FIRST_TIMEOUT_MS);
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    let slowFired = false;
    const slowTimer = setTimeout(() => {
      slowFired = true;
      bumpSlow(1);
      speak(WAKING_MESSAGE);
      opts.onSlow?.();
    }, SLOW_NOTICE_MS);

    try {
      let res: Response;
      try {
        res = await expoFetch(url, {
          method: opts.method ?? (body ? 'POST' : 'GET'),
          headers,
          body,
          signal: ctrl.signal,
        });
      } catch (e) {
        if (ctrl.signal.aborted) {
          lastError = new ApiError(
            'The server took too long to answer. Please try again in a moment.',
            0,
            'timeout',
          );
        } else {
          lastError = new ApiError(
            'I could not reach the server. Check your internet connection and try again.',
            0,
            'network',
          );
        }
        markOnline(false);
        if (attempt + 1 < attempts) {
          await sleep(1400);
          continue;
        }
        throw lastError;
      }

      markOnline(true);
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (res.status === 401 && attempt + 1 < attempts) {
        await sleep(300);
        continue;
      }

      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
        let spoken = err?.message;
        if (!spoken) {
          if (res.status === 401) spoken = 'Your session has expired. Please sign in again.';
          else if (res.status === 429) spoken = 'Too many requests. Please wait a minute and try again.';
          else if (res.status >= 500) spoken = 'The server had a problem. Please try again in a minute.';
          else spoken = 'That request did not work. Please try again.';
        }
        const apiErr = new ApiError(spoken, res.status, err?.code ?? 'http_error');
        if (res.status >= 500 && attempt + 1 < attempts) {
          lastError = apiErr;
          await sleep(1200);
          continue;
        }
        throw apiErr;
      }
      warm = true;
      return json as T;
    } finally {
      clearTimeout(timeout);
      clearTimeout(slowTimer);
      if (slowFired) bumpSlow(-1);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ApiError('I could not reach the server. Please try again.', 0, 'network');
}

function appendFile(form: FormData, field: string, uri: string, name: string) {
  // expo/fetch + expo-file-system's File implements Blob, which is reliable on
  // the New Architecture. Fall back to the legacy {uri, name, type} shape.
  try {
    const file = new File(uri);
    form.append(field, file as unknown as Blob, name);
  } catch {
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.wav') ? 'audio/wav' : name.endsWith('.m4a') ? 'audio/mp4' : 'image/jpeg';
    form.append(field, { uri, name, type } as unknown as Blob);
  }
}

export type Coords = { latitude: number; longitude: number };

export const api = {
  health: (onSlow?: () => void) =>
    request<{ status: string; version: string; time: string }>('/health', {
      onSlow,
      retry: true,
      timeoutMs: 20_000,
    }),

  diagnostics: () => request<Diagnostics>('/v1/diagnostics', { retry: true }),

  searchDestinations: (q: string, onSlow?: () => void) =>
    request<{ results: DestinationResult[] }>(`/v1/destinations/search?q=${encodeURIComponent(q)}`, {
      onSlow,
      retry: true,
    }),

  planRoute: (
    body: { from_node_id: string; to_node_id: string; avoid_stairs: boolean },
    onSlow?: () => void,
  ) => request<RoutePlan>('/v1/routes/plan', { method: 'POST', json: body, onSlow, retry: false }),

  readSign: (imageUri: string, question?: string, onSlow?: () => void) => {
    const form = new FormData();
    appendFile(form, 'image', imageUri, 'sign.jpg');
    if (question) form.append('question', question);
    return request<OcrResult>('/v1/ocr/read', { method: 'POST', form, onSlow });
  },

  describeScene: (
    imageUri: string,
    question?: string,
    coords?: Coords | null,
    place?: string | null,
    onSlow?: () => void,
  ) => {
    const form = new FormData();
    appendFile(form, 'image', imageUri, 'scene.jpg');
    if (question) form.append('question', question);
    if (coords) {
      form.append('lat', String(coords.latitude));
      form.append('lng', String(coords.longitude));
    }
    if (place) form.append('place', place);
    return request<VisionResult>('/v1/vision/describe', { method: 'POST', form, onSlow });
  },

  commandText: (text: string, onSlow?: () => void) => {
    const form = new FormData();
    form.append('text', text);
    return request<CommandResult>('/v1/assistant/command', { method: 'POST', form, onSlow });
  },

  transcribeText: (text: string, onSlow?: () => void) => {
    const form = new FormData();
    form.append('text', text);
    return request<{ transcript: string; intent: string; destination_query: string | null }>(
      '/v1/assistant/transcribe',
      { method: 'POST', form, onSlow },
    );
  },

  transcribeAudio: (audioUri: string, onSlow?: () => void) => {
    const form = new FormData();
    appendFile(form, 'audio', audioUri, 'command.m4a');
    return request<{ transcript: string; intent: string; destination_query: string | null }>(
      '/v1/assistant/transcribe',
      { method: 'POST', form, onSlow },
    );
  },

  commandAudio: (audioUri: string, onSlow?: () => void) => {
    const form = new FormData();
    appendFile(form, 'audio', audioUri, 'command.m4a');
    return request<CommandResult>('/v1/assistant/command', { method: 'POST', form, onSlow });
  },

  news: (limit = 12) =>
    request<{ items: NewsItem[]; count: number; categories: string[] }>(
      `/v1/news?limit=${limit}`,
      { retry: true, timeoutMs: 30_000 },
    ),

  newsBriefing: (limit = 8) =>
    request<NewsBriefing>(`/v1/news/briefing?limit=${limit}`, { retry: true, timeoutMs: 75_000 }),

  askNews: (title: string, summary: string, question: string) =>
    request<{ answer: string }>('/v1/news/ask', {
      method: 'POST',
      json: { title, summary, question },
      retry: false,
      timeoutMs: 75_000,
    }),

  locationContext: (coords: Coords) =>
    request<PlaceInfo>(
      `/v1/location/context?lat=${coords.latitude}&lng=${coords.longitude}`,
      { retry: true, timeoutMs: 75_000 },
    ),

  nearest: (coords: Coords) =>
    request<{
      found: boolean;
      on_campus: boolean;
      nearest: PlaceInfo['nearest'];
      accuracy_note: string;
    }>(`/v1/location/nearest?lat=${coords.latitude}&lng=${coords.longitude}`, { retry: true }),

  reverse: (coords: Coords) =>
    request<{
      found: boolean;
      display_name: string | null;
      name: string | null;
      short: string;
      road: string | null;
      suburb: string | null;
      city: string | null;
      state: string | null;
    }>(`/v1/location/reverse?lat=${coords.latitude}&lng=${coords.longitude}`, { retry: true }),

  askCampus: (question: string) =>
    request<{ answer: string; note: string }>('/v1/campus/ask', {
      method: 'POST',
      json: { question },
      retry: false,
      timeoutMs: 60_000,
    }),
};

/** Hook-style accessor. The "waking up" notice is spoken and shown by <ApiStatusBanner/>. */
export function useApi() {
  return api;
}
