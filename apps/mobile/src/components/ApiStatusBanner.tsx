import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WAKING_MESSAGE, subscribeOnline, subscribeSlow } from '../lib/api';
import { colors } from '../lib/theme';

/** Shows server health without blocking the whole screen. */
export function ApiStatusBanner() {
  const [slow, setSlow] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const a = subscribeSlow(setSlow);
    const b = subscribeOnline(setOnline);
    return () => {
      a();
      b();
    };
  }, []);

  if (slow) {
    return (
      <View style={styles.box} accessibilityLiveRegion="polite">
        <Text style={styles.text}>{WAKING_MESSAGE}</Text>
      </View>
    );
  }
  if (online === false) {
    return (
      <View style={[styles.box, styles.offline]} accessibilityLiveRegion="polite">
        <Text style={styles.text}>
          Server offline. Saved-map navigation still works. AI, news and account changes need internet.
        </Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surfaceHi, borderTopWidth: 2, borderTopColor: colors.accent, padding: 10 },
  offline: { borderTopColor: colors.sos },
  text: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
});
