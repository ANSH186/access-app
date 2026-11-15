import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { router, useIsFocused } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { BigButton, Body, Field, Heading, LiveText, Screen } from '../components/ui';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { api, errorToSpeech } from '../lib/api';
import { locationText } from '../lib/format';
import { haptic } from '../lib/haptics';
import { speak } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { REPORT_CATEGORIES } from '../lib/types';
import { useApp } from '../state/app';

export default function ReportScreen() {
  const { session, location } = useApp();
  const focused = useIsFocused();
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [useCheckpoint, setUseCheckpoint] = useState(!!location);
  const [cameraOn, setCameraOn] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const say = (t: string) => {
    setStatus(t);
    speak(t);
  };

  useEffect(() => {
    speak('What kind of problem do you want to report? Choose a category.');
  }, []);

  const voice = useVoiceCapture(async (uri) => {
    setBusy(true);
    setStatus('Listening to your description…');
    try {
      const cmd = await api.commandAudio(uri);
      if (cmd.transcript.trim()) {
        setDescription((d) => (d ? `${d} ${cmd.transcript.trim()}` : cmd.transcript.trim()));
        say(`Added to your description: ${cmd.transcript}`);
      } else {
        say('I did not catch that. Please try again.');
      }
    } catch (e) {
      say(errorToSpeech(e));
    } finally {
      setBusy(false);
    }
  });

  async function takePhoto() {
    if (!cam.current || busy) return;
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.8 });
      const actions =
        Math.max(pic.width, pic.height) > 1280
          ? [{ resize: pic.width >= pic.height ? { width: 1280 } : { height: 1280 } }]
          : [];
      const out = await manipulateAsync(pic.uri, actions, { compress: 0.7, format: SaveFormat.JPEG });
      setPhotoUri(out.uri);
      setCameraOn(false);
      haptic.success();
      say('Photo added.');
    } catch {
      say('I could not take the photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    if (!category) return say('Please choose a category first.');
    if (!session) return say('Please sign in again.');
    setBusy(true);
    say('Sending your report…');
    try {
      let photoPath: string | null = null;
      if (photoUri) {
        const path = `${session.user.id}/${randomUUID()}.jpg`;
        const buf = await (await fetch(photoUri)).arrayBuffer();
        const { error: upErr } = await supabase.storage
          .from('report-photos')
          .upload(path, buf, { contentType: 'image/jpeg' });
        if (upErr) {
          say(`The photo could not be uploaded. ${upErr.message} You can remove the photo and send the report without it.`);
          return;
        }
        photoPath = path;
      }
      const { error } = await supabase.from('obstacle_reports').insert({
        reporter_id: session.user.id,
        category,
        description: description.trim() || null,
        photo_path: photoPath,
        node_id: useCheckpoint && location ? location.node_id : null,
      });
      if (error) {
        say(`Your report was not sent. ${error.message}`);
        haptic.error();
        return;
      }
      haptic.success();
      speak('Thank you. Your report was sent. Staff will review it.');
      router.replace('/my-reports');
    } catch (e) {
      say(`Your report was not sent. ${errorToSpeech(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (cameraOn) {
    if (!perm?.granted) {
      return (
        <Screen>
          <Heading>Camera permission needed</Heading>
          <BigButton label="Allow camera" variant="primary" onPress={requestPerm} />
          <BigButton label="Cancel" onPress={() => setCameraOn(false)} />
        </Screen>
      );
    }
    return (
      <Screen>
        <Heading>Photo of the problem</Heading>
        {focused && (
          <View style={{ height: 340, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: colors.border }}>
            <CameraView ref={cam} style={{ flex: 1 }} facing="back" accessibilityLabel="Camera preview" />
          </View>
        )}
        <BigButton label="Take photo" variant="primary" minHeight={96} disabled={busy} onPress={takePhoto} />
        <BigButton label="Cancel" onPress={() => setCameraOn(false)} />
        <LiveText>{status}</LiveText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>What is the problem?</Heading>
      {REPORT_CATEGORIES.map((c) => (
        <BigButton
          key={c.value}
          label={c.label}
          selected={category === c.value}
          onPress={() => {
            setCategory(c.value);
            speak(`${c.label} selected.`);
          }}
        />
      ))}

      <Heading>Where is it?</Heading>
      {location && (
        <BigButton
          label={`At my last confirmed place: ${locationText(location)}`}
          selected={useCheckpoint}
          onPress={() => setUseCheckpoint(true)}
        />
      )}
      <BigButton
        label="Near the corridor I'm in (no checkpoint)"
        selected={!useCheckpoint || !location}
        onPress={() => setUseCheckpoint(false)}
      />

      <Field
        label="Describe it (optional)"
        value={description}
        onChangeText={setDescription}
        multiline
        style={{ minHeight: 110, textAlignVertical: 'top', fontSize: 22 }}
        hint="Type, or use the Dictate button below"
      />
      <BigButton
        label={voice.state === 'recording' ? 'Tap to stop dictating' : 'Dictate description'}
        hint="Tap, speak, then tap again. Your words are added to the description."
        disabled={busy || voice.state === 'processing'}
        onPress={() => voice.toggle()}
      />

      {photoUri ? (
        <>
          <Body>A photo is attached.</Body>
          <BigButton label="Remove photo" onPress={() => setPhotoUri(null)} />
        </>
      ) : (
        <BigButton label="Add a photo (optional)" onPress={() => setCameraOn(true)} />
      )}

      <LiveText>{status}</LiveText>
      <BigButton label="Send report" variant="primary" minHeight={80} disabled={busy} onPress={submit} />
      <BigButton label="My reports" onPress={() => router.push('/my-reports')} />
    </Screen>
  );
}
