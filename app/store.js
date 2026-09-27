// Small key-value store on IndexedDB (games and analysis can exceed localStorage's ~5 MB),
// plus localStorage helpers for tiny settings. Every call degrades to a no-op when storage is blocked.
const DB = 'chess-prep', STORE = 'kv';
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  }));
}
export const idb = {
  get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
  set: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined),
  del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => undefined),
  clear: () => tx('readwrite', (s) => s.clear()).catch(() => undefined),
};
const watchers = [];
export const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } watchers.forEach((fn) => fn(k)); },
  /** Call fn(key) after every set (sync.js uses it to notice changes to synced data). */
  watch(fn) { watchers.push(fn); },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  clear() { try { localStorage.clear(); } catch { /* storage unavailable */ } },
};
