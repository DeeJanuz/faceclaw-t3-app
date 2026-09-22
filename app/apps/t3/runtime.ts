import { t3GlanceWidgets, t3HomeWidget } from './glanceboard';
import { sdkControls, onHostEvent } from '../../extensions/host';
import { resourceKey } from './resource';
import { t3Client } from '../../t3/client';
import { getT3Config, onT3ConfigChanged, type T3Config } from '../../t3/config';
import { bridgeEndpoint } from '../../t3/security';
import { T3Workspace } from './workspace';
import { T3DemoApi } from './demo';
import { startT3ToolRelay } from '../../t3/tools';
import { saveT3PlanDraft, loadT3PlanDraft, deleteT3PlanDraft } from '../../t3/drafts';
import { startT3PowerMonitor } from '../../native/power-monitor';

export const t3Workspace = new T3Workspace(t3Client);
const NETWORK_UNAVAILABLE_RETRY_MS = 30_000;
const TOKEN_ACCOUNTING_KEY = 'token-accounting-v1';
let lastGlance = '';
function publishT3Glance(force = false): void {
  const content = { version: 2 as const, widgetId: 'default', title: 'T3 attention', emptyText: t3Workspace.demo ? 'Sample mode' : 'No sessions waiting',
    entries: (t3Workspace.demo ? [] : t3Workspace.awaitingSessions).slice(0, 12).map(session => ({
      id: resourceKey(session.id, session.environmentId).slice(0, 256), title: session.title.slice(0, 160),
      detail: [session.projectTitle, session.environmentLabel].filter(Boolean).join(' · ').slice(0, 256),
    })) };
  const key = JSON.stringify(content);
  if (!force && key === lastGlance) return;
  if (sdkControls().publishGlanceboardWidget({ ...content, expiresAt: Date.now() + 60000 })) lastGlance = key;
}
let started = false;
let demoApi: T3DemoApi | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let eventTimer: ReturnType<typeof setTimeout> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let modeGeneration = 0;
let connectionAttempt = 0;
let liveIdentity = '';
let powerRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let readerVisible = false;
let hostSurfaceVisible = false;
let phonePreviewVisible = false;

/** The full transcript is a reader resource, not a background subscription. */
export function setT3ReaderVisible(visible: boolean): void {
  if (readerVisible === visible) return;
  readerVisible = visible;
  if (visible && (hostSurfaceVisible || phonePreviewVisible) && t3Workspace.selectedThreadId) {
    void t3Workspace.refreshTranscript();
  }
}
export function setT3HostVisible(visible: boolean): void {
  if (hostSurfaceVisible === visible) return;
  hostSurfaceVisible = visible;
  if (visible && readerVisible && t3Workspace.selectedThreadId) void t3Workspace.refreshTranscript();
}
export function setT3PhonePreviewVisible(visible: boolean): void {
  if (phonePreviewVisible === visible) return;
  phonePreviewVisible = visible;
  if (visible && readerVisible && t3Workspace.selectedThreadId) void t3Workspace.refreshTranscript();
}
function pairingScope(config: T3Config): string {
  return JSON.stringify([bridgeEndpoint(config.bridgeUrl, config.allowInsecureLocal), config.pairingFingerprint]);
}
function clearTimers(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (eventTimer) clearTimeout(eventTimer);
  if (stableTimer) clearTimeout(stableTimer);
  if (powerRecoveryTimer) clearTimeout(powerRecoveryTimer);
  reconnectTimer = null; eventTimer = null; stableTimer = null; powerRecoveryTimer = null;
}
function current(mode: number, attempt?: number): boolean {
  return mode === modeGeneration && !t3Workspace.demo && (attempt === undefined || attempt === connectionAttempt);
}

