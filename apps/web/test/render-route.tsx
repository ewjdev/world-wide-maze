/** Render an app route to HTML after its lazy chunk has loaded (routes are lazy since Phase 12). */
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../src/routes.tsx';

export async function renderRoute(path: string): Promise<string> {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  if (!router.state.initialized)
    await new Promise<void>((resolve) => {
      const off = router.subscribe((s) => {
        if (s.initialized) {
          off();
          resolve();
        }
      });
    });
  return renderToString(<RouterProvider router={router} />);
}
