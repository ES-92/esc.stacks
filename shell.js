/* ============================================================
   esc//shelf — Shell (Boot · Bibliothek · Import-Dispatch · Stage)
   ============================================================ */
import { db, registry, $, esc, coverURL, clearCoverCache, saveProgress, toast, exportLibrary, importLibrary, migrateFromAudio } from './core.js';
import audioMod from './mod-audio.js';
import readerMod from './mod-reader.js';

registry.register(audioMod);
registry.register(readerMod);

const core = { db, saveProgress, toast };
let current = null;        // gemountetes Modul (Controller)
let filter = 'all', query = '';
let gridToken = 0;

async function boot() {
  await db.init();
  wire();
  try { const n = await migrateFromAudio(); if (n) toast(`${n} Hörbücher aus esc//audio übernommen`); }
  catch (err) { console.error('Migration:', err); }
  await renderGrid();
}
function wire() {
  $('importBtn').onclick = () => $('file').click();
  $('file').onchange = async (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) await doImport(files); };
  $('backBtn').onclick = () => closeItem();
  $('libSearch').oninput = () => { query = $('libSearch').value; renderGrid(); };
  $('filters').querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    $('filters').querySelectorAll('[data-f]').forEach(x => x.classList.toggle('active', x === b));
    renderGrid();
  });
  $('miniOpen').onclick = () => { if (current) foreground(); };
  $('miniCover').onclick = () => { if (current) foreground(); };
  $('miniToggle').onclick = () => { current?.ctrl.toggle?.(); updateMini(); };
  $('miniClose').onclick = () => { stopCurrent(); };

  // Einstellungen / Sicherung
  $('settingsBtn').onclick = () => openSettings();
  $('scrim').onclick = () => closeSettings();
  $('optExport').onclick = () => doExport();
  $('optImport').onclick = () => $('bakInput').click();
  $('bakInput').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await doImportBackup(f); };
}

function openSettings() { $('scrim').classList.add('show'); $('settingsSheet').classList.add('show'); }
function closeSettings() { $('scrim').classList.remove('show'); $('settingsSheet').classList.remove('show'); }

async function doExport() {
  closeSettings(); toast('Exportiere …');
  try {
    const blob = await exportLibrary();
    const url = URL.createObjectURL(blob);
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url; a.download = `esc-stacks-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.escstacks`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Sicherung exportiert');
  } catch (err) { console.error(err); toast('Export fehlgeschlagen'); }
}
async function doImportBackup(file) {
  closeSettings(); toast('Importiere Sicherung …');
  try { const n = await importLibrary(file); await renderGrid(); toast(`${n} Titel wiederhergestellt`); }
  catch (err) { console.error(err); toast('Import fehlgeschlagen: ' + err.message); }
}

async function doImport(files) {
  const mod = registry.forFile(files[0]);
  if (!mod) { toast('Dateityp nicht unterstützt'); return; }
  toast('Importiere …');
  try {
    const item = await mod.createItem(files, core);
    clearCoverCache();
    await renderGrid();
    toast('„' + item.title + '" hinzugefügt');
  } catch (err) { console.error(err); toast('Import fehlgeschlagen'); }
}

/* Fortschritt in Prozent — medienübergreifend */
function itemPercent(item) {
  if (item.type === 'reader') return item.progress?.percent || 0;
  // Audio: aus Kapitel-Offsets + Position
  const toc = item.toc || [];
  const total = toc.reduce((a, c) => a + (c.duration || 0), 0);
  if (!total) return 0;
  const ci = item.progress?.chapterIndex || 0;
  let done = 0; for (let i = 0; i < ci && i < toc.length; i++) done += toc[i].duration || 0;
  done += item.progress?.position || 0;
  return Math.max(0, Math.min(100, Math.round(done / total * 100)));
}

