import * as Haptics from 'expo-haptics';

const safe = (p: Promise<unknown>) => {
  p.catch(() => undefined);
};

export const haptic = {
  tap: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  strong: () => safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
