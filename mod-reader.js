/* ============================================================
   esc//shelf — Reader-Modul (EPUB), Vanilla
   Implementiert den MediaModule-Contract.
   ============================================================ */
import { db, uid, esc } from './core.js';

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
    const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
    entries[name] = { method, compSize, localOff };
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
function mimeFor(path) {
  const e = path.split('.').pop().toLowerCase();
  return e === 'png' ? 'image/png' : e === 'gif' ? 'image/gif' : e === 'svg' ? 'image/svg+xml' : 'image/jpeg';
}

/* ---------- Reader-Oberfläche ---------- */
const READER_CSS = `
.rd{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}
.rd-top{display:flex;align-items:center;gap:8px;padding:6px 4px}
.rd-top .t{flex:1;font-family:var(--serif);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-ic{width:36px;height:36px;border-radius:9px;display:grid;place-items:center;color:var(--txt-dim)}
.rd-ic:hover{background:var(--bg2);color:var(--txt)}.rd-ic svg{width:19px;height:19px}
.rd-stage{flex:1;position:relative;min-height:0;display:flex;justify-content:center}
.rd-page{position:relative;width:100%;max-width:680px;background:var(--paper);border-radius:12px;overflow:hidden;
  box-shadow:0 10px 38px rgba(0,0,0,.45),0 0 0 1px var(--line-soft);border-left:2px solid var(--amber)}
.rd-page iframe{border:0;width:100%;height:100%;display:block;background:var(--paper)}
.rd-z{position:absolute;top:0;bottom:0;width:34%;z-index:3}.rd-z.l{left:0}.rd-z.r{right:0}
.rd-prog{padding:10px 6px 4px}
.rd-bar{height:4px;border-radius:99px;background:var(--line);overflow:hidden}
.rd-bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--amber),var(--amber-hi));transition:width .25s}
.rd-meta{display:flex;justify-content:space-between;margin-top:6px;font-family:var(--mono);font-size:11px;color:var(--txt-dim)}
.rd-drawer{position:fixed;top:0;left:0;bottom:0;width:84%;max-width:340px;background:var(--bg2);z-index:60;
  transform:translateX(-100%);transition:transform .28s cubic-bezier(.32,.72,0,1);padding:20px 0;display:flex;flex-direction:column;border-right:1px solid var(--line)}
.rd-drawer.show{transform:none}.rd-drawer h3{font-family:var(--serif);font-weight:500;margin:0 20px 12px}
.rd-toc{overflow:auto;flex:1}.rd-tocitem{display:block;width:100%;text-align:left;padding:13px 20px;font-size:14px;color:var(--txt-dim);background:none;border:none}
.rd-tocitem.cur{color:var(--amber-hi);background:var(--amber-dim)}
.rd-scrim{position:fixed;inset:0;background:rgba(6,8,11,.6);opacity:0;pointer-events:none;transition:.25s;z-index:59}
.rd-scrim.show{opacity:1;pointer-events:auto}
`;

