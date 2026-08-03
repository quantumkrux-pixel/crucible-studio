import { kvGet, kvSet } from './kvStore.js';

// Optional local-folder backend using the File System Access API.
// When the user links a folder, each project is written as a real
// <name>.json file on disk that they can back up, sync, or edit
// outside the app. The chosen directory handle is persisted (in
// IndexedDB via kvStore) and silently reconnected on next launch;
// re-granting permission needs one user gesture per session.
//
// Availability is Chromium-desktop only (Chrome/Edge/Opera). Elsewhere
// isSupported() is false and the app stays on its IndexedDB store.
const HANDLE_KEY = 'fs:dir-handle';

export function isSupported(){
  return typeof window.showDirectoryPicker === 'function' && window.self === window.top;
}

export default class FolderStore {
  constructor(){ this.dir = null; }

  get linked(){ return !!this.dir; }
  get name(){ return this.dir?.name ?? null; }

  // Prompt the user to choose a projects folder (needs a user gesture).
  async link(){
    const dir = await window.showDirectoryPicker({ id:'crucible3d-projects', mode:'readwrite', startIn:'documents' });
    this.dir = dir;
    try { await kvSet(HANDLE_KEY, dir); } catch { /* handle not serializable on some builds */ }
    return dir.name;
  }
  async unlink(){ this.dir = null; try { await kvSet(HANDLE_KEY, null); } catch {} }

  // Try to restore a previously linked folder without a picker. Returns
  // 'ready' if usable now, 'needs-permission' if the handle survived but
  // permission must be re-granted by a gesture, or null if none.
  async tryRestore(){
    let handle = null;
    try { handle = await kvGet(HANDLE_KEY); } catch { handle = null; }
    if (!handle || typeof handle.queryPermission !== 'function') return null;
    this.dir = handle;
    const perm = await handle.queryPermission({ mode:'readwrite' });
    return perm === 'granted' ? 'ready' : 'needs-permission';
  }
  // Re-request permission on a restored handle (needs a user gesture).
  async requestPermission(){
    if (!this.dir?.requestPermission) return false;
    return (await this.dir.requestPermission({ mode:'readwrite' })) === 'granted';
  }

  #fileName(name){
    const base = (name || 'project').replace(/[^\w.\- ]+/g, '').trim() || 'project';
    return base + '.json';
  }
  async write(name, json){
    if (!this.dir) return false;
    const fh = await this.dir.getFileHandle(this.#fileName(name), { create:true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
    return true;
  }
  async remove(name){
    if (!this.dir) return;
    try { await this.dir.removeEntry(this.#fileName(name)); } catch { /* already gone */ }
  }
  // List every *.json in the folder, returning parsed { name, data }.
  async list(){
    if (!this.dir) return [];
    const out = [];
    for await (const entry of this.dir.values()){
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')){
        try {
          const file = await entry.getFile();
          out.push({ file: entry.name, name: entry.name.replace(/\.json$/i, ''), text: await file.text(), modified: file.lastModified });
        } catch { /* skip unreadable */ }
      }
    }
    return out;
  }
}
