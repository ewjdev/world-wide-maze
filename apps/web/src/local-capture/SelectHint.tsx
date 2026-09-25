/**
 * Phase 14: the "maze the page you're on" line on the select screen. It holds the draggable bookmarklet
 * and a link to /mazify (extension). Rendered by `src/ui/Screens.tsx` with one line.
 */
import './local.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Lang } from '../i18n/index.ts';
import { bookmarkletHref } from './bookmarklet.ts';
import { localStrings } from './strings.ts';

const hint = {
  en: { lead: 'Or maze the page you’re on:', drag: 'drag to your bookmarks bar', more: 'Extension and more' },
  ja: { lead: 'いま見ているページを迷路に：', drag: 'ブックマークバーへドラッグ', more: '拡張機能など' },
};

export function SelectHint() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === 'ja' ? 'ja' : 'en';
  const s = localStrings(lang);
  const h = hint[lang];
  const bm = useRef<HTMLAnchorElement>(null);
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    bm.current?.setAttribute('href', bookmarkletHref(location.origin));
  }, []);
  return (
    <p className="wwm-select-hint" data-testid="select-mazify">
      <span>{h.lead}</span>
      {/* href: /mazify until the effect swaps in the bookmarklet (React refuses javascript: in JSX) */}
      <a
        ref={bm}
        href="/mazify"
        className="wwm-select-hint__bm"
        draggable
        title={s.bmHowTo}
        onClick={(e) => {
          e.preventDefault();
          setClicked(true);
        }}
      >
        {s.bmDrag}
      </a>
      <span className="wwm-select-hint__drag">{clicked ? s.bmClicked : h.drag}</span>
      <Link to="/mazify" className="wwm-select-hint__more">
        {h.more}
      </Link>
    </p>
  );
}
