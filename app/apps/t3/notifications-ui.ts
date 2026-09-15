import { resourceKey } from './resource';
import {ownsFeature} from '../../extensions/host';
import { invokeExternalNotification, hasExternalNotification, invalidateExternalNotificationReplies, type NotificationReplyStatus } from "../../native/external-notifications";
import { getT3Config, onT3ConfigChanged } from "../../t3/config";
import { allowsT3PhoneNotification, onT3NotificationAppsChanged } from '../../t3/notification-preferences';
import { shell } from '../../ui/shell/shell';
import { readActiveNotifications, dismissNotification,dismissNotifications, requestNotificationReply, onAndroidNotificationRemoved, onAndroidNotificationsChanged, type AndroidNotification } from '../../native/notification-icons';
import { setNotificationOpenRoute } from '../../ui/notification-routing';
import { initializeT3PhoneNotifications, postT3Notification, dismissT3Notification, onT3NotificationRemoved, onT3ThreadOpenRequested } from '../../t3/notifications';
import { t3Workspace as state, connectT3 } from './runtime';
import { showT3AlertInCurrentConversation, isT3FlowProtected, openT3Thread, openT3Notification } from './t3-app';
import type { T3Alert } from './workspace';

let openWindow: () => Promise<void> = async () => {};
let initialized = false;
let openingNotification = false;
// Private APK content must never enter workspace snapshots or assistant tools.
const externalArrivals = new Map<string, T3Alert>();
const trackedT3Alerts = new Set<string>();
function pairingIdentity(): string {
  const config = getT3Config();
  return JSON.stringify([config.bridgeUrl, config.pairingFingerprint]);
}

function phoneAlert(notification: AndroidNotification): T3Alert {
  const messages = notification.messages || [];
  const latest = messages[messages.length - 1];
  const content = notification.bigText || notification.text;
  const messageText = (message: typeof latest) => `${message.sender ? `${message.sender}: ` : ''}${message.text || (message.attachment ? '[Attachment]' : '')}`;
  return { id: `phone:${notification.key}:${notification.postTime}`, kind: 'phone', threadId: notification.key,
    groupId: phoneConversationId(notification),
    title: notification.title || notification.appName,
    body: latest ? messages.map(messageText).join('\n\n') : [content, notification.lines.join('\n'), notification.subText, notification.infoText, notification.summaryText].filter(Boolean).join('\n'),
    previewBody: latest ? messageText(latest) : content || notification.lines[notification.lines.length - 1] || '',
    arrivalFingerprint: notification.key.startsWith('apk:') ? JSON.stringify(['apk', notification.key, notification.title, content]) : latest ? JSON.stringify(['message', latest.timestamp, latest.sender, latest.text, latest.attachment]) : JSON.stringify(['content', notification.title, content, notification.lines]),
    createdAt: notification.postTime };
}

function phoneConversationId(notification: AndroidNotification): string {
  const external = notification as AndroidNotification & { component?: string; target?: string };
  if (notification.key.startsWith("apk:") && external.component && external.target)
    return JSON.stringify(['apk-conversation', external.component, external.target]);
  // Group keys and sender labels can span unrelated conversations. Only Android's
  // app/user-scoped shortcut identifies a thread across notification key changes.
  return notification.conversationId && Number.isSafeInteger(notification.userId) && notification.userId! >= 0
    ? JSON.stringify(['conversation', notification.packageName, notification.userId, notification.conversationId])
    : JSON.stringify(['notification', notification.key]);
}

function isBackgroundStatus(notification: AndroidNotification): boolean {
  if (notification.category === 'msg' || notification.messages?.length) return false;
  return notification.category === 'service' || notification.isForegroundService === true;
}

function allowedPhoneNotifications(): AndroidNotification[] {
  const config = getT3Config();
  return readActiveNotifications(50, true).filter(notification => allowsT3PhoneNotification(notification.packageName, config) && !isBackgroundStatus(notification));
}

