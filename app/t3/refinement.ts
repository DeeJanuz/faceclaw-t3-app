import { getT3Config } from './config';
import { T3Client } from './client';
import { refineDictation, type RefineDictationOptions, type AnthropicStreamHandle } from '../native/anthropic';
let nextRefinementId = 0;
export function refineT3Dictation(options: RefineDictationOptions): AnthropicStreamHandle {
  if (getT3Config().refinementProvider !== 't3') return refineDictation(options);
  // Dedicated socket: cancellation cannot cancel another user's refinement or STT.
  const client = new T3Client();
  let cancelled = false;
  const requestId = `r${Date.now()}-${++nextRefinementId}`;
  const startedAt = Date.now();
  console.info(`[T3Refinement] start id=${requestId} originalChars=${options.original.length} instructionChars=${options.followup.length}`);
  void (async () => {
    try {
      client.configure(getT3Config()); await client.connect();
      if (cancelled) return;
      const result = await client.rpc<{ text: string }>('refinement.rewrite', { text: options.original, instruction: options.followup });
      if (cancelled) return;
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('T3_REFINEMENT_EMPTY');
      console.info(`[T3Refinement] complete id=${requestId} elapsedMs=${Date.now() - startedAt} outputChars=${result.text.length}`);
      options.onDone(result.text.trim());
    } catch (e) {
      if (!cancelled) {
        const rawCode = e instanceof Error ? e.message : '';
        const code = rawCode && /^[A-Za-z0-9_]{1,80}$/.test(rawCode) ? rawCode : 'T3_REFINEMENT_FAILED';
        console.warn(`[T3Refinement] failed id=${requestId} elapsedMs=${Date.now() - startedAt} code=${code}`);
        options.onError(code);
      }
    }
    finally { client.close(); }
  })();
  return { cancel() { cancelled = true; if (client.connected) void client.rpc('refinement.cancel').catch(() => {}); client.close(); } };
}