export function initializeT3(): void {
  if (started) return;
  started = true;
  t3Workspace.onChange(() => publishT3Glance());
  onHostEvent((type, data) => {
    if (type === 'connected' || type === 'capabilities') {
      sdkControls().registerGlanceboardWidgets(t3GlanceWidgets); publishT3Glance(true);
    }
    if (type === 'glanceboard-request') {
      if (data?.version === 2 && data.widgetId === 'home') sdkControls().publishGlanceboardWidget(t3HomeWidget(data));
      else if (!data?.widgetId || data.widgetId === 'default') publishT3Glance(true);
    }
    if (type === 'disconnected' || type === 'destroyed') lastGlance = '';
  });
  t3Workspace.setDraftStorage({
    load: key => t3Workspace.demo ? null : loadT3PlanDraft(key),
    save: (key, value) => { if (!t3Workspace.demo) saveT3PlanDraft(key, value); },
    remove: key => { if (!t3Workspace.demo) deleteT3PlanDraft(key); },
    scope: () => pairingScope(getT3Config()),
    loadApproval: key => loadT3PlanDraft(key),
    saveApproval: key => saveT3PlanDraft(key, { locked: true }),
    removeApproval: key => deleteT3PlanDraft(key),
  });
  t3Workspace.setViewedTurnStorage({
    scope: () => pairingScope(getT3Config()),
    load: () => loadT3PlanDraft(JSON.stringify(['viewed-turns-v1', pairingScope(getT3Config())])),
    save: value => saveT3PlanDraft(JSON.stringify(['viewed-turns-v1', pairingScope(getT3Config())]), value),
  });
  t3Workspace.setTokenAccountingStorage({
    scope: () => pairingScope(getT3Config()),
    load: () => loadT3PlanDraft(JSON.stringify([TOKEN_ACCOUNTING_KEY, pairingScope(getT3Config())])),
    save: value => saveT3PlanDraft(JSON.stringify([TOKEN_ACCOUNTING_KEY, pairingScope(getT3Config())]), value),
  });
  onT3ConfigChanged(() => { if (!t3Workspace.demo) void connectT3(); });
  startT3PowerMonitor(hint => {
    if (t3Workspace.demo || !getT3Config().enabled || t3Client.connected) return;
    // A callback is a scheduling hint. Do not reconnect while the platform is
    // still in idle or there is no active route; the authenticated handshake
    // remains the reachability check.
    if ((hint.kind === 'network' && hint.available !== true) || (hint.kind === 'idle' && hint.idle === true)) return;
    if (powerRecoveryTimer) return;
    powerRecoveryTimer = setTimeout(() => {
      powerRecoveryTimer = null;
      if (!t3Workspace.demo && getT3Config().enabled && !t3Client.connected) void connectT3();
    }, 0);
  });
  t3Client.onStateChange(state => {
    if (t3Workspace.demo) return;
    if (state.connected) {
      if (stableTimer) clearTimeout(stableTimer);
      const mode = modeGeneration, attempt = connectionAttempt;
      stableTimer = setTimeout(() => {
        stableTimer = null;
        if (current(mode, attempt) && t3Client.connected) retries = 0;
      }, 60_000);
      void t3Workspace.refresh();
      // The bridge's subscription set belongs to the WebSocket connection.
      // Re-read a visible conversation on every real reconnect so
      // transcript.get installs the subscription on the new socket; waiting
      // for transcript.changed cannot work when the new socket is not yet
      // subscribed.
      if (readerVisible && (hostSurfaceVisible || phonePreviewVisible) && t3Workspace.selectedThreadId) {
        void t3Workspace.refreshTranscript();
      }
    }
    else {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
      t3Workspace.disconnected();
      if (state.failureCategory === 'network-unavailable') {
        // Keep the transport diagnosis visible in the glasses workspace as
        // well as the phone settings page; the next network callback or
        // bounded retry will replace it with Connecting….
        t3Workspace.status = state.status;
        t3Workspace.changed();
      }
      if (getT3Config().enabled && state.phase === 'failed' && !reconnectTimer) {
        const mode = modeGeneration;
        const delay = state.failureCategory === 'network-unavailable'
          ? NETWORK_UNAVAILABLE_RETRY_MS
          : t3ReconnectDelayMs(retries++);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null; if (current(mode)) void connectT3();
        }, delay);
      }
    }
  });
  t3Client.onEvent(event => {
    if (t3Workspace.demo) return;
    if (readerVisible && (hostSurfaceVisible || phonePreviewVisible) && event.event === 'transcript.changed' && event.payload?.threadId === t3Workspace.selectedThreadId && (event.payload?.environmentId ?? undefined) === t3Workspace.selectedEnvironmentId) {
      void t3Workspace.refreshTranscript();
    }
    if (event.event === 'sessions.changed' && !eventTimer) {
      const mode = modeGeneration;
      eventTimer = setTimeout(() => { eventTimer = null; if (current(mode)) void t3Workspace.refreshSessions(); }, 150);
    }
  });
  // Install relay after mode/config listeners so settings changes clear the old
  // workspace before a new authenticated socket can produce events.
  startT3ToolRelay();
  if (getT3Config().enabled) void connectT3();
}

/** Exponential reconnect delay with bounded downward jitter to avoid synchronized reconnect storms. */
export function t3ReconnectDelayMs(attempt: number, entropy = Math.random()): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.min(Math.max(0,Math.floor(attempt)),5));
  const boundedEntropy = Math.max(0,Math.min(1,Number.isFinite(entropy)?entropy:0.5));
  return Math.round(base*(0.8+boundedEntropy*0.2));
}

export async function connectT3(): Promise<void> {
  const config = getT3Config();
  const attempt = ++connectionAttempt;
  clearTimers();
  let identity: string;
  try { identity = JSON.stringify([pairingScope(config), config.enabled]); }
  catch (error) { t3Workspace.fail(error); return; }
  if (t3Workspace.demo || identity !== liveIdentity) {
    ++modeGeneration; liveIdentity = identity; demoApi = null;
    t3Workspace.useApi(t3Client, false);
  }
  const mode = modeGeneration;
  t3Client.configure(config);
  if (!config.enabled) { t3Workspace.status = 'Enable the bridge in T3 settings'; t3Workspace.changed(); return; }
  try {
    await t3Client.connect();
    if (current(mode, attempt)) await t3Workspace.refresh();
  } catch (error) { if (current(mode, attempt)) t3Workspace.fail(error); }
}

export async function useT3SampleData(): Promise<void> {
  ++modeGeneration; ++connectionAttempt;
  clearTimers();
  demoApi = new T3DemoApi();
  t3Workspace.useApi(demoApi, true);
  // Sample mode changes this app's data source only. It never routes sample
  // prompts through the live assistant, tools, notification or voice APIs.
  await t3Workspace.refresh();
}

export async function simulateT3Completion(): Promise<void> {
  if (!demoApi || !t3Workspace.demo) return;
  demoApi.completeAgent();
  await t3Workspace.refresh();
}
