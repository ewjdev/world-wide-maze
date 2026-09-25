/** Minimal typed event emitter (no DOM dependency: works in Node, browsers and workers). */
export type Unsubscribe = () => void;

// biome-ignore lint/suspicious/noExplicitAny: listener signatures come from the caller's event map.
export type EventMap = Record<string, (...args: any[]) => void>;

export class Emitter<E extends EventMap> {
  #listeners = new Map<keyof E, Set<E[keyof E]>>();

  on<K extends keyof E>(event: K, cb: E[K]): Unsubscribe {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) (cb as (...a: Parameters<E[K]>) => void)(...args);
  }

  clear(): void {
    this.#listeners.clear();
  }
}
