import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen, styles as ui } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { askNews, loadBriefing, loadNews } from '../lib/news';
import { speak } from '../lib/speech';
import { colors } from '../lib/theme';
import type { NewsItem } from '../lib/types';

export default function NewsScreen() {
  const [briefing, setBriefing] = useState('');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [stale, setStale] = useState(false);
  const [age, setAge] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [category, setCategory] = useState('Top');
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const started = useRef(false);

  const say = useCallback((t: string) => {
    setMsg(t);
    speak(t);
  }, []);

  const load = useCallback(
    async (force = false) => {
      setBusy(true);
      try {
        const n = await loadNews(12, force);
        setItems(n.items);
        setStale(n.stale);
        setAge(n.ageMinutes);
        if (!n.items.length) say('I could not load the news. Check your internet connection and try again.');
        const b = await loadBriefing(8);
        setBriefing(b.briefing);
        if (b.items.length && !n.items.length) setItems(b.items);
      } catch (e) {
        say(`I could not load the news. ${errorToSpeech(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [say],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load().then(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (briefing && !busy) {
      speak(briefing);
      setMsg(briefing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefing]);

  const categories = ['Top', ...Array.from(new Set(items.map((i) => i.category).filter(Boolean)))];
  const shown = category === 'Top' ? items : items.filter((i) => i.category === category);

  const readItem = (item: NewsItem) => {
    const i = shown.findIndex((x) => x.id === item.id);
    if (i >= 0) setIndex(i);
    setSelected(item);
    setAnswer('');
    const text = `${item.title}. From ${item.source}. ${item.summary}`;
    setMsg(text);
    speak(text);
  };

  const move = (delta: number) => {
    if (!shown.length) return;
    const next = Math.max(0, Math.min(shown.length - 1, index + delta));
    setIndex(next);
    readItem(shown[next]!);
  };

  const openStory = (item: NewsItem) => {
    if (!item.link) return say('There is no link for this story.');
    Linking.openURL(item.link).catch(() => say('I could not open the story in a browser.'));
  };

  const voice = useVoiceCapture(async (uri) => {
    if (!selected) return say('Choose a story first.');
    setBusy(true);
    try {
      const cmd = await api.transcribeAudio(uri);
      const q = (cmd.transcript || '').trim();
      if (!q) return say('I did not catch the question. Please try again.');
      await ask(q);
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  });

  async function ask(q: string) {
    if (!selected || !q.trim()) return;
    setBusy(true);
    say('Thinking about your question…');
    try {
      const a = await askNews(selected, q.trim());
      setAnswer(a);
      speak(a);
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <Screen>
        <Heading>{selected.source}</Heading>
        <Text style={{ color: colors.text, fontSize: 30, fontWeight: '800', lineHeight: 40 }} accessibilityLiveRegion="polite">
          {selected.title}
        </Text>
        {selected.published && <Body muted>{selected.published}</Body>}
        <Body>{selected.summary || 'No summary was provided for this story.'}</Body>
        {answer && (
          <View style={ui.card}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>AI answer</Text>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700', lineHeight: 33 }}>{answer}</Text>
          </View>
        )}
        <Field
          label="Ask about this story"
          hint="For example: why does this matter, or what happened"
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => ask(question)}
          returnKeyType="send"
        />
        <BigButton label="Ask the AI" variant="primary" disabled={busy || !question.trim()} onPress={() => ask(question)} />
        <BigButton
          label={voice.state === 'recording' ? 'Tap to stop and ask' : 'Ask by voice'}
          disabled={busy || voice.state === 'processing'}
          onPress={() => voice.toggle()}
        />
        <BigButton label="Read the story again" onPress={() => readItem(selected)} />
        <BigButton label="Open the full story" onPress={() => openStory(selected)} />
        <BigButton label="Back to headlines" onPress={() => setSelected(null)} />
        <Body muted>AI answers use only the headline and summary. Open the full story to check details.</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>News updates</Heading>
      <Body muted>General news from trusted sources, with an AI briefing. You can ask about any story.</Body>
      <LiveText style={{ fontSize: 22, lineHeight: 31 }}>{msg}</LiveText>
      {stale && <Body muted>Showing saved headlines from {age} minutes ago.</Body>}

      <BigButton label="Read the AI briefing again" variant="primary" disabled={busy || !briefing} onPress={() => speak(briefing)} />
      <BigButton
        label={busy ? 'Loading news…' : 'Refresh news'}
        disabled={busy}
        onPress={() => {
          load(true);
        }}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {categories.map((c) => (
          <BigButton
            key={c}
            label={c}
            minHeight={56}
            selected={category === c}
            onPress={() => {
              setCategory(c);
              speak(`${c} news.`);
            }}
            style={{ flexGrow: 1, minWidth: 120 }}
          />
        ))}
      </View>

      {busy && items.length === 0 && <Body>Loading headlines…</Body>}
      {!busy && shown.length === 0 && <Body>No stories in this category right now.</Body>}
      {shown.map((item) => (
        <BigButton
          key={item.id}
          label={`${item.title} — ${item.source}`}
          hint="Double tap to hear the story summary"
          minHeight={84}
          onPress={() => readItem(item)}
        />
      ))}
      <BigButton label="Previous headline" disabled={index <= 0 || !shown.length} onPress={() => move(-1)} />
      <BigButton label="Next headline" disabled={index >= shown.length - 1 || !shown.length} onPress={() => move(1)} />
      <BigButton label="Play all headlines" onPress={() => speak(shown.slice(0, 5).map((i) => `${i.source}: ${i.title}.`).join(' '))} />
      <Body muted>News changes quickly. AI summaries can be wrong; open the full story for details.</Body>
    </Screen>
  );
}
