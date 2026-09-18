import { Utils } from '@nativescript/core';

declare const com: any;

export interface T3PowerHint {
  kind: 'network' | 'idle';
  available?: boolean;
  idle?: boolean;
}

/** Starts process-owned Android hints. The WebSocket handshake remains authoritative. */
export function startT3PowerMonitor(onHint: (hint: T3PowerHint) => void): () => void {
  if (!global.isAndroid) return () => {};
  try {
    const context = Utils.android.getApplicationContext();
    const monitor = new com.faceclaw.app.FaceclawT3PowerMonitor(context);
    const listener = new com.faceclaw.app.FaceclawT3PowerMonitorListener({
      onNetworkAvailable: (available: boolean) => onHint({ kind: 'network', available: Boolean(available) }),
      onDeviceIdleChanged: (idle: boolean) => onHint({ kind: 'idle', idle: Boolean(idle) }),
    });
    monitor.start(listener);
    return () => { try { monitor.stop(); } catch { /* Teardown races are harmless. */ } };
  } catch {
    // Older/vendor Android builds may reject callback registration. Recovery
    // still runs on normal WebSocket backoff and application resume.
    return () => {};
  }
}
