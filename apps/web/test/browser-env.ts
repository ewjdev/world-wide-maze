/**
 * How the browser e2e tests launch Chromium (docs/build-log/phase-12.md "CI on GitHub runners").
 *
 * - Locally (a real GPU): WebGPU is on, and the tests assert the engine really runs on it.
 * - CI (`CI` set; GitHub-hosted runners have no GPU): Chromium's software WebGPU adapter loses its device at
 *   random, so the pages run as a browser without WebGPU (`navigator.gpu` removed before any page script) and
 *   the engine picks WebGL2 (SwiftShader) up front, quietly. The engine's own device-loss fallback is covered
 *   by a local test that loses the WebGPU device on purpose (game.e2e.test.ts).
 */
import type { BrowserContext } from 'playwright';

export const IN_CI = !!process.env.CI;

export const CHROMIUM_ARGS = IN_CI
  ? ['--enable-unsafe-swiftshader']
  : ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'];

/**
 * Chromium's own diagnostics on a machine without a GPU (not the page's): the display compositor is software, so
 * every WebGL frame is read back from ANGLE/SwiftShader, and ANGLE reports that as a performance message
 * (`GL Driver Message (OpenGL, Performance, …): GPU stall due to ReadPixels`, 4× then "will no longer repeat").
 * A bare `gl.clear()` loop produces it too. Only these performance messages are ignored; GL errors are not.
 */
export const SOFTWARE_GL_NOISE =
  /GL Driver Message \(OpenGL, Performance, [^)]*\): GPU stall due to ReadPixels/;

/** The backend `engine.stats().backend` must report. */
export const EXPECTED_BACKEND: 'webgpu' | 'webgl2' = IN_CI ? 'webgl2' : 'webgpu';

/** CI only: every page in `ctx` behaves like a browser without WebGPU. */
export async function browserEnv(ctx: BrowserContext): Promise<void> {
  if (!IN_CI) return;
  await ctx.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
}
