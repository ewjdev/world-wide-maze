/**
 * Step 9: maze carving (E: 2013 randomized DFS from the top-left island → a spanning tree, a perfect maze).
 * Bridges whose decks would overlap an already carved deck are skipped, so carved bridges never collide.
 * Difficulty may add back a share of the unused candidates as loops (N: easy 15 %, normal/hard 0 %).
 */
import type { Rng } from '@wwm/schema';
import { boxesOverlap, type Candidate, deckBox } from './bridges.ts';

export interface MazeResult {
  /** Indices into `candidates` of the spanning-tree edges, in carving order. */
  tree: number[];
  /** Indices of loop edges added back. */
  loops: number[];
  /** Island reached by the DFS (by index). */
  reached: boolean[];
  /** Parent candidate index per island in the tree (-1 for the root / unreached). */
  parentEdge: number[];
}

/** Connected components of the candidate graph (island index → component id). */
export function candidateComponents(n: number, candidates: readonly Candidate[]): number[] {
  const comp = new Array<number>(n).fill(-1);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const c of candidates) {
    adj[c.from]?.push(c.to);
    adj[c.to]?.push(c.from);
  }
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = id;
    while (stack.length > 0) {
      const u = stack.pop() as number;
      for (const v of adj[u] as number[]) {
        if (comp[v] === -1) {
          comp[v] = id;
          stack.push(v);
        }
      }
    }
    id++;
  }
  return comp;
}

export function carveMaze(
  n: number,
  candidates: readonly Candidate[],
  root: number,
  rng: Rng,
  loopShare: number,
): MazeResult {
  const adj: number[][] = Array.from({ length: n }, () => []);
  candidates.forEach((c, i) => {
    adj[c.from]?.push(i);
    adj[c.to]?.push(i);
  });
  const boxes = candidates.map((c) => deckBox(c, 2));
  const carved: number[] = [];
  const compatible = (i: number) => {
    const bi = boxes[i];
    if (!bi) return false;
    return carved.every((j) => {
      const bj = boxes[j];
      return !bj || !boxesOverlap(bi, bj);
    });
  };

  const reached = new Array<boolean>(n).fill(false);
  const parentEdge = new Array<number>(n).fill(-1);
  const tree: number[] = [];
  reached[root] = true;
  const stack = [root];
  const dfsRng = rng.fork('dfs');
  while (stack.length > 0) {
    const u = stack[stack.length - 1] as number;
    const options = (adj[u] as number[]).filter((e) => {
      const c = candidates[e] as Candidate;
      const v = c.from === u ? c.to : c.from;
      return !reached[v] && compatible(e);
    });
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const e = dfsRng.pick(options);
    const c = candidates[e] as Candidate;
    const v = c.from === u ? c.to : c.from;
    reached[v] = true;
    parentEdge[v] = e;
    tree.push(e);
    carved.push(e);
    stack.push(v);
  }

  const loops: number[] = [];
  if (loopShare > 0) {
    const inTree = new Set(tree);
    const rest = candidates
      .map((_, i) => i)
      .filter((i) => {
        const c = candidates[i] as Candidate;
        return !inTree.has(i) && reached[c.from] && reached[c.to];
      });
    rng.fork('loops').shuffle(rest);
    const want = Math.round(rest.length * loopShare);
    for (const e of rest) {
      if (loops.length >= want) break;
      if (!compatible(e)) continue;
      loops.push(e);
      carved.push(e);
    }
  }
  return { tree, loops, reached, parentEdge };
}
