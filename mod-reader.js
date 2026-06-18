/* ============================================================
   esc//shelf — Reader-Modul (EPUB), Vanilla — Feinschliff
   Verlags-CSS + eingebettete Fonts · robuster Block-Locator ·
   Lesethemen (Dunkel/Sepia/Hell) · Spine-Cache
   ============================================================ */
import { db, uid, esc, getReaderPrefs, setReaderPrefs } from './core.js';

/* ---------- ZIP (nativ, DecompressionStream) ---------- */
function openZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eo = -1;
  for (let i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('Keine gültige EPUB-Datei');
  const count = dv.getUint16(eo + 10, true); let off = dv.getUint32(eo + 16, true);
  const entries = {}, td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), cmtLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    entries[td.decode(u8.subarray(off + 46, off + 46 + nameLen))] = { method, compSize, localOff };
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return { u8, dv, entries };
}
async function zipBytes(zip, name) {
  const e = zip.entries[name]; if (!e) return null;
  const lo = e.localOff;
  const nameLen = zip.dv.getUint16(lo + 26, true), extraLen = zip.dv.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const comp = zip.u8.subarray(start, start + e.compSize);
  if (e.method === 0) return comp.slice();
  if (e.method === 8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([comp]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('Kompressionsmethode ' + e.method);
}
const zipText = async (zip, n) => { const b = await zipBytes(zip, n); return b ? new TextDecoder().decode(b) : null; };
const dirname = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };
function resolvePath(base, rel) {
  if (/^[a-z]+:/i.test(rel)) return rel;
  const out = []; for (const seg of (base + rel).split('/')) { if (seg === '..') out.pop(); else if (seg !== '.' && seg) out.push(seg); }
  return out.join('/');
}
function guessMime(path) {
  const e = path.split('.').pop().toLowerCase();
  return ({ png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    otf: 'font/otf', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2' })[e] || 'application/octet-stream';
}

/* ---------- EPUB parsen ---------- */
async function parseEpub(u8) {
  const zip = openZip(u8);
  const cont = await zipText(zip, 'META-INF/container.xml');
  const opfPath = new DOMParser().parseFromString(cont, 'application/xml').querySelector('rootfile').getAttribute('full-path');
  const opfDir = dirname(opfPath);
  const odoc = new DOMParser().parseFromString(await zipText(zip, opfPath), 'application/xml');
  const title  = (odoc.querySelector('metadata > *|title, dc\\:title, title') || {}).textContent || 'Unbenanntes Buch';
  const author = (odoc.querySelector('metadata > *|creator, dc\\:creator, creator') || {}).textContent || '';
  const man = {};
  odoc.querySelectorAll('manifest > item').forEach(it => man[it.getAttribute('id')] = {
    href: resolvePath(opfDir, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '',
  });
  let coverItem = Object.values(man).find(m => /cover-image/.test(m.props));
  if (!coverItem) { const mc = odoc.querySelector('metadata > meta[name="cover"]'); if (mc) coverItem = man[mc.getAttribute('content')]; }
  const spine = [...odoc.querySelectorAll('spine > itemref')].map(ir => man[ir.getAttribute('idref')]).filter(Boolean).map(m => m.href);
  const toc = [];
  const navItem = Object.values(man).find(m => /\bnav\b/.test(m.props));
  if (navItem) {
    const ndoc = new DOMParser().parseFromString(await zipText(zip, navItem.href), 'application/xhtml+xml');
    const nav = [...ndoc.querySelectorAll('nav')].find(n => (n.getAttribute('epub:type') || n.getAttribute('type')) === 'toc') || ndoc.querySelector('nav');
    if (nav) nav.querySelectorAll('a[href]').forEach(a => toc.push({ label: a.textContent.trim(), href: resolvePath(dirname(navItem.href), a.getAttribute('href').split('#')[0]) }));
  }
  if (!toc.length) {
    const ncx = Object.values(man).find(m => /ncx/.test(m.type));
    if (ncx) { const x = new DOMParser().parseFromString(await zipText(zip, ncx.href), 'application/xml');
      x.querySelectorAll('navPoint').forEach(np => { const l = np.querySelector('navLabel > text'), s = np.querySelector('content');
        if (l && s) toc.push({ label: l.textContent.trim(), href: resolvePath(dirname(ncx.href), s.getAttribute('src').split('#')[0]) }); }); }
  }
  return { zip, title, author, coverHref: coverItem ? coverItem.href : null, spine, toc };
}

const THEMES = {
  dark:  { bg: '#171310', fg: '#e9e0d2', link: '#e0a458' },
  sepia: { bg: '#efe4cf', fg: '#43381f', link: '#9a6a18' },
  light: { bg: '#f8f6f2', fg: '#1d1b18', link: '#9a6a18' },
};

const READER_CSS = `
.rd{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}
.rd-top{display:flex;align-items:center;gap:8px;padding:6px 4px}
.rd-top .t{flex:1;font-family:var(--serif);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-ic{width:36px;height:36px;border-radius:9px;display:grid;place-items:center;color:var(--txt-dim)}
.rd-ic:hover{background:var(--bg2);color:var(--txt)}.rd-ic svg{width:19px;height:19px}
.rd-stage{flex:1;position:relative;min-height:0;display:flex;justify-content:center}
.rd-page{position:relative;width:100%;max-width:680px;border-radius:12px;overflow:hidden;
  box-shadow:0 10px 38px rgba(0,0,0,.45),0 0 0 1px var(--line-soft);border-left:2px solid var(--amber)}
.rd-page iframe{border:0;width:100%;height:100%;display:block}
.rd-z{position:absolute;top:0;bottom:0;width:34%;z-index:3}.rd-z.l{left:0}.rd-z.r{right:0}
.rd-prog{padding:10px 6px 4px}
.rd-bar{height:4px;border-radius:99px;background:var(--line);overflow:hidden}
.rd-bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--amber),var(--amber-hi));transition:width .25s}
.rd-meta{display:flex;justify-content:space-between;margin-top:6px;font-family:var(--mono);font-size:11px;color:var(--txt-dim)}
.rd-scrim{position:fixed;inset:0;background:rgba(6,8,11,.6);opacity:0;pointer-events:none;transition:.25s;z-index:59}
.rd-scrim.show{opacity:1;pointer-events:auto}
.rd-drawer{position:fixed;top:0;left:0;bottom:0;width:84%;max-width:340px;background:var(--bg2);z-index:60;
  transform:translateX(-100%);transition:transform .28s cubic-bezier(.32,.72,0,1);padding:20px 0;display:flex;flex-direction:column;border-right:1px solid var(--line)}
.rd-drawer.show{transform:none}.rd-drawer h3{font-family:var(--serif);font-weight:500;margin:0 20px 12px}
.rd-toc{overflow:auto;flex:1}.rd-tocitem{display:block;width:100%;text-align:left;padding:13px 20px;font-size:14px;color:var(--txt-dim);background:none;border:none}
.rd-tocitem.cur{color:var(--amber-hi);background:var(--amber-dim)}
.rd-sheet{position:fixed;left:0;right:0;bottom:0;z-index:62;background:var(--bg2);border-top:1px solid var(--line);
  border-radius:20px 20px 0 0;padding:12px 20px calc(22px + var(--safe-b));max-width:560px;margin:0 auto;
  transform:translateY(100%);transition:transform .28s cubic-bezier(.32,.72,0,1)}
.rd-sheet.show{transform:none}
.rd-handle{width:38px;height:4px;border-radius:99px;background:var(--line);margin:2px auto 12px}
.rd-sheet h4{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-faint);margin:14px 2px 7px}
.rd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 2px;font-size:14px}
.rd-seg{display:flex;gap:6px}
.rd-seg button{border:1px solid var(--line);border-radius:8px;padding:7px 12px;color:var(--txt-dim);font-family:var(--mono);font-size:12px;background:var(--bg)}
.rd-seg button.active{border-color:var(--amber);background:var(--amber-dim);color:var(--amber-hi)}
.rd-tog{width:42px;height:25px;border-radius:99px;background:var(--line);position:relative;flex:none;border:none}
.rd-tog.on{background:var(--amber)}
.rd-tog::after{content:"";position:absolute;top:3px;left:3px;width:19px;height:19px;border-radius:50%;background:#fff;transition:.2s}
.rd-tog.on::after{transform:translateX(17px)}
`;

function pageDoc(inner, fontPx, lead, serif, theme, publisher, bookCss) {
  const t = THEMES[theme] || THEMES.dark;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${t.bg};color:${t.fg}}#vp{overflow:hidden}
    #bk{column-fill:auto;font-size:${fontPx}px;line-height:${lead};color:${t.fg};text-align:justify;hyphens:auto;-webkit-hyphens:auto;${publisher ? '' : `font-family:${serif};`}}
    #bk p{margin:0 0 .9em}#bk h1,#bk h2,#bk h3{line-height:1.2}
    #bk img{max-width:100%;height:auto;display:block;margin:.6em auto}#bk a{color:${t.link};text-decoration:none}
    ::selection{background:rgba(224,164,88,.3)}
  </style><style id="bookcss">${bookCss || ''}</style></head>
  <body><div id="vp"><div id="bk">${inner}</div></div></body></html>`;
}

class ReaderInstance {
  constructor(item, stageEl, core) {
    this.item = item; this.core = core; this.host = stageEl;
    this.view = { spineIndex: item.progress?.spineIndex || 0, page: 0, total: 1, step: 0,
      blockIndex: item.progress?.blockIndex || 0, targetBlock: item.progress?.blockIndex || 0 };
    this.blobUrls = []; this.docCache = new Map();
    this.serif = getComputedStyle(document.documentElement).getPropertyValue('--serif').trim() || 'Georgia, serif';
  }
  async start() {
    this.prefs = await getReaderPrefs();
    const rec = await db.getMedia(`${this.item.id}:0`);
    if (!rec) throw new Error('EPUB-Daten fehlen');
    this.book = await parseEpub(new Uint8Array(await rec.blob.arrayBuffer()));
    this.buildDOM();
    await this.renderSpine(this.view.spineIndex);
  }
  buildDOM() {
    if (!document.getElementById('rd-style')) { const st = document.createElement('style'); st.id = 'rd-style'; st.textContent = READER_CSS; document.head.appendChild(st); }
    this.host.innerHTML = `
      <div class="rd">
        <div class="rd-top">
          <button class="rd-ic" data-act="toc" aria-label="Inhalt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
          <div class="t">${esc(this.book.title)}</div>
          <button class="rd-ic" data-act="settings" aria-label="Darstellung"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7V5h14v2M9 19h6M12 5v14"/></svg></button>
        </div>
        <div class="rd-stage"><div class="rd-page">
          <iframe sandbox="allow-same-origin"></iframe>
          <div class="rd-z l" data-act="prev"></div><div class="rd-z r" data-act="next"></div>
        </div></div>
        <div class="rd-prog"><div class="rd-bar"><i></i></div>
          <div class="rd-meta"><span class="ch">—</span><span class="pct">0 %</span></div></div>
      </div>`;
    this.frame = this.host.querySelector('iframe');
    this.fill = this.host.querySelector('.rd-bar > i');
    this.pct = this.host.querySelector('.rd-meta .pct');
    this.chl = this.host.querySelector('.rd-meta .ch');
    this.host.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'next') this.next(); else if (a === 'prev') this.prev();
      else if (a === 'toc') this.openToc(); else if (a === 'settings') this.openSettings();
    });
    this.scrim = document.createElement('div'); this.scrim.className = 'rd-scrim';
    this.drawer = document.createElement('div'); this.drawer.className = 'rd-drawer';
    const toc = (this.book.toc.length ? this.book.toc : this.book.spine.map((h, i) => ({ label: 'Abschnitt ' + (i + 1), href: h })));
    this.drawer.innerHTML = `<h3>Inhalt</h3><div class="rd-toc">` + toc.map(t => {
      const si = this.book.spine.indexOf(t.href); return `<button class="rd-tocitem" data-i="${si}">${esc(t.label)}</button>`;
    }).join('') + `</div>`;
    this.settings = document.createElement('div'); this.settings.className = 'rd-sheet';
    document.body.append(this.scrim, this.drawer, this.settings);
    this.scrim.onclick = () => this.closeOverlays();
    this.drawer.querySelectorAll('.rd-tocitem').forEach(b => b.onclick = () => { this.closeOverlays(); const i = +b.dataset.i; if (i >= 0) { this.view.targetBlock = 0; this.renderSpine(i); } });
    this._key = (e) => { if (e.key === 'ArrowRight') this.next(); else if (e.key === 'ArrowLeft') this.prev(); };
    document.addEventListener('keydown', this._key);
    this._resize = () => { clearTimeout(this._rt); this._rt = setTimeout(() => { this.view.targetBlock = this.view.blockIndex; this.layout(); }, 200); };
    window.addEventListener('resize', this._resize);
    this._statsTimer = setInterval(() => { if (document.visibilityState === 'visible' && this.core.trackTime) this.core.trackTime(1); }, 1000);
  }
  async buildSpineContent(i) {
    if (this.docCache.has(i)) return this.docCache.get(i);
    const path = this.book.spine[i], base = dirname(path);
    const doc = new DOMParser().parseFromString(await zipText(this.book.zip, path), 'application/xhtml+xml');
    // Bilder -> Blob
    for (const img of [...doc.querySelectorAll('img[src], image')]) {
      const raw = img.getAttribute('src') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!raw || /^(data|blob|https?):/.test(raw)) continue;
      const rp = resolvePath(base, raw), b = await zipBytes(this.book.zip, rp);
      if (b) { const url = URL.createObjectURL(new Blob([b], { type: guessMime(rp) })); this.blobUrls.push(url);
        if (img.hasAttribute('src')) img.setAttribute('src', url); else img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url); }
    }
    // Verlags-CSS (inkl. Fonts) einsammeln
    let bookCss = '';
    if (this.prefs.publisherCss) {
      doc.querySelectorAll('style').forEach(s => bookCss += '\n' + s.textContent);
      for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
        const rp = resolvePath(base, link.getAttribute('href'));
        const css = await zipText(this.book.zip, rp).catch(() => null);
        if (css) bookCss += '\n' + await this.rewriteCssUrls(css, dirname(rp));
      }
    }
    // Block-Locator-Marken setzen
    let bki = 0;
    doc.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,figure,img').forEach(el => el.setAttribute('data-bk', bki++));
    const out = { inner: doc.body ? doc.body.innerHTML : '', bookCss };
    this.docCache.set(i, out);
    return out;
  }
  async rewriteCssUrls(cssText, cssDir) {
    const urls = [...cssText.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)];
    for (const m of urls) {
      const raw = m[1]; if (/^(data|blob|https?):/.test(raw)) continue;
      const rp = resolvePath(cssDir, raw); const bytes = await zipBytes(this.book.zip, rp).catch(() => null);
      if (bytes) { const url = URL.createObjectURL(new Blob([bytes], { type: guessMime(rp) })); this.blobUrls.push(url);
        cssText = cssText.split(m[0]).join(`url("${url}")`); }
    }
    return cssText;
  }
  async renderSpine(i) {
    i = Math.max(0, Math.min(i, this.book.spine.length - 1));
    this.view.spineIndex = i;
    const { inner, bookCss } = await this.buildSpineContent(i);
    this.frame.srcdoc = pageDoc(inner, this.prefs.fontPx, this.prefs.lead, this.serif, this.prefs.theme, this.prefs.publisherCss, bookCss);
    await new Promise(res => { this.frame.onload = res; setTimeout(res, 1400); });
    this.layout();
  }
  layout() {
    const d = this.frame.contentDocument; if (!d) return;
    const r = this.host.querySelector('.rd-page').getBoundingClientRect();
    const padX = 26, padY = 24, W = Math.floor(r.width), H = Math.floor(r.height);
    this.frame.style.height = H + 'px';
    const colW = W - padX * 2, colH = H - padY * 2, gap = padX * 2;
    const vp = d.getElementById('vp'), bk = d.getElementById('bk');
    vp.style.cssText = `width:${W}px;height:${H}px;padding:${padY}px ${padX}px;box-sizing:border-box`;
    bk.style.height = colH + 'px'; bk.style.columnWidth = colW + 'px'; bk.style.columnGap = gap + 'px';
    const step = colW + gap; this.view.step = step;
    bk.style.transition = 'none'; bk.style.transform = 'translateX(0)';
    this.view.total = Math.max(1, Math.round(bk.scrollWidth / step));
    // Block -> Seite kartieren (für robusten Locator)
    const bkLeft = bk.getBoundingClientRect().left;
    this.blockPages = [...d.querySelectorAll('[data-bk]')].map(el => ({
      bk: +el.dataset.bk, page: Math.max(0, Math.round((el.getBoundingClientRect().left - bkLeft) / step)),
    }));
    if (this.view.targetBlock != null) {
      const tgt = this.view.targetBlock; this.view.targetBlock = null;
      if (tgt === -1) { this.view.page = this.view.total - 1; }
      else { const e = this.blockPages.find(b => b.bk === tgt); this.view.page = e ? Math.min(e.page, this.view.total - 1) : 0; this._jumpedBlock = tgt; }
    } else this.view.page = Math.max(0, Math.min(this.view.page, this.view.total - 1));
    requestAnimationFrame(() => { bk.style.transition = 'transform .25s ease'; this.applyPage(); });
  }
  applyPage() {
    const d = this.frame.contentDocument; if (!d) return;
    d.getElementById('bk').style.transform = `translateX(${-this.view.page * this.view.step}px)`;
    const frac = (this.view.spineIndex + (this.view.page + 1) / this.view.total) / this.book.spine.length;
    this.fill.style.width = Math.round(frac * 100) + '%'; this.pct.textContent = Math.round(frac * 100) + ' %';
    let lab = ''; for (const t of this.book.toc) { const si = this.book.spine.indexOf(t.href); if (si >= 0 && si <= this.view.spineIndex) lab = t.label; }
    this.chl.textContent = lab || `Abschnitt ${this.view.spineIndex + 1}/${this.book.spine.length}`;
    this.drawer?.querySelectorAll('.rd-tocitem').forEach(elm => elm.classList.toggle('cur', +elm.dataset.i === this.view.spineIndex));
    this.save();
  }
  next() { if (this.view.page < this.view.total - 1) { this.view.page++; this.applyPage(); } else if (this.view.spineIndex < this.book.spine.length - 1) { this.view.targetBlock = 0; this.renderSpine(this.view.spineIndex + 1); } }
  prev() { if (this.view.page > 0) { this.view.page--; this.applyPage(); } else if (this.view.spineIndex > 0) { this.view.targetBlock = -1; this.renderSpine(this.view.spineIndex - 1); } }
  openToc() { this.scrim.classList.add('show'); this.drawer.classList.add('show'); }
  closeOverlays() { this.scrim.classList.remove('show'); this.drawer.classList.remove('show'); this.settings.classList.remove('show'); }
  openSettings() {
    const FONTS = [16, 18, 19, 21, 24], LEADS = [1.4, 1.6, 1.8], TH = [['Dunkel', 'dark'], ['Sepia', 'sepia'], ['Hell', 'light']];
    const seg = (arr, cur, key, fmt) => `<div class="rd-seg">` + arr.map(v => { const val = Array.isArray(v) ? v[1] : v; const lab = Array.isArray(v) ? v[0] : fmt(v);
      return `<button data-key="${key}" data-v="${val}" class="${val == cur ? 'active' : ''}">${lab}</button>`; }).join('') + `</div>`;
    this.settings.innerHTML = `<div class="rd-handle"></div>
      <h4>Schriftgröße</h4><div class="rd-row">${seg(FONTS, this.prefs.fontPx, 'fontPx', v => v)}</div>
      <h4>Zeilenabstand</h4><div class="rd-row">${seg(LEADS, this.prefs.lead, 'lead', v => v.toFixed(1))}</div>
      <h4>Thema</h4><div class="rd-row">${seg(TH, this.prefs.theme, 'theme', v => v)}</div>
      <h4>Layout</h4><div class="rd-row"><span>Verlagslayout (Schriften &amp; CSS)</span><button class="rd-tog ${this.prefs.publisherCss ? 'on' : ''}" data-key="publisherCss"></button></div>`;
    this.settings.querySelectorAll('.rd-seg button').forEach(b => b.onclick = () => {
      const key = b.dataset.key; let v = b.dataset.v; if (key === 'fontPx') v = +v; else if (key === 'lead') v = +v;
      this.changePref(key, v);
    });
    this.settings.querySelector('.rd-tog').onclick = (e) => this.changePref('publisherCss', !e.target.classList.contains('on'));
    this.scrim.classList.add('show'); this.settings.classList.add('show');
  }
  async changePref(key, val) {
    this.prefs = await setReaderPrefs({ [key]: val });
    if (key === 'publisherCss') this.docCache.clear(); // CSS-Aufbereitung neu
    this.view.targetBlock = this.view.blockIndex;       // Position halten
    await this.renderSpine(this.view.spineIndex);
    this.openSettings(); // Sheet-Zustand aktualisieren
  }
  save() {
    let bk = 0;
    if (this._jumpedBlock != null) { bk = this._jumpedBlock; this._jumpedBlock = null; }
    else if (this.blockPages && this.blockPages.length) {
      const onPage = this.blockPages.filter(b => b.page === this.view.page);
      const e = onPage[0] || this.blockPages.filter(b => b.page <= this.view.page).pop() || this.blockPages[0];
      bk = e.bk;
    }
    this.view.blockIndex = bk;
    const frac = (this.view.spineIndex + (this.view.page + 1) / this.view.total) / this.book.spine.length;
    this.core.saveProgress(this.item, { spineIndex: this.view.spineIndex, blockIndex: bk, percent: Math.round(frac * 100) });
  }
  destroy() {
    document.removeEventListener('keydown', this._key);
    window.removeEventListener('resize', this._resize);
    clearInterval(this._statsTimer);
    this.scrim?.remove(); this.drawer?.remove(); this.settings?.remove();
    this.blobUrls.forEach(u => URL.revokeObjectURL(u));
    this.host.innerHTML = '';
  }
}

export default {
  id: 'reader', label: 'Buch', badge: 'EPUB',
  pick: { accept: '.epub,application/epub+zip', multiple: false },
  accepts(file) { return /\.epub$/i.test(file.name) || file.type === 'application/epub+zip'; },
  async createItem(files, core) {
    const file = files[0];
    const u8 = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseEpub(u8);
    const id = uid();
    await db.putMedia(`${id}:0`, file);
    if (parsed.coverHref) {
      const cb = await zipBytes(parsed.zip, parsed.coverHref);
      if (cb) await db.putCover(id, new Blob([cb], { type: guessMime(parsed.coverHref) }));
    }
    const item = {
      id, type: 'reader', title: parsed.title, author: parsed.author,
      toc: parsed.toc.map(t => t.label), parts: [{ idx: 0, mime: 'application/epub+zip' }],
      progress: { spineIndex: 0, blockIndex: 0, percent: 0, updatedAt: 0 }, createdAt: Date.now(),
    };
    await db.putItem(item);
    return item;
  },
  async mount(item, stageEl, core) { const inst = new ReaderInstance(item, stageEl, core); await inst.start(); return inst; },
};
