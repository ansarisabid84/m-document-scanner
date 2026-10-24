import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { getSettings } from './settings';
import { isNative } from './platform';

/** Haptics only for meaningful events, and only when enabled. */
export function tap(style: 'light' | 'medium' = 'light') {
  if (!isNative || !getSettings().haptics) return;
  Haptics.impact({ style: style === 'light' ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => undefined);
}
export function success() {
  if (!isNative || !getSettings().haptics) return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => undefined);
}