function pageDoc(inner, fontPx, lead, serif) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#171310;color:#e9e0d2}#vp{overflow:hidden}
    #bk{column-fill:auto;font-family:${serif};font-size:${fontPx}px;line-height:${lead};text-align:justify;hyphens:auto;-webkit-hyphens:auto;color:#e9e0d2}
    #bk p{margin:0 0 .9em}#bk h1,#bk h2,#bk h3{font-weight:600;line-height:1.2;color:#f0e7d8}
    #bk img{max-width:100%;height:auto;display:block;margin:.6em auto}#bk a{color:#e0a458;text-decoration:none}
    ::selection{background:rgba(224,164,88,.3)}
  </style></head><body><div id="vp"><div id="bk">${inner}</div></div></body></html>`;
}

class ReaderInstance {
  constructor(item, stageEl, core) {
    this.item = item; this.core = core; this.host = stageEl;
    this.view = { spineIndex: item.progress?.spineIndex || 0, page: 0, total: 1, step: 0, fontPx: 19, lead: 1.6 };
    this.blobUrls = [];
    this.serif = getComputedStyle(document.documentElement).getPropertyValue('--serif').trim() || 'Georgia, serif';
  }
  async start() {
    const rec = await db.getMedia(`${this.item.id}:0`);
    if (!rec) throw new Error('EPUB-Daten fehlen');
    this.book = await parseEpub(new Uint8Array(await rec.blob.arrayBuffer()));
    this.buildDOM();
    await this.renderSpine(this.view.spineIndex, false);
  }
  buildDOM() {
    if (!document.getElementById('rd-style')) {
      const st = document.createElement('style'); st.id = 'rd-style'; st.textContent = READER_CSS; document.head.appendChild(st);
    }
    this.host.innerHTML = `
      <div class="rd">
        <div class="rd-top">
          <button class="rd-ic" data-act="toc" aria-label="Inhalt"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
          <div class="t">${esc(this.book.title)}</div>
          <button class="rd-ic" data-act="font" aria-label="Schrift"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7V5h14v2M9 19h6M12 5v14"/></svg></button>
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
      else if (a === 'toc') this.openToc(); else if (a === 'font') this.cycleFont();
    });
    // TOC-Drawer + Scrim
    this.scrim = document.createElement('div'); this.scrim.className = 'rd-scrim';
    this.drawer = document.createElement('div'); this.drawer.className = 'rd-drawer';
    const toc = (this.book.toc.length ? this.book.toc : this.book.spine.map((h, i) => ({ label: 'Abschnitt ' + (i + 1), href: h })));
    this.drawer.innerHTML = `<h3>Inhalt</h3><div class="rd-toc">` + toc.map(t => {
      const si = this.book.spine.indexOf(t.href);
      return `<button class="rd-tocitem" data-i="${si}">${esc(t.label)}</button>`;
    }).join('') + `</div>`;
    document.body.append(this.scrim, this.drawer);
    this.scrim.onclick = () => this.closeToc();
    this.drawer.querySelectorAll('.rd-tocitem').forEach(b => b.onclick = () => { this.closeToc(); const i = +b.dataset.i; if (i >= 0) this.renderSpine(i, false); });
    this._key = (e) => { if (e.key === 'ArrowRight') this.next(); else if (e.key === 'ArrowLeft') this.prev(); };
    document.addEventListener('keydown', this._key);
    this._resize = () => { clearTimeout(this._rt); this._rt = setTimeout(() => this.layout(false), 200); };
    window.addEventListener('resize', this._resize);
  }
  async renderSpine(i, toLast) {
    i = Math.max(0, Math.min(i, this.book.spine.length - 1));
    this.view.spineIndex = i;
    const path = this.book.spine[i], base = dirname(path);
    const doc = new DOMParser().parseFromString(await zipText(this.book.zip, path), 'application/xhtml+xml');
    for (const img of [...doc.querySelectorAll('img[src], image')]) {
      const raw = img.getAttribute('src') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!raw || /^(data|blob|https?):/.test(raw)) continue;
      const rp = resolvePath(base, raw), b = await zipBytes(this.book.zip, rp);
      if (b) { const url = URL.createObjectURL(new Blob([b], { type: mimeFor(rp) })); this.blobUrls.push(url);
        if (img.hasAttribute('src')) img.setAttribute('src', url); else img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url); }
    }
    this.frame.srcdoc = pageDoc(doc.body ? doc.body.innerHTML : '', this.view.fontPx, this.view.lead, this.serif);
    await new Promise(res => { this.frame.onload = res; setTimeout(res, 1200); });
    this.layout(toLast);
    this.save();
  }
  layout(toLast) {
    const d = this.frame.contentDocument; if (!d) return;
    const r = this.host.querySelector('.rd-page').getBoundingClientRect();
    const padX = 26, padY = 24, W = Math.floor(r.width), H = Math.floor(r.height);
    this.frame.style.height = H + 'px';
    const colW = W - padX * 2, colH = H - padY * 2, gap = padX * 2;
    const vp = d.getElementById('vp'), bk = d.getElementById('bk');
    vp.style.cssText = `width:${W}px;height:${H}px;padding:${padY}px ${padX}px;box-sizing:border-box`;
    bk.style.height = colH + 'px'; bk.style.columnWidth = colW + 'px'; bk.style.columnGap = gap + 'px'; bk.style.transition = 'transform .25s ease';
    this.view.step = colW + gap;
    this.view.total = Math.max(1, Math.round(bk.scrollWidth / this.view.step));
    this.view.page = toLast ? this.view.total - 1 : 0;
    this.applyPage();
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
  next() { if (this.view.page < this.view.total - 1) { this.view.page++; this.applyPage(); } else if (this.view.spineIndex < this.book.spine.length - 1) this.renderSpine(this.view.spineIndex + 1, false); }
  prev() { if (this.view.page > 0) { this.view.page--; this.applyPage(); } else if (this.view.spineIndex > 0) this.renderSpine(this.view.spineIndex - 1, true); }
  cycleFont() { const opts = [16, 18, 19, 21, 24]; this.view.fontPx = opts[(opts.indexOf(this.view.fontPx) + 1) % opts.length]; this.renderSpine(this.view.spineIndex, false); }
  openToc() { this.scrim.classList.add('show'); this.drawer.classList.add('show'); }
  closeToc() { this.scrim.classList.remove('show'); this.drawer.classList.remove('show'); }
  save() {
    const frac = (this.view.spineIndex + (this.view.page + 1) / this.view.total) / this.book.spine.length;
    this.core.saveProgress(this.item, { spineIndex: this.view.spineIndex, page: this.view.page, percent: Math.round(frac * 100) });
  }
  destroy() {
    document.removeEventListener('keydown', this._key);
    window.removeEventListener('resize', this._resize);
    this.scrim?.remove(); this.drawer?.remove();
    this.blobUrls.forEach(u => URL.revokeObjectURL(u));
    this.host.innerHTML = '';
  }
}

/* ---------- Modul-Export (Contract) ---------- */
export default {
  id: 'reader', label: 'Buch', badge: 'EPUB',
  accepts(file) { return /\.epub$/i.test(file.name) || file.type === 'application/epub+zip'; },
  async createItem(files, core) {
    const file = files[0];
    const u8 = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseEpub(u8);
    const id = uid();
    await db.putMedia(`${id}:0`, file);
    if (parsed.coverHref) {
      const cb = await zipBytes(parsed.zip, parsed.coverHref);
      if (cb) await db.putCover(id, new Blob([cb], { type: mimeFor(parsed.coverHref) }));
    }
    const item = {
      id, type: 'reader', title: parsed.title, author: parsed.author,
      toc: parsed.toc.map(t => t.label), parts: [{ idx: 0, mime: 'application/epub+zip' }],
      progress: { spineIndex: 0, page: 0, percent: 0, updatedAt: 0 }, createdAt: Date.now(),
    };
    await db.putItem(item);
    return item;
  },
  async mount(item, stageEl, core) {
    const inst = new ReaderInstance(item, stageEl, core);
    await inst.start();
    return inst;
  },
};
