/**
 * Capturer (b): local Playwright Chromium in Node, for tests, benchmarks and the capture sidecar. Runs the
 * exact `capture/core.ts` sequence (same SSRF guard, same capture-script steps) as Browser Run.
 * Not bundled into the Worker (Node-only: imports `playwright`).
 */
import { type Browser, chromium, type Page } from 'playwright';
import { type CoreOptions, captureWithBrowser } from '../src/capture/core.ts';
import type { CaptureOutput, CaptureRequest, Capturer } from '../src/capture/types.ts';

/** Chromium flags that close non-HTTP side channels the CDP `Fetch` guard can't see. */
export const HARDENING_ARGS = [
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-features=WebRtcHideLocalIpsWithMdns,DnsOverHttps,InterestFeedContentSuggestions',
  '--disable-background-networking',
  '--no-pings',
];

export class LocalChromiumCapturer implements Capturer {
  readonly name = 'local-chromium';
  private browser: Promise<Browser> | undefined;

  constructor(private readonly opts: CoreOptions) {}

  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ args: HARDENING_ARGS });
    return this.browser;
  }

  async capture(req: CaptureRequest): Promise<CaptureOutput> {
    return captureWithBrowser<Page>(await this.getBrowser(), req, this.opts);
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b).close();
  }
}
