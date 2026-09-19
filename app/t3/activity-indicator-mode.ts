export type T3ActivityIndicatorMode = 'fluid' | 'efficient' | 'static';

export const T3_ACTIVITY_INDICATOR_MODES: readonly T3ActivityIndicatorMode[] = [
  'fluid', 'efficient', 'static',
];

export function normalizeT3ActivityIndicatorMode(value: unknown): T3ActivityIndicatorMode {
  return value === 'efficient' || value === 'static' ? value : 'fluid';
}

/** Null means paint one fixed phase and do not schedule decorative updates. */
export function t3ActivityIndicatorCadenceMs(mode: unknown): number | null {
  switch (normalizeT3ActivityIndicatorMode(mode)) {
    case 'efficient': return 500;
    case 'static': return null;
    default: return 140;
  }
}

export function t3ActivityIndicatorFrame(mode: unknown, presentationMs: number): number {
  const cadence = t3ActivityIndicatorCadenceMs(mode);
  return cadence === null ? 0 : Math.floor(Math.max(0, presentationMs) / cadence);
}

export function t3ActivityIndicatorLabel(mode: unknown): string {
  switch (normalizeT3ActivityIndicatorMode(mode)) {
    case 'efficient': return 'Battery saver (2 updates/sec)';
    case 'static': return 'Static';
    default: return 'Smooth (about 7 updates/sec)';
  }
}
