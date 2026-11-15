import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiStatusBanner } from '../components/ApiStatusBanner';
import { SetupScreen } from '../components/SetupScreen';
import { SosBar } from '../components/SosBar';
import { TestBadge } from '../components/ui';
import { envOk } from '../lib/env';
import { colors } from '../lib/theme';
import { AppProvider, useApp } from '../state/app';
import { NavProvider } from '../state/nav';

function Gate() {
  const { ready, session, reduceMotion } = useApp();
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
          <Stack.Screen name="scan" options={title('Where am I')} />
          <Stack.Screen name="report" options={title('Report a problem')} />
          <Stack.Screen name="my-reports" options={title('My reports')} />
          <Stack.Screen name="settings" options={title('Settings')} />
          <Stack.Screen name="sos" options={{ ...title('SOS'), headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="sos-status" options={title('SOS status')} />
        </Stack.Protected>
      </Stack>
      <ApiStatusBanner />
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
          <NavProvider>
            <Gate />
          </NavProvider>
        </AppProvider>
      ) : (
        <SetupScreen />
      )}
    </SafeAreaProvider>
  );
}
