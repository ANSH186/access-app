import React, { useEffect, useState } from 'react';
import { BigButton, Body, Field, Heading, LiveText, Screen, ToggleRow } from '../components/ui';
import { getSpeechRate, setSpeechRate, speak } from '../lib/speech';
import { useApp } from '../state/app';

export default function Settings() {
  const { profile, updateProfile, signOut } = useApp();
  const [rate, setRate] = useState(getSpeechRate());
  const [ecName, setEcName] = useState(profile?.emergency_contact_name ?? '');
  const [ecPhone, setEcPhone] = useState(profile?.emergency_contact_phone ?? '');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setEcName(profile?.emergency_contact_name ?? '');
    setEcPhone(profile?.emergency_contact_phone ?? '');
    if (profile) setRate(profile.speech_rate ?? 1);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (t: string) => {
    setMsg(t);
    speak(t);
  };

  async function changeRate(delta: number) {
    const r = Math.round(Math.min(2, Math.max(0.5, rate + delta)) * 100) / 100;
    setRate(r);
    setSpeechRate(r);
    speak(`Speech speed ${r.toFixed(2)}. This is how fast I will talk.`);
    const err = await updateProfile({ speech_rate: r });
    if (err) setMsg(`Could not save the speed. ${err}`);
  }

  async function save(patch: Partial<NonNullable<typeof profile>>, ok: string) {
    const err = await updateProfile(patch);
    say(err ? `Could not save. ${err}` : ok);
  }

  return (
    <Screen>
      <Heading>Speech</Heading>
      <Body>Speech speed: {rate.toFixed(2)}</Body>
      <BigButton label="Slower" onPress={() => changeRate(-0.1)} disabled={rate <= 0.5} />
      <BigButton label="Faster" onPress={() => changeRate(0.1)} disabled={rate >= 2} />

      <Heading>Navigation</Heading>
      <ToggleRow
        label="Avoid stairs"
        hint="Double tap to switch. Routes will use lifts and step-free paths only."
        value={!!profile?.avoid_stairs}
        onChange={(v) => save({ avoid_stairs: v }, v ? 'Avoid stairs is on.' : 'Avoid stairs is off.')}
      />

      <Heading>Emergency</Heading>
      <ToggleRow
        label="Share my last confirmed location when I send SOS"
        hint="Double tap to switch"
        value={profile?.share_location_in_sos !== false}
        onChange={(v) =>
          save({ share_location_in_sos: v }, v ? 'Location sharing in SOS is on.' : 'Location sharing in SOS is off.')
        }
      />
      <Field label="Emergency contact name" value={ecName} onChangeText={setEcName} />
      <Field label="Emergency contact phone" value={ecPhone} onChangeText={setEcPhone} keyboardType="phone-pad" />
      <BigButton
        label="Save emergency contact"
        variant="primary"
        onPress={() =>
          save(
            { emergency_contact_name: ecName.trim() || null, emergency_contact_phone: ecPhone.trim() || null },
            'Emergency contact saved.',
          )
        }
      />
      <LiveText>{msg}</LiveText>

      <Heading>Test mode</Heading>
      <Body>
        AccessAble is running in TEST MODE. SOS alerts go to the campus test dashboard only. No real emergency service
        is contacted and nobody is sent to help you. In a real emergency, call 112. AccessAble is not an emergency
        service.
      </Body>

      <BigButton label="Sign out" variant="ghost" onPress={() => signOut()} />
    </Screen>
  );
}
