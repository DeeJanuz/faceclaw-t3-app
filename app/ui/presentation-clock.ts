let targetPresentationMs: number | null = null;

/** Supplies the scheduler's next presentation sample without changing wall-clock timers. */
export function setPresentationTime(value: unknown): void {
  const parsed = Number(value);
  targetPresentationMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function presentationNow(): number {
  return targetPresentationMs ?? Date.now();
}
