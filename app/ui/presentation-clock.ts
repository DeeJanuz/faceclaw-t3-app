let targetPresentationMs: number | null = null;
let lastPresentationMs = 0;

/** Supplies the scheduler's next presentation sample without changing wall-clock timers. */
export function setPresentationTime(value: unknown): void {
  const parsed = Number(value);
  targetPresentationMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function presentationNow(): number {
  // Input can start a new motion long after the last render credit. Never
  // initialize it in the past and then jump to completion on the next credit.
  lastPresentationMs = Math.max(lastPresentationMs, targetPresentationMs ?? 0, Date.now());
  return lastPresentationMs;
}
