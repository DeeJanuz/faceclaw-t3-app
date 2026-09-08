import { bridgeEndpoint, validateToken, isDefiniteBridgeRejection } from './security';
import { getT3Config, type T3Config } from './config';
import { toJavaBytes } from '../native/cloud-stt';
declare const com: any;
export interface T3Event { v: 1; type: 'event'; event: string; payload: any }
export interface T3State { phase: 'idle' | 'connecting' | 'connected' | 'failed'; status: string; connected: boolean }
export class T3Error extends Error { constructor(public readonly code: string, public readonly dispatched = false) { super(code); } }
export class T3Client {
  private config: T3Config | null = null;
  private ws: any = null;
  private listener: any = null;
  private generation = 0;
  private sequence = 0;
  private current: T3State = { phase: 'idle', status: 'T3 disconnected', connected: false };
  private pending = new Map<string, { resolve: (value: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private events = new Set<(event: T3Event) => void>();
  private states = new Set<(state: T3State) => void>();
  private connecting: Promise<void> | null = null;
  private rejectConnect: ((e: Error) => void) | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  get connected(): boolean { return this.current.connected; }
  state(): T3State { return this.current; }
  onEvent(listener: (event: T3Event) => void): () => void { this.events.add(listener); return () => this.events.delete(listener); }
  onStateChange(listener: (state: T3State) => void): () => void { this.states.add(listener); return () => this.states.delete(listener); }
  configure(config: T3Config): void {
    if (this.config && JSON.stringify(this.config) === JSON.stringify(config)) return;
    this.close(); this.config = { ...config };
  }
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const config = this.config ?? getT3Config();
    let url: string;
    try {
      if (!config.enabled) throw new T3Error('T3_DISABLED');
      url = bridgeEndpoint(config.bridgeUrl, config.allowInsecureLocal); validateToken(config.token);
    } catch (e) { return Promise.reject(e); }
    const generation = ++this.generation;
    this.setState('connecting', 'Connecting to T3');
    const promise = new Promise<void>((resolve, reject) => {
      this.rejectConnect = reject;
      this.connectTimer = setTimeout(() => { if (generation === this.generation) this.lost('T3_CONNECT_TIMEOUT'); }, 10000);
      this.listener = new com.faceclaw.app.FaceclawWebSocketListener({
        onOpen: () => {
          if (generation !== this.generation) return;
          this.clearConnect(); this.setState('connected', 'T3 connected'); resolve();
        },
        onTextMessage: (raw: string) => { if (generation === this.generation) this.receive(String(raw)); },
        onClosed: () => { if (generation === this.generation) this.lost('T3_CONNECTION_DROPPED'); },
        onFailure: () => { if (generation === this.generation) this.lost('T3_CONNECTION_DROPPED'); },
      });
      try { this.ws = new com.faceclaw.app.FaceclawWebSocket(url, this.listener, 'Sec-WebSocket-Protocol', `even-t3-v1, auth.${config.token}`); }
      catch { this.lost('T3_CONNECT_FAILED'); }
    });
    this.connecting = promise;
    void promise.then(() => { if (this.connecting === promise) this.connecting = null; }, () => { if (this.connecting === promise) this.connecting = null; });
    return promise;
  }
  rpc<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected || !this.ws) return Promise.reject(new T3Error('T3_NOT_CONNECTED'));
    const id = `fc-${this.generation}-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new T3Error('T3_REQUEST_TIMEOUT', true)); }, method === 'voice.finish' || method === 'refinement.rewrite' ? 90000 : 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { if (!this.ws.sendText(JSON.stringify({ v: 1, type: 'request', id, method, params }))) throw new Error(); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new T3Error('T3_SEND_FAILED', true)); }
    });
  }
  request<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> { return this.rpc<T>(method, params); }
  sendAudio(bytes: Uint8Array): void {
    if (!this.connected || !this.ws) throw new T3Error('T3_NOT_CONNECTED');
    if (!this.ws.sendBinary(toJavaBytes(bytes))) throw new T3Error('T3_AUDIO_SEND_FAILED', true);
  }
  close(): void { this.lost('T3_CLOSED'); this.setState('idle', 'T3 disconnected'); }
  private receive(raw: string): void {
    if (raw.length > 4 * 1024 * 1024) { this.lost('T3_FRAME_TOO_LARGE'); return; }
    let frame: any; try { frame = JSON.parse(raw); } catch { return; }
    if (!frame || frame.v !== 1) return;
    if (frame.type === 'response' && typeof frame.id === 'string' && typeof frame.ok === 'boolean') {
      const pending = this.pending.get(frame.id); if (!pending) return;
      this.pending.delete(frame.id); clearTimeout(pending.timer);
      if (frame.ok) pending.resolve(frame.result);
      else {
        const code = typeof frame.error?.code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(frame.error.code) ? frame.error.code : 'T3_REQUEST_FAILED';
        pending.reject(new T3Error(code, !isDefiniteBridgeRejection(code)));
      }
    } else if (frame.type === 'event' && typeof frame.event === 'string') {
      for (const listener of this.events) { try { listener(frame); } catch { /* Consumer isolation. */ } }
    }
  }
  private clearConnect(): void { if (this.connectTimer) clearTimeout(this.connectTimer); this.connectTimer = null; this.rejectConnect = null; }
  private lost(code: string): void {
    ++this.generation;
    const ws = this.ws; this.ws = null; this.listener = null;
    this.rejectConnect?.(new T3Error(code)); this.clearConnect(); this.connecting = null;
    try { ws?.close(1000, 'closed'); } catch { /* Already closed. */ }
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new T3Error(code, true)); }
    this.pending.clear(); this.setState('failed', code);
  }
  private setState(phase: T3State['phase'], status: string): void {
    this.current = { phase, status, connected: phase === 'connected' };
    for (const listener of this.states) { try { listener(this.current); } catch { /* Consumer isolation. */ } }
  }
}
export const t3Client = new T3Client();
