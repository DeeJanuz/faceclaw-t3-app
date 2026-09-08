import { bridgeEndpoint, validateToken } from './security';
import { saveT3Config } from './config';
declare const com: any;
const pending = new Set<any>();
export function pairT3(bridgeUrl: string, passphrase: string, allowInsecureLocal = false): Promise<void> {
  const endpoint = new URL(bridgeEndpoint(bridgeUrl, allowInsecureLocal));
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
  endpoint.pathname = '/v1/faceclaw/pair';
  if (!passphrase || passphrase.length > 512) return Promise.reject(new Error('T3_PAIR_CODE_REQUIRED'));
  return new Promise<void>((resolve, reject) => {
    let response = '';
    const listener = new com.faceclaw.app.FaceclawSseListener({
      onLine: (line: string) => { response += String(line); },
      onHttpError: (code: number) => { pending.delete(listener); reject(new Error(`T3_PAIR_HTTP_${code}`)); },
      onFailure: () => { pending.delete(listener); reject(new Error('T3_PAIR_FAILED')); },
      onComplete: () => {
        pending.delete(listener);
        try {
          const result = JSON.parse(response); validateToken(result.token);
          saveT3Config({ bridgeUrl, allowInsecureLocal, token: result.token, enabled: true }); resolve();
        } catch { reject(new Error('T3_PAIR_INVALID')); }
      },
    });
    pending.add(listener);
    try { com.faceclaw.app.FaceclawT3Pairing.pair(endpoint.toString(), JSON.stringify({ passphrase }), listener); }
    catch { pending.delete(listener); reject(new Error('T3_PAIR_FAILED')); }
  });
}
