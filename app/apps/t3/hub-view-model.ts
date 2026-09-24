import { resourceKey } from './resource'
// Adapted from the MIT-licensed Even Hub T3 plugin. Keep interaction and pagination rules aligned.
// Use explicit Unicode ranges: the NativeScript Android V8 build lacks ICU
// property-escape support and rejects those regex literals at bundle startup.
import { getTextWidth } from '@evenrealities/pretext'
import { wrapText, type WrapFont } from '../../graphics/textwrap'
import type {
  LiveToolActivity,
  ModelSummary,
  ProjectSummary,
  ReasoningChoice,
  SessionSummary,
  SessionTokenUsage,
  SessionsListResult,
  TranscriptTurn,
} from './protocol'

export interface MenuRow {
  key: string
  text: string
  selectable: boolean
  value?: string
}

const sessionRunning = (session: SessionSummary) => ['running', 'starting'].includes(session.status)

/** Prefixes describe projects; navigation always uses the full project/thread ID. */
export function projectAbbreviations(projects: readonly Pick<ProjectSummary, 'id' | 'title'>[]): Map<string, string> {
  const result = new Map<string, string>()
  const singles = new Map<string, Array<{ id: string; title: string }>>()
  const initial = (word: string) => Array.from(word.toUpperCase())[0] ?? '?'
  for (const project of new Map(projects.map(project => [project.id, project])).values()) {
    const words = project.title.trim().split(/[\u002d\u058a\u05be\u1400\u1806\u2010-\u2015\u2e17\u2e1a\u2e3a-\u2e3b\u2e40\u2e5d\u301c\u3030\u30a0\ufe31-\ufe32\ufe58\ufe63\uff0d\u{10d6e}\u{10ead}_\s]+/u).filter(Boolean)
    if (words.length > 1) result.set(project.id, initial(words[0]!) + initial(words[1]!))
    else {
      const first = initial(words[0] ?? '')
      const group = singles.get(first) ?? []
      group.push(project)
      singles.set(first, group)
    }
  }
  for (const [first, group] of singles) {
    group.sort((a, b) => a.title.trim().localeCompare(b.title.trim(), 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    group.forEach((project, index) => {
      // Preserve the two-character display beyond nine projects. An exhausted
      // alphabet uses '?' rather than silently truncating or wrapping a rank.
      const rank = index + 1
      result.set(project.id, first + (rank < 36 ? rank.toString(36).toUpperCase() : '?'))
    })
  }
  return result
}

/** Working sessions lead Unsettled; each section otherwise follows recency. */
export function buildSessionRows(result: SessionsListResult, now = Date.now(), projects: readonly ProjectSummary[] = []): MenuRow[] {
  const sessions = sortSessionsByLastActivity([...new Map([...result.settled, ...result.unsettled].map(session => [resourceKey(session.id, session.environmentId), session])).values()])
  const abbreviations = projectAbbreviations([
    ...sessions.map(session => ({ id: session.projectId, title: session.projectTitle })), ...projects,
  ])
  const groups: Array<[string, SessionSummary[]]> = [
    ['UNSETTLED', sessions.filter(session => sessionRunning(session) || !session.settled)],
    ['SETTLED', sessions.filter(session => !sessionRunning(session) && session.settled)],
  ]
  const rows = groups.flatMap(([label, sessions]) => sessions.length ? [
    { key: `section:${label}`, text: label, selectable: false },
    ...sessions.map(session => sessionRow(session, now, abbreviations.get(session.projectId) ?? '??')),
  ] : [])
  return [
    { key: 'new', text: 'START NEW SESSION', selectable: true },
    ...(result.environments ?? []).filter(e => e.status !== 'connected').map(e => ({ key: `offline:${e.environmentId}`, text: `${e.label} · UNAVAILABLE`, selectable: false })),
    ...(rows.length ? rows : [{ key: 'sessions-empty', text: 'NO SESSIONS', selectable: false }]),
  ]
}

export function modelKey(model: Pick<ModelSummary, 'instanceId' | 'model'>): string {
  return JSON.stringify([model.instanceId, model.model])
}

export function buildModelRows(models: readonly ModelSummary[]): MenuRow[] {
  if (models.length === 0) {
    return [{ key: 'models-empty', text: 'NO CONFIGURED MODELS', selectable: false }]
  }
  const rows: MenuRow[] = []
  let provider = ''
  for (const model of models) {
    if (model.providerName !== provider) {
      provider = model.providerName
      rows.push({
        key: `provider:${model.instanceId}`,
        text: provider.toUpperCase(),
        selectable: false,
      })
    }
    const key = modelKey(model)
    rows.push({
      key: `model:${key}`,
      text: `${model.isDefault ? '* ' : '  '}${truncate(model.name, 36)}`,
      selectable: true,
      value: key,
    })
  }
  return rows
}

export function buildReasoningRows(choices: readonly ReasoningChoice[]): MenuRow[] {
  return choices.map((choice) => ({
    key: `reasoning:${choice.id}`,
    text: `${choice.isDefault ? '* ' : '  '}${truncate(choice.label, 36)}`,
    selectable: true,
    value: choice.id,
  }))
}

export function defaultModelKey(models: readonly ModelSummary[]): string | null {
  const model = models.find((candidate) => candidate.isDefault) ?? models[0]
  return model ? `model:${modelKey(model)}` : null
}

export function defaultReasoningId(choices: readonly ReasoningChoice[]): string | null {
  const choice = choices.find((candidate) => candidate.isDefault) ?? choices[0]
  return choice ? `reasoning:${choice.id}` : null
}

export interface RenderedMenu {
  body: string
  position: number
  count: number
}

export function sortSessionsByLastActivity(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const activeDifference = Number(sessionRunning(right)) - Number(sessionRunning(left))
    const timeDifference = timestamp(right.lastActivityAt) - timestamp(left.lastActivityAt)
    return activeDifference || timeDifference || left.id.localeCompare(right.id)
  })
}

