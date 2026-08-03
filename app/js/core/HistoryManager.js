import SceneStore from '../io/SceneStore.js';

// Undo/redo via coalesced scene snapshots. Structural changes
// ('objects:changed') checkpoint automatically; any component can also
// request one with bus.emit('history:commit') — e.g. at drag end.
// Snapshots landing in the same tick collapse into a single entry
// (so clear + restore on scene load is one undo step).
// Emits: 'history:changed' {canUndo, canRedo}.
// Listens: 'history:undo', 'history:redo'.
export default class HistoryManager {
  constructor(bus, objectManager){
    this.bus = bus; this.om = objectManager;
    this.past = []; this.future = [];
    this.applying = false; this.pending = null;
    this.limit = 50;
    bus.on('objects:changed', () => this.#schedule());
    bus.on('history:commit', () => this.#schedule());
    bus.on('history:undo', () => this.undo());
    bus.on('history:redo', () => this.redo());
    bus.on('history:reset', () => {
      clearTimeout(this.pending); this.pending = null;
      this.past = []; this.future = [];
      this.#schedule();            // baseline = freshly loaded scene
      this.#announce();
    });
  }
  #snapshot(){ return JSON.stringify(SceneStore.objectsPayload(this.om)); }
  #schedule(){
    if (this.applying) return;
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.#commit(), 0);
  }
  #flush(){
    if (this.pending){ clearTimeout(this.pending); this.pending = null; this.#commit(); }
  }
  #commit(){
    this.pending = null;
    const s = this.#snapshot();
    if (s === this.past[this.past.length - 1]) return;
    this.past.push(s);
    if (this.past.length > this.limit + 1) this.past.shift();
    this.future = [];
    this.#announce();
  }
  #apply(s){
    this.applying = true;
    const d = JSON.parse(s);
    this.om.clear();
    this.om.restore(d.objects, d.counter);
    this.applying = false;
  }
  undo(){
    this.#flush();
    if (this.past.length < 2) return;
    this.future.push(this.past.pop());
    this.#apply(this.past[this.past.length - 1]);
    this.#announce();
  }
  redo(){
    this.#flush();
    if (!this.future.length) return;
    const s = this.future.pop();
    this.past.push(s);
    this.#apply(s);
    this.#announce();
  }
  #announce(){
    this.bus.emit('history:changed',
      { canUndo:this.past.length > 1, canRedo:this.future.length > 0 });
  }
}
