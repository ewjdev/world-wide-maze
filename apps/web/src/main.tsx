import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { touchCapable } from './input/capability.ts';
import { routes } from './routes.tsx';
import { servicesResting } from './service-mode.ts';
import { installEngagement } from './telemetry/engagement.ts';
import { installTelemetry, trackPage } from './telemetry/index.ts';

// Engagement listeners run before transport listeners so exit deltas flush in the same beacon.
if (!servicesResting()) {
  installEngagement();
  installTelemetry({ url: import.meta.env.VITE_TELEMETRY_URL as string | undefined });
}

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

// A static anchor stays usable even if every dynamic route is blocked at the edge.
function showResting() {
  if (!servicesResting() || document.getElementById('service-status')) return;
  const notice = document.createElement('aside');
  notice.id = 'service-status';
  notice.setAttribute('role', 'status');
  // On a touch device the bottom edge belongs to the game controls: the notice sits at the top there.
  const touch = touchCapable();
  notice.style.cssText = `position:fixed;${touch ? 'top' : 'bottom'}:12px;left:12px;right:12px;z-index:10000;padding:12px;background:#fff;color:#222;border:1px solid #aaa;font:14px system-ui;text-align:center`;
  notice.append('Online services are resting. ');
  const link = document.createElement('a');
  link.href = '/play/practice?offline=1';
  link.textContent = touch ? 'Play the practice maze' : 'Play the practice maze with keyboard controls';
  notice.append(link);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.style.marginLeft = '12px';
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(dismiss);
  document.body.append(notice);
}
window.addEventListener('wwm-services-resting', showResting);
showResting();