export function freezeSessionOrder(result: SessionsListResult): SessionsListResult {
  return {
    ...result,
    unsettled: sortSessionsByLastActivity(result.unsettled),
    settled: sortSessionsByLastActivity(result.settled),
  }
}

export function buildProjectRows(projects: readonly ProjectSummary[]): MenuRow[] {
  const available = projects.filter((project) => project.canStartSession)
  if (available.length === 0) {
    return [{ key: 'projects-empty', text: 'NO PROJECTS AVAILABLE', selectable: false }]
  }
  return available.map((project) => ({
    key: `project:${resourceKey(project.id, project.environmentId)}`,
    text: truncate(projects.filter(other => other.title === project.title).length > 1 && project.environmentLabel ? `${project.title} · ${project.environmentLabel}` : project.title, 60),
    selectable: true,
    value: resourceKey(project.id, project.environmentId),
  }))
}

export function firstSelectableKey(rows: readonly MenuRow[]): string | null {
  return rows.find((row) => row.selectable)?.key ?? null
}

export function moveSelection(
  rows: readonly MenuRow[],
  currentKey: string | null,
  direction: -1 | 1,
): string | null {
  const selectable = rows.filter((row) => row.selectable)
  if (selectable.length === 0) return null
  const currentIndex = Math.max(0, selectable.findIndex((row) => row.key === currentKey))
  const nextIndex = Math.min(selectable.length - 1, Math.max(0, currentIndex + direction))
  return selectable[nextIndex]?.key ?? null
}

export function selectedValue(rows: readonly MenuRow[], selectedKey: string | null): string | null {
  return rows.find((row) => row.key === selectedKey && row.selectable)?.value ?? null
}

export function renderMenu(
  rows: readonly MenuRow[],
  selectedKey: string | null,
  maxLines = 8,
): RenderedMenu {
  const selectedRowIndex = Math.max(0, rows.findIndex((row) => row.key === selectedKey))
  let start = Math.max(0, selectedRowIndex - 2)
  start = Math.min(start, Math.max(0, rows.length - maxLines))
  const visibleRows = rows.slice(start, start + maxLines)
  const selectable = rows.filter((row) => row.selectable)
  const selectedPosition = selectable.findIndex((row) => row.key === selectedKey)
  return {
    body: visibleRows
      .map((row) => `${row.key === selectedKey ? '>' : ' '} ${row.text}`)
      .join('\n'),
    position: selectedPosition < 0 ? 0 : selectedPosition + 1,
    count: selectable.length,
  }
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp(iso)) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'WORKING'
  const wholeSeconds = Math.max(0, Math.floor(seconds))
  if (wholeSeconds < 60) return `WORKED ${wholeSeconds}S`
  const minutes = Math.floor(wholeSeconds / 60)
  if (minutes < 60) return `WORKED ${minutes}M ${wholeSeconds % 60}S`
  return `WORKED ${Math.floor(minutes / 60)}H ${minutes % 60}M`
}

