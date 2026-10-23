/** Minimal typed event emitter (no Node `events` dependency). */

export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);

    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    set.add(listener);
    return () => set?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);

    if (!set) {
      return;
    }

    for (const listener of Array.from(set)) {
      try {
        listener(payload);
      } catch {
        // A bad listener must never break the protocol loop.
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
