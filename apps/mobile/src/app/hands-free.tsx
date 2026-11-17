import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Heading, LiveText, Screen, ToggleRow, styles as ui } from '../components/ui';
import { speak } from '../lib/speech';
import { nativeSpeechAvailable } from '../lib/speechRecognition';
import { colors } from '../lib/theme';
import { useApp } from '../state/app';

const STEPS =
  'Hands-free voice mode. First, install the AccessAble app as a development or production build. Hands-free does not work inside Expo Go. ' +
  'Second, open Settings and switch Hands-free voice mode on. Third, wait until AccessAble finishes speaking. ' +
  'Fourth, say a command such as take me to the library, where am I, read this sign, or press two. ' +
  'After each answer, wait for the app to finish, then speak again. Say stop listening to turn hands-free off.';

export default function HandsFreeScreen() {
  const { handsFree, setHandsFree } = useApp();

  useEffect(() => {
    speak(
      nativeSpeechAvailable
        ? 'Hands-free voice. You can turn it on here. After AccessAble speaks, wait for the beep or vibration, then say your command.'
        : 'Hands-free voice needs the installed AccessAble app. In Expo Go, use the Talk button at the bottom instead.',
    );
  }, []);

  function enable() {
    if (!nativeSpeechAvailable) {
      speak(
        'Hands-free voice is not available in this preview. Install the AccessAble development or production app, then come back to this screen.',
      );
      return;
    }
    setHandsFree(true);
    speak('Hands-free voice is on. After I finish, say take me to the library, or say help.');
  }

  function disable() {
    setHandsFree(false);
    speak('Hands-free voice is off.');
  }

  return (
    <Screen>
      <Heading>Hands-free voice</Heading>
      <Body>
        Use AccessAble without pressing a button. The app listens again after it finishes speaking.
      </Body>

      <View style={ui.card} accessible>
        <Text style={{ color: colors.accent, fontSize: 20, fontWeight: '800' }}>
          {nativeSpeechAvailable ? 'Available on this installation' : 'Needs the installed app'}
        </Text>
        <Body>
          {nativeSpeechAvailable
            ? 'The on-device speech recognizer is available. Turn hands-free on below.'
            : 'Expo Go cannot run continuous on-device speech recognition. Build the app with “npx expo run:android” or an EAS development build, then install it on the phone.'}
        </Body>
      </View>

      <ToggleRow
        label="Hands-free voice mode"
        hint="Listens again after the app finishes speaking"
        value={handsFree}
        onChange={(v) => (v ? enable() : disable())}
      />
      <BigButton label="Turn hands-free on" variant="primary" minHeight={84} onPress={enable} />
      <BigButton label="Turn hands-free off" onPress={disable} />
      <BigButton label="Hear how to use it" onPress={() => speak(STEPS)} />

      <Heading>How to use it</Heading>
      <Body>1. Install the AccessAble app — not Expo Go.</Body>
      <Body>2. Turn hands-free voice mode on.</Body>
      <Body>3. Wait until the app finishes speaking.</Body>
      <Body>4. Say: “Take me to the library”, “Where am I”, “Read this sign”, “Continuous scene”, or “Press two”.</Body>
      <Body>5. After the answer, wait again, then speak your next command.</Body>
      <Body>6. Say “Stop listening” to turn hands-free off.</Body>

      <BigButton label="Open Settings" onPress={() => router.push('/settings')} />
      <BigButton label="Voice help and commands" onPress={() => router.push('/help')} />
      <BigButton label="Back to home" onPress={() => router.replace('/')} />
      <LiveText>
        If the microphone is busy, wait for the app to finish speaking before you talk. Hands-free uses more battery.
      </LiveText>
    </Screen>
  );
}
