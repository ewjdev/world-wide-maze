/**
 * Backend choice and the WebGPU → WebGL2 fallback (N, CI hardening).
 *
 * `WebGPURenderer` already falls back to WebGL2 when no WebGPU adapter/device can be created (three warns once).
 * It does not survive a WebGPU *device loss*: it logs an error, stops rendering, and in-flight
 * `popErrorScope()` promises reject unhandled ("Instance dropped in popErrorScope" on Chromium). GPUs without
 * reliable WebGPU (software adapters, flaky drivers, GPU process resets) lose the device at any time, so the
 * engine handles it itself (engine.ts `recoverOnWebGL2`):
 *   - the loss is logged once at `warn` (never `error`), and every later engine on the page starts on WebGL2;
 *   - the renderer is recreated on the WebGL2 backend on a fresh canvas that takes the old canvas's place in
 *     the DOM (a canvas that had a `webgpu` context can never get a `webgl2` one); the scene, the stage and
 *     every per-frame state are kept, so play continues where it was.
 * A browser without `navigator.gpu` at all is a normal configuration, not a failure: WebGL2 is chosen quietly.
 */

/** Once WebGPU failed on this page (adapter/device failure or device loss), later engines skip it. */
let webgpuFailed = false;
let warned = false;

/** Whether to try the WebGPU backend at all. */
export function wantWebGPU(forceWebGL: boolean | undefined): boolean {
  if (forceWebGL || webgpuFailed) return false;
  return typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu;
}

/** Remember the failure for this page; `message` is logged at `warn`, once per page. */
export function markWebGPUFailed(message: string | null): void {
  webgpuFailed = true;
  if (message !== null && !warned) {
    warned = true;
    console.warn(`[@wwm/engine] ${message}`);
  }
}

/** The warning is already out (three's own "running under WebGL2 backend" at startup). */
export function markWarned(): void {
  warned = true;
}

/** Tests only. */
export function resetBackendState(): void {
  webgpuFailed = false;
  warned = false;
}

interface ErrorScopeDevice {
  popErrorScope(): Promise<unknown>;
}

/**
 * After a device loss Chromium rejects pending and later `popErrorScope()` calls, and three.js awaits some of
 * them without a `catch` (WebGPUPipelineUtils): an unhandled rejection. A lost device has no validation errors
 * worth reporting, so a rejection resolves to "no error" (null, as the spec does for a lost device).
 */
export function quietErrorScopes(device: ErrorScopeDevice): void {
  const pop = device.popErrorScope.bind(device);
  device.popErrorScope = () => pop().catch(() => null);
}

/** A fresh canvas with the old one's attributes, put in its place in the DOM. */
export function replaceCanvas(old: HTMLCanvasElement): HTMLCanvasElement {
  const next = old.ownerDocument.createElement('canvas');
  for (const a of Array.from(old.attributes)) next.setAttribute(a.name, a.value);
  next.width = old.width;
  next.height = old.height;
  old.replaceWith(next);
  return next;
}