function groupedPhoneNotifications(): AndroidNotification[] {
  const native = allowedPhoneNotifications();
  const distinct = native.filter(notification => !notification.isGroupSummary || !notification.groupKey ||
    !native.some(child => !child.isGroupSummary && child.groupKey === notification.groupKey && child.packageName === notification.packageName && child.userId === notification.userId));
  const groups = new Map<string, AndroidNotification[]>();
  for (const notification of distinct) {
    const key = phoneConversationId(notification);
    groups.set(key, [...(groups.get(key) || []), notification]);
  }
  const latestTime = (notification: AndroidNotification) => Math.max(0, ...(notification.messages || []).map(message => message.timestamp));
  return [...groups.values()].map(group => {
    group.sort((a, b) => latestTime(b) - latestTime(a) || b.postTime - a.postTime);
    const messages = new Map<string, NonNullable<AndroidNotification['messages']>[number]>();
    for (const notification of [...group].reverse()) for (const message of notification.messages || []) {
      messages.set(JSON.stringify([message.timestamp, message.sender, message.text, message.attachment]), message);
    }
    if (group[0].key.startsWith('apk:')) return { ...group[0], messages: [...group].reverse().map(item => ({ text: item.text, sender: item.title, timestamp: item.postTime, attachment: false })) };
    return { ...group[0], messages: [...messages.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-50) };
  });
}

/** Always use the native filtered snapshot, including changed importance and revoked access. */
export function visibleT3Alerts(): T3Alert[] {
  if (state.demo) return state.alerts;
  return [...state.alerts.filter(alert => alert.kind === 't3'), ...groupedPhoneNotifications().map(phoneAlert)]
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
}

export function findT3Alert(id: string): T3Alert | undefined {
  return visibleT3Alerts().find(alert => alert.id === id);
}

/** Bind a reviewed reply to one authorized native version and free-form action. */
export function getT3NotificationReply(id: string): { isCurrent: () => boolean; review: (current?:()=>boolean) => Promise<NotificationReplyStatus> } | undefined {
 if(state.demo || getT3Config().notificationOverride!==true||!ownsFeature('ui.notifications'))return undefined;
 const alert=findT3Alert(id);if(alert?.kind!=='phone')return undefined;
 const notification=allowedPhoneNotifications().find(n=>n.key===alert.threadId && n.postTime===alert.createdAt);
 const action=notification?.actions.find(a=>a.enabled&&a.acceptsText);
 if(!notification||!action)return undefined;
 const pairing=pairingIdentity();let requested=false;
 const isCurrent=()=>!state.demo&&getT3Config().notificationOverride===true&&pairingIdentity()===pairing&&Boolean(findT3Alert(id));
 return {isCurrent,async review(current=()=>true){if(requested||!isCurrent()||!current())return 'rejected';requested=true;try{const result=await requestNotificationReply(notification.key,notification.postTime,action.index,()=>current()&&pairingIdentity()===pairing&&getT3Config().notificationOverride===true);return ['sent','draft-saved','unknown','rejected'].includes(result.status)?result.status:'unknown';}catch(error){return ['NOTIFICATION_REVIEW_STALE','HOST_CAPABILITY_UNAVAILABLE','HOST_ACTION_UNAVAILABLE','HOST_ACTION_DUPLICATE'].includes(error instanceof Error?error.message:'')?'rejected':'unknown';}}};
}

async function openNotificationUi(notificationKey?: string, returnToSleep = false): Promise<boolean> {
  if (openingNotification) return false;
  openingNotification = true;
  const pairing = pairingIdentity();
  try {
    // An explicit system notification open may leave sample mode, as native T3 opens do.
    if (state.demo) await connectT3();
    if (state.demo || getT3Config().notificationOverride !== true || pairing !== pairingIdentity()) return false;
    const source = notificationKey ? allowedPhoneNotifications().find(item => item.key === notificationKey) : undefined;
    if (notificationKey && !source) return false;
    const alert = source ? visibleT3Alerts().find(item => item.kind === 'phone' && item.groupId === phoneConversationId(source)) : undefined;
    if (notificationKey && !alert) return false;
    const foreground = shell.foregroundWindow()?.windowId;
    const previous = foreground === 'notifications' ? undefined : foreground;
    await openWindow();
    if (state.demo || getT3Config().notificationOverride !== true || pairing !== pairingIdentity() || (alert && !findT3Alert(alert.id)) ||
        (source && !allowedPhoneNotifications().some(item => item.key === source.key && item.postTime === source.postTime))) return false;
    shell.focusWindow('t3');
    openT3Notification(alert?.id, previous, returnToSleep);
    return true;
  } catch {
    if (pairing === pairingIdentity() && !state.demo) state.fail(new Error('T3_NOTIFICATION_OPEN_FAILED'));
    return false;
  } finally {
    openingNotification = false;
  }
}

