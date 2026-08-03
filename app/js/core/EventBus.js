// Pub/sub backbone. Components communicate only through the bus and
// public methods — never by reaching into each other's DOM or internals.
export default class EventBus {
  #map = new Map();
  on(evt, fn){
    (this.#map.get(evt) ?? this.#map.set(evt, []).get(evt)).push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn){
    const a = this.#map.get(evt);
    if (a){ const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  emit(evt, data){
    (this.#map.get(evt) ?? []).forEach(fn => fn(data));
  }
}
