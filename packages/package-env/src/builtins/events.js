export class EventEmitter {
  #events = new Map();
  #maxListeners = 10;

  on(event, listener) { return this.addListener(event, listener); }
  addListener(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (event !== 'newListener') this.emit('newListener', event, listener);
    const list = this.#events.get(event) ?? [];
    list.push(listener);
    this.#events.set(event, list);
    return this;
  }
  prependListener(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (event !== 'newListener') this.emit('newListener', event, listener);
    const list = this.#events.get(event) ?? [];
    list.unshift(listener);
    this.#events.set(event, list);
    return this;
  }
  once(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const self = this;
    function onceWrapper(...args) { self.removeListener(event, onceWrapper); return listener.apply(this, args); }
    onceWrapper.listener = listener;
    return this.on(event, onceWrapper);
  }
  prependOnceListener(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const self = this;
    function onceWrapper(...args) { self.removeListener(event, onceWrapper); return listener.apply(this, args); }
    onceWrapper.listener = listener;
    return this.prependListener(event, onceWrapper);
  }
  off(event, listener) { return this.removeListener(event, listener); }
  removeListener(event, listener) {
    const list = this.#events.get(event);
    if (!list?.length) return this;
    for (let index = list.length - 1; index >= 0; index--) {
      const candidate = list[index];
      if (candidate === listener || candidate.listener === listener) {
        list.splice(index, 1);
        if (!list.length) this.#events.delete(event);
        if (event !== 'removeListener') this.emit('removeListener', event, candidate.listener ?? candidate);
        break;
      }
    }
    return this;
  }
  removeAllListeners(event) {
    if (event !== undefined) {
      for (const listener of this.listeners(event).reverse()) this.removeListener(event, listener);
      return this;
    }
    for (const name of this.eventNames()) if (name !== 'removeListener') this.removeAllListeners(name);
    this.#events.delete('removeListener');
    return this;
  }
  emit(event, ...args) {
    const list = this.#events.get(event);
    if ((!list || !list.length) && event === 'error') {
      const error = args[0];
      throw error instanceof Error ? error : new Error('Unhandled error event');
    }
    if (!list?.length) return false;
    for (const listener of [...list]) listener.apply(this, args);
    return true;
  }
  listeners(event) { return (this.#events.get(event) ?? []).map((listener) => listener.listener ?? listener); }
  rawListeners(event) { return [...(this.#events.get(event) ?? [])]; }
  listenerCount(event, listener) {
    const list = this.#events.get(event) ?? [];
    if (!listener) return list.length;
    return list.filter((candidate) => candidate === listener || candidate.listener === listener).length;
  }
  eventNames() { return [...this.#events.keys()]; }
  setMaxListeners(value) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('max listeners must be a non-negative integer');
    this.#maxListeners = value;
    return this;
  }
  getMaxListeners() { return this.#maxListeners; }
}

export function createEventsBuiltin() {
  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.once = (emitter, event) => new Promise((resolve, reject) => {
    const onEvent = (...args) => { cleanup(); resolve(args); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      emitter.removeListener(event, onEvent);
      if (event !== 'error') emitter.removeListener('error', onError);
    };
    emitter.once(event, onEvent);
    if (event !== 'error') emitter.once('error', onError);
  });
  return EventEmitter;
}
