import type { ProposedPlan, SessionSummary } from '../apps/t3/protocol';
/** Pure boundary checks shared by native transport and focused tests. */
export function bridgeEndpoint(base: string, allowInsecureLocal = false): string {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) throw new Error('T3_URL_INVALID');
  const host = url.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '10.0.2.2';
  const octets = host.split('.').map(Number);
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  const privateHost = ipv4 && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && (loopback || (allowInsecureLocal && privateHost)))) throw new Error('T3_TLS_REQUIRED');
  url.pathname = '/v1/faceclaw/events';
  return url.toString();
}
export function validateToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{20,512}$/.test(token)) throw new Error('T3_TOKEN_INVALID');
}
export class ToolReplayGuard {
  private seen = new Map<string, number>();
  admit(call: any, projectId: string, now = Date.now()): boolean {
    for (const [id, expiry] of this.seen) if (expiry < now) this.seen.delete(id);
    if (!call || typeof call.callId !== 'string' || !call.callId || call.callId.length > 128 || call.projectId !== projectId || !((typeof call.threadId === 'string' && call.threadId.length > 0) || (call.bindingKind === 'provider-session' && typeof call.providerSessionId === 'string' && call.providerSessionId.length > 0)) || typeof call.name !== 'string' || call.name.length > 256 || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments) || !Number.isFinite(call.issuedAt) || !Number.isFinite(call.expiresAt) || call.issuedAt > now + 5000 || call.expiresAt < now || call.expiresAt <= call.issuedAt || call.expiresAt - call.issuedAt > 120000 || this.seen.has(call.callId) || this.seen.size >= 512) return false;
    this.seen.set(call.callId, call.expiresAt);
    return true;
  }
}

/** These bridge errors are emitted before mutating T3. Unknown upstream errors remain uncertain. */
const definiteRejections = new Set([
  'invalid_request', 'invalid_message', 'request_too_large', 'rate_limited',
  'unauthorized', 'origin_denied', 'native_only', 'not_found',
  'session_busy', 'session_not_running', 'project_model_required', 'model_selection_changed', 'plan_unavailable',
  'provider_selection_unavailable', 'model_selection_unavailable', 'reasoning_selection_unavailable',
]);
export function isDefiniteBridgeRejection(code: string): boolean { return definiteRejections.has(code); }


function boundedControlText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}
function controlTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) &&
    [new Date(value).toISOString(), new Date(value).toISOString().replace('.000Z', 'Z')].includes(value);
}
export function parseProposedPlan(value: unknown): ProposedPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (!boundedControlText(plan.planId, 256) || typeof plan.revision !== 'string' || !/^[a-f0-9]{64}$/.test(plan.revision) ||
      typeof plan.turnId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(plan.turnId) ||
      !boundedControlText(plan.planMarkdown, 64_000) || !controlTimestamp(plan.createdAt) || !controlTimestamp(plan.updatedAt)) return null;
  return { planId: plan.planId, revision: plan.revision, turnId: plan.turnId,
    planMarkdown: plan.planMarkdown, createdAt: plan.createdAt, updatedAt: plan.updatedAt };
}
/** Strip invalid optional controls so older/invalid responses cannot enable mutations. */
export function sanitizeSessionControls(session: SessionSummary): void {
  if (session.interactionMode !== 'default' && session.interactionMode !== 'plan') delete session.interactionMode;
  const model = session.modelSelection;
  if (!model || !boundedControlText(model.instanceId, 128) || !boundedControlText(model.model, 256)) {
    delete session.modelSelection; return;
  }
  session.modelSelection = { instanceId: model.instanceId, model: model.model,
    ...(typeof model.reasoningId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(model.reasoningId) ? { reasoningId: model.reasoningId } : {}) };
}
