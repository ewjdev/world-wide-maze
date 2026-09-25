/**
 * Capturer (b′): the Worker delegates to the Node capture sidecar (`node/sidecar.ts`), which runs the
 * local-Chromium capturer with the same `capture/core.ts` sequence and SSRF guard. Used by the integration
 * tests (the Worker under test runs in workerd, where Playwright can't) and optionally in local dev.
 */
import { parseCapture } from '@wwm/schema';
import { ServiceError } from '../errors.ts';
import type { CaptureOutput, CaptureRequest, Capturer } from './types.ts';
import { decodeCaptureOutput, errorFromWire } from './wire.ts';

export class HttpCapturer implements Capturer {
  readonly name = 'sidecar';
  constructor(
    private readonly endpoint: string,
    private readonly doFetch: typeof fetch = (i, init) => fetch(i, init),
  ) {}

  async capture(req: CaptureRequest): Promise<CaptureOutput> {
    const budget = req.deadline - Date.now();
    if (budget <= 0) throw new ServiceError('CAPTURE_TIMEOUT', 'no time left to capture');
    let res: Response;
    try {
      res = await this.doFetch(new URL('/capture', this.endpoint).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: req.url, budgetMs: budget, now: req.now?.().toISOString() }),
        // A little slack over the budget so the sidecar can report CAPTURE_TIMEOUT itself.
        signal: AbortSignal.timeout(budget + 3000),
      });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError')
        throw new ServiceError('CAPTURE_TIMEOUT', 'capture timed out');
      throw new ServiceError('BUILD_FAILED', `capture sidecar unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw errorFromWire(res.status, await res.json().catch(() => null));
    req.onStep?.('extracting');
    const out = decodeCaptureOutput(new Uint8Array(await res.arrayBuffer()));
    return { ...out, bundle: parseCapture(out.bundle) };
  }
}
