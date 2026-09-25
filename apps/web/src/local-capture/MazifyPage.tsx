/**
 * Phase 14 `/mazify`: how to maze the page you're on. The extension (full fidelity) and the bookmarklet
 * (sketch mode, no install), plus what happens to the page.
 */
import '@fontsource-variable/unbounded';
import '@fontsource-variable/figtree';
import '../ui/game.css';
import './local.css';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../ui/parts.tsx';
import { bookmarkletHref } from './bookmarklet.ts';
import { localStrings } from './strings.ts';

export default function MazifyPage() {
  const s = localStrings();
  const bm = useRef<HTMLAnchorElement>(null);
  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    document.title = `${s.mazifyTitle} · World Wide Maze`;
    // React refuses `javascript:` hrefs in JSX, so the bookmark URL is set on the element directly.
    bm.current?.setAttribute('href', bookmarkletHref(location.origin));
  }, [s.mazifyTitle]);

  return (
    <main className="wwm-mazify" data-testid="mazify">
      <div className="wwm-local__facets" aria-hidden="true" />
      <div className="wwm-mazify__inner">
        <Link className="wwm-btn wwm-btn--ghost wwm-btn--small" to="/">
          <Icon name="back" size={18} /> {s.mazifyBack}
        </Link>
        <header className="wwm-mazify__head">
          <h1 className="wwm-mazify__title">{s.mazifyTitle}</h1>
          <p className="wwm-mazify__lead">{s.mazifyLead}</p>
        </header>

        <div className="wwm-mazify__ways">
          <section className="wwm-way wwm-way--ext" aria-labelledby="way-ext">
            <div className="wwm-way__head">
              <h2 id="way-ext" className="wwm-h2">
                {s.extTitle}
              </h2>
              <span className="wwm-way__tag">{s.extTag}</span>
            </div>
            <p className="wwm-way__body">{s.extBody}</p>
            <ol className="wwm-way__steps">
              {s.extSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="wwm-way__note">{s.extNote}</p>
          </section>

          <section className="wwm-way wwm-way--bm" aria-labelledby="way-bm">
            <div className="wwm-way__head">
              <h2 id="way-bm" className="wwm-h2">
                {s.bmTitle}
              </h2>
              <span className="wwm-way__tag is-sketch">{s.bmTag}</span>
            </div>
            <p className="wwm-way__body">{s.bmBody}</p>
            <div className="wwm-way__drag">
              {/* href: /mazify until the effect swaps in the bookmarklet (React refuses javascript: in JSX) */}
              <a
                ref={bm}
                href="/mazify"
                className="wwm-btn wwm-btn--hero wwm-bookmarklet"
                data-testid="bookmarklet"
                draggable
                onClick={(e) => {
                  e.preventDefault();
                  setClicked(true);
                }}
              >
                {s.bmDrag}
              </a>
              <p className="wwm-way__how" aria-live="polite">
                {clicked ? <strong>{s.bmClicked}</strong> : s.bmHowTo}
              </p>
            </div>
            <p className="wwm-way__note">{s.bmPopups}</p>
          </section>
        </div>

        <section className="wwm-mazify__privacy" aria-labelledby="privacy-h">
          <h2 id="privacy-h" className="wwm-h3">
            {s.privacyTitle}
          </h2>
          <ol>
            {s.privacy.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