export function initializeT3Notifications(launch: () => Promise<void>): void {
  openWindow = launch;
  setNotificationOpenRoute((key, returnToSleep = false) => {
    if (getT3Config().notificationOverride !== true) return false;
    void openNotificationUi(key, returnToSleep);
    return true;
  });
  if (initialized) return;
  initialized = true;
  initializeT3PhoneNotifications();
  const refreshNotificationPreferences = () => {
    const allowed = state.demo ? [] : visibleT3Alerts();
    if (!ownsFeature('ui.notifications')) {
      // The grant is the authority for both preview presentation and the
      // optional phone copy. Retire tracked copies when it is revoked.
      for (const id of trackedT3Alerts) dismissT3Notification(id);
      trackedT3Alerts.clear();
    }
    for (const [group, alert] of externalArrivals) {
      if (getT3Config().notificationOverride !== true || !allowed.some(current => current.id === alert.id || current.groupId === group) || !hasExternalNotification(alert.threadId)) {
        shell.closeNotificationPreview(alert.id);
        externalArrivals.delete(group);
      }
    }
    if (state.demo) return;
    for (const alert of state.alerts.filter(alert => alert.kind === 'phone' && !allowed.some(current => current.id === alert.id || (alert.groupId && current.groupId === alert.groupId)))) {
      shell.closeNotificationPreview(alert.id);
      state.removeAlert(alert.id);
    }
    state.changed();
  };
  const preferencesChanged = () => {
    invalidateExternalNotificationReplies(); refreshNotificationPreferences();
    // Settings reveal cached cards, never replay their earlier arrival on a repost.
    if (!state.demo) for (const alert of visibleT3Alerts()) if (alert.kind === 'phone' && alert.threadId.startsWith('apk:'))
      externalArrivals.set(alert.groupId || alert.threadId, alert);
  };
  onT3ConfigChanged(preferencesChanged);
  onT3NotificationAppsChanged(preferencesChanged);
  onAndroidNotificationsChanged(refreshNotificationPreferences);
  // Glasses preview cleanup is independent of optional phone posting.
  state.onChange(() => {
    if (state.demo) return;
    const active = new Set(state.alerts.map(alert => alert.id));
    for (const id of trackedT3Alerts) {
      if (!active.has(id)) { dismissT3Notification(id); trackedT3Alerts.delete(id); shell.closeNotificationPreview(id); }
    }
  });
  const presentArrival = (alert: T3Alert, hostPresentationId?: string) => {
    if (alert.kind === 'phone' && !findT3Alert(alert.id)) return;
    // Keep inbox/history bookkeeping. A matching current reader supplies the
    // update directly, waking in place if asleep, without a duplicate alert.
    if (showT3AlertInCurrentConversation(alert)) return;
    if (alert.kind === 't3' && !state.demo) {
      try { postT3Notification({ id: alert.id, threadId: alert.threadId, title: alert.title, text: alert.body }); }
      catch { state.fail(new Error('T3_PHONE_NOTIFICATION_UNAVAILABLE')); }
      trackedT3Alerts.add(alert.id);
    }
    shell.showNotificationPreview(alert.id, alert.title, alert.previewBody || alert.body,
      wokeDisplay => openT3Alert(alert, wokeDisplay), () => dismissT3Alert(alert), isT3FlowProtected(), hostPresentationId || (alert.kind === 't3' ? alert.id : undefined));
  };
  // T3-owned completions get their host lease from the returned Android
  // publication event. The local alert id is not that lease and must never be
  // echoed as a close token.
  state.onArrival(alert => presentArrival(alert));
  presentExternalArrival = presentArrival;
  onT3NotificationRemoved(id => { if (!state.demo) { state.removeAlert(id); shell.closeNotificationPreview(id); } });
  onAndroidNotificationRemoved(key => {
    for (const alert of state.alerts.filter(a => a.kind === 'phone' && a.threadId === key)) { state.removeAlert(alert.id); shell.closeNotificationPreview(alert.id); }
    // Notifications restored from Android after restart may have no arrival cache.
    state.changed();
  });
  onT3ThreadOpenRequested(threadId => {
    const pairing = pairingIdentity();
    void (async () => {
      // This explicit native click may leave sample mode, but may never cross
      // a subsequent account/bridge change while awaiting window creation.
      if (state.demo) await connectT3();
      if (pairing !== pairingIdentity() || state.demo) return;
      await openWindow();
      if (pairing !== pairingIdentity() || state.demo) return;
      shell.wake('window'); shell.focusWindow('t3'); openT3Thread(threadId);
    })().catch(error => { if (pairing === pairingIdentity() && !state.demo) state.fail(error); });
  });
}

