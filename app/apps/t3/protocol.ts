// Adapted from the MIT-licensed T3 Code Assistant bridge.
import type { PhoneSnapshot, PhoneCommandResult, PhonePairing } from './phone-protocol'
export const PROTOCOL_VERSION = 1 as const
export const BRIDGE_PROTOCOL = 'even-t3-v1'

export interface EnvironmentSummary { environmentId: string; label: string; kind: string; status: string; isPrimary: boolean; errorCode?: string }

export interface SessionSummary {
  environmentId?: string
  environmentLabel?: string
  interactionMode?: 'default' | 'plan'
  modelSelection?: NewSessionModelSelection
  id: string
  projectId: string
  projectTitle: string
  title: string
  settled: boolean
  lastActivityAt: string
  status: string
  completedTurn?: { id: string; completedAt: string } | null
}

export interface WeatherLocation {
  id: string
  name: string
  region: string
  country: string
  latitude: number
  longitude: number
}

export interface WeatherCurrentResult {
  temperatureC: number
  condition: string
  observedAt: string
  fetchedAt: string
}

export interface SessionsListResult {
  environments?: EnvironmentSummary[]
  partial?: boolean
  snapshotId: string
  frozenAt: string
  unsettled: SessionSummary[]
  settled: SessionSummary[]
}

export interface ProjectSummary {
  environmentId?: string
  environmentLabel?: string
  id: string
  title: string
  canStartSession: boolean
  updatedAt: string
}

export interface ProjectsListResult {
  environments?: EnvironmentSummary[]
  partial?: boolean
  snapshotId: string
  projects: ProjectSummary[]
}

export interface ReasoningChoice {
  id: string
  label: string
  isDefault: boolean
}

export interface ModelSummary {
  environmentId?: string
  environmentLabel?: string
  instanceId: string
  providerName: string
  model: string
  name: string
  isDefault: boolean
  reasoningChoices: ReasoningChoice[]
}

export interface ModelsListResult {
  models: ModelSummary[]
}

export interface NewSessionModelSelection {
  instanceId: string
  model: string
  reasoningId?: string
}

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  streaming: boolean
  createdAt: string
  updatedAt: string
}

export interface TranscriptTurn {
  id: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number | null
  separatorLabel: string
  messages: TranscriptMessage[]
}

export interface LiveToolActivity {
  id: string
  kind: 'tool'
  label: string
  startedAt: string
  completedAt: string | null
}

export interface SessionTokenUsage {
  contextTokens: number | null
  contextWindowTokens: number | null
  totalTokens: number | null
  updatedAt: string | null
}

export interface TranscriptResult {
  tokenUsage?: SessionTokenUsage
  snapshotId: string
  session: SessionSummary
  turns: TranscriptTurn[]
  liveActivity: {
    phase: 'thinking' | 'tool'
    label: string
    updatedAt: string
  } | null
  liveActivities: LiveToolActivity[]
  pendingPlanInput?: PendingPlanInput | null
  pendingProposedPlan?: ProposedPlan | null
}

export interface ProposedPlan {
  planId: string
  revision: string
  turnId: string
  planMarkdown: string
  createdAt: string
  updatedAt: string
}

export interface PlanQuestion {
  id: string
  header: string
  question: string
  options: { label: string; description: string }[]
  multiSelect: boolean
}

export interface PendingPlanInput {
  requestId: string
  revision: string
  turnId: string | null
  createdAt: string
  questions: PlanQuestion[]
}

export interface PlanAnswer {
  questionId: string
  optionIndexes: number[]
  text: string
}

export interface PlanSubmitResult {
  threadId: string
  requestId: string
  sequence: number
}

export interface VoiceStartResult {
  maxBytes: number
  sampleRate: 16000
  channels: 1
  format: 'pcm_s16le'
}

export interface VoiceDraftResult {
  text: string
}

export interface SentTurnResult {
  threadId: string
  text: string
  sequence: number
}

export type VoiceTarget =
  | { kind: 'thread'; threadId: string; environmentId?: string }
  | { kind: 'project'; projectId: string; environmentId?: string; modelSelection: NewSessionModelSelection }
  | { kind: 'assistant'; projectId: string; environmentId?: string; modelSelection: NewSessionModelSelection }

export interface BridgeEvent {
  v: typeof PROTOCOL_VERSION
  type: 'event'
  event: 'phone.changed' | 'connection.changed' | 'sessions.changed' | 'transcript.changed' | 'bridge.status' | 'archive.status' | 'voice.partial' | 'voice.error'
  payload: unknown
}

export interface BridgeError {
  code: string
  message: string
}

export interface BridgeResponse {
  v: typeof PROTOCOL_VERSION
  type: 'response'
  id: string
  ok: boolean
  result?: unknown
  error?: BridgeError
}

export type BridgeMethod =
  | 'phone.notifications.list' | 'phone.apps.list' | 'phone.apps.setEnabled' | 'phone.notifications.reply' | 'phone.notifications.dismiss' | 'phone.pairing.create'
  | 'plan.submit'
  | 'plan.approve'
  | 'thread.reasoning.set'
  | 'thread.model.set'
  | 'weather.locations'
  | 'weather.current'
  | 'sessions.list'
  | 'projects.list'
  | 'models.list'
  | 'transcript.get'
  | 'transcript.unsubscribe'
  | 'thread.start'
  | 'assistant.start'
  | 'thread.settle'
  | 'turn.send'
  | 'turn.steer'
  | 'turn.reply'
  | 'voice.start'
  | 'voice.finish'
  | 'voice.cancel'

export type BridgeMethodResult = {
  'phone.notifications.list': PhoneSnapshot
  'phone.apps.list': PhoneSnapshot
  'phone.apps.setEnabled': PhoneSnapshot
  'phone.notifications.reply': PhoneCommandResult
  'phone.notifications.dismiss': PhoneCommandResult
  'phone.pairing.create': PhonePairing
  'plan.submit': PlanSubmitResult
  'plan.approve': { threadId: string; planId: string; sequence: number }
  'thread.reasoning.set': { threadId: string; reasoningId: string; sequence: number }
  'thread.model.set': { threadId: string; modelSelection: NewSessionModelSelection; sequence: number }
  'weather.locations': { locations: WeatherLocation[] }
  'weather.current': WeatherCurrentResult
  'sessions.list': SessionsListResult
  'projects.list': ProjectsListResult
  'models.list': ModelsListResult
  'transcript.get': TranscriptResult
  'transcript.unsubscribe': { threadId: string; unsubscribed: true }
  'thread.start': SentTurnResult
  'assistant.start': SentTurnResult
  'thread.settle': { threadId: string; settled: true; sequence: number }
  'turn.send': SentTurnResult
  'turn.steer': SentTurnResult
  'turn.reply': SentTurnResult
  'voice.start': VoiceStartResult
  'voice.finish': VoiceDraftResult
  'voice.cancel': { cancelled: boolean }
}

export class BridgeRequestError extends Error {
  readonly code: string

  constructor(error: BridgeError) {
    super(error.message)
    this.name = 'BridgeRequestError'
    this.code = error.code
  }
}
