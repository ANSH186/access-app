import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Body, BigButton, Heading, Screen } from '../components/ui';
import { speak } from '../lib/speech';
import { useApp } from '../state/app';

export default function MoreScreen() {
  const { signOut, profile } = useApp();
  useEffect(() => {
    speak('More options. Report a problem, my reports, voice help, settings, or sign out.');
  }, []);
  return (
    <Screen>
      <Heading>More options</Heading>
      <BigButton label="Report a problem" hint="Report a blocked path, broken lift, wet floor or other issue" onPress={() => router.push('/report')} />
      <BigButton label="My reports" hint="Hear the status of problems you reported" onPress={() => router.push('/my-reports')} />
      <BigButton label="Document and book reader" hint="Photograph pages and hear every line" onPress={() => router.push('/document')} />
      <BigButton label="Continuous scene description" hint="Camera stays on and describes what is around you" onPress={() => router.push('/live-scene')} />
      <BigButton label="Hands-free voice" hint="Use the app without pressing buttons" onPress={() => router.push('/hands-free')} />
      <BigButton label="Voice help" hint="Hear every voice command and button-number trick" onPress={() => router.push('/help')} />
      <BigButton label="Settings" hint="Speech speed, hands-free voice, emergency contact, server test" onPress={() => router.push('/settings')} />
      <BigButton label="About AccessAble and safety" onPress={() => router.push('/settings')} variant="ghost" />
      <BigButton label="Sign out" variant="ghost" onPress={() => signOut()} />
      <Body muted>Signed in as {profile?.display_name ?? 'you'}.</Body>
    </Screen>
  );
}
