import type { ModelSummary, PendingPlanInput, SessionSummary, TranscriptResult, ProposedPlan, NewSessionModelSelection } from './protocol';
import type { T3Api } from './workspace';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const plan: PendingPlanInput = {
  requestId: 'preview-plan', revision: 'preview-r1', turnId: 'preview-turn', createdAt: ago(2),
  questions: [
    { id: 'layout', header: 'Layout', question: 'Which conversation layout should we test first?', multiSelect: false,
      options: [{ label: 'Full-height reader', description: 'Use the taller Faceclaw viewport.' }, { label: 'Compact reader', description: 'Show a shorter conversation with larger controls.' }] },
    { id: 'events', header: 'Events', question: 'Which notification scenarios should this test cover?', multiSelect: true,
      options: [{ label: 'Agent completes', description: 'Open the exact T3 thread from an alert.' }, { label: 'Message arrives', description: 'Read, review a reply, or dismiss.' }, { label: 'Connection drops', description: 'Keep the draft and show the error code.' }] },
    { id: 'notes', header: 'Notes', question: 'Anything else to test?', multiSelect: false,
      options: [{ label: 'Ready to test', description: 'Continue with these scenarios.' }] },
  ],
};

/** Explicit sample-data adapter. It cannot contact a bridge or send a real message. */
export class T3DemoApi implements T3Api {
  calls: string[] = [];
  private sequence = 0;
  private projects = [
    { id: 'assistant', title: 'Personal assistant', canStartSession: true, updatedAt: ago(1) },
    { id: 'faceclaw', title: 'Faceclaw T3', canStartSession: true, updatedAt: ago(3) },
    { id: 'bridge', title: 'T3 bridge', canStartSession: true, updatedAt: ago(9) },
  ];
  private sessions: SessionSummary[] = [
    { id: 'ui', projectId: 'faceclaw', projectTitle: 'Faceclaw T3', title: 'Build the conversation reader', status: 'running', settled: false, lastActivityAt: ago(0), completedTurn: null },
    { id: 'plan', projectId: 'faceclaw', projectTitle: 'Faceclaw T3', title: 'Choose the notification interactions', status: 'waiting', settled: false, lastActivityAt: ago(2), completedTurn: null },
    { id: 'voice', projectId: 'bridge', projectTitle: 'T3 bridge', title: 'Whisper fallback is ready to test', status: 'idle', settled: false, lastActivityAt: ago(6), completedTurn: { id: 'voice-done', completedAt: ago(6) } },
    { id: 'completed-plan', projectId: 'faceclaw', projectTitle: 'Faceclaw T3', title: 'Review the completed dashboard plan', status: 'ready', settled: false, lastActivityAt: ago(8), completedTurn: { id: 'completed-plan-turn', completedAt: ago(8) } },
    { id: 'day', projectId: 'assistant', projectTitle: 'Personal assistant', title: 'Help me plan the afternoon', status: 'idle', settled: true, lastActivityAt: ago(40), completedTurn: { id: 'day-done', completedAt: ago(40) } },
  ];
  private models: ModelSummary[] = [
    { instanceId: 'demo', providerName: 'Preview', model: 'preview-astra', name: 'Astra · sample', isDefault: true,
      reasoningChoices: [{ id: 'high', label: 'High', isDefault: true }, { id: 'medium', label: 'Medium', isDefault: false }] },
    { instanceId: 'demo', providerName: 'Preview', model: 'preview-luna', name: 'Luna · sample', isDefault: false,
      reasoningChoices: [{ id: 'low', label: 'Low', isDefault: true }] },
  ];
  private extraMessages = new Map<string, string[]>();
  private answered = false;
  private proposed: ProposedPlan | null = { planId: 'sample-proposed-plan', revision: 'a'.repeat(64), turnId: 'completed-plan-turn',
    planMarkdown: '# Dashboard update\n\n1. Place the glasses battery in the upper-right corner of the left dashboard panel.\n\n2. Review the draft and choose plan or normal mode before sending.\n\n3. Keep plan questions and completed-plan approval as separate review steps.\n\n4. Check display-off and notification return behavior on the glasses.',
    createdAt: ago(8), updatedAt: ago(8) };

  constructor() {
    for (const session of this.sessions) {
      session.interactionMode = ['plan', 'completed-plan'].includes(session.id) ? 'plan' : 'default';
      session.modelSelection = { instanceId: 'demo', model: 'preview-astra', reasoningId: 'high' };
    }
  }

