import { getT3Config } from './config';
import { T3Client } from './client';
import { refineDictation, type RefineDictationOptions, type AnthropicStreamHandle } from '../native/anthropic';
export function refineT3Dictation(options: RefineDictationOptions): AnthropicStreamHandle {
  if (getT3Config().refinementProvider !== 't3') return refineDictation(options);
  // Dedicated socket: cancellation cannot cancel another user's refinement or STT.
  const client = new T3Client();
  let cancelled = false;
  void (async () => {
    try {
      client.configure(getT3Config()); await client.connect();
      if (cancelled) return;
      const result = await client.rpc<{ text: string }>('refinement.rewrite', { text: options.original, instruction: options.followup });
      if (cancelled) return;
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('T3_REFINEMENT_EMPTY');
      options.onDone(result.text.trim());
    } catch (e) { if (!cancelled) options.onError((e as Error).message); }
    finally { client.close(); }
  })();
  return { cancel() { cancelled = true; if (client.connected) void client.rpc('refinement.cancel').catch(() => {}); client.close(); } };
}
