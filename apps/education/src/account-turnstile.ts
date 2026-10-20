/**
 * Turnstile on the email sign-in form. The site key comes from `VITE_TURNSTILE_SITE_KEY` at build time. In the
 * Vite dev server without a key, the widget is skipped and the documented dummy token is sent: the Worker in
 * development answers it with Cloudflare's always-pass test secret, and no deployed Worker accepts it.
 * The widget script loads from challenges.cloudflare.com only when a real key is configured (the Worker's
 * `/learn/account/` CSP allows exactly that origin).
 */
export const DEV_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      action?: string;
    },
  ): string;
  reset(widget?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileHandle {
  /** The current token, or null if the check hasn't passed yet. */
  token(): string | null;
  /** After a token is used (they are single use). */
  reset(): void;
  /** False when sign-in by email can't work in this build (no site key outside dev). */
  available: boolean;
}

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile')));
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(script);
  });
}

export function mountTurnstile(container: HTMLElement): TurnstileHandle {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
  if (!siteKey) {
    const dev = import.meta.env.DEV;
    container.hidden = true;
    return { token: () => (dev ? DEV_TURNSTILE_TOKEN : null), reset: () => {}, available: dev };
  }
  let token: string | null = null;
  let widget: string | undefined;
  loadScript()
    .then((api) => {
      widget = api.render(container, {
        sitekey: siteKey,
        action: 'learning-sign-in',
        callback: (value) => {
          token = value;
        },
        'expired-callback': () => {
          token = null;
        },
        'error-callback': () => {
          token = null;
        },
      });
    })
    .catch(() => {
      container.textContent = 'The “are you human” check couldn’t load. Check your connection and reload.';
    });
  return {
    token: () => token,
    reset: () => {
      token = null;
      window.turnstile?.reset(widget);
    },
    available: true,
  };
}