  completeAgent(): void {
    const session = this.sessions.find(s => s.id === 'ui')!;
    session.status = 'idle'; session.settled = false; session.lastActivityAt = ago(0);
    session.completedTurn = { id: `ui-done-${++this.sequence}`, completedAt: ago(0) };
  }

  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push(method);
    let result: unknown;
    if (method === 'projects.list') result = { projects: this.projects, snapshotId: 'demo' };
    else if (method === 'models.list') result = { models: this.models };
    else if (method === 'sessions.list') result = {
      snapshotId: 'demo', frozenAt: ago(0), unsettled: this.sessions.filter(s => !s.settled), settled: this.sessions.filter(s => s.settled),
    };
    else if (method === 'transcript.get') result = this.transcript(String(params.threadId));
    else if (method === 'transcript.unsubscribe') result = { threadId: String(params.threadId), unsubscribed: true };
    else if (method === 'thread.settle') {
      const session = this.sessions.find(s => s.id === params.threadId);
      if (session) session.settled = true;
      result = { threadId: params.threadId, settled: true, sequence: ++this.sequence };
    } else if (method === 'thread.reasoning.set') {
      const session = this.sessions.find(s => s.id === params.threadId);
      if (session?.modelSelection) session.modelSelection.reasoningId = String(params.reasoningId);
      result = { threadId: params.threadId, reasoningId: params.reasoningId, sequence: ++this.sequence };
    } else if (method === 'plan.approve') {
      if (params.threadId !== 'completed-plan' || !this.proposed || params.planId !== this.proposed.planId || params.revision !== this.proposed.revision) {
        throw Object.assign(new Error('This sample plan changed.'), { code: 'plan_unavailable', dispatched: false });
      }
      const session = this.sessions.find(s => s.id === 'completed-plan')!;
      session.interactionMode = 'default'; this.proposed = null;
      this.extraMessages.set(session.id, ['Implement the approved sample plan.']);
      result = { threadId: session.id, planId: params.planId, sequence: ++this.sequence };
    } else if (method === 'turn.send' || method === 'turn.steer') {
      const id = String(params.threadId);
      const session = this.sessions.find(s => s.id === id);
      if (session && method === 'turn.send' && (params.interactionMode === 'default' || params.interactionMode === 'plan')) session.interactionMode = params.interactionMode;
      this.extraMessages.set(id, [...this.extraMessages.get(id) || [], String(params.text)]);
      result = { threadId: id, text: params.text, sequence: ++this.sequence };
    } else if (method === 'thread.start' || method === 'assistant.start') {
      const project = this.projects.find(p => p.id === params.projectId)!;
      const id = `new-${++this.sequence}`;
      this.sessions.unshift({ id, projectId: project.id, projectTitle: project.title, title: String(params.text).slice(0, 60),
        status: 'idle', settled: false, lastActivityAt: ago(0), completedTurn: null, interactionMode: 'default', modelSelection: params.modelSelection as NewSessionModelSelection });
      this.extraMessages.set(id, [String(params.text)]);
      result = { threadId: id, text: params.text, sequence: this.sequence };
    } else if (method === 'plan.submit') {
      this.answered = true;
      result = { threadId: params.threadId, requestId: params.requestId, sequence: ++this.sequence };
    } else throw new Error(`Sample data does not implement ${method}`);
    // Snapshots have the same ownership as a decoded transport response.
    return JSON.parse(JSON.stringify(result)) as T;
  }

  private transcript(id: string): TranscriptResult {
    const session = this.sessions.find(s => s.id === id);
    if (!session) throw new Error('Sample conversation not found');
    const text = id === 'ui'
      ? 'The full-height reader is ready for review.\n\nProject and conversation navigation keep your place when a notification arrives. A tap opens the new conversation; double tap returns to what you were reading.\n\nNext I will check long replies, the plan-question flow, and the draft review screen.'
      : id === 'voice'
      ? 'Dictation uses Faceclaw\'s selected transcription engine.\n\nThe default on-device Moonshine engine works without a network connection once its voice model is downloaded. The reviewed transcript stays on screen until you tap to send.'
      : id === 'plan' ? 'I have three questions about the next UI test. Select Answer questions to review them. Nothing is submitted until the complete answer set is confirmed.'
      : 'This is a sample assistant conversation. The live version uses the project and model selected in T3 settings.';
    const messages = [
      { id: `${id}-user`, role: 'user' as const, text: 'Show me the current status and what to test next.', streaming: false, createdAt: ago(4), updatedAt: ago(4) },
      { id: `${id}-assistant`, role: 'assistant' as const, text, streaming: session.status === 'running', createdAt: ago(3), updatedAt: ago(0) },
      ...(this.extraMessages.get(id) || []).flatMap((draft, index) => [
        { id: `${id}-extra-${index}`, role: 'user' as const, text: draft, streaming: false, createdAt: ago(0), updatedAt: ago(0) },
        { id: `${id}-reply-${index}`, role: 'assistant' as const, text: 'Sample reply received. No live request was sent.', streaming: false, createdAt: ago(0), updatedAt: ago(0) },
      ]),
    ];
    return { snapshotId: 'demo', session, turns: [{ id: `${id}-turn`, startedAt: ago(4), endedAt: session.status === 'running' ? null : ago(0), durationSeconds: 12, separatorLabel: 'Latest turn', messages }],
      liveActivity: session.status === 'running' ? { phase: 'tool', label: 'Checking the conversation layout', updatedAt: ago(0) } : null,
      liveActivities: [], pendingPlanInput: id === 'plan' && !this.answered ? plan : null,
      pendingProposedPlan: id === 'completed-plan' && session.interactionMode === 'plan' ? this.proposed : null };
  }
}
