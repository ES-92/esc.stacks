/* ============================================================
   esc//shelf — Core (medienunabhängig)
   - vereinheitlichte DB:  items · media · covers
   - Modul-Registry + Contract
   - Cover-Cache + Utilities
   ============================================================ */

/* ---------- Utilities ---------- */
export const $  = (id) => document.getElementById(id);
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
export const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const fmt = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
export const bytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
};
export const toast = (msg) => {
  let t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._); toast._ = setTimeout(() => t.classList.remove('show'), 2400);
};

/* ---------- IndexedDB (vereinheitlicht) ---------- */
const DB_NAME = 'esc-shelf', DB_VER = 2;
let _db = null;
const P = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const store = (name, mode = 'readonly') => _db.transaction(name, mode).objectStore(name);

export const db = {
  init() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('items'))  d.createObjectStore('items',  { keyPath: 'id' });
        if (!d.objectStoreNames.contains('media'))  d.createObjectStore('media',  { keyPath: 'k' });
        if (!d.objectStoreNames.contains('covers')) d.createObjectStore('covers', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('meta'))   d.createObjectStore('meta',   { keyPath: 'k' });
      };
      r.onsuccess = () => { _db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  getItems()        { return P(store('items').getAll()); },
  getItem(id)       { return P(store('items').get(id)); },
  putItem(it)       { return P(store('items', 'readwrite').put(it)); },
  delItem(id)       { return P(store('items', 'readwrite').delete(id)); },
  putMedia(k, blob) { return P(store('media', 'readwrite').put({ k, blob })); },
  getMedia(k)       { return P(store('media').get(k)); },
  delMedia(k)       { return P(store('media', 'readwrite').delete(k)); },
  putCover(k, blob) { return P(store('covers', 'readwrite').put({ k, blob })); },
  getCover(k)       { return P(store('covers').get(k)); },
  getMeta(k)        { return P(store('meta').get(k)).then(r => (r ? r.v : undefined)); },
  putMeta(k, v)     { return P(store('meta', 'readwrite').put({ k, v })); },
  clearAll() {
    return new Promise((res, rej) => {
      const tx = _db.transaction(['items', 'media', 'covers'], 'readwrite');
      tx.objectStore('items').clear(); tx.objectStore('media').clear(); tx.objectStore('covers').clear();
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  },
};

/* ---------- Cover-Cache ---------- */
const _covers = {};
export async function coverURL(id) {
  if (id in _covers) return _covers[id];
  const rec = await db.getCover(id).catch(() => null);
  return (_covers[id] = rec ? URL.createObjectURL(rec.blob) : null);
}
export function clearCoverCache() {
  for (const k in _covers) { if (_covers[k]) URL.revokeObjectURL(_covers[k]); delete _covers[k]; }
}

/* ---------- Modul-Registry + Contract ----------
   Ein Medien-Modul exportiert standardmäßig ein Objekt:
   {
     id, label, badge,
     accepts(file) -> boolean,                 // Typ-Erkennung beim Import
     async createItem(files, core) -> item,    // parsen + media/cover speichern
     async mount(item, stageEl, core) -> { destroy() }
   }
   item = { id, type, title, author, toc[], parts[], progress, createdAt }
------------------------------------------------------------- */
const _mods = {};
export const registry = {
  register(mod) { _mods[mod.id] = mod; },
  all() { return Object.values(_mods); },
  get(id) { return _mods[id]; },
  forFile(file) { return Object.values(_mods).find(m => { try { return m.accepts(file); } catch (_) { return false; } }); },
};

/* ---------- Fortschritt (medienunabhängig) ---------- */
export async function saveProgress(item, progress) {
  item.progress = Object.assign({}, item.progress, progress, { updatedAt: Date.now() });
  await db.putItem(item);
}

/* ---------- Sicherung (.escstacks) — medienübergreifend ----------
   Container:  [16-Byte-Header][Manifest-JSON][Blobs hintereinander]
   Header:     "ESCSTK\0"(7) · Version(1) · Manifest-Länge(8, LE)
   Blobs:      via Blob-Slices referenziert (speicherschonend, kein 4-GB-Limit)
------------------------------------------------------------------- */
const MAGIC = 'ESCSTK\0', BAK_VER = 1;

export async function exportLibrary() {
  const items = await db.getItems();
  const entries = [], parts = [];
  for (const it of items) {
    for (const p of (it.parts || [])) {
      const rec = await db.getMedia(`${it.id}:${p.idx}`);
      if (rec) { entries.push({ kind: 'media', key: `${it.id}:${p.idx}`, length: rec.blob.size }); parts.push(rec.blob); }
    }
    const cov = await db.getCover(it.id);
    if (cov) { entries.push({ kind: 'cover', key: it.id, length: cov.blob.size }); parts.push(cov.blob); }
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify({ version: BAK_VER, items, entries }));
  const header = new ArrayBuffer(16); const dv = new DataView(header);
  for (let i = 0; i < 7; i++) dv.setUint8(i, MAGIC.charCodeAt(i));
  dv.setUint8(7, BAK_VER);
  dv.setBigUint64(8, BigInt(manifestBytes.length), true);
  return new Blob([header, manifestBytes, ...parts], { type: 'application/octet-stream' });
}

export async function importLibrary(file) {
  const headBuf = await file.slice(0, 16).arrayBuffer();
  const dv = new DataView(headBuf);
  let magic = ''; for (let i = 0; i < 7; i++) magic += String.fromCharCode(dv.getUint8(i));
  if (magic !== MAGIC) throw new Error('Keine gültige .escstacks-Sicherung');
  const manLen = Number(dv.getBigUint64(8, true));
  const manifest = JSON.parse(new TextDecoder().decode(await file.slice(16, 16 + manLen).arrayBuffer()));
  let offset = 16 + manLen, restored = 0;
  for (const e of manifest.entries) {
    const slice = file.slice(offset, offset + e.length); offset += e.length;
    if (e.kind === 'media') await db.putMedia(e.key, slice);
    else if (e.kind === 'cover') await db.putCover(e.key, slice);
  }
  for (const it of manifest.items) { await db.putItem(it); restored++; }
  clearCoverCache();
  return restored;
}


/* ---------- Einmal-Migration aus esc//audio (alte DB) ---------- */
function _openOld(name) {
  return new Promise((res) => {
    let req; try { req = indexedDB.open(name); } catch (_) { return res(null); }
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null); req.onblocked = () => res(null);
  });
}
function _allOf(database, storeName) {
  return new Promise((res, rej) => {
    if (!database.objectStoreNames.contains(storeName)) return res([]);
    const t = database.transaction(storeName).objectStore(storeName).getAll();
    t.onsuccess = () => res(t.result || []); t.onerror = () => rej(t.error);
  });
}

export async function migrateFromAudio() {
  const FLAG = 'migrated_esc_audio';
  if (await db.getMeta(FLAG).catch(() => null)) return 0;
  // Existenz der alten DB prüfen (verhindert Phantom-DB)
  if (indexedDB.databases) {
    try {
      const list = await indexedDB.databases();
      if (!list.some(d => d.name === 'esc-audio')) { await db.putMeta(FLAG, true); return 0; }
    } catch (_) {}
  }
  const old = await _openOld('esc-audio');
  if (!old) return 0;
  let books = [], media = [], covers = [];
  try {
    books  = await _allOf(old, 'books');
    media  = await _allOf(old, 'media');
    covers = await _allOf(old, 'covers');
  } catch (_) { old.close(); await db.putMeta(FLAG, true); return 0; }

  let n = 0;
  for (const b of books) {
    const chapters = (b.chapters || []).map((c, i) => ({
      name: c.name || `Kapitel ${i + 1}`, mediaIndex: (c.mediaIndex | 0), start: c.start || 0, duration: c.duration || 0,
    }));
    const idxSet = [...new Set(chapters.map(c => c.mediaIndex))].sort((x, y) => x - y);
    await db.putItem({
      id: b.id, type: 'audio', title: b.title || 'Hörbuch', author: b.author || '',
      toc: chapters, parts: idxSet.map(idx => ({ idx, mime: '' })),
      progress: { chapterIndex: b.progress?.chapterIndex || 0, position: b.progress?.position || 0, updatedAt: b.progress?.updatedAt || b.createdAt || 0 },
      settings: { rate: b.rate || 1 },
      bookmarks: (b.bookmarks || []).map(bm => ({ chapterIndex: bm.chapterIndex || 0, position: bm.position || 0, label: bm.label || 'Lesezeichen', at: bm.at || Date.now() })),
      finished: !!b.finished, archived: !!b.archived, createdAt: b.createdAt || Date.now(),
    });
    n++;
  }
  for (const m of media) if (m && m.k && m.blob) await db.putMedia(m.k, m.blob);
  for (const c of covers) if (c && c.k && c.blob) await db.putCover(c.k, c.blob);
  old.close();
  await db.putMeta(FLAG, true);
  clearCoverCache();
  return n;
}
