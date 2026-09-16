import { resourceKey, resourceRef } from './resource';
import { isDefiniteBridgeRejection, parseProposedPlan, sanitizeSessionControls } from "../../t3/security";
import type {
  ModelSummary, NewSessionModelSelection, PendingPlanInput, PlanAnswer,
  ProjectSummary, SessionSummary, SessionTokenUsage, SessionsListResult, TranscriptResult, ProposedPlan,
} from './protocol';

export interface T3Api {
  rpc<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface T3Alert {
  id: string;
  kind: 't3' | 'phone';
  environmentId?: string;
  title: string;
  body: string;
  threadId: string;
  createdAt: number;
  groupId?: string;
  arrivalFingerprint?: string;
  previewBody?: string;
}

export interface PlanDraft {
  request: PendingPlanInput;
  answers: PlanAnswer[];
  locked: boolean;
  notice: string;
}

export interface PlanDraftStorage {
  load(key: string): PlanDraft | null;
  save(key: string, value: PlanDraft): void;
  remove(key: string): void;
  scope(): string;
  loadApproval?(key: string): unknown;
  saveApproval?(key: string): void;
  removeApproval?(key: string): void;
}

export interface ReviewedReplyDestination {
  threadId: string;
  environmentId?: string;
  pairing: string;
}

function safeTokenCount(value: unknown, positive = false): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= (positive ? 1 : 0) ? value : null;
}

function sanitizeTokenUsage(value: unknown): SessionTokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const updatedAt = typeof usage.updatedAt === 'string' && usage.updatedAt.length <= 40 && Number.isFinite(Date.parse(usage.updatedAt))
    ? usage.updatedAt : null;
  return {
    contextTokens: safeTokenCount(usage.contextTokens),
    contextWindowTokens: safeTokenCount(usage.contextWindowTokens, true),
    totalTokens: safeTokenCount(usage.totalTokens),
    updatedAt,
  };
}

/** Shared across window lifetimes: closed windows still receive agent alerts. */
export class T3Workspace {
  projects: ProjectSummary[] = [];
  sessions: SessionSummary[] = [];
  models: ModelSummary[] = [];
  transcript: TranscriptResult | null = null;
  selectedThreadId = '';
  selectedEnvironmentId: string | undefined;
  environments: import('./protocol').EnvironmentSummary[] = [];
  get selectedThreadKey(): string { return resourceKey(this.selectedThreadId, this.selectedEnvironmentId); }
  getPlan(threadId: string) { return this.plans.get(resourceKey(threadId, this.selectedEnvironmentId)); }
  modelsFor(environmentId?: string) {
    const target = environmentId ?? this.environments.find(e => e.isPrimary)?.environmentId;
    return this.models.filter(m => m.environmentId === target || (!m.environmentId && !environmentId));
  }
  status = 'Connect to your T3 bridge';
  error = '';
  busy = false;
  /** UI may unlock its draft only when the last attempted send was definitely rejected. */
  canRetryLastSend = true;
  demo = false;
  alerts: T3Alert[] = [];
  readonly plans = new Map<string, PlanDraft>();
  private approvalLocks = new Set<string>();
  private listeners = new Set<() => void>();
  private arrivals = new Set<(alert: T3Alert) => void>();
  private completions = new Map<string, string>();
  private initialized = false;
  private generation = 0;
  private transcriptRequest = 0;
  private transcriptRefreshPending: Promise<void> | null = null;
  private transcriptRefreshPendingThread = '';
  private transcriptRefreshQueued = false;
  private refreshPending: Promise<void> | null = null;
  private sessionsRefreshPending: Promise<void> | null = null;
  private draftStorage: PlanDraftStorage | null = null;
  private tokenContexts = new Map<string, SessionTokenUsage>();
  private tokenSnapshots = new Map<string, { fingerprint: string; model: string }>();
  private sessionTokenTotals = new Map<string, number>();