async function renderGrid() {
  const grid = $('grid'); if (!grid) return;
  const token = ++gridToken;
  let items = await db.getItems();
  items = items.filter(it => {
    if (filter !== 'all' && it.type !== filter) return false;
    if (query) { const hay = (it.title + ' ' + (it.author || '')).toLowerCase(); if (!hay.includes(query.toLowerCase())) return false; }
    return true;
  }).sort((a, b) => (b.progress?.updatedAt || b.createdAt) - (a.progress?.updatedAt || a.createdAt));

  if (!items.length) {
    grid.innerHTML = `<div class="empty">${query ? 'Keine Treffer.' : 'Noch nichts hier.<br>Tippe oben auf + und füge ein Hörbuch (M4B/MP3) oder ein Buch (EPUB) hinzu.'}</div>`;
    return;
  }
  grid.innerHTML = '';
  for (const it of items) {
    const cu = await coverURL(it.id);
    if (token !== gridToken) return;
    const pct = itemPercent(it);
    const badge = registry.get(it.type)?.badge || '';
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.id = it.id;
    card.innerHTML = `
      <div class="cw">
        ${cu ? `<img src="${cu}" alt="">` : `<div class="fb">${esc(it.title)}</div>`}
        <span class="badge">${badge}</span>
        ${pct > 0 ? `<div class="cp"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      <div class="ct">${esc(it.title)}</div>
      <div class="ca">${esc(it.author || 'Unbekannt')}</div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll('.card').forEach(c => c.onclick = () => openItem(c.dataset.id));
}

async function openItem(id) {
  // Bereits offen (im Hintergrund)? -> nur wieder in den Vordergrund holen.
  if (current && current.item.id === id) { foreground(); return; }
  const item = await db.getItem(id); if (!item) return;
  const mod = registry.get(item.type); if (!mod) { toast('Kein Modul für ' + item.type); return; }
  // Vorheriges Item beenden (auch ein im Hintergrund laufendes Hörbuch)
  if (current) { try { current.ctrl.destroy(); } catch (_) {} current = null; hideMini(); }
  $('stage').innerHTML = '';
  showItemView();
  try {
    const ctrl = await mod.mount(item, $('stage'), core);
    current = { item, ctrl };
    if (ctrl) ctrl.onState = updateMini;
  } catch (err) { console.error(err); toast('Konnte nicht öffnen'); backToLibrary(); }
}

// „Zurück": Hörbuch läuft weiter (Mini-Player), Reader wird beendet.
async function closeItem() {
  if (current && current.item.type === 'audio') {
    background();
  } else {
    stopCurrent();
  }
}
function stopCurrent() {
  try { current?.ctrl.destroy(); } catch (_) {}
  current = null; hideMini(); backToLibrary();
}
function backToLibrary() {
  $('itemView').classList.add('hidden');
  $('libView').classList.remove('hidden');
  clearCoverCache();
  renderGrid();
}
function showItemView() {
  $('libView').classList.add('hidden');
  $('itemView').classList.remove('hidden');
}
function foreground() { hideMini(); showItemView(); }
function background() {
  $('itemView').classList.add('hidden');
  $('libView').classList.remove('hidden');
  showMini(); updateMini();
  clearCoverCache(); renderGrid();
}

/* ---------- Mini-Player ---------- */
function showMini() { $('mini').classList.remove('hidden'); }
function hideMini() { $('mini').classList.add('hidden'); }
const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
function updateMini() {
  if (!current || !current.ctrl.meta) return;
  const m = current.ctrl.meta();
  $('miniTitle').textContent = m.title || '';
  $('miniChap').textContent = m.author || '';
  $('miniCover').innerHTML = m.cover ? `<img src="${m.cover}">` : '';
  $('miniToggle').innerHTML = m.playing ? PAUSE_ICON : PLAY_ICON;
}

boot();

// Test-/Debug-Hook (harmlos): erlaubt Sicherung ohne UI-Download zu prüfen
window.__stacks = { export: exportLibrary, import: importLibrary, render: renderGrid, db };
