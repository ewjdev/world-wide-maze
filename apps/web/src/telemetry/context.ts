import type { TelemetryContext } from '@wwm/schema';

/** Normalize BEFORE capture: paths contain room codes; hashes can contain pairing credentials. */
export function routeName(path: string): TelemetryContext['route'] {
  if (path === '/') return 'home';
  if (path === '/play/local') return 'local';
  if (path.startsWith('/play/')) return 'play';
  if (path.startsWith('/c/')) return 'controller';
  if (path.startsWith('/p/')) return 'host';
  if (path.startsWith('/making')) return 'making';
  if (path.startsWith('/j/')) return 'journey';
  if (path === '/privacy/analytics') return 'privacy';
  if (path === '/about' || path === '/log' || path === '/mazify')
    return path.slice(1) as 'about' | 'log' | 'mazify';
  return 'other';
}

function sourceName(value: string): TelemetryContext['source'] {
  const s = value.toLowerCase();
  if (['google', 'bing', 'linkedin', 'github', 'reddit', 'facebook', 'email'].includes(s))
    return s as TelemetryContext['source'];
  if (s === 'twitter' || s === 'x') return 'x';
  return 'other';
}

export function pageContext(win: Window): TelemetryContext {
  const route = routeName(win.location.pathname);
  const ua = win.navigator.userAgent;
  const params = new URLSearchParams(win.location.search);
  let source: TelemetryContext['source'] = 'direct';
  if (params.has('utm_source')) source = sourceName(params.get('utm_source') ?? '');
  else if (win.document.referrer) {
    try {
      const ref = new URL(win.document.referrer);
      if (ref.origin === win.location.origin) source = 'internal';
      else {
        const known = ['google', 'bing', 'linkedin', 'github', 'reddit', 'facebook', 'twitter', 'x'].find(
          (s) => ref.hostname === `${s}.com` || ref.hostname.endsWith(`.${s}.com`),
        );
        source = known ? sourceName(known) : 'referral';
      }
    } catch {
      source = 'other';
    }
  }
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');
  return {
    route,
    surface:
      route === 'controller'
        ? 'controller'
        : ['home', 'play', 'local', 'host'].includes(route)
          ? 'host'
          : 'site',
    device: /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobile|Android/i.test(ua) ? 'mobile' : 'desktop',
    browser: /Edg\//.test(ua)
      ? 'Edge'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Other',
    language: win.navigator.language.startsWith('ja')
      ? 'ja'
      : win.navigator.language.startsWith('en')
        ? 'en'
        : 'other',
    source,
    medium: !medium
      ? 'none'
      : ['social', 'email', 'referral', 'organic', 'paid'].includes(medium)
        ? (medium as TelemetryContext['medium'])
        : 'other',
    campaign: !campaign
      ? 'none'
      : ['launch', 'build-story', 'tribute'].includes(campaign)
        ? (campaign as TelemetryContext['campaign'])
        : 'other',
  };
}
