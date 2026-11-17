import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen, ToggleRow, styles as ui } from '../components/ui';
import { api, errorToSpeech } from '../lib/api';
import { DEFAULT_API_URL, getServerUrl, resetServerUrl, setServerUrl } from '../lib/server';
import { getSpeechRate, setSpeechRate, speak } from '../lib/speech';
import { nativeSpeechAvailable, requestVoicePermission } from '../lib/speechRecognition';
import { colors } from '../lib/theme';
import type { Diagnostics } from '../lib/types';
import { useApp } from '../state/app';

export default function Settings() {
  const { profile, updateProfile, signOut, handsFree, setHandsFree } = useApp();
  const [rate, setRate] = useState(getSpeechRate());
  const [ecName, setEcName] = useState(profile?.emergency_contact_name ?? '');
  const [ecPhone, setEcPhone] = useState(profile?.emergency_contact_phone ?? '');
  const [msg, setMsg] = useState('');
  const [server, setServer] = useState('');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getServerUrl().then(setServer).catch(() => undefined);
  }, []);

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

  async function testServer() {
    if (testing) return;
    setTesting(true);
    say('Testing the server connection.');
    try {
      const h = await api.health();
      let d: Diagnostics | null = null;
      try {
        d = await api.diagnostics();
      } catch {
        d = null;
      }
      setDiag(d);
      if (d) {
        say(
          `Server version ${h.version} is online. Map: ${d.map.source}, ${d.map.nodes} places. ` +
            `AI is ${d.ai.configured ? 'configured' : 'not configured on the server'}.`,
        );
      } else {
        say(`Server version ${h.version} is online. The detailed check needs you to be signed in.`);
      }
    } catch (e) {
      say(`The server test failed. ${errorToSpeech(e)}`);
    } finally {
      setTesting(false);
    }
  }

  async function checkVoice() {
    if (!nativeSpeechAvailable) {
      say(
        'On-device voice recognition is not available in this preview. The Talk button will record your voice and send it to the server instead.',
      );
      return;
    }
    const ok = await requestVoicePermission();
    say(ok ? 'Microphone and speech recognition are ready.' : 'Speech recognition permission was not granted.');
  }

  return (
    <Screen>
      <Heading>Voice and speech</Heading>
      <Body>Speech speed: {rate.toFixed(2)}</Body>
      <BigButton label="Slower" onPress={() => changeRate(-0.1)} disabled={rate <= 0.5} />
      <BigButton label="Faster" onPress={() => changeRate(0.1)} disabled={rate >= 2} />

      <ToggleRow
        label="Hands-free voice mode"
        hint="When on, the app listens for a command after it finishes speaking. Best with the installed app. Not available in Expo Go."
        value={handsFree}
        onChange={(v) => {
          if (v && !nativeSpeechAvailable) {
            setHandsFree(false);
            speak(
              'Hands-free voice needs the installed AccessAble app. In this preview, press the Talk button and speak, or type your command.',
            );
            return;
          }
          setHandsFree(v);
          speak(
            v
              ? 'Hands-free voice is on. After I finish speaking, say your command. Say stop listening to turn it off.'
              : 'Hands-free voice is off. Use the Talk button at the bottom.',
          );
        }}
      />
      <BigButton label="Check microphone and speech recognition" onPress={checkVoice} />
      <BigButton label="Read this screen" onPress={() => speak(
        'Settings. Change speech speed, hands-free voice, emergency contact, server connection and safety information.',
      )} />

      <Heading>Navigation</Heading>
      <ToggleRow
        label="Avoid stairs"
        hint="Routes will use lifts and step-free paths only."
        value={!!profile?.avoid_stairs}
        onChange={(v) => save({ avoid_stairs: v }, v ? 'Avoid stairs is on.' : 'Avoid stairs is off.')}
      />
      <Body muted>
        NIE North Campus uses a schematic map traced from satellite imagery. It is not yet verified on site. GPS progress
        is approximate.
      </Body>

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

      <Heading>Server connection</Heading>
      <Body muted>
        Default server: {DEFAULT_API_URL || 'not set'}. Leave the box empty to use the default.
      </Body>
      <Field
        label="Server address"
        value={server}
        onChangeText={setServer}
        autoCapitalize="none"
        keyboardType="url"
        hint="Only change this if you are testing a local or tunnel server."
      />
      <BigButton
        label="Save server address"
        onPress={async () => {
          const saved = await setServerUrl(server);
          setServer(saved);
          say('Server address saved. Testing it now.');
          void testServer();
        }}
      />
      <BigButton
        label="Reset to default server"
        onPress={async () => {
          const saved = await resetServerUrl();
          setServer(saved);
          say('Server address reset to the default.');
        }}
      />
      <BigButton label={testing ? 'Testing…' : 'Test server connection'} variant="primary" disabled={testing} onPress={testServer} />
      {diag && (
        <View style={ui.card} accessible>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>Server status</Text>
          <Body>Map: {diag.map.ok ? 'working' : 'not working'} ({diag.map.source}, {diag.map.nodes} places).</Body>
          <Body>AI: {diag.ai.configured ? `configured (${diag.ai.model})` : 'not configured'}.</Body>
          <Body>Database: {diag.database.configured ? 'configured' : 'not configured'}.</Body>
        </View>
      )}

      <Heading>Test mode and safety</Heading>
      <Body>
        AccessAble is running in TEST MODE. SOS alerts go to the campus test dashboard only. No real emergency service
        is contacted and nobody is sent to help you. In a real emergency, call 112. AccessAble is not an emergency
        service.
      </Body>
      <LiveText>{msg}</LiveText>

      <BigButton label="Sign out" variant="ghost" onPress={() => signOut()} />
    </Screen>
  );
}