let presentExternalArrival: (alert: T3Alert, hostPresentationId?: string) => void = () => {};
export function handlePhoneNotification(key: string, hostPresentationId?: string): void {
  const external = key.startsWith("apk:");
  if (external && (state.demo || getT3Config().notificationOverride !== true)) return;
  const notification = readActiveNotifications(50, external).find(n => n.key === key);
  if (!notification || notification.packageName === 'com.faceclaw.t3') return;
  if (!allowsT3PhoneNotification(notification.packageName, getT3Config())) return;
  // Android group summaries describe children already represented by their own alerts.
  if (notification.isGroupSummary || isBackgroundStatus(notification)) return;
  const groupId = phoneConversationId(notification);
  const current = groupedPhoneNotifications().find(item => phoneConversationId(item) === groupId);
  if (!current) return;
  const alert = phoneAlert(current);
  const group = alert.groupId || alert.threadId;
  const previous = external ? externalArrivals.get(group) : state.alerts.find(item => item.kind === 'phone' && (item.groupId || item.threadId) === group);
  const changed = !previous || previous.arrivalFingerprint !== alert.arrivalFingerprint;
  if (external) {
    externalArrivals.set(group, alert);
    while (externalArrivals.size > 128) { const oldest = externalArrivals.keys().next().value!; shell.closeNotificationPreview(externalArrivals.get(oldest)!.id); externalArrivals.delete(oldest); }
    if (changed) presentExternalArrival(alert, hostPresentationId);
    state.changed();
  } else state.addAlert(alert, changed);
  if (!changed && previous) shell.updateNotificationPreview(previous.id, alert.id, alert.title, alert.previewBody || alert.body,
    wokeDisplay => openT3Alert(alert, wokeDisplay), () => dismissT3Alert(alert), hostPresentationId);
}

export async function openT3Alert(alert: T3Alert, returnToSleep = false): Promise<boolean> {
  if (alert.kind === 'phone' ? !findT3Alert(alert.id) : !state.alerts.includes(alert)) return false;
  if (alert.kind === "phone" && alert.threadId.startsWith("apk:") && getT3Config().notificationOverride !== true) return invokeExternalNotification(alert.threadId, 0);
  const pairing = pairingIdentity();
  const demo = state.demo;
  if (alert.kind === 'phone') {
    if (getT3Config().notificationOverride === true && !state.demo) return openNotificationUi(alert.threadId, returnToSleep);
    else if (state.demo) openT3Notification(alert.id, undefined, returnToSleep);
    else shell.openNotificationModal(alert.threadId, returnToSleep);
    return true;
  }
  const previous = shell.foregroundWindow()?.windowId;
  await openWindow();
  if (!state.alerts.includes(alert) || state.demo !== demo || pairing !== pairingIdentity()) return false;
  shell.focusWindow('t3'); openT3Thread(resourceKey(alert.threadId, alert.environmentId), previous);
  shell.closeNotificationPreview(alert.id, false);
  dismissT3Alert(alert);
  return true;
}

export function openT3NotificationApp(id: string): boolean {
  const alert = findT3Alert(id);
  return Boolean(!state.demo && alert?.kind === 'phone' && alert.threadId.startsWith("apk:") &&
    invokeExternalNotification(alert.threadId, 0, alert.createdAt));
}

export async function dismissT3Alert(alert: T3Alert): Promise<boolean> {
  if (alert.kind === 'phone' ? !findT3Alert(alert.id) : !state.alerts.includes(alert)) return false;
  if (alert.kind === 'phone') {
    if (!state.demo) {
      const members = allowedPhoneNotifications().filter(notification => alert.groupId ? phoneConversationId(notification) === alert.groupId : notification.key === alert.threadId);
      // Cancel the selected/current native key last, so a failed partial group
      // cancellation cannot falsely close its reader or remove another thread.
      members.sort((a, b) => Number(a.key === alert.threadId) - Number(b.key === alert.threadId));
      if (!members.length) return false;
      if (!await dismissNotifications(members.map(notification=>({key:notification.key,postTime:notification.postTime})))) return false;
    }
  } else if (!state.demo) dismissT3Notification(alert.id);
  externalArrivals.delete(alert.groupId || alert.threadId);
  state.removeAlert(alert.id);
  shell.closeNotificationPreview(alert.id);
  return true;
}