export function transcriptToText(turns: readonly TranscriptTurn[]): string {
  if (turns.length === 0) return 'No transcript yet.'

  return turns.map((turn, index) => {
    const blocks = turn.messages.map(formatTranscriptMessage)
    const duration = turn.separatorLabel.trim().toUpperCase() || formatDuration(turn.durationSeconds)
    return [`TURN ${index + 1} | ${duration}`, ...blocks].join('\n\n')
  }).join('\n\n----------------\n\n')
}

export interface PageBox {
  font: WrapFont & { lineHeight: number }
  width: number
  height: number
  lineHeight?: number
}

export interface TranscriptPage {
  text: string
  speakerLabel: string
  messageId: string
  role: TranscriptTurn['messages'][number]['role']
  streaming: boolean
  messageUpdatedAt: string
  activeActivity: ActivityMarkerKind | null
  activeActivityLabel?: string | null
  turnNumber: number
  turnCount: number
  durationLabel: string
}

export type ActivityMarkerKind = 'thinking' | 'tool'

const FIXED_SPACE = '\u00a0'
const MAX_ACTIVITY_LABEL_WIDTH = 400
const PULSE_GLYPHS = [
  ['◐', '◐'],
  ['◓', '◓'],
  ['◑', '◑'],
  ['◒', '◒'],
  ['◐', '◐'],
  ['◓', '◓'],
  ['◑', '◑'],
  ['◒', '◒'],
] as const

export const ACTIVITY_PULSE_FRAME_COUNT = PULSE_GLYPHS.length

function activityWord(kind: ActivityMarkerKind, label?: string | null): string {
  if (kind === 'thinking') return 'thinking'
  const normalized = (label ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\u{110bd}\u{110cd}\u{13430}-\u{1343f}\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0001}\u{e0020}-\u{e007f}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'tool call'
  if (getTextWidth(normalized) <= MAX_ACTIVITY_LABEL_WIDTH) return normalized
  let fitted = normalized.slice(0, 160).replace(/\.*$/, '')
  while (fitted.length > 1 && getTextWidth(`${fitted}...`) > MAX_ACTIVITY_LABEL_WIDTH) {
    fitted = fitted.slice(0, -1)
  }
  return `${fitted}...`
}

export function activeActivityMarker(
  kind: ActivityMarkerKind,
  frame: number,
  label?: string | null,
): string {
  const glyphs = PULSE_GLYPHS[Math.abs(Math.floor(frame)) % PULSE_GLYPHS.length]!
  return `${glyphs[0]}${FIXED_SPACE}${activityWord(kind, label)}${FIXED_SPACE}${glyphs[1]}`
}

export function historicalActivityMarker(kind: ActivityMarkerKind, label?: string | null): string {
  return `-${FIXED_SPACE}${FIXED_SPACE}${FIXED_SPACE}${activityWord(kind, label)}${FIXED_SPACE}-`
}

export function renderActivityPulse(
  text: string,
  kind: ActivityMarkerKind,
  frame: number,
  label?: string | null,
): string {
  return text.replace(
    activeActivityMarker(kind, 0, label).trimEnd(),
    activeActivityMarker(kind, frame, label),
  )
}

export interface ExtractedActivityLine {
  body: string
  lineIndex: number
}

export function extractActiveActivityLine(
  text: string,
  kind: ActivityMarkerKind,
  _width: number,
  label?: string | null,
): ExtractedActivityLine | null {
  const marker = activeActivityMarker(kind, 0, label).trimEnd()
  const markerIndex = text.lastIndexOf(marker)
  if (markerIndex < 0) return null
  const beforeMarker = text.slice(0, markerIndex)
  return {
    body: `${beforeMarker}${text.slice(markerIndex + marker.length)}`,
    lineIndex: Math.max(0, beforeMarker.split('\n').length - 1),
  }
}

