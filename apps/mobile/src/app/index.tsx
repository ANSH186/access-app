import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { Body, BigButton, Field, LiveText, Screen, styles as uiStyles } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { useTicker } from '../hooks/useTicker';
import { api, errorToSpeech } from '../lib/api';
import { isStale, locationLine, locationText, ageText } from '../lib/format';
import { getLastInstruction, speak } from '../lib/speech';
import { colors } from '../lib/theme';
import type { CommandResult } from '../lib/types';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

const HELP_TEXT =
  'You can say: take me to the library. Read this sign. Describe the scene. Where am I. Report a problem. Repeat. Cancel. Or, I need help.';

export default function Home() {
  const { location, profile, activeAlert, refreshActiveAlert, reduceMotion } = useApp();
  const nav = useNav();
  const now = useTicker();
  const [status, setStatus] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshActiveAlert();
  }, [refreshActiveAlert]);

  const say = useCallback((t: string) => {
    setStatus(t);
    speak(t);
  }, []);

  const route = useCallback(
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
          speak(res.reply);
          router.push({ pathname: '/camera', params: { mode: 'sign' } });
          break;
        case 'describe_scene':
          speak(res.reply);
          router.push({ pathname: '/camera', params: { mode: 'scene' } });
          break;
        case 'report_problem':
          speak(res.reply);
          router.push('/report');
          break;
        case 'where_am_i': {
          if (location && !isStale(location)) {
            say(`You were last confirmed at ${locationText(location)}, ${ageText(location.observed_at)}.`);
          } else if (location) {
            say(
              `You were last confirmed at ${locationText(location)}, ${ageText(location.observed_at)}. That may be out of date. Opening the checkpoint scanner.`,
            );
            router.push('/scan');
          } else {
            say('Your location is not confirmed. Opening the checkpoint scanner.');
            router.push('/scan');
          }
          break;
        }
        case 'sos':
          // Never sends anything: only opens the confirmation screen.
          router.push('/sos');
          break;
        case 'repeat':
          say(getLastInstruction() ?? 'There is nothing to repeat yet.');
          break;
        case 'cancel':
          nav.stop();
          setStatus('Navigation stopped.');
          break;
        case 'help':
        case 'unknown':
        default:
          say(`${res.reply ? res.reply + ' ' : ''}${HELP_TEXT}`);
      }
    },
    [location, nav, say],
  );

  const runCommand = useCallback(
    async (p: Promise<CommandResult>) => {
      setBusy(true);
      setStatus('Working on it…');
      try {
        const res = await p;
        if (res.transcript) setStatus(`I heard: “${res.transcript}”`);
        route(res);
      } catch (e) {
        say(`${errorToSpeech(e)} You can use the buttons instead.`);
      } finally {
        setBusy(false);
      }
    },
    [route, say],
  );

  const voice = useVoiceCapture(async (uri) => {
    await runCommand(api.commandAudio(uri));
  });

  const sendTyped = () => {
    const t = typed.trim();
    if (!t || busy) return;
    setTyped('');
    runCommand(api.commandText(t));
  };

  const recording = voice.state === 'recording';
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!recording || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.6, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, reduceMotion, pulse]);

  const talkLabel = recording ? 'Listening… release to send' : voice.state === 'processing' ? 'Working…' : 'Hold to talk';

  return (
    <Screen>
      <View style={uiStyles.card} accessible accessibilityLabel={locationLine(location, now)}>
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: location && !isStale(location, now) ? colors.text : colors.accent, fontSize: 20, fontWeight: '700' }}
        >
          {locationLine(location, now)}
        </Text>
        {location && isStale(location, now) && (
          <Body muted>This is more than 15 minutes old. Scan a checkpoint to update it.</Body>
        )}
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
          label="You have an active SOS alert — see status"
          variant="ghost"
          onPress={() => router.push('/sos-status')}
        />
      )}

      <Animated.View style={{ opacity: pulse }}>
        <BigButton
          label={talkLabel}
          accessibilityLabel="Hold to talk"
          hint="Press and hold, say a command such as take me to the library, then release. If you use TalkBack, use the Tap to talk button instead."
          variant="primary"
          minHeight={140}
          silentHaptic
          selected={recording}
          disabled={busy || voice.state === 'processing'}
          onPressIn={() => {
            if (voice.state === 'idle') voice.start();
          }}
          onPressOut={() => {
            if (voice.state === 'recording' || voice.state === 'starting') voice.finish();
          }}
        />
      </Animated.View>
      <BigButton
        label={recording ? 'Tap to stop and send' : 'Tap to talk'}
        hint={recording ? 'Stops recording and sends your command.' : 'Starts recording. Tap again when you have finished speaking.'}
        variant="secondary"
        disabled={busy || voice.state === 'processing' || voice.state === 'starting'}
        onPress={() => voice.toggle()}
      />

      <LiveText>{status}</LiveText>

      <Field
        label="Or type a command"
        hint="For example: take me to the library"
        value={typed}
        onChangeText={setTyped}
        onSubmitEditing={sendTyped}
        returnKeyType="send"
        autoCapitalize="none"
      />
      <BigButton label="Send typed command" onPress={sendTyped} disabled={busy || !typed.trim()} />

      <BigButton
        label="Navigate"
        hint="Choose a destination and get step by step directions"
        onPress={() => router.push('/navigate')}
      />
      <BigButton
        label="Read sign"
        hint="Opens the camera to read a sign aloud"
        onPress={() => router.push({ pathname: '/camera', params: { mode: 'sign' } })}
      />
      <BigButton
        label="Describe scene"
        hint="Opens the camera to describe what is in front of you"
        onPress={() => router.push({ pathname: '/camera', params: { mode: 'scene' } })}
      />
      <BigButton
        label="Where am I — scan checkpoint"
        hint="Scan a QR checkpoint to confirm your location"
        onPress={() => router.push('/scan')}
      />
      <BigButton
        label="Report a problem"
        hint="Report a blocked path, broken lift or other issue"
        onPress={() => router.push('/report')}
      />
      <BigButton label="My reports" hint="See the status of problems you reported" onPress={() => router.push('/my-reports')} />
      <BigButton label="Settings" onPress={() => router.push('/settings')} />
      <Body muted>AccessAble is not an emergency service. Signed in as {profile?.display_name ?? 'you'}.</Body>
    </Screen>
  );
}
