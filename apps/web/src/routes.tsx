/**
 * Route shell (Phase 02 scaffold). Phase 08 owns the shell/HUD, Phase 06 owns /c/:code
 * (apps/web/src/controller), Phase 10 adds history/museum pages.
 */
import { CONTRACT_VERSION } from '@wwm/schema';
import { Link, Outlet, type RouteObject, useParams } from 'react-router';
import { ControllerPage } from './controller/ControllerPage.tsx';
import { InputSandbox } from './dev/input-sandbox.tsx';
import { AboutPage } from './pages/about/AboutPage.tsx';

function Layout() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <nav style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Outlet />
    </main>
  );
}

export function Home() {
  return (
    <section>
      <h1>World Wide Maze</h1>
      <p>
        Any website becomes a 3D island maze you steer with your phone. (Scaffold — contracts v
        {CONTRACT_VERSION}.)
      </p>
      <p>
        <Link to="/play/handmade-simple">Play the handmade test stage</Link>
      </p>
    </section>
  );
}

export function Play() {
  const { stageId } = useParams();
  return (
    <section>
      <h1>Play</h1>
      <p data-testid="stage-id">Stage: {stageId}</p>
    </section>
  );
}

export function About() {
  return (
    <section>
      <h1>About</h1>
      <p>
        A tribute to Google Japan / PARTY&apos;s 2013 Chrome Experiment &ldquo;World Wide Maze&rdquo;. Not
        affiliated with Google.
      </p>
    </section>
  );
}

function NotFound() {
  return <p>Not found.</p>;
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'play/:stageId', element: <Play /> },
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
  // Phase 10 showcase pages (own full-page layout).
  { path: '/about', element: <AboutPage /> },
  {
    path: '/making/:stageId?',
    lazy: async () => ({ Component: (await import('./pages/making/MakingPage.tsx')).default }),
  },
  { path: '/log', lazy: async () => ({ Component: (await import('./pages/log/LogPage.tsx')).default }) },
  {
    path: '/dev/ranking',
    lazy: async () => ({ Component: (await import('./ranking/Preview.tsx')).default }),
  },
  {
    path: '/dev/engine',
    lazy: async () => ({ Component: (await import('./dev/engine-sandbox.tsx')).default }),
  },
];
