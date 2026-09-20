export interface TokenCounterReading {
  totalTokens: number | null;
  latestTotalTokens?: number | null;
  updatedAt: string | null;
}

export interface TokenAccountingState {
  modelKey: string;
  resetInterval: boolean;
  baselineRaw: number | null;
  lastRaw: number | null;
  lastAt: string | null;
  displayedTotal: number | null;
  invalid: boolean;
}

export interface TokenAccountingResult {
  state: TokenAccountingState;
  totalTokens: number | null;
  changedModel: boolean;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
}

export function parseTokenAccountingState(value: unknown): TokenAccountingState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.modelKey !== 'string' || candidate.modelKey.length < 1 || candidate.modelKey.length > 600 ||
      typeof candidate.resetInterval !== 'boolean' || typeof candidate.invalid !== 'boolean') return null;
  const baselineRaw = candidate.baselineRaw === null ? null : count(candidate.baselineRaw);
  const lastRaw = candidate.lastRaw === null ? null : count(candidate.lastRaw);
  const displayedTotal = candidate.displayedTotal === null ? null : count(candidate.displayedTotal);
  const lastAt = candidate.lastAt === null ? null : timestamp(candidate.lastAt);
  if ((candidate.baselineRaw !== null && baselineRaw === null) ||
      (candidate.lastRaw !== null && lastRaw === null) ||
      (candidate.displayedTotal !== null && displayedTotal === null) ||
      (candidate.lastAt !== null && lastAt === null)) return null;
  return { modelKey: candidate.modelKey, resetInterval: candidate.resetInterval,
    baselineRaw, lastRaw, lastAt, displayedTotal, invalid: candidate.invalid };
}

/**
 * Preserve T3's lifetime total until this client observes its first model
 * transition. Every later provider/model transition starts a new display
 * interval. The raw provider counter is cumulative, so interval usage is a
 * delta from the reading at that boundary.
 */
export function reconcileTokenTotal(
  previous: TokenAccountingState | null,
  modelKey: string,
  reading: TokenCounterReading,
): TokenAccountingResult {
  const raw = count(reading.latestTotalTokens);
  const at = timestamp(reading.updatedAt);
  if (!previous) {
    const displayedTotal = count(reading.totalTokens);
    return { changedModel: false, totalTokens: displayedTotal, state: {
      modelKey, resetInterval: false, baselineRaw: null, lastRaw: raw,
      lastAt: raw !== null ? at : null, displayedTotal, invalid: false,
    } };
  }

  if (previous.modelKey !== modelKey) {
    const displayedTotal = raw === null || at === null ? null : 0;
    return { changedModel: true, totalTokens: displayedTotal, state: {
      modelKey, resetInterval: true, baselineRaw: raw, lastRaw: raw,
      lastAt: raw !== null ? at : null, displayedTotal, invalid: false,
    } };
  }

  if (!previous.resetInterval) {
    const displayedTotal = count(reading.totalTokens);
    return { changedModel: false, totalTokens: displayedTotal, state: {
      ...previous, lastRaw: raw ?? previous.lastRaw,
      lastAt: raw !== null && at !== null ? at : previous.lastAt,
      displayedTotal,
    } };
  }
  if (previous.invalid || raw === null || at === null) {
    return { changedModel: false, totalTokens: previous.invalid ? null : previous.displayedTotal,
      state: previous.invalid ? { ...previous, displayedTotal: null } : previous };
  }
  if (previous.lastAt !== null) {
    const order = Date.parse(at) - Date.parse(previous.lastAt);
    if (order <= 0) return { changedModel: false, totalTokens: previous.displayedTotal, state: previous };
  }
  if (previous.lastRaw !== null && raw < previous.lastRaw) {
    const state = { ...previous, lastRaw: raw, lastAt: at, displayedTotal: null, invalid: true };
    return { changedModel: false, totalTokens: null, state };
  }
  if (previous.baselineRaw === null) {
    const state = { ...previous, baselineRaw: raw, lastRaw: raw, lastAt: at, displayedTotal: 0 };
    return { changedModel: false, totalTokens: 0, state };
  }
  if (raw < previous.baselineRaw) {
    const state = { ...previous, lastRaw: raw, lastAt: at, displayedTotal: null, invalid: true };
    return { changedModel: false, totalTokens: null, state };
  }
  const displayedTotal = raw - previous.baselineRaw;
  const state = { ...previous, lastRaw: raw, lastAt: at, displayedTotal };
  return { changedModel: false, totalTokens: displayedTotal, state };
}
