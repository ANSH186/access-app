import { router } from 'expo-router';
import React from 'react';
import { Body, BigButton, Heading, Screen } from '../components/ui';
import { useApp } from '../state/app';

export default function MoreScreen() {
  const { signOut, profile } = useApp();
  return (
    <Screen>
      <Heading>More options</Heading>
      <BigButton label="Report a problem" hint="Report a blocked path, broken lift, wet floor or other issue" onPress={() => router.push('/report')} />
      <BigButton label="My reports" hint="Hear the status of problems you reported" onPress={() => router.push('/my-reports')} />
      <BigButton label="Voice help" hint="Hear every voice command and button-number trick" onPress={() => router.push('/help')} />
      <BigButton label="Settings" hint="Speech speed, hands-free voice, emergency contact, server test" onPress={() => router.push('/settings')} />
      <BigButton label="About AccessAble and safety" onPress={() => router.push('/settings')} variant="ghost" />
      <BigButton label="Sign out" variant="ghost" onPress={() => signOut()} />
      <Body muted>Signed in as {profile?.display_name ?? 'you'}.</Body>
    </Screen>
  );
}
