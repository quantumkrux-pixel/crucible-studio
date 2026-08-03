// TexturePalette — an in-project collection of painted/imported textures.
// Each entry is { id, name, dataURL }. Persists with the project (saved and
// restored via toJSON/fromJSON, threaded through ProjectManager like the
// timeline). The properties panel shows these as thumbnails you can click
// to apply to the selected object.
//
// Emits: 'palette:changed' when entries are added/removed.
export default class TexturePalette {
  constructor(bus){
    this.bus = bus;
    this.items = [];   // [{ id, name, dataURL }]
  }

  get count(){ return this.items.length; }

  add(dataURL, name){
    const id = 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = { id, name: name || `Texture ${this.items.length + 1}`, dataURL };
    this.items.push(entry);
    this.#emit();
    return entry;
  }
  remove(id){
    const i = this.items.findIndex(t => t.id === id);
    if (i >= 0){ this.items.splice(i, 1); this.#emit(); }
  }
  rename(id, name){
    const t = this.items.find(t => t.id === id);
    if (t && name?.trim()){ t.name = name.trim(); this.#emit(); }
  }
  get(id){ return this.items.find(t => t.id === id) || null; }

  #emit(){ this.bus.emit('palette:changed'); }

  toJSON(){ return this.items.length ? this.items : undefined; }
  fromJSON(data){
    this.items = Array.isArray(data) ? data.filter(t => t && t.dataURL) : [];
    this.#emit();
  }
}
