/**
 * Element ↔ island attribution (for `Island.sourceElementIds` and `StageData.provenance`).
 * An element belongs to an island when at least `share` of its (clipped) rect cells are that island's cells.
 */
import type { DropReason } from '@wwm/schema';
import { type Grid, rectToCells } from './grid.ts';
import type { SliceElement } from './slice-elements.ts';

export interface Attribution {
  /** island index (0-based, final) → element ids */
  sources: number[][];
  kept: number[];
  dropped: { elementId: number; reason: DropReason }[];
}

/**
 * @param islandOf  label → final island index (-1 = not kept)
 * @param lostMask  cells of land that was dropped: 1 = too small / thin, 2 = not connected to the maze
 */
export function attributeElements(
  grid: Pick<Grid, 'cols' | 'rows' | 'cell'>,
  elements: readonly SliceElement[],
  labels: Int32Array,
  islandOf: readonly number[],
  islandCount: number,
  lostMask: Uint8Array,
  share = 0.3,
): Attribution {
  const sources: number[][] = Array.from({ length: islandCount }, () => []);
  const kept: number[] = [];
  const dropped: { elementId: number; reason: DropReason }[] = [];
  const counts = new Map<number, number>();
  const { cols } = grid;
  for (const e of elements) {
    const { c0, c1, r0, r1 } = rectToCells(grid, e.rect);
    const total = (c1 - c0) * (r1 - r0);
    if (total === 0) {
      dropped.push({ elementId: e.id, reason: 'too-small' });
      continue;
    }
    counts.clear();
    let land = 0;
    let small = 0;
    let disconnected = 0;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * cols + c;
        const l = labels[i] as number;
        const isl = l > 0 ? (islandOf[l] ?? -1) : -1;
        if (isl >= 0) {
          land++;
          counts.set(isl, (counts.get(isl) ?? 0) + 1);
        } else if (lostMask[i] === 1) small++;
        else if (lostMask[i] === 2) disconnected++;
      }
    }
    let any = false;
    for (const [isl, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
      if (n >= share * total) {
        sources[isl]?.push(e.id);
        any = true;
      }
    }
    if (any) kept.push(e.id);
    else if (land > 0) dropped.push({ elementId: e.id, reason: 'merged' });
    else if (small >= disconnected && small > 0) dropped.push({ elementId: e.id, reason: 'too-small' });
    else if (disconnected > 0) dropped.push({ elementId: e.id, reason: 'other' });
    else dropped.push({ elementId: e.id, reason: 'background' });
  }
  return { sources, kept, dropped };
}
