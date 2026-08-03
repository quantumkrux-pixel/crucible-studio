// Shared async key-value storage adapter. Backend priority:
//   1. window.storage — artifact hosting API, when the host provides it
//   2. IndexedDB     — normal browsers (no practical size ceiling)
//   3. localStorage  — last-resort fallback (~5 MB)
// All values are strings. kvSet/kvDel resolve true on success.
// If an IndexedDB operation fails (private modes, blocked storage),
// each call quietly falls through to localStorage.

const hasAppStorage = typeof window.storage?.get === 'function';
const hasIDB = typeof indexedDB !== 'undefined';
export const backend = hasAppStorage ? 'app' : (hasIDB ? 'idb' : 'local');

const DB_NAME = 'crucible3d', STORE = 'kv';
let dbPromise = null;
function openDB(){
  if (!dbPromise){
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
function idb(mode, op){
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = op(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export async function kvGet(key){
  if (hasAppStorage){
    try { const r = await window.storage.get(key); return r?.value ?? null; }
    catch { return null; }
  }
  if (hasIDB){
    try { const v = await idb('readonly', s => s.get(key)); return v ?? null; }
    catch { /* fall through to localStorage */ }
  }
  try { return localStorage.getItem(key); } catch { return null; }
}
export async function kvSet(key, value){
  if (hasAppStorage){
    try { return !!(await window.storage.set(key, value)); }
    catch { return false; }
  }
  if (hasIDB){
    try { await idb('readwrite', s => s.put(value, key)); return true; }
    catch { /* fall through to localStorage */ }
  }
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export async function kvDel(key){
  if (hasAppStorage){
    try { await window.storage.delete(key); return true; } catch { return false; }
  }
  if (hasIDB){
    try { await idb('readwrite', s => s.delete(key)); return true; }
    catch { /* fall through to localStorage */ }
  }
  try { localStorage.removeItem(key); return true; } catch { return false; }
}
