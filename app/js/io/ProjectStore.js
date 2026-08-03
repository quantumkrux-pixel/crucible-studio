import { kvGet, kvSet, kvDel, backend } from './kvStore.js';

// Persistent project storage on top of the shared kvStore adapter
// (window.storage → IndexedDB → localStorage). Index entry:
//   { id, name, updated, thumb }   (thumb = small jpeg data URL)
// Scene data lives per-project under 'projects:data:{id}'.
//
// Projects created by earlier localStorage-based builds migrate into
// IndexedDB automatically the first time the store is used; legacy
// data is only removed once every copy has succeeded.
const INDEX_KEY = 'projects:index';

export default class ProjectStore {
  #migration = null;
  #migrate(){
    this.#migration ??= (async () => {
      if (backend !== 'idb') return;
      try {
        if (await kvGet(INDEX_KEY)) return;             // fresh or already migrated
        const legacy = localStorage.getItem(INDEX_KEY);
        if (!legacy) return;
        const list = JSON.parse(legacy);
        if (!(await kvSet(INDEX_KEY, legacy))) return;  // leave legacy intact
        let ok = true;
        for (const p of list){
          const d = localStorage.getItem('projects:data:' + p.id);
          if (d && !(await kvSet('projects:data:' + p.id, d))) ok = false;
        }
        if (ok){
          localStorage.removeItem(INDEX_KEY);
          list.forEach(p => localStorage.removeItem('projects:data:' + p.id));
        }
      } catch { /* on any failure, legacy data stays put */ }
    })();
    return this.#migration;
  }

  async list(){
    await this.#migrate();
    try {
      const raw = await kvGet(INDEX_KEY);
      const l = raw ? JSON.parse(raw) : [];
      return l.sort((a, b) => b.updated - a.updated);
    } catch { return []; }
  }
  async #saveIndex(list){ return kvSet(INDEX_KEY, JSON.stringify(list)); }
  async create(name){
    const entry = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (name || 'Untitled').trim() || 'Untitled',
      updated: Date.now(),
      thumb: null
    };
    const list = await this.list();
    list.unshift(entry);
    await this.#saveIndex(list);
    return entry;
  }
  async rename(id, name){
    const list = await this.list();
    const e = list.find(p => p.id === id);
    if (!e) return;
    e.name = (name || '').trim() || e.name;
    e.updated = Date.now();
    await this.#saveIndex(list);
  }
  async clone(id){
    const list = await this.list();
    const src = list.find(p => p.id === id);
    if (!src) return null;
    const entry = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: src.name + ' copy',
      updated: Date.now(),
      thumb: src.thumb
    };
    const data = await kvGet('projects:data:' + id);
    if (data) await kvSet('projects:data:' + entry.id, data);
    list.unshift(entry);
    await this.#saveIndex(list);
    return entry;
  }
  async saveProject(id, dataJson, thumb){
    await kvSet('projects:data:' + id, dataJson);
    const list = await this.list();
    const e = list.find(p => p.id === id);
    if (e){ e.updated = Date.now(); if (thumb) e.thumb = thumb; }
    await this.#saveIndex(list);
  }
  async loadProject(id){
    await this.#migrate();
    return kvGet('projects:data:' + id);
  }
  async remove(id){
    await kvDel('projects:data:' + id);
    const list = (await this.list()).filter(p => p.id !== id);
    await this.#saveIndex(list);
  }
}
