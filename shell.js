/* ============================================================
   esc//shelf — Shell (Boot · Bibliothek · Import-Dispatch · Stage)
   ============================================================ */
import { db, registry, $, esc, coverURL, clearCoverCache, saveProgress, toast, exportLibrary, importLibrary, migrateFromAudio, trackTime, getStats, flushStats, getAudioPrefs, setAudioPrefs } from './core.js';
import audioMod from './mod-audio.js';
import musicMod from './mod-music.js';
import readerMod from './mod-reader.js';

registry.register(audioMod);
registry.register(musicMod);
registry.register(readerMod);

const core = { db, saveProgress, toast, trackTime };
let current = null;        // gemountetes Modul (Controller)
let pendingModule = null;  // gewähltes Import-Modul
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
  $('importBtn').onclick = () => openAdd();
  $('file').onchange = async (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) await doImport(files); };
  $('addAudio').onclick = () => pickFor('audio');
  $('addMusic').onclick = () => pickFor('music');
  $('addBook').onclick = () => pickFor('reader');
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
  $('scrim').onclick = () => closeSheets();
  $('optStats').onclick = () => openStats();
  $('optExport').onclick = () => doExport();
  $('optImport').onclick = () => $('bakInput').click();
  $('bakInput').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await doImportBackup(f); };
  $('togSilence').onclick = () => updatePrefs({ skipSilence: !$('togSilence').classList.contains('on') });
  $('togNormalize').onclick = () => updatePrefs({ normalize: !$('togNormalize').classList.contains('on') });
}

const SKIP_BACK = [10, 15, 30], SKIP_FWD = [15, 30, 60];
async function renderAudioPrefs() {
  const p = await getAudioPrefs();
  $('togSilence').classList.toggle('on', !!p.skipSilence);
  $('togNormalize').classList.toggle('on', !!p.normalize);
  $('segBack').innerHTML = SKIP_BACK.map(v => `<button data-v="${v}" class="${v === p.skipBack ? 'active' : ''}">${v}s</button>`).join('');
  $('segFwd').innerHTML  = SKIP_FWD.map(v => `<button data-v="${v}" class="${v === p.skipFwd ? 'active' : ''}">${v}s</button>`).join('');
  $('segBack').querySelectorAll('button').forEach(b => b.onclick = () => updatePrefs({ skipBack: +b.dataset.v }));
  $('segFwd').querySelectorAll('button').forEach(b => b.onclick = () => updatePrefs({ skipFwd: +b.dataset.v }));
}
async function updatePrefs(patch) {
  const p = await setAudioPrefs(patch);
  if (current && current.item.type === 'audio' && current.ctrl.applyPrefs) current.ctrl.applyPrefs(p);
  await renderAudioPrefs();
}

async function openSettings() { await renderAudioPrefs(); $('scrim').classList.add('show'); $('settingsSheet').classList.add('show'); }
function closeSheets() { $('scrim').classList.remove('show'); $('settingsSheet').classList.remove('show'); $('statsSheet').classList.remove('show'); $('addSheet').classList.remove('show'); }
function closeSettings() { closeSheets(); }

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h) return `${h} Std ${m} Min`;
  if (m) return `${m} Min`;
  return `${sec} Sek`;
}
async function openStats() {
  $('settingsSheet').classList.remove('show');
  const s = await getStats();
  const max = Math.max(1, ...s.last7.map(d => d.sec));
  const DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const todayKey = s.last7[s.last7.length - 1].day;
  const bars = s.last7.map(d => {
    const h = Math.round(d.sec / max * 100);
    return `<div class="st-bar ${d.day === todayKey ? 'today' : ''}"><div class="col"><i class="${d.sec ? '' : 'zero'}" style="height:${d.sec ? Math.max(3, h) : 3}%"></i></div><div class="d">${DOW[d.dow]}</div></div>`;
  }).join('');
  $('statsBody').innerHTML = `
    <div class="st-top">
      <div class="st-card"><div class="v">${fmtDur(s.today)}</div><div class="l">heute</div></div>
      <div class="st-card"><div class="v">${s.streak}</div><div class="l">Tage in Folge</div></div>
      <div class="st-card"><div class="v">${fmtDur(s.total)}</div><div class="l">gesamt</div></div>
    </div>
    <div class="st-chart">${bars}</div>`;
  $('scrim').classList.add('show'); $('statsSheet').classList.add('show');
}

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

function openAdd() { $('scrim').classList.add('show'); $('addSheet').classList.add('show'); }
function pickFor(id) {
  pendingModule = registry.get(id);
  const pk = pendingModule.pick || { accept: '', multiple: true };
  const f = $('file'); f.setAttribute('accept', pk.accept); f.multiple = !!pk.multiple;
  closeSheets(); f.click();
}

async function doImport(files) {
  const mod = pendingModule || registry.forFile(files[0]); pendingModule = null;
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
  if (item.type === 'music') return 0;
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
  if (current && (current.item.type === 'audio' || current.item.type === 'music')) {
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

window.addEventListener('pagehide', () => { try { flushStats(); } catch (_) {} });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { flushStats(); } catch (_) {} } });

boot();

// Test-/Debug-Hook (harmlos): erlaubt Sicherung ohne UI-Download zu prüfen
window.__stacks = { export: exportLibrary, import: importLibrary, render: renderGrid, db, trackTime, getStats, flushStats, fxState: () => (current && current.ctrl && current.ctrl.fx) ? { built: current.ctrl.fx.built } : null };
