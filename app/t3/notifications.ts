import {nativeService} from '../extensions/host';
import { Application, Utils } from '@nativescript/core';
import { readT3PhoneNotificationsEnabled, onT3PhoneNotificationsChanged } from './notification-preferences';
declare const com: any;
export interface T3PhoneNotification { id: string; threadId: string; title: string; text: string }
const java = () => com.faceclaw.app.FaceclawT3Notifications;
const postedIds = new Set<string>();
const observers = new Set<Set<string>>();
const context = () => Utils.android.getApplicationContext();
// Preference-driven removals must not dismiss the glasses' independent inbox.
const suppressedIds = new Set<string>();
let initialized = false;
export function initializeT3PhoneNotifications(): void {
  if (initialized) return;
  initialized = true;
  const sync = () => {
    if (readT3PhoneNotificationsEnabled()) return;
    for (const id of [...readNativeIds(), ...postedIds]) suppressedIds.add(id);
    postedIds.clear();
    for (const observer of observers) observer.clear();
    java().dismissAll(context());
  };
  onT3PhoneNotificationsChanged(sync);
  sync();
}

export function postT3Notification(notification: T3PhoneNotification): boolean {
  nativeService()?.postNotification(notification.id,notification.threadId,notification.title,notification.text,Date.now()+24*60*60*1000);
  if (!readT3PhoneNotificationsEnabled()) return false;
  if (!java().post(context(), notification.id, notification.threadId, notification.title, notification.text)) return false;
  suppressedIds.delete(notification.id);
  postedIds.add(notification.id);
  for (const observer of observers) observer.add(notification.id);
  return true;
}
export function dismissT3Notification(id: string): void { nativeService()?.removeNotification(id); java().dismiss(context(), id); }
function readNativeIds(): string[] {
  const ids = JSON.parse(String(java().activeIds(context())));
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}
export function readT3NotificationIds(): string[] {
  return readNativeIds().filter(id => !suppressedIds.has(id));
}
/** Detects explicit phone dismissal without requiring notification-listener permission. */
export function onT3NotificationRemoved(listener: (id: string) => void): () => void {
  let known = new Set([...readT3NotificationIds(), ...postedIds]);
  observers.add(known);
  const timer = setInterval(() => {
    const nativeIds = new Set(readNativeIds());
    for (const id of suppressedIds) if (!nativeIds.has(id)) suppressedIds.delete(id);
    if (!readT3PhoneNotificationsEnabled()) { known.clear(); return; }
    const current = new Set([...nativeIds].filter(id => !suppressedIds.has(id)));
    for (const id of known) if (!current.has(id)) { postedIds.delete(id); listener(id); }
    known.clear(); for (const id of current) known.add(id);
  }, 1000);
  return () => { clearInterval(timer); observers.delete(known); };
}

/** Initial launch + new intents, verified natively before exposing any thread ID. */
export function onT3ThreadOpenRequested(listener: (threadId: string) => void): () => void {
  let active = true;
  const handle = (intent: any) => {
    if (!active || !intent) return;
    const threadId = String(java().consumeThread(context(), intent));
    if (threadId) listener(threadId);
  };
  const onLaunch = (args: any) => handle(args.android);
  const onNewIntent = (args: any) => handle(args.intent);
  const onStarted = (args: any) => handle(args.activity?.getIntent());
  Application.on(Application.launchEvent, onLaunch);
  Application.android.on(Application.android.activityNewIntentEvent, onNewIntent);
  Application.android.on(Application.android.activityStartedEvent, onStarted);
  // Runtime may initialize after Application.launchEvent has already fired.
  const initial = setTimeout(() => handle((Application.android.foregroundActivity ?? Application.android.startActivity)?.getIntent()), 0);
  return () => {
    active = false; clearTimeout(initial);
    Application.off(Application.launchEvent, onLaunch);
    Application.android.off(Application.android.activityNewIntentEvent, onNewIntent);
    Application.android.off(Application.android.activityStartedEvent, onStarted);
  };
}