export interface ResponsePageSelection {
  pageIndex: number
  hasResponseText: boolean
}

export function retainTranscriptPage(
  previousPages: readonly TranscriptPage[],
  previousIndex: number,
  nextPages: readonly TranscriptPage[],
): number {
  const fallback = Math.min(Math.max(0, previousIndex), Math.max(0, nextPages.length - 1))
  const previous = previousPages[previousIndex]
  if (!previous?.messageId) return fallback
  const occurrence = previousPages
    .slice(0, previousIndex + 1)
    .filter((page) => page.messageId === previous.messageId).length - 1
  const matching = nextPages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.messageId === previous.messageId)
  return matching[Math.min(occurrence, matching.length - 1)]?.index ?? fallback
}

export function selectResponsePage(
  pages: readonly TranscriptPage[],
  baselineMessageIds: ReadonlySet<string>,
  working: boolean,
): ResponsePageSelection {
  const responsePages = pages.filter((page) => (
    page.role === 'assistant'
    && page.messageId.length > 0
    && !baselineMessageIds.has(page.messageId)
  ))
  const latestResponsePage = responsePages[responsePages.length - 1]
  if (!latestResponsePage) {
    return { pageIndex: Math.max(0, pages.length - 1), hasResponseText: false }
  }
  if (working) {
    return { pageIndex: pages.lastIndexOf(latestResponsePage), hasResponseText: true }
  }
  const finalMessageId = latestResponsePage.messageId
  return {
    pageIndex: pages.findIndex((page) => page.messageId === finalMessageId),
    hasResponseText: true,
  }
}

export function paginateTranscript(
  turns: readonly TranscriptTurn[],
  box: PageBox,
): TranscriptPage[] {
  if (turns.length === 0) {
    return [{
      text: 'No transcript yet.',
      speakerLabel: 'T3',
      messageId: '',
      role: 'assistant',
      streaming: false,
      messageUpdatedAt: '',
      activeActivity: null,
      turnNumber: 0,
      turnCount: 0,
      durationLabel: '',
    }]
  }

  return turns.flatMap((turn, index) => {
    const durationLabel = turn.separatorLabel.trim().toUpperCase() || formatDuration(turn.durationSeconds)
    if (turn.messages.length === 0) {
      return [{
        text: '(empty)',
        speakerLabel: 'T3',
        messageId: '',
        role: 'assistant',
        streaming: false,
        messageUpdatedAt: turn.endedAt ?? turn.startedAt,
        activeActivity: null,
        turnNumber: index + 1,
        turnCount: turns.length,
        durationLabel,
      }]
    }
    return turn.messages.flatMap((message) => {
      const content = plainText(message.text) || '(empty)'
      return paginateText(content, box).map((page) => ({
        text: page,
        speakerLabel: transcriptRoleLabel(message.role),
        messageId: message.id,
        role: message.role,
        streaming: message.streaming,
        messageUpdatedAt: message.updatedAt,
        activeActivity: null,
        turnNumber: index + 1,
        turnCount: turns.length,
        durationLabel,
      }))
    })
  })
}

