/**
 * The one place the engine touches private three.js state. Re-check on every three.js upgrade: the
 * `three-private` test in `test/index.test.ts` fails loudly if the field moves.
 *
 * Why it is needed (checked against three r186):
 * - Node `updateBefore` hooks (every `pass()` in the render pipeline, bloom, the env cube camera) run at
 *   most once per `NodeFrame.frameId`.
 * - The only public code path that advances `frameId` is the renderer's internal animation loop
 *   (`Animation.start()` → `nodeFrame.update()` once per `requestAnimationFrame`, then
 *   `info.frame = frameId`). `setAnimationLoop` only installs a callback inside that same rAF and
 *   `info.autoReset` only resets counters, so neither advances the frame on demand. `compile*()` also
 *   advances it, but it recompiles the scene, which is far too heavy to call every frame.
 * - The engine is driven externally. When `frame()` runs more than once per rAF (the sandbox's manual
 *   clock, catch-up after a stall, a host that ticks from a timer), the pass nodes would silently skip
 *   re-rendering and the screen would show a stale frame.
 *
 * So `NodeFrameClock.tick()` uses the public `renderer.info.frame` counter to see whether the renderer's own
 * rAF has already advanced the node frame since the previous `frame()`. Only when it has not does it
 * advance the private `renderer._nodes.nodeFrame`. In a normal one-frame-per-rAF game loop the private
 * field is never touched.
 */
import type { WebGPURenderer } from 'three/webgpu';

interface PrivateNodes {
  _nodes?: { nodeFrame?: { update?: () => void; frameId?: number } };
}

/** Returns the private node frame, or null if three.js moved it (then we degrade, see `tick`). */
export function privateNodeFrame(renderer: unknown): { update(): void; frameId: number } | null {
  const nf = (renderer as PrivateNodes)._nodes?.nodeFrame;
  if (!nf || typeof nf.update !== 'function' || typeof nf.frameId !== 'number') return null;
  return nf as { update(): void; frameId: number };
}

export class NodeFrameClock {
  private lastInfoFrame = -1;
  private warned = false;
  /** how many times the private path was needed (evidence / tests) */
  manualAdvances = 0;

  constructor(private readonly renderer: Pick<WebGPURenderer, 'info'>) {}

  /** Call once at the start of every engine `frame()`, before rendering. */
  tick(): void {
    const infoFrame = this.renderer.info.frame;
    if (infoFrame !== this.lastInfoFrame) {
      // the renderer's rAF advanced the node frame since our last frame(): nothing to do
      this.lastInfoFrame = infoFrame;
      return;
    }
    const nf = privateNodeFrame(this.renderer);
    if (nf) {
      nf.update();
      this.manualAdvances++;
    } else if (!this.warned) {
      this.warned = true;
      console.warn(
        '[@wwm/engine] three.js private renderer._nodes.nodeFrame is gone; frames rendered more than once ' +
          'per requestAnimationFrame may show stale post-processing. See packages/engine/src/three-private.ts.',
      );
    }
  }
}
