/**
 * Routes. Phase 08 owns the game shell (`/`, `/play/:stageId`, `/p/:code`), Phase 06 owns `/c/:code`
 * (apps/web/src/controller), Phase 10 owns the showcase pages (`/about`, `/making`, `/log`).
 * `/dev/*` sandboxes exist only in dev builds (they pull test fixtures into the bundle).
 */
import { Link, Outlet, type RouteObject, useParams } from 'react-router';
import { ControllerPage } from './controller/ControllerPage.tsx';
import { AboutPage } from './pages/about/AboutPage.tsx';
import { GameApp } from './ui/GameApp.tsx';

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

export function Home() {
  return <GameApp />;
}

export function Play() {
  const { stageId } = useParams();
  return <GameApp deepLink={stageId} key={stageId} />;
}

export function JoinRoom() {
  const { code } = useParams();
  return <GameApp roomCode={code} key={code} />;
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

export const routes: RouteObject[] = [
  // The game renders full-screen without the document layout.
  { path: '/', element: <Home /> },
  { path: '/play/:stageId', element: <Play /> },
  { path: '/p/:code', element: <JoinRoom /> },
  // The phone controller renders without the desktop layout.
  { path: '/c/:code', element: <ControllerPage /> }, // Phase 06
  // Phase 10 showcase pages (own full-page layout).
  { path: '/about', element: <AboutPage /> },
  {
    path: '/making/:stageId?',
    lazy: async () => ({ Component: (await import('./pages/making/MakingPage.tsx')).default }),
  },
  { path: '/log', lazy: async () => ({ Component: (await import('./pages/log/LogPage.tsx')).default }) },
  ...devRoutes,
  { path: '*', element: <NotFound /> },
];