export function paginateTranscriptWithLiveTurn(
  turns: readonly TranscriptTurn[],
  liveActivities: readonly LiveToolActivity[],
  liveActivity: { phase: ActivityMarkerKind; label?: string; updatedAt: string } | null,
  box: PageBox,
): TranscriptPage[] {
  if (liveActivity === null || turns.length === 0) return paginateTranscript(turns, box)

  const settledPages = turns.length > 1
    ? paginateTranscript(turns.slice(0, -1), box)
      .map((page) => ({ ...page, turnCount: turns.length }))
    : []
  const turn = turns[turns.length - 1]!
  const userPages = turn.messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => paginateText(`YOU\n${plainText(message.text) || '(empty)'}`, box).map((text) => ({
      text,
      speakerLabel: 'YOU',
      messageId: message.id,
      role: 'user' as const,
      streaming: false,
      messageUpdatedAt: message.updatedAt,
      activeActivity: null,
      turnNumber: turns.length,
      turnCount: turns.length,
      durationLabel: 'WORKING',
    })))
  const timeline = [
    ...turn.messages
      .filter((message) => message.role !== 'user')
      .map((message) => ({
        type: 'message' as const,
        at: timestamp(message.createdAt),
        text: `${transcriptRoleLabel(message.role)}\n${plainText(message.text) || '(empty)'}`,
      })),
    ...liveActivities.map((activity) => ({
      type: 'tool' as const,
      at: timestamp(activity.startedAt),
      activity,
    })),
  ].sort((left, right) => left.at - right.at)
  const activeToolId = liveActivity.phase === 'tool'
    ? [...liveActivities]
        .filter((activity) => activity.completedAt === null)
        .sort((left, right) => timestamp(left.startedAt) - timestamp(right.startedAt))
        .at(-1)?.id ?? null
    : null

  const blocks: Array<{ text: string; activity: boolean }> = []
  let activeMarker: ActivityMarkerKind | null = null
  let activeMarkerLabel: string | null = null
  if (timeline.length === 0 && liveActivity.phase === 'thinking') {
    blocks.push({ text: activeActivityMarker('thinking', 0), activity: true })
    activeMarker = 'thinking'
  } else {
    blocks.push({ text: historicalActivityMarker('thinking'), activity: true })
    for (const item of timeline) {
      if (item.type === 'message') {
        blocks.push({ text: item.text, activity: false })
        continue
      }
      const toolIsActive = item.activity.id === activeToolId
      blocks.push({
        text: toolIsActive
          ? activeActivityMarker('tool', 0, item.activity.label)
          : historicalActivityMarker('tool', item.activity.label),
        activity: true,
      })
      if (toolIsActive) {
        activeMarker = 'tool'
        activeMarkerLabel = item.activity.label
      }
    }
    if (liveActivity.phase === 'thinking') {
      blocks.push({ text: activeActivityMarker('thinking', 0), activity: true })
      activeMarker = 'thinking'
    } else if (activeMarker === null) {
      activeMarkerLabel = liveActivity.label ?? 'tool call'
      blocks.push({ text: activeActivityMarker('tool', 0, activeMarkerLabel), activity: true })
      activeMarker = 'tool'
    }
  }

  const content = blocks.map((block, index) => {
    if (index === 0) return block.text
    const previous = blocks[index - 1]!
    return `${previous.activity || block.activity ? '\n' : '\n\n'}${block.text}`
  }).join('')
  const liveTexts = paginateText(content, box)
  const liveMessageTime = turn.messages.reduce(
    (latest, message) => Math.max(latest, timestamp(message.updatedAt)),
    timestamp(liveActivity.updatedAt),
  )
  const livePages = liveTexts.map((text) => ({
    text,
    speakerLabel: 'LIVE',
    messageId: `live:${turn.id}`,
    role: 'assistant' as const,
    streaming: true,
    messageUpdatedAt: new Date(liveMessageTime || Date.now()).toISOString(),
    activeActivity: text.includes(
      activeActivityMarker(activeMarker ?? 'thinking', 0, activeMarkerLabel).trimEnd(),
    )
      ? activeMarker
      : null,
    activeActivityLabel: activeMarker === 'tool' ? activeMarkerLabel : null,
    turnNumber: turns.length,
    turnCount: turns.length,
    durationLabel: 'WORKING',
  }))

  return [...settledPages, ...userPages, ...livePages]
}

/** Rounded compact counts are display-only; the protocol keeps exact integers. */
export function formatSessionTokens(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '—'
  if (value < 1000) return String(value)
  const [scale, suffix] = value < 999_500 ? [1000, 'k'] : value < 999_500_000 ? [1_000_000, 'm'] : [1_000_000_000, 'b']
  return `${(value / Number(scale)).toFixed(value < Number(scale) * 10 ? 1 : 0).replace(/\.0$/, '')}${suffix}`
}

export function formatSessionModel(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  const source = value.trim().split('/').pop()?.trim() || ''
  const family = source.match(/(?:^|[^a-z])(astra|luna|terra|sol)(?:[^a-z]|$)/i)?.[1]
  return (family || source).toUpperCase().slice(0, 20)
}

