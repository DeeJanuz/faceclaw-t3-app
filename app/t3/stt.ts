import type { CloudSttClient, CloudSttOptions } from '../native/cloud-stt';
import { getT3Config, onT3ConfigChanged } from './config';
import { T3Client } from './client';

const DICTATION_ERROR_CODES = new Set([
  'no_speech', 'voice_cancelled', 'voice_not_active', 'voice_active', 'voice_too_large',
  'transcription_unavailable', 'transcription_failed', 'transcription_invalid_response',
  'T3_NOT_CONNECTED', 'T3_CONNECTION_DROPPED', 'T3_REQUEST_TIMEOUT', 'T3_SEND_FAILED',
  'T3_AUDIO_SEND_FAILED', 'unauthorized', 'rate_limited',
  'T3_CONNECT_TIMEOUT', 'T3_CONNECT_FAILED', 'T3_VOICE_START_TIMEOUT',
]);

/** Only fixed diagnostic codes can leave the provider boundary, never raw error text. */
function dictationErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && DICTATION_ERROR_CODES.has(code) ? code : 'dictation_failed';
}
/** Isolated voice socket, bounded buffering, no transcript logging or persistent audio. */
export class T3SttClient implements CloudSttClient {
  private client = new T3Client();
  private stopped = false;
  private ready = false;
  private finishing = false;
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private maxBytes = 9600000;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeConfig: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private options: CloudSttOptions, private fallback: () => void, private scope: 'configured' | 't3' = 'configured') {}
  start(): void {
    if (this.stopped || this.startTimer !== null || this.ready) return;
    this.startTimer = setTimeout(() => this.fail('T3_VOICE_START_TIMEOUT'), 20000);
    const initial = getT3Config();
    this.unsubscribeConfig = onT3ConfigChanged(() => {
      const config = getT3Config();
      if (!config.enabled || (this.scope === 'configured' && !config.bridgeDictation) || config.token !== initial.token || config.bridgeUrl !== initial.bridgeUrl) this.fail();
    });
    this.unsubscribe = this.client.onEvent((event) => {
      if (this.stopped) return;
      if (event.event === 'voice.partial' && typeof event.payload?.text === 'string') this.options.onTranscript({ text: event.payload.text, isFinal: false });
      if (event.event === 'voice.error') {
        // The bridge keeps recording after a partial preview failure. Preserve
        // the audio so voice.finish can still produce the authoritative text.
        if (event.payload?.error?.code === 'partial_transcription_unavailable') {
          this.options.onStatus('Live preview unavailable. Finish dictation to transcribe.');
        } else {
          this.fail(dictationErrorCode(event.payload?.error));
        }
      }
    });
    void (async () => {
      try {
        this.client.configure(initial);
        this.unsubscribeState = this.client.onStateChange(state => {
          if (state.phase === 'failed') this.fail(dictationErrorCode({ code: state.status }));
        });
        await this.client.connect();
        if (this.stopped) return;
        const recording = await this.client.rpc<any>('voice.start');
        if (this.stopped) return;
        if (!Number.isSafeInteger(recording?.maxBytes) || recording.maxBytes <= 0 || recording.sampleRate !== 16000 || recording.format !== 'pcm_s16le') throw new Error();
        this.maxBytes = Math.min(recording.maxBytes, this.maxBytes);
        if (this.bytes > this.maxBytes) throw new Error();
        this.ready = true;
        if (this.startTimer !== null) clearTimeout(this.startTimer);
        this.startTimer = null;
        for (const chunk of this.chunks) { this.client.sendAudio(chunk); chunk.fill(0); }
        this.chunks = [];
        if (this.finishing) await this.complete();
      } catch (error) { this.fail(dictationErrorCode(error)); }
    })();
  }
  acceptPcm(pcm: Uint8Array): void {
    if (this.stopped || this.finishing) return;
    this.bytes += pcm.length;
    if (this.bytes > this.maxBytes) { this.fail(); return; }
    try { if (this.ready) this.client.sendAudio(pcm); else this.chunks.push(pcm.slice()); }
    catch { this.fail(); }
  }
  finish(): void { if (this.stopped || this.finishing) return; this.finishing = true; if (this.ready) void this.complete(); }
  private async complete(): Promise<void> {
    try {
      const result = await this.client.rpc<{ text: string }>('voice.finish');
      if (this.stopped) return;
      if (typeof result?.text !== 'string') throw new Error();
      this.options.onTranscript({ text: result.text, isFinal: true });
      this.stop();
    } catch (error) {
      if (this.stopped) return;
      const code = dictationErrorCode(error);
      // Silence is a completed capture with no review text, not a failed STT
      // service. Do not invoke an unavailable local backup or promote partials.
      if (code === 'no_speech') {
        this.options.onStatus('No speech detected.');
        this.options.onTranscript({ text: '', isFinal: true });
        this.stop();
        return;
      }
      console.warn(`T3 dictation finish failed: ${code}`);
      this.fail(code);
    }
  }
  private fail(code = 'dictation_failed'): void {
    if (this.stopped) return;
    console.warn(`T3 dictation failed: ${code}`);
    this.stop(); this.options.onStatus('T3 unavailable; using on-device transcription.'); this.fallback();
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeConfig?.(); this.unsubscribeConfig = null;
    this.unsubscribeState?.(); this.unsubscribeState = null;
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.client.close(); for (const chunk of this.chunks) chunk.fill(0); this.chunks = [];
  }
}
