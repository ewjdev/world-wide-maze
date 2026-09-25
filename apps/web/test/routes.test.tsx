import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, test } from 'vitest';
import { routes } from '../src/routes.tsx';

function render(path: string): string {
  return renderToString(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('route shell', () => {
  test('/ renders home', () => {
    expect(render('/')).toContain('World Wide Maze');
  });
  test('/play/:stageId passes the id', () => {
    expect(render('/play/abc123')).toContain('abc123');
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