export function transcriptPageHeader(
  page: TranscriptPage,
  pageNumber: number,
  pageCount: number,
  usage?: SessionTokenUsage,
  options: { working?: boolean; unread?: number; font?: WrapFont; width?: number; model?: string } = {},
): string {
  const turn = page.turnCount > 0 ? `TURN ${page.turnNumber}/${page.turnCount}` : 'NO TURNS'
  const model = formatSessionModel(options.model)
  const context = usage?.contextWindowTokens
    ? `${formatSessionTokens(usage.contextTokens)}/${formatSessionTokens(usage.contextWindowTokens)}`
    : formatSessionTokens(usage?.contextTokens)
  const usageLabel = `CTX ${context} | TOTAL ${formatSessionTokens(usage?.totalTokens)}`
  const status = options.working ? `LIVE${options.unread ? ` +${options.unread} NEW` : ''}` : page.speakerLabel
  const duration = options.working ? '' : page.durationLabel.replace(/^WORKED\s+/, '')
  const pageLabel = `${pageNumber}/${pageCount}`
  const tracked = [model, usageLabel].filter(Boolean).join(' · ')
  const candidates = [
    [turn, tracked, status, duration, pageLabel],
    [turn, tracked, status, pageLabel],
    [turn, tracked, pageLabel],
    [tracked, pageLabel],
    [tracked],
    [usageLabel],
  ].map(parts => parts.filter(Boolean).join(' | '))
  return candidates.find(value => !options.font || options.width === undefined || options.font.measureText(value) <= options.width) ?? usageLabel
}

/** Speech providers may insert single line breaks in otherwise continuous prose.
 * Reflow those for display; paragraph breaks and structured/code lines stay intact.
 * Callers retain the original final transcript for review/send authorization.
 */
export function reflowDictationText(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let inCode = false
  let previousWasProse = false
  for (const line of lines) {
    const fence = /^\s*```/.test(line)
    const structured = inCode || fence || /^(?:[ \t]{2,}\S|[ \t]*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>\s))/.test(line)
    const prose = line.trim().length > 0 && !structured
    if (prose && previousWasProse) output[output.length - 1] += ` ${line.trim()}`
    else output.push(prose ? line.trim() : line)
    previousWasProse = prose
    if (fence) inCode = !inCode
  }
  return output.join('\n')
}

/** Page breaks use the same measured lines and line pitch as the native renderer. */
export function paginateMessageText(source: string, box: PageBox): string[] {
  return paginateText(source, box)
}

export function paginateText(source: string, box: PageBox): string[] {
  const maxLines = Math.max(1, Math.floor(box.height / (box.lineHeight ?? box.font.lineHeight + 4)))
  const lines = wrapText(box.font, source.replace(/\r\n?/g, '\n'), box.width, {
    preserveLeadingWhitespace: true,
  })
  const pages: string[] = []
  for (let offset = 0; offset < lines.length; offset += maxLines) pages.push(lines.slice(offset, offset + maxLines).join('\n'))
  return pages.length > 0 ? pages : ['(empty)']
}

export function plainText(markdown: string): string {
  let inCode = false
  return markdown.replace(/\r\n?/g, '\n').split('\n').map(line => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return null }
    if (inCode) return line
    return line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}[ \t]+/, '')
      .replace(/^[ \t]*[-*+][ \t]+/, '- ')
      .replace(/[*_~`]/g, '')
      .replace(/<[^>]+>/g, '')
  }).filter(line => line !== null).join('\n')
}

function formatTranscriptMessage(message: TranscriptTurn['messages'][number]): string {
  const label = transcriptRoleLabel(message.role)
  return `${label}\n${plainText(message.text)}`
}

function transcriptRoleLabel(role: TranscriptTurn['messages'][number]['role']): string {
  return role === 'user' ? 'YOU' : role === 'system' ? 'SYSTEM' : 'T3'
}

function sessionRow(session: SessionSummary, now: number, abbreviation: string): MenuRow {
  const status = session.hasPendingUserInput ? 'QUESTION' : ['running', 'starting'].includes(session.status)
    ? 'WORKING'
    : formatRelativeTime(session.lastActivityAt, now)
  return {
    key: `session:${resourceKey(session.id, session.environmentId)}`,
    text: `${session.environmentLabel ? session.environmentLabel + " · " : ""}${abbreviation} - ${truncate(session.title, 24).padEnd(24)} ${status}`,
    selectable: true,
    value: resourceKey(session.id, session.environmentId),
  }
}

function timestamp(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : 0
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}
