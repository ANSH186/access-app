import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CallButtons } from '../components/CallButtons';
import { BigButton, Body, Heading, LiveText, Screen } from '../components/ui';
import { ageText, locationText } from '../lib/format';
import { haptic } from '../lib/haptics';
import { speak } from '../lib/speech';
import { saveLastAlertId } from '../lib/storage';
import { endSosAttempt, sendSos, startSosAttempt } from '../lib/sos';
import { colors, sizes } from '../lib/theme';
import { useApp } from '../state/app';

const TYPES: { value: string; label: string }[] = [
  { value: 'medical', label: 'Medical' },
  { value: 'lost', label: 'Lost' },
  { value: 'fall', label: 'Fall' },
  { value: 'unsafe', label: 'Unsafe' },
  { value: 'other', label: 'Other' },
];

const PROMPT = 'Send an emergency alert to campus security? Double-tap Send SOS to confirm.';

export default function SosConfirm() {
  const { profile, location, refreshActiveAlert } = useApp();
  const [phase, setPhase] = useState<'confirm' | 'sending' | 'failed'>('confirm');
  const [type, setType] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const attemptStarted = useRef(false);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    speak(PROMPT);
  }, []);

  // While the failure screen is up, keep saying so (alert fatigue is better than a missed failure).
  useEffect(() => {
    if (phase !== 'failed') return;
    haptic.error();
    speak('Your alert was not sent. Call 112 now if you can.');
    repeatTimer.current = setInterval(() => {
      haptic.error();
      speak('Your alert was not sent. Call 112 now if you can.');
    }, 20_000);
    return () => {
      if (repeatTimer.current) clearInterval(repeatTimer.current);
    };
  }, [phase]);

  const share = profile?.share_location_in_sos !== false;

  async function send() {
    if (phase === 'sending') return;
    if (!attemptStarted.current) {
      startSosAttempt();
      attemptStarted.current = true;
    }
    setPhase('sending');
    haptic.strong();
    speak('Sending your alert.');
    const res = await sendSos({ emergencyType: type ?? 'unspecified', profile, location });
    if (res.ok) {
      endSosAttempt();
      await saveLastAlertId(res.alert.id);
      await refreshActiveAlert();
      haptic.success();
      router.replace({ pathname: '/sos-status', params: { id: res.alert.id } });
    } else {
      setErr(res.error);
      setPhase('failed');
    }
  }

  if (phase === 'failed') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.sos, padding: sizes.pad, gap: 14, justifyContent: 'center' }}>
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ color: '#FFFFFF', fontSize: 42, fontWeight: '900', lineHeight: 50 }}
        >
          Your alert was NOT sent
        </Text>
        <Text style={{ color: '#FFFFFF', fontSize: 22, lineHeight: 30 }}>
          Campus staff have not been told. Call 112 or your emergency contact now if you can.
        </Text>
        <CallButtons />
        <BigButton label="Try again" variant="secondary" minHeight={80} onPress={send} />
        <BigButton
          label="Cancel"
          variant="ghost"
          onPress={() => {
            endSosAttempt();
            router.back();
          }}
        />
        <Text style={{ color: '#FFFFFF', fontSize: 16 }}>Reason: {err}</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 16 }}>AccessAble is not an emergency service.</Text>
      </View>
    );
  }

  return (
    <Screen>
      <Heading>Send an emergency alert?</Heading>
      <LiveText style={{ fontSize: 24, lineHeight: 34 }}>{PROMPT}</LiveText>
      <Body muted>This is a test version. No real emergency service is contacted.</Body>

      <Body>
        {!share
          ? 'Your location will not be shared, because you turned off location sharing in Settings.'
          : location
            ? `Location that will be shared: ${locationText(location)}, confirmed ${ageText(location.observed_at)}.`
            : 'No confirmed location to share. Campus staff will not know where you are.'}
      </Body>

      <Body>Emergency type (optional):</Body>
      <View style={{ gap: 10 }}>
        {TYPES.map((t) => (
          <BigButton
            key={t.value}
            label={t.label}
            selected={type === t.value}
            onPress={() => setType(type === t.value ? null : t.value)}
          />
        ))}
      </View>

      <BigButton
        label="Send SOS"
        hint="Double tap to send the alert to campus security now"
        variant="danger"
        minHeight={120}
        silentHaptic
        disabled={phase === 'sending'}
        onPress={send}
      />
      {phase === 'sending' && <LiveText assertive>Sending your alert…</LiveText>}
      <BigButton
        label="Cancel"
        hint="Go back without sending"
        minHeight={96}
        disabled={phase === 'sending'}
        onPress={() => {
          speak('Cancelled. Nothing was sent.');
          router.back();
        }}
      />
      <Body muted>AccessAble is not an emergency service. In a real emergency call 112.</Body>
    </Screen>
  );
}
