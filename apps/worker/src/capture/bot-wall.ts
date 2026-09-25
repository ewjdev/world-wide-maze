/**
 * Bot-wall / interstitial heuristics → `CAPTURE_BLOCKED`. A small legitimate page (example.com has 4
 * elements) must still pass, so size alone never blocks; only an error status, a known challenge marker,
 * or a page with nothing on it does.
 */
import type { CaptureBundle } from '@wwm/schema';

/** Case-insensitive markers of challenge pages (Cloudflare, Akamai, PerimeterX, DataDome, Imperva, AWS WAF…). */
export const CHALLENGE_MARKERS: readonly RegExp[] = [
  /just a moment\.\.\./i,
  /attention required!? \| cloudflare/i,
  /checking (if the site connection is secure|your browser)/i,
  /verify(ing)? (that )?you are (a )?human/i,
  /are you a robot/i,
  /press (&|and) hold/i,
  /access denied/i,
  /request unsuccessful\. incapsula/i,
  /pardon our interruption/i,
  /captcha/i,
  /enable javascript and cookies to continue/i,
  /unusual traffic from your computer network/i,
  /\bbot detection\b/i,
];

export interface BlockInput {
  status: number;
  bundle: Pick<CaptureBundle, 'title' | 'elements' | 'page'>;
}

/** Reason the capture looks blocked, or null if it looks like the real page. */
export function detectBlocked({ status, bundle }: BlockInput): string | null {
  if (status >= 400) return `site answered HTTP ${status}`;
  const texts = [bundle.title, ...bundle.elements.slice(0, 200).map((e) => e.text ?? '')];
  const joined = texts.join('\n');
  const marker = CHALLENGE_MARKERS.find((re) => re.test(joined));
  // A marker only counts on small pages: a long article that merely mentions "captcha" is fine.
  if (marker && bundle.elements.length < 60) return `looks like a bot check (${marker.source})`;
  if (bundle.elements.length === 0) return 'page rendered nothing we can build from';
  return null;
}
