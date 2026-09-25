import { describe, expect, test } from 'vitest';
import { renderRoute as render } from './render-route.tsx';

describe('route shell', () => {
  test('/ renders the full-screen game shell (no document nav)', async () => {
    const html = await render('/');
    expect(html).toContain('data-testid="game-root"');
    expect(html).not.toContain('About</a>');
  });
  test('/play/:stageId renders the game shell', async () => {
    expect(await render('/play/abc123')).toContain('data-testid="game-root"');
  });
  test('/p/:code renders the game shell', async () => {
    expect(await render('/p/123456')).toContain('data-testid="game-root"');
  });
  test('/c/:code renders the controller without the desktop nav', async () => {
    const html = await render('/c/123456');
    expect(html).toContain('123456');
    expect(html).not.toContain('About</a>');
  });
  test('/about renders', async () => {
    expect(await render('/about')).toContain('tribute');
  });
});
