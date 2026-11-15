import React from 'react';
import { Body, Heading, Screen } from './ui';
import { missingEnv } from '../lib/env';

export function SetupScreen() {
  return (
    <Screen style={{ paddingTop: 56 }}>
      <Heading>Setup needed</Heading>
      <Body>AccessAble cannot start because some configuration values are missing.</Body>
      {missingEnv.map((k) => (
        <Body key={k} style={{ fontWeight: '800' }}>
          {k}
        </Body>
      ))}
      <Body>
        Copy .env.example to .env in apps/mobile, fill these in, then restart Expo with: npx expo start -c
      </Body>
    </Screen>
  );
}
