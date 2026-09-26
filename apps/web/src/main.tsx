import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes.tsx';
import { installEngagement } from './telemetry/engagement.ts';
import { installTelemetry, trackPage } from './telemetry/index.ts';

// Engagement listeners run before transport listeners so exit deltas flush in the same beacon.
installEngagement();
installTelemetry({ url: import.meta.env.VITE_TELEMETRY_URL as string | undefined });

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

const router = createBrowserRouter(routes);
let routeKey = router.state.location.key;
trackPage();
router.subscribe((state) => {
  if (state.navigation.state !== 'idle' || state.location.key === routeKey) return;
  routeKey = state.location.key;
  trackPage();
});

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
