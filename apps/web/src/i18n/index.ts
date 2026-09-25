/**
 * i18next setup (E: the 2013 build localized with i18next; en first, ja second). All user-facing strings of
 * the game shell live in `en.ts` / `ja.ts`. The phone controller keeps its own table
 * (apps/web/src/controller/strings.ts, Phase 06) with the same language rule.
 */
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en.ts';
import { ja } from './ja.ts';

export type Lang = 'en' | 'ja';
export const LANGS: readonly Lang[] = ['en', 'ja'];
const KEY = 'wwm.lang';

export function detectLang(): Lang {
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ja') return saved;
  } catch {
    // storage blocked
  }
  const nav = typeof navigator === 'undefined' ? undefined : navigator.languages?.[0];
  return nav?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** One i18next instance per app mount (no global singleton). */
export function createI18n(lang: Lang = detectLang()): i18n {
  const inst = i18next.createInstance();
  void inst.use(initReactI18next).init({
    resources: { en: { translation: en }, ja: { translation: ja } },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React escapes
    initAsync: false,
    returnNull: false,
  });
  return inst;
}

export function setLang(inst: i18n, lang: Lang): void {
  void inst.changeLanguage(lang);
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export { en, ja };
