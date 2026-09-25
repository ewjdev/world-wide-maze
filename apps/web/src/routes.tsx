/**
 * Routes. Phase 08 owns the game shell (`/`, `/play/:stageId`, `/p/:code`), Phase 06 owns `/c/:code`
 * (apps/web/src/controller), Phase 10 will replace `/about` with the history / museum pages.
 */
import { CONTRACT_VERSION } from '@wwm/schema';
import { Link, Outlet, type RouteObject, useParams } from 'react-router';
import { ControllerPage } from './controller/ControllerPage.tsx';
import { InputSandbox } from './dev/input-sandbox.tsx';
import { GameApp } from './ui/GameApp.tsx';

function Layout() {
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

export function About() {
  return (
    <section>
      <h1>About</h1>
      <p>
        A tribute to Google Japan / PARTY&apos;s 2013 Chrome Experiment &ldquo;World Wide Maze&rdquo;. Not
        affiliated with Google. (Contracts v{CONTRACT_VERSION}; the full history page arrives in Phase 10.)
      </p>
    </section>
  );
}

function NotFound() {
  return <p>Not found.</p>;
}

export const routes: RouteObject[] = [
  // The game renders full-screen without the document layout.
  { path: '/', element: <Home /> },
  { path: '/play/:stageId', element: <Play /> },
  { path: '/p/:code', element: <JoinRoom /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: 'about', element: <About /> },
      {
        path: 'dev/physics',
        lazy: () => import('./dev/physics-sandbox.tsx').then((m) => ({ Component: m.default })),
      },
      { path: 'dev/input', element: <InputSandbox /> }, // Phase 06
      { path: '*', element: <NotFound /> },
    ],
  },
  // The phone controller renders without the desktop layout.
  { path: '/c/:code', element: <ControllerPage /> }, // Phase 06
  {
    path: '/dev/engine',
    lazy: async () => ({ Component: (await import('./dev/engine-sandbox.tsx')).default }),
  },
];
