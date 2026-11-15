import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WAKING_MESSAGE, subscribeSlow } from '../lib/api';
import { colors } from '../lib/theme';

/** Shown while any API request is taking longer than 5 s (Render free tier waking up). */
export function ApiStatusBanner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => subscribeSlow(setSlow), []);
  if (!slow) return null;
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{WAKING_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surfaceHi, borderTopWidth: 2, borderTopColor: colors.accent, padding: 10 },
  text: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
