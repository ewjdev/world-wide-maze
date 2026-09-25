import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, test } from 'vitest';
import { routes } from '../src/routes.tsx';

function render(path: string): string {
  return renderToString(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('route shell', () => {
  test('/ renders the full-screen game shell (no document nav)', () => {
    const html = render('/');
    expect(html).toContain('data-testid="game-root"');
    expect(html).not.toContain('About</a>');
  });
  test('/play/:stageId renders the game shell', () => {
    expect(render('/play/abc123')).toContain('data-testid="game-root"');
  });
  test('/p/:code renders the game shell', () => {
    expect(render('/p/123456')).toContain('data-testid="game-root"');
  });
  test('/c/:code renders the controller without the desktop nav', () => {
    const html = render('/c/123456');
    expect(html).toContain('123456');
    expect(html).not.toContain('About</a>');
  });
  test('/about renders', () => {
    expect(render('/about')).toContain('tribute');
  });
});
