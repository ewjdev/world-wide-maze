/** Only ordinary web pages can be captured (browsers also forbid their own pages and the extension stores). */
export function capturable(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !/^(chromewebstore\.google\.com|chrome\.google\.com|addons\.mozilla\.org)$/i.test(u.hostname);
  } catch {
    return false;
  }
}
