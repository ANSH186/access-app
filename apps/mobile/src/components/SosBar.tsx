import { router, usePathname } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, sizes } from '../lib/theme';
import { haptic } from '../lib/haptics';
import { useApp } from '../state/app';
import { BigButton } from './ui';

const HIDDEN = ['/auth', '/sos', '/sos-status'];

/** Always-visible SOS button at the bottom of every main screen. Never inside a menu. */
export function SosBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { session, activeAlert } = useApp();
  if (!session || HIDDEN.includes(pathname)) return null;
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <BigButton
        label={activeAlert ? 'SOS — view my active alert' : 'SOS'}
        accessibilityLabel={activeAlert ? 'SOS. You have an active alert. View its status.' : 'SOS emergency help'}
        hint={
          activeAlert
            ? 'Opens the status of the alert you already sent.'
            : 'Opens a confirmation screen. Nothing is sent until you confirm.'
        }
        variant="danger"
        minHeight={sizes.sosTarget}
        silentHaptic
        onPress={() => {
          haptic.strong();
          router.push(activeAlert ? '/sos-status' : '/sos');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    paddingHorizontal: sizes.pad,
    paddingTop: 8,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
});
