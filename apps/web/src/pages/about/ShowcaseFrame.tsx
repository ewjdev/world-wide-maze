/** Masthead + footer shared by the showcase pages (/about, /making, /log). */
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import './showcase.css';

/** Two islands, a bridge and the ball: the whole idea in one mark (drawn for this project, not 2013 art). */
export function MazeMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="3" width="9" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="12"
        y="13"
        width="10.5"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8.5 11v5.5h3.5" fill="none" stroke="#2c8a4b" strokeWidth="2.25" strokeLinecap="square" />
      <circle cx="17.25" cy="17" r="2" fill="#0b6f79" />
    </svg>
  );
}

const NAV = [
  { to: '/about', label: 'History' },
  { to: '/making', label: 'How it’s made' },
  { to: '/log', label: 'Build record' },
];

export function ShowcaseFrame({ children }: { children: ReactNode }) {
  return (
    <div className="sc">
      <a className="sc-skip" href="#main">
        Skip to content
      </a>
      <header className="sc-mast">
        <div className="sc-mast__inner">
          <Link to="/" className="sc-brand">
            <MazeMark />
            World Wide Maze <small>a tribute</small>
          </Link>
          <nav className="sc-nav" aria-label="Showcase">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to}>
                {n.label}
              </NavLink>
            ))}
            <Link to="/" className="sc-nav__play">
              Play
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="sc-main">
        {children}
      </main>
      <footer className="sc-foot">
        <div className="sc-foot__inner">
          <p>
            A fan tribute to World Wide Maze, the 2013 Chrome Experiment from Google Japan with PARTY (agency)
            and AID-DCC, Katamari and FUTUREK (production). This rebuild is not affiliated with or endorsed by
            Google or the original team, and uses none of the original art, audio or logos.
          </p>
          <p>
            <Link to="/privacy/analytics">Analytics privacy</Link> · <Link to="/about#sources">Sources</Link>{' '}
            · <Link to="/log">How this was built</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
