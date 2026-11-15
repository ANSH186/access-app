import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { Body, BigButton, Field, Heading, LiveText, Screen, ToggleRow } from '../components/ui';
import { savePendingProfile } from '../lib/storage';
import { speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    speak('Welcome to AccessAble. Sign in with your email and password, or choose create account.');
  }, []);

  const say = (t: string) => {
    setMsg(t);
    speak(t);
  };

  async function submit() {
    if (busy) return;
    const e = email.trim();
    if (!e || !password) return say('Please enter your email and password.');
    if (mode === 'up' && !name.trim()) return say('Please enter your name.');
    if (mode === 'up' && password.length < 6) return say('Choose a password with at least 6 characters.');
    setBusy(true);
    say(mode === 'in' ? 'Signing in.' : 'Creating your account.');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password });
        if (error) say(`Sign in failed. ${error.message}`);
        // Success: the auth listener swaps to the home screen.
      } else {
        const fields = {
          display_name: name.trim(),
          phone: phone.trim() || null,
          emergency_contact_name: ecName.trim() || null,
          emergency_contact_phone: ecPhone.trim() || null,
          share_location_in_sos: consent,
        };
        const { data, error } = await supabase.auth.signUp({
          email: e,
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (error) {
          say(`Could not create the account. ${error.message}`);
        } else if (data.session) {
          const { error: upErr } = await supabase.from('profiles').update(fields).eq('id', data.session.user.id);
          if (upErr) await savePendingProfile(e, fields); // applied on next profile load
        } else {
          await savePendingProfile(e, fields);
          setMode('in');
          say('Account created. Check your email to confirm it, then sign in.');
        }
      }
    } catch (err) {
      say(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Heading>{mode === 'in' ? 'Sign in' : 'Create account'}</Heading>
        <Body muted>AccessAble helps blind and low-vision students move around campus. This is a test version.</Body>
        {mode === 'up' && (
          <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        )}
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          textContentType={mode === 'in' ? 'password' : 'newPassword'}
        />
        {mode === 'up' && (
          <>
            <Field label="Your phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Field
              label="Emergency contact name (optional)"
              value={ecName}
              onChangeText={setEcName}
            />
            <Field
              label="Emergency contact phone (optional)"
              value={ecPhone}
              onChangeText={setEcPhone}
              keyboardType="phone-pad"
            />
            <ToggleRow
              label="Share my last confirmed location when I send SOS"
              hint="Double tap to switch on or off"
              value={consent}
              onChange={setConsent}
            />
          </>
        )}
        <LiveText>{msg}</LiveText>
        <BigButton
          label={mode === 'in' ? 'Sign in' : 'Create account'}
          variant="primary"
          disabled={busy}
          onPress={submit}
        />
        <BigButton
          label={mode === 'in' ? 'I need an account' : 'I already have an account'}
          variant="ghost"
          onPress={() => {
            setMsg('');
            setMode(mode === 'in' ? 'up' : 'in');
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
