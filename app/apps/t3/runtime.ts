import { t3Client } from '../../t3/client';
import { getT3Config, onT3ConfigChanged, type T3Config } from '../../t3/config';
import { bridgeEndpoint } from '../../t3/security';
import { T3Workspace } from './workspace';
import { T3DemoApi } from './demo';
import { startT3ToolRelay } from '../../t3/tools';
import { saveT3PlanDraft, loadT3PlanDraft, deleteT3PlanDraft } from '../../t3/drafts';

export const t3Workspace = new T3Workspace(t3Client);
let started = false;
let demoApi: T3DemoApi | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let eventTimer: ReturnType<typeof setTimeout> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let modeGeneration = 0;
let connectionAttempt = 0;
let liveIdentity = '';
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
  reconnectTimer = null; eventTimer = null; stableTimer = null;
}
function current(mode: number, attempt?: number): boolean {
  return mode === modeGeneration && !t3Workspace.demo && (attempt === undefined || attempt === connectionAttempt);
}

export function initializeT3(): void {
  if (started) return;
  started = true;
  t3Workspace.setDraftStorage({
    load: key => t3Workspace.demo ? null : loadT3PlanDraft(key),
    save: (key, value) => { if (!t3Workspace.demo) saveT3PlanDraft(key, value); },
    remove: key => { if (!t3Workspace.demo) deleteT3PlanDraft(key); },
    scope: () => pairingScope(getT3Config()),
    loadApproval: key => loadT3PlanDraft(key),
    saveApproval: key => saveT3PlanDraft(key, { locked: true }),
    removeApproval: key => deleteT3PlanDraft(key),
  });
  onT3ConfigChanged(() => { if (!t3Workspace.demo) void connectT3(); });
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
    }
    else {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = null;
      t3Workspace.disconnected();
      if (getT3Config().enabled && state.phase === 'failed' && !reconnectTimer) {
        const mode = modeGeneration;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null; if (current(mode)) void connectT3();
        }, t3ReconnectDelayMs(retries++));
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
