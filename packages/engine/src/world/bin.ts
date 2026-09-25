/** Tracks GPU resources so `dispose()` can release everything a stage created (no leaks across loads). */
export interface Disposable {
  dispose(): void;
}

export class Bin {
  private items: Disposable[] = [];

  add<T extends Disposable>(d: T): T {
    this.items.push(d);
    return d;
  }

  disposeAll(): void {
    for (const d of this.items.splice(0).reverse()) d.dispose();
  }

  get size(): number {
    return this.items.length;
  }
}
