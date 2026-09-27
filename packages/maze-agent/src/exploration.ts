import type { Candidate, Frame, Observation } from './contracts.ts';
import type { MazeFixture } from './fixtures.ts';
export class Exploration {
  current = 0;
  private nodes = new Map<number, string>();
  private edges = new Map<number, string>();
  private counts = new Map<number, number>();
  private visits = new Map<number, number>();
  private history: Observation['history'] = [];
  constructor(
    readonly maze: MazeFixture,
    readonly orderSeed = 0,
  ) {
    this.arrive(0, null);
  }
  private node(id: number) {
    let alias = this.nodes.get(id);
    if (!alias) {
      alias = `island-${this.nodes.size + 1}`;
      this.nodes.set(id, alias);
    }
    return alias;
  }
  arrive(id: number, edge: number | null) {
    this.current = id;
    this.visits.set(id, (this.visits.get(id) ?? 0) + 1);
    if (edge !== null) this.counts.set(edge, (this.counts.get(edge) ?? 0) + 1);
    this.history.push({ node: this.node(id), edge: edge === null ? null : (this.edges.get(edge) ?? null) });
  }
  candidates(): Candidate[] {
    if (this.current === this.maze.stage.goal.islandId)
      return [
        {
          id: 'finish',
          direction: 'Goal',
          kind: 'goal',
          destination: this.node(this.current),
          traversals: 0,
        },
      ];
    const [cx, cy] = this.maze.centers[this.current];
    const local = this.maze.stage.bridges
      .filter((b) => b.from === this.current || b.to === this.current)
      .map((b) => {
        const p = b.from === this.current ? b.a : b.b;
        const direction =
          Math.abs(p[0] - cx) > Math.abs(p[1] - cy)
            ? p[0] > cx
              ? 'East'
              : 'West'
            : p[1] > cy
              ? 'South'
              : 'North';
        return { b, direction };
      })
      .sort((a, b) => a.direction.localeCompare(b.direction));
    for (const { b } of local)
      if (!this.edges.has(b.id)) this.edges.set(b.id, `connection-${this.edges.size + 1}`);
    const out = local.map(({ b, direction }) => ({
      id: this.edges.get(b.id)!,
      direction,
      kind: b.type,
      destination: this.nodes.get(b.from === this.current ? b.to : b.from) ?? null,
      traversals: this.counts.get(b.id) ?? 0,
    }));
    if (this.orderSeed % 2) out.reverse();
    return out;
  }
  observation(): Observation {
    this.candidates();
    return {
      current: this.node(this.current),
      goalVisible: this.current === this.maze.stage.goal.islandId,
      nodes: [...this.nodes].map(([id, alias]) => ({ id: alias, visits: this.visits.get(id) ?? 0 })),
      edges: [...this.edges].map(([id, alias]) => {
        const b = this.maze.stage.bridges.find((b) => b.id === id)!;
        return {
          id: alias,
          from: this.nodes.get(b.from) ?? this.nodes.get(b.to)!,
          to: this.nodes.has(b.from) && this.nodes.has(b.to) ? this.nodes.get(b.to)! : null,
          traversals: this.counts.get(id) ?? 0,
        };
      }),
      history: this.history.slice(-64),
    };
  }
  resolve(choice: string) {
    if (choice === 'finish' && this.current === this.maze.stage.goal.islandId)
      return { target: this.current, edge: null, point: this.maze.stage.goal.pos };
    const id = [...this.edges].find(([, v]) => v === choice)?.[0];
    const b = this.maze.stage.bridges.find(
      (b) => b.id === id && (b.from === this.current || b.to === this.current),
    );
    if (!b) throw new Error('Invalid local choice');
    const target = b.from === this.current ? b.to : b.from;
    return { target, edge: b.id, point: this.maze.centers[target] };
  }
}
export function baseline(frame: Pick<Frame, 'observation' | 'candidates'>): string {
  const { observation: o, candidates: c } = frame;
  if (c.length === 1) return c[0].id;
  const stack: string[] = [];
  let cycleEdge: string | null = null;
  for (const h of o.history) {
    if (!stack.length) stack.push(h.node);
    else if (h.node === stack.at(-2)) {
      stack.pop();
      cycleEdge = null;
    } else if (h.node === stack.at(-1)) {
      cycleEdge = null;
    } else if (stack.includes(h.node)) {
      cycleEdge = h.edge;
    } else {
      stack.push(h.node);
      cycleEdge = null;
    }
  }
  if (cycleEdge && c.some((x) => x.id === cycleEdge)) return cycleEdge;
  return (
    c.find((x) => x.traversals === 0)?.id ??
    c.find((x) => x.destination === stack.at(-2))?.id ??
    [...c].sort((a, b) => a.traversals - b.traversals)[0].id
  );
}
