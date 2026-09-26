/**
 * Routes. Phase 08 owns the game shell (`/`, `/play/:stageId`, `/p/:code`), Phase 06 owns `/c/:code`
 * (apps/web/src/controller), Phase 10 owns the showcase pages (`/about`, `/making`, `/log`).
 * `/dev/*` sandboxes exist only in dev builds (they pull test fixtures into the bundle).
 *
 * Phase 12: every page is a lazy route, so each loads only its own code. The phone controller (`/c/:code`)
 * no longer downloads three.js, the engine, the builder and Rapier; the showcase pages don't either.
 */
import { Link, Outlet, type RouteObject, useParams } from 'react-router';
import { localCaptureRoutes } from './local-capture/routes.tsx';

function DevLayout() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <nav style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <Link to="/">Play</Link>
        <Link to="/about">About</Link>
      </nav>
      <Outlet />
    </main>
  );
}

/** The game shell and its three entry routes live in one chunk (three.js, engine, physics, builder). */
const game = () => import('./ui/GameApp.tsx');

async function homeRoute() {
  const { GameApp } = await game();
  return { Component: () => <GameApp /> };
}

async function playRoute() {
  const { GameApp } = await game();
  return {
    Component: function Play() {
      const { stageId } = useParams();
      return <GameApp deepLink={stageId} key={stageId} />;
    },
  };
}

async function joinRoute() {
  const { GameApp } = await game();
  return {
    Component: function JoinRoom() {
      const { code } = useParams();
      return <GameApp roomCode={code} key={code} />;
    },
  };
}

/** Shown while a lazy route's chunk loads on first paint (also keeps React Router from warning). */
function Loading() {
  return null;
}

function NotFound() {
  return <p>Not found.</p>;
}

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev',
        element: <DevLayout />,
        children: [
          {
            path: 'physics',
            lazy: () => import('./dev/physics-sandbox.tsx').then((m) => ({ Component: m.default })),
          },
          {
            path: 'input',
            lazy: () => import('./dev/input-sandbox.tsx').then((m) => ({ Component: m.InputSandbox })),
          },
        ],
      },
      {
        path: '/dev/ranking',
        lazy: async () => ({ Component: (await import('./ranking/Preview.tsx')).default }),
      },
      {
        path: '/dev/engine',
        lazy: async () => ({ Component: (await import('./dev/engine-sandbox.tsx')).default }),
      },
    ]
  : [];

const pageRoutes: RouteObject[] = [
  {
    path: '/privacy/analytics',
    lazy: async () => ({ Component: (await import('./pages/privacy/AnalyticsPrivacy.tsx')).default }),
  },
  // The game renders full-screen without the document layout.
  { path: '/', lazy: homeRoute },
  { path: '/play/:stageId', lazy: playRoute },
  { path: '/p/:code', lazy: joinRoute },
  // The phone controller renders without the desktop layout.
  {
    path: '/c/:code',
    lazy: async () => ({ Component: (await import('./controller/ControllerPage.tsx')).ControllerPage }),
  }, // Phase 06
  // Phase 10 showcase pages (own full-page layout).
  {
    path: '/about',
    lazy: async () => ({ Component: (await import('./pages/about/AboutPage.tsx')).AboutPage }),
  },
  {
    path: '/making/:stageId?',
    lazy: async () => ({ Component: (await import('./pages/making/MakingPage.tsx')).default }),
  },
  // Phase 13: a shared web journey (light page; the game loads only when a stop is played).
  {
    path: '/j/:trail',
    lazy: async () => ({ Component: (await import('./ui/JourneyPage.tsx')).JourneyPage }),
  },
  { path: '/log', lazy: async () => ({ Component: (await import('./pages/log/LogPage.tsx')).default }) },
  ...localCaptureRoutes, // Phase 14: /play/local (receiver), /mazify (extension + bookmarklet)
  ...devRoutes,
  { path: '*', element: <NotFound /> },
];

/** Every lazy page gets the blank first-paint fallback. */
export const routes: RouteObject[] = pageRoutes.map((r) => (r.lazy ? { ...r, HydrateFallback: Loading } : r));
