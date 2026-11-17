import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Body, BigButton, Heading, Screen } from '../components/ui';
import { speak } from '../lib/speech';

const COMMANDS = [
  'Take me to the library',
  'Where am I',
  'Read this sign',
  'Read a document or book',
  'Describe the scene',
  'Continuous scene',
  'News',
  'Hands-free voice',
  'Report a problem',
  'Next',
  'Previous',
  'Repeat',
  'Stop',
  'Press one',
  'Press two',
  'Help',
];

export default function HelpScreen() {
  useEffect(() => {
    speak(
      'Voice help. Press the Talk button at the bottom and say a command. You can also press any button by number, for example, press two.',
    );
  }, []);
  return (
    <Screen>
      <Heading>What can I say?</Heading>
      <Body>
        Press the big Talk button at the bottom of the screen and speak. You can also press any button by number. For
        example, say “press two” to use the second button on the screen.
      </Body>
      {COMMANDS.map((c) => (
        <BigButton key={c} label={`“${c}”`} minHeight={64} onPress={() => speak(c)} />
      ))}
      <BigButton
        label="Read this screen"
        onPress={() =>
          speak(
            'You can say take me to the library, where am I, read this sign, describe the scene, news, report a problem, next, previous, repeat, stop, or press a number. Press the Talk button at the bottom and speak.',
          )
        }
      />
      <BigButton label="Turn hands-free voice on or off" onPress={() => router.push('/hands-free')} />
      <BigButton label="Read a document or book" onPress={() => router.push('/document')} />
      <BigButton label="Continuous scene description" onPress={() => router.push('/live-scene')} />
      <BigButton label="Back to home" variant="primary" onPress={() => router.replace('/')} />
    </Screen>
  );
}
