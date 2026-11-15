import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { haptic } from '../lib/haptics';
import { colors, sizes } from '../lib/theme';

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!scroll) return <View style={[styles.screen, style]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.screenContent, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Heading({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text accessibilityRole="header" style={[styles.heading, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  muted,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
}) {
  return <Text style={[styles.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

/** Text that screen readers announce when it changes (Android live region). */
export function LiveText({
  children,
  style,
  assertive,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  assertive?: boolean;
}) {
  if (!children) return null;
  return (
    <Text
      accessibilityLiveRegion={assertive ? 'assertive' : 'polite'}
      style={[styles.body, style]}
    >
      {children}
    </Text>
  );
}

export function TestBadge() {
  return (
    <View
      accessible
      accessibilityLabel="Test mode. No real emergency service is contacted."
      style={styles.badge}
    >
      <Text style={styles.badgeText}>TEST MODE</Text>
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function BigButton({
  label,
  hint,
  onPress,
  onPressIn,
  onPressOut,
  variant = 'secondary',
  disabled,
  minHeight = sizes.minTarget,
  selected,
  style,
  accessibilityLabel,
  silentHaptic,
}: {
  label: string;
  hint?: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  variant?: Variant;
  disabled?: boolean;
  minHeight?: number;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  silentHaptic?: boolean;
}) {
  const v = variantStyles[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, selected: selected ?? undefined }}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => {
        if (!silentHaptic) haptic.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.button,
        { minHeight, backgroundColor: v.bg, borderColor: v.border },
        selected && styles.buttonSelected,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: v.fg }]}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptic.tap();
        onChange(!value);
      }}
      style={[styles.toggle, value && { borderColor: colors.accent }]}
    >
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
      <Text style={[styles.toggleState, value && { backgroundColor: colors.accent, color: colors.onAccent }]}>
        {value ? 'ON' : 'OFF'}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor="#A1A1A6"
        style={styles.input}
        {...props}
      />
    </View>
  );
}

const variantStyles: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
  secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
  danger: { bg: colors.sos, fg: colors.onSos, border: '#FFFFFF' },
  ghost: { bg: 'transparent', fg: colors.accent, border: colors.accent },
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: sizes.pad, gap: 12 },
  screenContent: { padding: sizes.pad, gap: 14, paddingBottom: 40 },
  heading: { color: colors.text, fontSize: sizes.large, fontWeight: '800' },
  body: { color: colors.text, fontSize: sizes.body, lineHeight: sizes.body * 1.4 },
  badge: {
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 4,
  },
  badgeText: { color: colors.accent, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  button: {
    borderWidth: 2,
    borderRadius: sizes.radius,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSelected: { borderWidth: 4, borderColor: colors.accent },
  buttonText: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  toggle: {
    minHeight: sizes.minTarget,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    backgroundColor: colors.surface,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleState: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 18,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  fieldLabel: { color: colors.text, fontSize: 18, fontWeight: '700' },
  input: {
    minHeight: sizes.minTarget,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  card: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 8,
  },
});
