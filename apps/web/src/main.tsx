import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes.tsx';
import { installTelemetry } from './telemetry/index.ts';

// Phase 12: off unless the build sets VITE_TELEMETRY_URL (see src/telemetry/index.ts).
installTelemetry({ url: import.meta.env.VITE_TELEMETRY_URL as string | undefined });

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
