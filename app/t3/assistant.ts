import type { AssistantBackendConfig } from '../assistant/session';
import type { AssistantTurnCallbacks, AssistantTurnHandle } from '../assistant/types';
import { getT3Config } from './config';
import { t3Client } from './client';

export function getT3AssistantConfig(fallback: AssistantBackendConfig | null): AssistantBackendConfig | null {
  const config = getT3Config();
  return config.enabled && config.preferAssistant ? { kind: 't3', fallback } : fallback;
}
const activeTurns = new Set<object>();
export function isT3AssistantTurnActive(): boolean { return activeTurns.size > 0; }

/** Each call creates a new conversation; failures after dispatch can never select fallback. */
export function sendT3Assistant(text: string, callbacks: AssistantTurnCallbacks, unavailable: () => AssistantTurnHandle): AssistantTurnHandle {
  let cancelled = false;
  let fallback: AssistantTurnHandle | null = null;
  let poll: ReturnType<typeof setTimeout> | null = null;
  let activeThreadId: string | null = null;
  let environmentId: string | undefined;
  const config = getT3Config();
  environmentId = config.assistantEnvironmentId || undefined;
  const scope = () => environmentId ? { environmentId } : {};
  const sameHost = () => { const now = getT3Config(); return now.bridgeUrl === config.bridgeUrl && now.pairingFingerprint === config.pairingFingerprint; };
  let lastText = '';
  const turnToken = {};
  const finish = () => {
    activeTurns.delete(turnToken);
    if (activeThreadId && sameHost()) {
      const threadId = activeThreadId;
      activeThreadId = null;
      void t3Client.rpc('transcript.unsubscribe', { threadId, ...scope() }).catch(() => undefined);
    }
  };
  const deadline = Date.now() + 10 * 60 * 1000;
  const run = async () => {
    try { t3Client.configure(config); await t3Client.connect(); }
    catch { if (!cancelled) fallback = unavailable(); return; }
    if (cancelled) return;
    // This is the dispatch boundary. Never retry or route elsewhere past here.
    try {
      if (!sameHost()) throw new Error('T3_HOST_CHANGED');
      if (!config.assistantProjectId || !config.assistantProvider || !config.assistantModel) throw new Error('T3_ASSISTANT_CONFIG_REQUIRED');
      activeTurns.add(turnToken);
      const result = await t3Client.rpc<{ threadId: string; environmentId?: string }>('assistant.start', {
        ...scope(),
        projectId: config.assistantProjectId, text,
        modelSelection: { instanceId: config.assistantProvider, model: config.assistantModel, ...(config.assistantReasoning ? { reasoningId: config.assistantReasoning } : {}) },
      });
      if (!sameHost() || (environmentId && result.environmentId !== environmentId)) throw new Error('T3_OPERATION_UNCERTAIN');
      environmentId = result.environmentId || environmentId;
      activeThreadId = result.threadId;
      if (cancelled) { finish(); return; }
      if (typeof result?.threadId !== 'string') throw new Error('T3_INVALID_RESPONSE');
      const read = async () => {
        if (cancelled) return;
        try {
          if (!sameHost()) throw new Error('T3_HOST_CHANGED');
          if (Date.now() > deadline) throw new Error('T3_ASSISTANT_TIMEOUT');
          const snapshot = await t3Client.rpc<any>('transcript.get', { threadId: result.threadId, ...scope() });
          if (cancelled) return;
          if (!sameHost()) throw new Error('T3_HOST_CHANGED');
          if ((environmentId && snapshot.environmentId !== environmentId) || !Array.isArray(snapshot?.turns) || snapshot?.session?.id !== result.threadId) throw new Error('T3_INVALID_RESPONSE');
          const messages = snapshot.turns.flatMap((turn: any) => Array.isArray(turn.messages) ? turn.messages : []);
          const output = messages.filter((msg: any) => msg.role === 'assistant' && typeof msg.text === 'string').map((msg: any) => msg.text).join('\n\n');
          if (output !== lastText) { callbacks.onTextDelta(output.startsWith(lastText) ? output.slice(lastText.length) : output, output); lastText = output; }
          if (snapshot.liveActivity?.label) callbacks.onToolActivity(String(snapshot.liveActivity.label));
          const latest = snapshot.turns[snapshot.turns.length - 1];
          if (latest?.endedAt) { finish(); callbacks.onTurnDone({ stopReason: snapshot.session.status === 'error' ? 'error' : 'end_turn' }); return; }
          poll = setTimeout(() => { void read(); }, 800);
        } catch (e) { finish(); if (!cancelled) callbacks.onError((e as Error).message); }
      };
      await read();
    } catch (e) { finish(); if (!cancelled) callbacks.onError((e as Error).message); }
  };
  void run();
  return { cancel() { cancelled = true; finish(); if (poll) clearTimeout(poll); fallback?.cancel(); } };
}
