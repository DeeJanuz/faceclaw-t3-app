import { Utils } from '@nativescript/core';
import { getStringSetting, setStringSetting, onSettingsStoreChanged } from '../native/settings-store';
import { bridgeEndpoint, validateToken } from './security';
import { readT3NotificationApps, saveT3NotificationApps } from './notification-preferences';
import { normalizeT3ActivityIndicatorMode, T3_ACTIVITY_INDICATOR_MODES, type T3ActivityIndicatorMode } from './activity-indicator-mode';
declare const com: any;
export interface T3Config {
  enabled: boolean; pairingFingerprint: string; bridgeUrl: string; token: string; allowInsecureLocal: boolean;
  preferAssistant: boolean; assistantProjectId: string; assistantEnvironmentId?: string; assistantProvider: string;
  assistantModel: string; assistantReasoning: string; bridgeDictation: boolean;
  notificationOverride: boolean;
  notificationExcludedApps: string[];
  activityIndicatorMode: T3ActivityIndicatorMode;
  refinementProvider: 'anthropic' | 't3'; allowTools: boolean; deviceId: string;
}
const defaults: T3Config = { enabled: false, pairingFingerprint: '', bridgeUrl: 'ws://10.0.2.2:8787', token: '', allowInsecureLocal: false, preferAssistant: false, assistantProjectId: '', assistantEnvironmentId: '', assistantProvider: '', assistantModel: '', assistantReasoning: '', bridgeDictation: false, notificationOverride: false, notificationExcludedApps: [], activityIndicatorMode: 'fluid', refinementProvider: 't3', allowTools: false, deviceId: 'faceclaw-t3' };
const key = 't3.config';
function secrets(): any { return com.faceclaw.app.FaceclawT3Secrets; }
export function getT3Config(): T3Config {
  let saved: Partial<T3Config> = {};
  try { saved = JSON.parse(getStringSetting(key, '{}')); } catch { /* Defaults for corrupt non-secret settings. */ }
  const token = String(secrets().read(Utils.android.getApplicationContext()));
  return { ...defaults, ...saved, activityIndicatorMode: normalizeT3ActivityIndicatorMode(saved.activityIndicatorMode), notificationExcludedApps: readT3NotificationApps(), token, pairingFingerprint: String(secrets().fingerprint(token)) };
}
export function saveT3Config(update: Partial<T3Config>): void {
  // Notification app choices are local preferences, not a bridge reconfiguration.
  if (Object.keys(update).length === 1 && update.notificationExcludedApps !== undefined) { saveT3NotificationApps(update.notificationExcludedApps); return; }
  const next = { ...getT3Config(), ...update };
  if (next.assistantEnvironmentId && !/^[A-Za-z0-9_-]{1,256}$/.test(next.assistantEnvironmentId)) throw new Error('T3_CONFIG_INVALID');
  bridgeEndpoint(next.bridgeUrl, next.allowInsecureLocal);
  if (next.token) validateToken(next.token);
  if (next.refinementProvider !== 'anthropic' && next.refinementProvider !== 't3') throw new Error('T3_CONFIG_INVALID');
  if (!T3_ACTIVITY_INDICATOR_MODES.includes(next.activityIndicatorMode)) throw new Error('T3_CONFIG_INVALID');
  if (!Array.isArray(next.notificationExcludedApps) || next.notificationExcludedApps.length > 2048 || next.notificationExcludedApps.some(name => typeof name !== 'string' || name.length > 255 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name))) throw new Error('T3_NOTIFICATION_APPS_INVALID');
  next.notificationExcludedApps = [...new Set(next.notificationExcludedApps)];
  const { token, pairingFingerprint: _derivedIdentity, notificationExcludedApps: _localApps, ...settings } = next;
  secrets().write(Utils.android.getApplicationContext(), token);
  setStringSetting(key, JSON.stringify(settings));
  if (update.notificationExcludedApps !== undefined) saveT3NotificationApps(next.notificationExcludedApps);
}
export function onT3ConfigChanged(listener: () => void): () => void {
  return onSettingsStoreChanged((changed) => { if (changed === key) listener(); });
}
