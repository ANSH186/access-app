import React from 'react';
import { Linking } from 'react-native';
import { speak } from '../lib/speech';
import { useApp } from '../state/app';
import { BigButton, Body } from './ui';

function dial(num: string) {
  // Opens the phone dialer pre-filled. The user still has to press call: we never dial automatically.
  Linking.openURL(`tel:${num.replace(/[^+\d]/g, '')}`).catch(() => speak('I could not open the phone dialer.'));
}

export function CallButtons() {
  const { profile } = useApp();
  const phone = profile?.emergency_contact_phone?.trim();
  const name = profile?.emergency_contact_name?.trim();
  return (
    <>
      <BigButton
        label="Call 112"
        hint="Opens the phone dialer with 112. You must press call yourself."
        variant="primary"
        minHeight={80}
        onPress={() => dial('112')}
      />
      {phone ? (
        <BigButton
          label={`Call my emergency contact${name ? `: ${name}` : ''}`}
          hint="Opens the phone dialer with your emergency contact's number."
          minHeight={80}
          onPress={() => dial(phone)}
        />
      ) : (
        <Body muted>No emergency contact saved. You can add one in Settings.</Body>
      )}
    </>
  );
}
