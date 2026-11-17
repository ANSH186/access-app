import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiStatusBanner } from '../components/ApiStatusBanner';
import { SetupScreen } from '../components/SetupScreen';
import { SosBar } from '../components/SosBar';
import { VoiceBar } from '../components/VoiceBar';
import { TestBadge } from '../components/ui';
import { envOk } from '../lib/env';
import { api } from '../lib/api';
import { colors } from '../lib/theme';
import { AppProvider, useApp } from '../state/app';
import { NavProvider } from '../state/nav';
import { VoiceActionsProvider } from '../state/voice';

function Gate() {
  const { ready, session, reduceMotion } = useApp();
  React.useEffect(() => {
    const ping = () => {
      api.health().catch(() => undefined);
    };
    ping();
    const t = setInterval(ping, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Loading" />
      </View>
    );
  }
  const signedIn = !!session;
  const title = (t: string) => ({ title: t, headerTitle: t });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text, fontWeight: '800', fontSize: 22 },
          headerRight: () => <TestBadge />,
          contentStyle: { backgroundColor: colors.bg },
          animation: reduceMotion ? 'none' : 'default',
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="auth" options={title('Sign in')} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={title('AccessAble')} />
          <Stack.Screen name="navigate" options={title('Navigate')} />
          <Stack.Screen name="camera" options={title('Camera')} />
          <Stack.Screen name="scan" options={title('Scan checkpoint')} />
          <Stack.Screen name="where-am-i" options={title('Where am I')} />
          <Stack.Screen name="news" options={title('News')} />
          <Stack.Screen name="help" options={title('Voice help')} />
          <Stack.Screen name="more" options={title('More options')} />
          <Stack.Screen name="report" options={title('Report a problem')} />
          <Stack.Screen name="my-reports" options={title('My reports')} />
          <Stack.Screen name="settings" options={title('Settings')} />
          <Stack.Screen name="sos" options={{ ...title('SOS'), headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="sos-status" options={title('SOS status')} />
        </Stack.Protected>
      </Stack>
      <ApiStatusBanner />
      <VoiceBar />
      <SosBar />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {envOk ? (
        <AppProvider>
          <VoiceActionsProvider>
            <NavProvider>
              <Gate />
            </NavProvider>
          </VoiceActionsProvider>
        </AppProvider>
      ) : (
        <SetupScreen />
      )}
    </SafeAreaProvider>
  );
}
