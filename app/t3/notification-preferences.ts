import type { T3Config } from './config';
import { getStringSetting, setStringSetting, onSettingsStoreChanged } from '../native/settings-store';

const APPS_KEY = 't3.notification-apps';
const PHONE_NOTIFICATIONS_KEY = 't3.phone-notifications';
const NOTIFICATION_PREVIEW_SECONDS_KEY = 't3.notification-preview-seconds';

export type T3NotificationPreviewSeconds = 3 | 5 | 7 | 10;
export const T3_NOTIFICATION_PREVIEW_SECONDS: readonly T3NotificationPreviewSeconds[] = [3, 5, 7, 10];
const DEFAULT_NOTIFICATION_PREVIEW_SECONDS: T3NotificationPreviewSeconds = 5;

function isNotificationPreviewSeconds(value: unknown): value is T3NotificationPreviewSeconds {
  return typeof value === 'number' && T3_NOTIFICATION_PREVIEW_SECONDS.includes(value as T3NotificationPreviewSeconds);
}

/** Duration of the T3-owned glasses arrival preview. Missing or corrupt data uses five seconds. */
export function readT3NotificationPreviewSeconds(): T3NotificationPreviewSeconds {
  const stored = getStringSetting(NOTIFICATION_PREVIEW_SECONDS_KEY, '');
  if (stored !== '3' && stored !== '5' && stored !== '7' && stored !== '10') return DEFAULT_NOTIFICATION_PREVIEW_SECONDS;
  return Number(stored) as T3NotificationPreviewSeconds;
}

export function saveT3NotificationPreviewSeconds(seconds: T3NotificationPreviewSeconds): void {
  if (!isNotificationPreviewSeconds(seconds)) throw new Error('T3_NOTIFICATION_PREVIEW_SECONDS_INVALID');
  setStringSetting(NOTIFICATION_PREVIEW_SECONDS_KEY, String(seconds));
}

export function onT3NotificationPreviewSecondsChanged(listener: () => void): () => void {
  return onSettingsStoreChanged(key => { if (key === NOTIFICATION_PREVIEW_SECONDS_KEY) listener(); });
}

/** Phone posting is independent of glasses forwarding and defaults to off. */
export function readT3PhoneNotificationsEnabled(): boolean {
  return getStringSetting(PHONE_NOTIFICATIONS_KEY, 'false') === 'true';
}

export function saveT3PhoneNotificationsEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new Error('T3_PHONE_NOTIFICATIONS_INVALID');
  setStringSetting(PHONE_NOTIFICATIONS_KEY, String(enabled));
}

export function onT3PhoneNotificationsChanged(listener: () => void): () => void {
  return onSettingsStoreChanged(key => { if (key === PHONE_NOTIFICATIONS_KEY) listener(); });
}

export function readT3NotificationApps(): string[] {
  try {
    const value = JSON.parse(getStringSetting(APPS_KEY, '[]'));
    return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
  } catch { return []; }
}

export function saveT3NotificationApps(excluded: string[]): void {
  if (!Array.isArray(excluded) || excluded.length > 2048 || excluded.some(name => typeof name !== 'string' || name.length > 255 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name))) throw new Error('T3_NOTIFICATION_APPS_INVALID');
  setStringSetting(APPS_KEY, JSON.stringify([...new Set(excluded)]));
}

export function onT3NotificationAppsChanged(listener: () => void): () => void {
  return onSettingsStoreChanged(key => { if (key === APPS_KEY) listener(); });
}

/** UI exclusions can only narrow the native access/importance-filtered snapshot. */
export function allowsT3PhoneNotification(packageName: string, config: Pick<T3Config, 'notificationOverride' | 'notificationExcludedApps'>): boolean {
  if (config.notificationOverride !== true) return true;
  const excluded = config.notificationExcludedApps;
  return (!Array.isArray(excluded) || !excluded.includes(packageName));
}
