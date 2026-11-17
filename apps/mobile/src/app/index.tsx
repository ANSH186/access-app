import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, BigButton, Field, LiveText, Screen, styles as uiStyles } from '../components/ui';
import { useTicker } from '../hooks/useTicker';
import { api, errorToSpeech } from '../lib/api';
import { isStale, locationLine } from '../lib/format';
import { speak } from '../lib/speech';
import { colors } from '../lib/theme';
import type { CommandResult } from '../lib/types';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

export default function Home() {
  const { location, profile, activeAlert, refreshActiveAlert, handsFree } = useApp();
  const nav = useNav();
  const now = useTicker();
  const [status, setStatus] = useState('');
  const [typed, setTyped] = useState('');
  const [showTyped, setShowTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const welcomed = useRef(false);

  useEffect(() => {
    refreshActiveAlert();
  }, [refreshActiveAlert]);

  useEffect(() => {
    if (welcomed.current) return;
    welcomed.current = true;
    const place = location ? locationLine(location, now) : 'Your location is not confirmed yet.';
    const alert = activeAlert ? ' You have an active SOS alert.' : '';
    speak(
      `AccessAble. ${place}.${alert} Say take me to the library, or press a button. ` +
        'Press the Talk button at the bottom at any time and say what you need.',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback((t: string) => {
    setStatus(t);
    speak(t);
  }, []);

  const routeCommand = useCallback(
    (res: CommandResult) => {
      setStatus(res.reply || '');
      switch (res.intent) {
        case 'navigate': {
          const params: Record<string, string> = {};
          if (res.destination) {
            params.destId = res.destination.node_id;
            params.destLabel = res.destination.label;
          } else if (res.destination_query) {
            params.q = res.destination_query;
          }
          if (res.reply) params.intro = res.reply;
          router.push({ pathname: '/navigate', params });
          break;
        }
        case 'read_sign':
          router.push({ pathname: '/camera', params: { mode: 'sign' } });
          break;
        case 'describe_scene':
          router.push({ pathname: '/camera', params: { mode: 'scene' } });
          break;
        case 'report_problem':
          router.push('/report');
          break;
        case 'where_am_i':
          router.push('/where-am-i');
          break;
        case 'news':
          router.push('/news');
          break;
        case 'sos':
          router.push('/sos');
          break;
        case 'repeat':
          speak('Use the Talk button and say repeat, or press the Repeat button on the screen.');
          break;
        case 'cancel':
          nav.stop();
          setStatus('Navigation stopped.');
          break;
        case 'help':
        case 'unknown':
        default:
          router.push('/help');
      }
    },
    [nav],
  );

  const sendTyped = async () => {
    const t = typed.trim();
    if (!t || busy) return;
    setTyped('');
    setBusy(true);
    try {
      routeCommand(await api.commandText(t));
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  };

  const stale = location && isStale(location, now);

  return (
    <Screen>
      <View style={uiStyles.card} accessible accessibilityLabel={locationLine(location, now)}>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: location && !stale ? colors.text : colors.accent,
            fontSize: 21,
            fontWeight: '700',
            lineHeight: 29,
          }}
        >
          {locationLine(location, now)}
        </Text>
        {stale && <Body muted>This is more than 15 minutes old. Use Where am I to update it.</Body>}
      </View>

      {nav.dest && (
        <BigButton
          label={`Navigation to ${nav.dest.label} in progress — resume`}
          variant="ghost"
          onPress={() => router.push('/navigate')}
        />
      )}

      {activeAlert && (
        <BigButton
          label="You have an active SOS alert — hear the status"
          variant="danger"
          onPress={() => router.push('/sos-status')}
        />
      )}

      <BigButton
        label="Navigate"
        hint="Choose a destination and get step by step directions, indoors or on NIE North Campus"
        variant="primary"
        minHeight={88}
        onPress={() => router.push('/navigate')}
      />
      <BigButton
        label="Where am I"
        hint="Use GPS, scan a checkpoint, or choose your location from a list"
        minHeight={80}
        onPress={() => router.push('/where-am-i')}
      />
      <BigButton
        label="Read sign"
        hint="Opens the camera to read a sign aloud"
        onPress={() => router.push({ pathname: '/camera', params: { mode: 'sign' } })}
      />
      <BigButton
        label="Describe scene"
        hint="Describes any place in front of you, not just the campus"
        onPress={() => router.push({ pathname: '/camera', params: { mode: 'scene' } })}
      />
      <BigButton
        label="News updates"
        hint="General news headlines with an AI briefing you can ask about"
        onPress={() => router.push('/news')}
      />
      <BigButton label="More options" onPress={() => router.push('/more')} />
      <BigButton label="What can I say?" variant="ghost" onPress={() => router.push('/help')} />

      <LiveText>{status}</LiveText>

      <BigButton
        label={showTyped ? 'Hide typing' : 'Type a command instead'}
        variant="ghost"
        onPress={() => setShowTyped((v) => !v)}
      />
      {showTyped && (
        <>
          <Field
            label="Type a command"
            hint="For example: take me to the library"
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={sendTyped}
            returnKeyType="send"
            autoCapitalize="none"
          />
          <BigButton label="Send typed command" onPress={sendTyped} disabled={busy || !typed.trim()} />
        </>
      )}

      <Body muted>
        Hands-free voice is {handsFree ? 'on' : 'off'}. AccessAble is not an emergency service. Signed in as{' '}
        {profile?.display_name ?? 'you'}.
      </Body>
    </Screen>
  );
}
