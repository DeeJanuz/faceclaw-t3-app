let targetPresentationMs: number | null = null;

/** Supplies the scheduler's next presentation sample without changing wall-clock timers. */
export function setPresentationTime(value: unknown): void {
  const parsed = Number(value);
  targetPresentationMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function presentationNow(): number {
  // Input can start a new motion long after the last render credit. Never
  // initialize it in the past and then jump to completion on the next credit.
  return Math.max(targetPresentationMs ?? 0, Date.now());
}
