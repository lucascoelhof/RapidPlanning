/**
 * Minimal type-safe event emitter. One shared implementation replaces the
 * duplicated `on()/emit()` blocks that were copy-pasted across every class in
 * the legacy codebase. Critically, this version supports `off()` and `once()`
 * (the old code had no removal API at all, which caused listener leaks).
 *
 * Usage:
 *   class Foo extends Emitter<{ connected: [id: string] }> { ... }
 *   const foo = new Foo();
 *   const off = foo.on('connected', (id) => ...);
 *   off(); // unsubscribe
 */
export type Listener<Args extends unknown[]> = (...args: Args) => void;

/**
 * Constraint: `Events` is an object whose every value is an array type. We use
 * the self-referential mapped-type trick `{ [K in keyof Events]: unknown[] }`
 * rather than `Record<string, unknown[]>` because the latter requires an index
 * signature that interfaces don't have — this form accepts interfaces fine.
 */
export class Emitter<Events extends { [K in keyof Events]: unknown[] }> {
  private listeners: {
    [K in keyof Events]?: Set<Listener<Events[K]>>;
  } = {};

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(fn);
    return () => this.off(event, fn);
  }

  /** Subscribe but auto-unsubscribe after the first emission. */
  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(event, (...args: Events[K]) => {
      off();
      fn(...args);
    });
    return off;
  }

  /** Unsubscribe a specific listener. */
  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners[event]?.delete(fn);
  }

  /** Remove every listener for an event (or all events if omitted). */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event === undefined) {
      this.listeners = {};
    } else {
      delete this.listeners[event];
    }
  }

  /**
   * Emit. Listeners are isolated — one throwing does not block the others.
   * Public so any owner of the emitter can fire events; the type parameter
   * still constrains the payload shape.
   */
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    // Copy to a array first so a listener that calls off() mid-emit can't
    // mutate the set we're iterating.
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[Emitter] listener for "${String(event)}" threw:`, err);
      }
    }
  }
}
