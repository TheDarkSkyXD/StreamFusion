/**
 * Browser-Compatible EventEmitter
 *
 * A lightweight EventEmitter implementation that works in both Node.js and browser environments.
 * Node.js's 'node:events' module is not available in the renderer process when bundled with Vite.
 */

type EventMapConstraint<Events> = {
  [Event in keyof Events]: readonly unknown[];
};

type EventName<Events> = [Events] extends [never] ? string : Extract<keyof Events, string>;
type EventArgs<Events, Event extends EventName<Events>> = [Events] extends [never]
  ? readonly unknown[]
  : Event extends keyof Events
    ? Events[Event] extends readonly unknown[]
      ? Events[Event]
      : never
    : never;
type Listener<Events, Event extends EventName<Events>> = (
  ...args: [Events] extends [never] ? never[] : EventArgs<Events, Event>
) => void;

class BrowserEventEmitter<Events extends EventMapConstraint<Events> = never> {
  private listeners = new Map<EventName<Events>, Set<unknown>>();

  on<Event extends EventName<Events>>(event: Event, listener: Listener<Events, Event>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  once<Event extends EventName<Events>>(event: Event, listener: Listener<Events, Event>): this {
    const onceWrapper: Listener<Events, Event> = (...args) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  off<Event extends EventName<Events>>(event: Event, listener: Listener<Events, Event>): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit<Event extends EventName<Events>>(event: Event, ...args: EventArgs<Events, Event>): boolean {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.size === 0) return false;
    for (const listener of eventListeners) {
      try {
        if (typeof listener === "function") Reflect.apply(listener, undefined, args);
      } catch (error) {
        console.error(`Error in event listener for '${event}':`, error);
      }
    }
    return true;
  }

  removeListener<Event extends EventName<Events>>(
    event: Event,
    listener: Listener<Events, Event>
  ): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: EventName<Events>): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  listenerCount(event: EventName<Events>): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// Export as EventEmitter for compatibility with existing code
export { BrowserEventEmitter as EventEmitter };