  constructor(private api: T3Api) {}
  setDraftStorage(storage: PlanDraftStorage): void { this.draftStorage = storage; }
  private get storage(): PlanDraftStorage | null { return this.demo ? null : this.draftStorage; }
  private draftKey(threadId: string, request: PendingPlanInput): string {
    return JSON.stringify([this.storage?.scope() || '', resourceKey(threadId, this.selectedEnvironmentId), request.requestId, request.revision]);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onArrival(listener: (alert: T3Alert) => void): () => void {
    this.arrivals.add(listener);
    return () => this.arrivals.delete(listener);
  }
  changed(): void { this.listeners.forEach(listener => listener()); }

  useApi(api: T3Api, demo: boolean): void {
    const previousApi = this.api;
    const previous = { threadId: this.selectedThreadId, ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}) };
    // A reused transport is closed/reconfigured by runtime.ts. Never queue an old unsubscribe onto its new host.
    if (previous.threadId && previousApi !== api) void Promise.resolve().then(() => previousApi.rpc('transcript.unsubscribe', previous)).catch(() => undefined);
    this.generation++;
    this.transcriptRequest++;
    this.api = api;
    this.demo = demo;
    this.projects = []; this.sessions = []; this.models = [];
    this.transcript = null; this.selectedThreadId = ''; this.selectedEnvironmentId = undefined; this.environments = []; this.alerts = [];
    this.completions.clear(); this.plans.clear(); this.approvalLocks.clear(); this.initialized = false;
    this.tokenContexts.clear(); this.tokenSnapshots.clear(); this.sessionTokenTotals.clear();
    this.refreshPending = null; this.busy = false; this.error = ''; this.canRetryLastSend = true;
    this.sessionsRefreshPending = null;
    this.transcriptRefreshPending = null; this.transcriptRefreshPendingThread = ''; this.transcriptRefreshQueued = false;
    this.status = demo ? 'Sample data · no live actions' : 'Connecting…';
    this.changed();
  }

  disconnected(): void {
    // A new snapshot is a baseline, never a replay of missed notifications.
    this.initialized = false;
    this.status = 'Disconnected';
    // Preserve readable history, but never animate a backend activity marker
    // whose owner is offline and can no longer advance or complete it.
    if (this.transcript?.liveActivity) this.transcript = { ...this.transcript, liveActivity: null };
    this.changed();
  }

  refresh(): Promise<void> {
    if (this.refreshPending) return this.refreshPending;
    const generation = this.generation;
    const api = this.api;
    const pending = (async () => {
      try {
        const [projects, sessions, models] = await Promise.all([
          api.rpc<{ projects: ProjectSummary[] }>('projects.list'),
          api.rpc<SessionsListResult>('sessions.list'),
          api.rpc<{ models: ModelSummary[] }>('models.list'),
        ]);
        if (generation !== this.generation) return;
        this.projects = projects.projects;
        this.models = models.models;
        this.environments = sessions.environments ?? [];
        this.applySessions([...sessions.unsettled, ...sessions.settled]);
        this.error = '';
        this.status = this.demo ? 'Sample data · no live actions' : sessions.partial ? `Connected · unavailable: ${this.environments.filter(e => e.status !== 'connected').map(e => e.label).join(', ')}` : 'Connected to T3';
        this.changed();
      } catch (error) {
        if (generation === this.generation) this.fail(error);
      }
    })();
    this.refreshPending = pending;
    void pending.finally(() => { if (this.refreshPending === pending) this.refreshPending = null; });
    return pending;
  }

  refreshSessions(): Promise<void> {
    // `sessions.changed` is emitted from the bridge's live poll. Keep it off
    // the full refresh path: models.list opens a separate upstream WebSocket.
    if (this.refreshPending) return this.refreshPending;
    if (this.sessionsRefreshPending) return this.sessionsRefreshPending;
    const generation = this.generation;
    const api = this.api;
    const pending = (async () => {
      try {
        const sessions = await api.rpc<SessionsListResult>('sessions.list');
        if (generation !== this.generation) return;
        const environmentsChanged = JSON.stringify(this.environments) !== JSON.stringify(sessions.environments ?? []);
        this.environments = sessions.environments ?? [];
        if (environmentsChanged) {
          const [projects, models] = await Promise.all([
            api.rpc<{ projects: ProjectSummary[] }>('projects.list'), api.rpc<{ models: ModelSummary[] }>('models.list'),
          ]);
          if (generation !== this.generation) return;
          this.projects = projects.projects; this.models = models.models;
        }
        this.applySessions([...sessions.unsettled, ...sessions.settled]);
        this.error = '';
        this.status = this.demo ? 'Sample data · no live actions' : sessions.partial ? `Connected · unavailable: ${this.environments.filter(e => e.status !== 'connected').map(e => e.label).join(', ')}` : 'Connected to T3';
        this.changed();
      } catch (error) {
        if (generation === this.generation) this.fail(error);
      }
    })();
    this.sessionsRefreshPending = pending;
    void pending.finally(() => { if (this.sessionsRefreshPending === pending) this.sessionsRefreshPending = null; });
    return pending;
  }

  applySessions(sessions: SessionSummary[]): void {
    const next = new Map<string, string>();
    for (const session of sessions) {
      const completion = session.completedTurn?.id;
      if (completion) next.set(resourceKey(session.id, session.environmentId), completion);
      if (this.initialized && completion && this.completions.get(resourceKey(session.id, session.environmentId)) !== completion && !session.settled) {
        const timestamp = Date.parse(session.completedTurn!.completedAt);
        if (Number.isFinite(timestamp) && Date.now() - timestamp < 30_000) {
          this.addAlert({
            id: `t3:${resourceKey(session.id, session.environmentId)}:${completion}`, environmentId: session.environmentId, kind: 't3', threadId: session.id,
            title: session.projectTitle, body: session.title, createdAt: timestamp,
          });
        }
      }
    }
    this.completions = next;
    this.initialized = true;
    this.sessions = sessions;
    const allowed = new Set(sessions.filter(s => !s.settled).map(s => resourceKey(s.id, s.environmentId)));
    this.alerts = this.alerts.filter(a => a.kind === 'phone' || allowed.has(resourceKey(a.threadId, a.environmentId)));
  }

  addAlert(alert: T3Alert, notifyArrival = true): void {
    if (this.alerts.some(existing => existing.id === alert.id && existing.title === alert.title && existing.body === alert.body && existing.arrivalFingerprint === alert.arrivalFingerprint)) return;
    this.alerts = [alert, ...this.alerts.filter(a => (a.groupId || resourceKey(a.threadId, a.environmentId)) !== (alert.groupId || resourceKey(alert.threadId, alert.environmentId)) || a.kind !== alert.kind)].slice(0, 50);
    if (notifyArrival) this.arrivals.forEach(listener => listener(alert));
    this.changed();
  }

  removeAlert(id: string): void {
    this.alerts = this.alerts.filter(alert => alert.id !== id);
    this.changed();
  }

  async openThread(threadId: string, environmentId?: string): Promise<void> {
    const ref = resourceRef(threadId); threadId = ref.id; environmentId = environmentId ?? ref.environmentId;
    const generation = this.generation;
    const previousThreadId = this.selectedThreadId;
    if (previousThreadId && resourceKey(previousThreadId, this.selectedEnvironmentId) !== resourceKey(threadId, environmentId)) {
      void this.api.rpc('transcript.unsubscribe', { threadId: previousThreadId, ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}) }).catch(() => undefined);
    }
    this.selectedThreadId = threadId;
    this.selectedEnvironmentId = environmentId;
    this.transcript = null;
    this.changed();
    if (generation === this.generation) await this.refreshTranscript();
  }

  /**
   * T3 usage events do not carry model identity. Associate each new snapshot
   * with the active model, and keep its last context reading when models are
   * switched. Session totals remain monotonic across every model.
   */
  private reconcileTokenUsage(transcript: TranscriptResult): void {
    const usage = sanitizeTokenUsage(transcript.tokenUsage);
    if (!usage) { delete transcript.tokenUsage; return; }
    const sessionKey = resourceKey(transcript.session.id, transcript.session.environmentId);
    const previousTotal = this.sessionTokenTotals.get(sessionKey);
    if (usage.totalTokens !== null && (previousTotal === undefined || usage.totalTokens > previousTotal)) {
      this.sessionTokenTotals.set(sessionKey, usage.totalTokens);
    }
    const totalTokens = this.sessionTokenTotals.get(sessionKey) ?? usage.totalTokens;
    const selection = transcript.session.modelSelection;
    if (!selection) { transcript.tokenUsage = { ...usage, totalTokens }; return; }
    const model = JSON.stringify([selection.instanceId, selection.model]);
    const fingerprint = JSON.stringify([usage.contextTokens, usage.contextWindowTokens, usage.totalTokens, usage.updatedAt]);
    const owner = this.tokenSnapshots.get(sessionKey);
    const contextKey = JSON.stringify([sessionKey, selection.instanceId, selection.model]);
    if (!owner || owner.fingerprint !== fingerprint) {
      this.tokenSnapshots.set(sessionKey, { fingerprint, model });
      const current = { ...usage, totalTokens };
      this.tokenContexts.set(contextKey, current);
      transcript.tokenUsage = current;
    } else if (owner.model === model) {
      const current = { ...usage, totalTokens };
      this.tokenContexts.set(contextKey, current);
      transcript.tokenUsage = current;
    } else {
      const cached = this.tokenContexts.get(contextKey);
      transcript.tokenUsage = {
        contextTokens: cached?.contextTokens ?? null,
        contextWindowTokens: cached?.contextWindowTokens ?? null,
        totalTokens,
        updatedAt: cached?.updatedAt ?? null,
      };
    }
    if (this.tokenContexts.size > 512) this.tokenContexts.delete(this.tokenContexts.keys().next().value as string);
  }

  async refreshTranscript(): Promise<void> {
    const threadId = this.selectedThreadId;
    const environmentId = this.selectedEnvironmentId;
    const threadKey = resourceKey(threadId, environmentId);
    if (!threadId) return;
    // The bridge may report a live turn every poll interval. Keep one fetch in
    // flight and coalesce arrivals so a slow mobile link cannot build an
    // unbounded queue that starves gesture handling.
    if (this.transcriptRefreshPending && this.transcriptRefreshPendingThread === threadKey) {
      this.transcriptRefreshQueued = true;
      return this.transcriptRefreshPending;
    }
    const request = ++this.transcriptRequest;
    const generation = this.generation;
    const pending = (async () => {
      try {
      const transcript = await this.api.rpc<TranscriptResult>('transcript.get', { threadId, ...(environmentId ? { environmentId } : {}) });
      if (request !== this.transcriptRequest || generation !== this.generation || threadKey !== this.selectedThreadKey) return;
      if (!transcript?.session || transcript.session.id !== threadId || (environmentId && transcript.session.environmentId !== environmentId)) throw new Error('T3_INVALID_RESPONSE');
      sanitizeSessionControls(transcript.session);
      this.reconcileTokenUsage(transcript);
      transcript.pendingProposedPlan = parseProposedPlan(transcript.pendingProposedPlan);
      this.transcript = transcript;
      const pending = transcript.pendingPlanInput;
      const old = this.plans.get(resourceKey(threadId, this.selectedEnvironmentId));
      if (!pending) {
        if (old) this.storage?.remove(this.draftKey(threadId, old.request));
        this.plans.delete(threadKey);
      }
      else if (!old || old.request.revision !== pending.revision || old.request.requestId !== pending.requestId) {
        if (old) this.storage?.remove(this.draftKey(threadId, old.request));
        const saved = this.storage?.load(this.draftKey(threadId, pending));
        this.plans.set(threadKey, saved && saved.request?.requestId === pending.requestId && saved.request?.revision === pending.revision && typeof saved.locked === "boolean" && Array.isArray(saved.answers) && saved.answers.every(a => typeof a.questionId === "string" && typeof a.text === "string" && Array.isArray(a.optionIndexes) && a.optionIndexes.every(Number.isInteger))
          ? { ...saved, request: pending } : { request: pending, answers: [], locked: false, notice: '' });
      }
      this.error = '';
      this.changed();
      } catch (error) { if (request === this.transcriptRequest && generation === this.generation) this.fail(error); }
    })();
    this.transcriptRefreshPending = pending;
    this.transcriptRefreshPendingThread = threadKey;
    void pending.finally(() => {
      if (this.transcriptRefreshPending !== pending) return;
      this.transcriptRefreshPending = null;
      this.transcriptRefreshPendingThread = '';
      if (this.transcriptRefreshQueued) {
        this.transcriptRefreshQueued = false;
        void this.refreshTranscript();
      }
    });
    return pending;
  }

  async send(text: string, options?: { projectId: string; environmentId?: string; modelSelection: NewSessionModelSelection; assistant?: boolean }, controls?: { interactionMode?: 'default' | 'plan'; reviewedDestination?: ReviewedReplyDestination }): Promise<boolean> {
    if (this.busy) return false;
    if (!text.trim() || (!options && !this.selectedThreadId)) { this.canRetryLastSend = true; return false; }
    const generation = this.generation;
    const api = this.api;
    const targetEnvironmentId = options ? options.environmentId : this.selectedEnvironmentId;
    this.busy = true; this.canRetryLastSend = false; this.error = ''; this.changed();
    try {
      if (generation !== this.generation) return false;
      const selected = this.transcript?.session?.id === this.selectedThreadId ? this.transcript.session : this.sessions.find(session => resourceKey(session.id, session.environmentId) === this.selectedThreadKey);
      const running = selected?.status === 'running' || selected?.status === 'starting';
      if (controls?.interactionMode !== undefined &&
          (options || !selected?.interactionMode || !['default', 'plan'].includes(controls.interactionMode) ||
            (running && controls.interactionMode !== selected.interactionMode))) {
        throw Object.assign(new Error('Wait for the current turn before changing mode.'), { code: 'session_busy', dispatched: false });
      }
      const reviewed = controls?.reviewedDestination;
      if (reviewed && (options || this.selectedThreadId !== reviewed.threadId || this.selectedEnvironmentId !== reviewed.environmentId)) {
        this.canRetryLastSend = true;
        return false;
      }
      const method = options ? (options.assistant ? 'assistant.start' : 'thread.start') : reviewed ? 'turn.reply' : running ? 'turn.steer' : 'turn.send';
      const params = options
        ? { ...(options.environmentId ? { environmentId: options.environmentId } : {}), projectId: options.projectId, modelSelection: options.modelSelection, text: text.trim() }
        : { ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}), threadId: this.selectedThreadId, text: text.trim(), ...(!running && controls?.interactionMode ? { interactionMode: controls.interactionMode } : {}) };
      const result = await api.rpc<{ threadId: string; environmentId?: string }>(method, params);
      if (generation !== this.generation) return false;
      if (typeof result?.threadId !== 'string' || !result.threadId ||
          (!options && result.threadId !== this.selectedThreadId) ||
          (targetEnvironmentId && result.environmentId !== targetEnvironmentId)) throw new Error('T3_INVALID_RESPONSE');
      await this.openThread(result.threadId, result.environmentId ?? targetEnvironmentId);
      if (generation !== this.generation) return false;
      await this.refresh();
      return true;
    } catch (error) {
      if (generation === this.generation) {
        const failure = error as { dispatched?: boolean; code?: string };
        this.canRetryLastSend = failure.dispatched === false || (typeof failure.code === 'string' && isDefiniteBridgeRejection(failure.code));
        this.fail(error);
      }
      return false;
    }
    finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }

  async setReasoning(threadId: string, reasoningId: string, expectedModel: { instanceId: string; model: string }): Promise<boolean> {
    const session = this.transcript?.session;
    if (this.busy || !session || session.id !== threadId || !session.interactionMode ||
        !['idle', 'ready', 'interrupted', 'stopped', 'error'].includes(session.status) || !session.modelSelection ||
        session.modelSelection.instanceId !== expectedModel.instanceId || session.modelSelection.model !== expectedModel.model) return false;
    const generation = this.generation; const api = this.api;
    this.busy = true; this.error = ''; this.changed();
    try {
      await api.rpc('thread.reasoning.set', { ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}), threadId, reasoningId, expectedModel: { instanceId: expectedModel.instanceId, model: expectedModel.model } });
      if (generation !== this.generation) return false;
      if (threadId === this.selectedThreadId) await this.refreshTranscript();
      return generation === this.generation;
    } catch (error) { if (generation === this.generation) this.fail(error); return false; }
    finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }

  async setModel(threadId: string, selection: NewSessionModelSelection, expectedModel: { instanceId: string; model: string }): Promise<boolean> {
    const session = this.transcript?.session;
    if (this.busy || !session || session.id !== threadId || !session.interactionMode ||
        !['idle', 'ready', 'interrupted', 'stopped', 'error'].includes(session.status) || !session.modelSelection ||
        session.modelSelection.instanceId !== expectedModel.instanceId || session.modelSelection.model !== expectedModel.model) return false;
    const generation = this.generation; const api = this.api;
    this.busy = true; this.error = ''; this.changed();
    try {
      await api.rpc('thread.model.set', { ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}), threadId, selection, expectedModel });
      if (generation !== this.generation) return false;
      if (threadId === this.selectedThreadId) await this.refreshTranscript();
      return generation === this.generation;
    } catch (error) { if (generation === this.generation) this.fail(error); return false; }
    finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }

  private approvalKey(threadId: string, plan: ProposedPlan): string {
    return JSON.stringify([this.demo ? 'demo' : this.storage?.scope() || '', 'plan-approval', resourceKey(threadId, this.selectedEnvironmentId), plan.planId, plan.revision]);
  }
  isPlanApprovalLocked(threadId: string, plan: ProposedPlan): boolean {
    try {
      const key = this.approvalKey(threadId, plan);
      if (this.approvalLocks.has(key)) return true;
      if (this.demo) return false;
      if (!this.storage?.loadApproval || !this.storage.saveApproval || !this.storage.removeApproval) return true;
      const stored = this.storage.loadApproval(key);
      if (stored !== null) { this.approvalLocks.add(key); return true; }
      return false;
    } catch { return true; }
  }

  async approvePlan(threadId: string, requested: ProposedPlan): Promise<boolean> {
    const plan = parseProposedPlan(requested);
    const current = this.transcript?.pendingProposedPlan;
    const session = this.transcript?.session;
    if (this.busy) return false;
    if (!plan || !current || !session || session.id !== threadId || session.interactionMode !== 'plan' ||
        !['idle', 'ready', 'interrupted', 'stopped', 'error'].includes(session.status) || current.planId !== plan.planId || current.revision !== plan.revision ||
        current.planMarkdown !== plan.planMarkdown) {
      this.fail(Object.assign(new Error('This plan changed. Return to the conversation and review it again.'), { code: 'plan_unavailable' }));
      return false;
    }
    if (this.isPlanApprovalLocked(threadId, plan)) return false;
    const generation = this.generation; const api = this.api; const storage = this.storage;
    const key = this.approvalKey(threadId, plan);
    this.approvalLocks.add(key); this.busy = true; this.error = ''; this.changed();
    let dispatched = false;
    try {
      if (!this.demo) storage!.saveApproval!(key);
      if (generation !== this.generation) return false;
      dispatched = true;
      await api.rpc('plan.approve', { ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}), threadId, planId: plan.planId, revision: plan.revision });
      if (generation !== this.generation) return false;
      if (threadId === this.selectedThreadId) await this.refreshTranscript();
      if (generation !== this.generation) return false;
      await this.refresh();
      return generation === this.generation;
    } catch (error) {
      if (generation !== this.generation) return false;
      const failure = error as { code?: string; dispatched?: boolean };
      if (dispatched && (failure.dispatched === false || (typeof failure.code === 'string' && isDefiniteBridgeRejection(failure.code)))) {
        try { storage?.removeApproval?.(key); this.approvalLocks.delete(key); } catch { /* Keep the persisted lock. */ }
      }
      this.fail(error); return false;
    } finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }

  async settle(threadId: string, environmentId = this.selectedEnvironmentId): Promise<boolean> {
    const generation = this.generation;
    const api = this.api;
    try {
      await api.rpc('thread.settle', { threadId, ...(environmentId ? { environmentId } : {}) });
      if (generation !== this.generation) return false;
      this.alerts = this.alerts.filter(alert => alert.kind !== 't3' || resourceKey(alert.threadId, alert.environmentId) !== resourceKey(threadId, environmentId));
      await this.refresh();
      this.changed();
      return true;
    } catch (error) { if (generation === this.generation) this.fail(error); return false; }
  }

  setAnswer(threadId: string, answer: PlanAnswer): void {
    const draft = this.plans.get(resourceKey(threadId, this.selectedEnvironmentId));
    if (!draft || draft.locked) return;
    const question = draft.request.questions.find(q => q.id === answer.questionId);
    if (!question) return;
    draft.answers = [...draft.answers.filter(a => a.questionId !== answer.questionId), {
      questionId: answer.questionId,
      optionIndexes: [...answer.optionIndexes], text: answer.text,
    }];
    try { this.storage?.save(this.draftKey(threadId, draft.request), draft); }
    catch (error) { this.fail(error); }
    this.changed();
  }

  async submitPlan(threadId: string): Promise<boolean> {
    const draft = this.plans.get(resourceKey(threadId, this.selectedEnvironmentId));
    if (!draft || draft.locked || !draft.request.questions.every(q => draft.answers.some(a => a.questionId === q.id && (a.text.trim() || a.optionIndexes.length)))) return false;
    const generation = this.generation;
    const api = this.api;
    draft.locked = true; draft.notice = 'Submitting answers…'; this.changed();
    try {
      if (generation !== this.generation) return false;
      // Persist the submission lock before crossing the transport boundary.
      this.storage?.save(this.draftKey(threadId, draft.request), draft);
      await api.rpc('plan.submit', {
        ...(this.selectedEnvironmentId ? { environmentId: this.selectedEnvironmentId } : {}), threadId, requestId: draft.request.requestId, revision: draft.request.revision,
        answers: draft.answers.map(a => ({ ...a, optionIndexes: [...a.optionIndexes] })),
      });
      if (generation !== this.generation) return false;
      draft.notice = 'Answers submitted';
      await this.refreshTranscript();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      // The command may have been accepted: never silently unlock/replay.
      draft.notice = 'Submission not confirmed. Check this request in T3.';
      this.fail(error);
      return false;
    } finally { if (generation === this.generation) this.changed(); }
  }

  fail(error: unknown): void {
    const typed = error as { code?: string; message?: string };
    this.error = `${typed.code || 't3_request_failed'}: ${typed.message || 'Request failed'}`;
    this.changed();
  }
}
