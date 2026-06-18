/* ============================================================
   esc//shelf — Audio-Modul (Schnitt 2: Feature-Parität)
   Tempo pro Buch · Sleep-Timer (inkl. Kapitelende) · Lesezeichen
   · Media Session (Lockscreen) · hintergrundfähig (Mini-Player)
   ============================================================ */
import { db, uid, esc, fmt, coverURL } from './core.js';

const AudioMeta = () => window.AudioMeta;
function probeDuration(file) {
  return new Promise((res) => {
    const a = document.createElement('audio'); const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); a.remove(); res(v); };
    a.preload = 'metadata'; a.src = url;
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0); setTimeout(() => done(0), 5000);
  });
}
const naturalSort = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
const mediaOf = (c) => (c && c.mediaIndex) | 0;
const chStart = (c) => (c && c.start) || 0;
const chDur = (c) => (c && c.duration) || 0;

const PLAYER_CSS = `
.au{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;padding:4px}
.au-cover{width:min(54vw,230px);aspect-ratio:1;border-radius:14px;overflow:hidden;background:var(--bg2);
  margin:6px auto 12px;box-shadow:0 12px 40px rgba(0,0,0,.5);border:1px solid var(--line);flex:none}
.au-cover img{width:100%;height:100%;object-fit:cover}
.au-cover .ph{width:100%;height:100%;display:grid;place-items:center;font-family:var(--serif);color:var(--txt-faint);padding:18px;text-align:center}
.au-title{font-family:var(--serif);font-size:19px;text-align:center;margin:0 8px}
.au-auth{color:var(--txt-dim);font-size:13px;text-align:center;margin:2px 0 4px}
.au-chap{color:var(--amber-hi);font-family:var(--mono);font-size:12px;text-align:center;margin-bottom:6px}
.au-scrub{width:100%;max-width:560px;margin:0 auto;display:block}.au-scrub input{width:100%}
.au-times{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--txt-dim);max-width:560px;margin:2px auto 0}
.au-chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:10px 0 2px}
.au-chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--txt-dim);background:var(--bg2);border:1px solid var(--line);border-radius:99px;padding:7px 13px}
.au-chip.on{border-color:var(--amber);color:var(--amber-hi);background:var(--amber-dim)}
.au-tp{display:flex;align-items:center;justify-content:center;gap:16px;margin:12px 0 4px}
.au-b{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:var(--txt);background:var(--bg2);border:1px solid var(--line)}
.au-b.main{width:62px;height:62px;background:var(--amber);color:#1a1208;border:none}
.au-b svg{width:22px;height:22px}.au-b.main svg{width:27px;height:27px}
.au-list{flex:1;overflow:auto;margin-top:6px;border-top:1px solid var(--line-soft)}
.au-ci{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:11px 8px;background:none;border:none;color:var(--txt-dim);font-size:14px;border-bottom:1px solid var(--line-soft)}
.au-ci.cur{color:var(--amber-hi)}.au-ci .d{font-family:var(--mono);font-size:12px;color:var(--txt-faint)}
.au-scrim{position:fixed;inset:0;background:rgba(6,8,11,.6);opacity:0;pointer-events:none;transition:.25s;z-index:69}
.au-scrim.show{opacity:1;pointer-events:auto}
.au-sheet{position:fixed;left:0;right:0;bottom:0;z-index:70;background:var(--bg2);border-top:1px solid var(--line);
  border-radius:20px 20px 0 0;padding:14px 20px calc(22px + var(--safe-b));max-width:560px;margin:0 auto;
  transform:translateY(100%);transition:transform .28s cubic-bezier(.32,.72,0,1)}
.au-sheet.show{transform:none}.au-sheet h3{font-family:var(--serif);font-weight:500;margin:2px 0 12px}
.au-opt{display:flex;width:100%;justify-content:space-between;align-items:center;padding:13px 12px;border:none;background:none;color:var(--txt);font-size:15px;border-radius:10px}
.au-opt:hover{background:var(--bg)}.au-opt.on{color:var(--amber-hi)}
.au-bm{display:flex;justify-content:space-between;gap:10px;width:100%;padding:12px 10px;border:none;background:none;color:var(--txt);text-align:left;border-bottom:1px solid var(--line-soft)}
.au-bm .m{color:var(--txt-dim);font-family:var(--mono);font-size:11px}
.au-bm .del{color:var(--txt-faint);padding:0 6px}
`;
const ICON = {
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14l-10-7z"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l10 7-10 7z"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 7l-5 5 5 5M6 12h9a4 4 0 0 1 0 8h-1"/></svg>',
  fwd:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7l5 5-5 5M18 12H9a4 4 0 0 0 0 8h1"/></svg>',
};

class AudioInstance {
  constructor(item, host, core) {
    this.item = item; this.host = host; this.core = core;
    this.audio = new Audio(); this.audio.preload = 'metadata';
    this.chapter = item.progress?.chapterIndex || 0;
    this.mediaIndex = -1; this.url = null;
    this.rate = item.settings?.rate || 1;
    this.sleep = { mins: 0, endChap: false, until: 0 };
    this.overlays = [];
    this.coverUrl = null;
    this.onState = null; // von der Shell gesetzt (Mini-Player)
  }
  async start() {
    if (!document.getElementById('au-style')) { const s = document.createElement('style'); s.id = 'au-style'; s.textContent = PLAYER_CSS; document.head.appendChild(s); }
    this.coverUrl = await coverURL(this.item.id);
    this.host.innerHTML = `
      <div class="au">
        <div class="au-cover">${this.coverUrl ? `<img src="${this.coverUrl}">` : `<div class="ph">${esc(this.item.title)}</div>`}</div>
        <div class="au-title">${esc(this.item.title)}</div>
        <div class="au-auth">${esc(this.item.author || 'Unbekannt')}</div>
        <div class="au-chap"></div>
        <div class="au-scrub"><input type="range" min="0" max="1000" value="0"></div>
        <div class="au-times"><span class="cur">0:00</span><span class="tot">0:00</span></div>
        <div class="au-chips">
          <button class="au-chip" data-a="speed">1.0×</button>
          <button class="au-chip" data-a="sleep">Sleep</button>
          <button class="au-chip" data-a="mark">＋ Merken</button>
          <button class="au-chip" data-a="bmlist">Lesezeichen</button>
        </div>
        <div class="au-tp">
          <button class="au-b" data-a="prev">${ICON.prev}</button>
          <button class="au-b" data-a="back">${ICON.back}</button>
          <button class="au-b main" data-a="toggle">${ICON.play}</button>
          <button class="au-b" data-a="fwd">${ICON.fwd}</button>
          <button class="au-b" data-a="next">${ICON.next}</button>
        </div>
        <div class="au-list"></div>
      </div>`;
    this.elChap = this.host.querySelector('.au-chap');
    this.elScrub = this.host.querySelector('.au-scrub input');
    this.elCur = this.host.querySelector('.cur'); this.elTot = this.host.querySelector('.tot');
    this.elMain = this.host.querySelector('[data-a="toggle"]');
    this.elSpeed = this.host.querySelector('[data-a="speed"]');
    this.elSleep = this.host.querySelector('[data-a="sleep"]');
    this.audio.style.display = 'none'; this.host.appendChild(this.audio);
    this.host.querySelectorAll('.au-chips [data-a], .au-tp [data-a]').forEach(b => b.onclick = () => this.action(b.dataset.a));
    this.elScrub.addEventListener('input', () => { this.scrubbing = true; });
    this.elScrub.addEventListener('change', () => { this.applyScrub(); this.scrubbing = false; });
    this.renderList();
    this.elSpeed.textContent = this.rate.toFixed(1) + '×';
    this.elSpeed.classList.toggle('on', this.rate !== 1);
    this.audio.addEventListener('timeupdate', () => this.onTime());
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('play', () => { this.elMain.innerHTML = ICON.pause; this.setSession(); this.onState && this.onState(); });
    this.audio.addEventListener('pause', () => { this.elMain.innerHTML = ICON.play; this.onState && this.onState(); });
    await this.loadChapter(this.chapter, this.item.progress?.position || 0, false);
    this.setSession();
  }
  action(a) {
    if (a === 'toggle') this.toggle();
    else if (a === 'prev') this.prev(); else if (a === 'next') this.next();
    else if (a === 'back') this.seek(-15); else if (a === 'fwd') this.seek(30);
    else if (a === 'speed') this.cycleSpeed();
    else if (a === 'sleep') this.openSleep();
    else if (a === 'mark') this.addBookmark();
    else if (a === 'bmlist') this.openBookmarks();
  }
  toggle() { this.audio.paused ? this.audio.play().catch(()=>{}) : this.audio.pause(); }
  isPlaying() { return !this.audio.paused; }
  meta() { return { title: this.item.title, author: this.item.author, cover: this.coverUrl, playing: !this.audio.paused }; }

  renderList() {
    const list = this.host.querySelector('.au-list');
    list.innerHTML = this.item.toc.map((c, i) =>
      `<button class="au-ci ${i === this.chapter ? 'cur' : ''}" data-i="${i}"><span>${esc(c.name)}</span><span class="d">${fmt(chDur(c))}</span></button>`).join('');
    list.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.loadChapter(+b.dataset.i, 0, true));
  }
  async loadChapter(i, within, autoplay) {
    const toc = this.item.toc;
    i = Math.max(0, Math.min(i, toc.length - 1)); this.chapter = i;
    const ch = toc[i], mi = mediaOf(ch);
    if (mi !== this.mediaIndex) {
      const rec = await db.getMedia(`${this.item.id}:${mi}`); if (!rec) return;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(rec.blob); this.mediaIndex = mi;
      this.audio.src = this.url; this.audio.defaultPlaybackRate = this.rate; this.audio.playbackRate = this.rate; this.audio.load();
      await new Promise(r => { const ok = () => { this.audio.removeEventListener('loadedmetadata', ok); r(); }; this.audio.addEventListener('loadedmetadata', ok); setTimeout(r, 4000); });
      this.audio.playbackRate = this.rate;
    }
    const target = chStart(ch) + Math.max(0, within);
    if (isFinite(this.audio.duration)) this.audio.currentTime = Math.min(target, this.audio.duration - 0.25); else this.audio.currentTime = target;
    if (autoplay) this.audio.play().catch(() => {});
    this.syncChapter();
  }
  chapterAtTime(t) { let idx = this.chapter; for (let i = 0; i < this.item.toc.length; i++) { const c = this.item.toc[i]; if (mediaOf(c) !== this.mediaIndex) continue; if (t >= chStart(c) - 0.05) idx = i; } return idx; }
  onTime() {
    if (!this.scrubbing) this.paintScrub();
    const idx = this.chapterAtTime(this.audio.currentTime || 0);
    if (idx !== this.chapter) { this.chapter = idx; this.syncChapter(); }
    this.checkSleep();
    if (Date.now() - (this._save || 0) > 4000) { this._save = Date.now(); this.persist(); }
  }
  syncChapter() {
    const ch = this.item.toc[this.chapter];
    this.elChap.textContent = `Kapitel ${this.chapter + 1}/${this.item.toc.length} · ${ch.name}`;
    this.host.querySelectorAll('.au-ci').forEach(elm => elm.classList.toggle('cur', +elm.dataset.i === this.chapter));
    this.paintScrub(); this.persist(); this.setSession();
  }
  geom() { const ch = this.item.toc[this.chapter]; const start = chStart(ch); const fd = isFinite(this.audio.duration) ? this.audio.duration : 0; return { start, dur: chDur(ch) || Math.max(0, fd - start) }; }
  paintScrub() { const { start, dur } = this.geom(); const cur = Math.max(0, (this.audio.currentTime || 0) - start); this.elScrub.value = dur > 0 ? Math.min(1000, cur / dur * 1000) : 0; this.elCur.textContent = fmt(cur); this.elTot.textContent = '-' + fmt(Math.max(0, dur - cur)); }
  applyScrub() { const { start, dur } = this.geom(); if (dur > 0 && isFinite(this.audio.duration)) this.audio.currentTime = Math.min(start + this.elScrub.value / 1000 * dur, this.audio.duration - 0.05); }
  seek(d) { if (!isFinite(this.audio.duration)) return; this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + d)); this.onTime(); }
  prev() { const ch = this.item.toc[this.chapter]; if ((this.audio.currentTime || 0) - chStart(ch) > 3) { this.audio.currentTime = chStart(ch); } else if (this.chapter > 0) this.loadChapter(this.chapter - 1, 0, !this.audio.paused); }
  next() { if (this.chapter < this.item.toc.length - 1) this.loadChapter(this.chapter + 1, 0, !this.audio.paused); else this.audio.pause(); }
  persist() { const ch = this.item.toc[this.chapter]; const within = Math.max(0, (this.audio.currentTime || 0) - chStart(ch)); this.core.saveProgress(this.item, { chapterIndex: this.chapter, position: within }); }

  /* Tempo (pro Buch) */
  cycleSpeed() {
    const opts = [0.8, 1.0, 1.2, 1.5, 1.7, 2.0];
    this.rate = opts[(opts.indexOf(this.rate) + 1) % opts.length];
    this.audio.defaultPlaybackRate = this.rate; this.audio.playbackRate = this.rate;
    this.elSpeed.textContent = this.rate.toFixed(1) + '×'; this.elSpeed.classList.toggle('on', this.rate !== 1);
    this.item.settings = Object.assign({}, this.item.settings, { rate: this.rate }); db.putItem(this.item);
  }

  /* Sleep-Timer */
  openSleep() {
    const opts = [['Aus', 0, false], ['15 Min', 15, false], ['30 Min', 30, false], ['45 Min', 45, false], ['Ende des Kapitels', 0, true]];
    const sh = this.sheet('Sleep-Timer', opts.map(([l, m, e], i) =>
      `<button class="au-opt ${(this.sleep.mins === m && this.sleep.endChap === e && (m || e || (!this.sleep.mins && !this.sleep.endChap && i === 0))) ? 'on' : ''}" data-m="${m}" data-e="${e}">${l}</button>`).join(''));
    sh.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { this.setSleep(+b.dataset.m, b.dataset.e === 'true'); this.closeSheets(); });
  }
  setSleep(mins, endChap) {
    this.sleep.mins = mins; this.sleep.endChap = endChap;
    this.sleep.until = mins ? Date.now() + mins * 60000 : 0;
    if (endChap) { const ch = this.item.toc[this.chapter]; this.sleep.endTime = chStart(ch) + chDur(ch); this.sleep.endMedia = mediaOf(ch); }
    else { this.sleep.endTime = 0; }
    const active = !!mins || endChap;
    this.elSleep.classList.toggle('on', active);
    this.elSleep.textContent = endChap ? 'Sleep · Kap.' : (mins ? `Sleep · ${mins}m` : 'Sleep');
    if (active && this.audio.paused) this.audio.play().catch(()=>{});
  }
  checkSleep() {
    if (this.sleep.until && Date.now() >= this.sleep.until) { this.setSleep(0, false); this.audio.pause(); this.core.toast?.('Sleep-Timer abgelaufen'); return; }
    if (this.sleep.endChap && this.sleep.endTime && this.mediaIndex === this.sleep.endMedia &&
        (this.audio.currentTime || 0) >= this.sleep.endTime - 0.2) {
      const stop = this.sleep.endTime; this.setSleep(0, false);
      if (isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(stop, this.audio.duration - 0.05));
      this.audio.pause(); this.core.toast?.('Sleep-Timer: Kapitelende');
    }
  }

  /* Lesezeichen */
  addBookmark() {
    const ch = this.item.toc[this.chapter]; const within = Math.max(0, (this.audio.currentTime || 0) - chStart(ch));
    this.item.bookmarks = this.item.bookmarks || [];
    this.item.bookmarks.push({ chapterIndex: this.chapter, position: within, label: `${ch.name} · ${fmt(within)}`, at: Date.now() });
    db.putItem(this.item); this.core.toast?.('Lesezeichen gesetzt');
  }
  openBookmarks() {
    const bms = this.item.bookmarks || [];
    const body = bms.length ? bms.map((b, i) => `<button class="au-bm" data-i="${i}"><span>${esc(b.label)}</span><span class="del" data-del="${i}">✕</span></button>`).join('') : `<div style="color:var(--txt-faint);padding:18px 6px;font-size:14px">Noch keine Lesezeichen.</div>`;
    const sh = this.sheet('Lesezeichen', body);
    sh.querySelectorAll('.au-bm').forEach(b => b.onclick = (e) => {
      if (e.target.dataset.del != null) { this.item.bookmarks.splice(+e.target.dataset.del, 1); db.putItem(this.item); this.closeSheets(); return; }
      const bm = this.item.bookmarks[+b.dataset.i]; this.closeSheets(); this.loadChapter(bm.chapterIndex, bm.position, true);
    });
  }

  /* generische Sheets */
  sheet(title, innerHtml) {
    const scrim = document.createElement('div'); scrim.className = 'au-scrim';
    const sheet = document.createElement('div'); sheet.className = 'au-sheet';
    sheet.innerHTML = `<h3>${esc(title)}</h3>${innerHtml}`;
    document.body.append(scrim, sheet); this.overlays.push(scrim, sheet);
    requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
    scrim.onclick = () => this.closeSheets();
    return sheet;
  }
  closeSheets() { this.overlays.forEach(o => o.remove()); this.overlays = []; }

  /* Media Session (Lockscreen) */
  setSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const ch = this.item.toc[this.chapter];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: ch ? ch.name : this.item.title, artist: this.item.author || '', album: this.item.title,
        artwork: this.coverUrl ? [{ src: this.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.audio.play());
      ms.setActionHandler('pause', () => this.audio.pause());
      ms.setActionHandler('previoustrack', () => this.prev());
      ms.setActionHandler('nexttrack', () => this.next());
      ms.setActionHandler('seekbackward', (d) => this.seek(-(d.seekOffset || 15)));
      ms.setActionHandler('seekforward', (d) => this.seek(d.seekOffset || 30));
    } catch (_) {}
  }

  destroy() {
    try { this.audio.pause(); } catch (_) {}
    this.closeSheets();
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio.src = ''; this.host.innerHTML = '';
  }
}

export default {
  id: 'audio', label: 'Hörbuch', badge: 'Audio',
  accepts(file) { return (file.type && file.type.startsWith('audio')) || /\.(m4b|m4a|mp3|aac|ogg|opus|wav|flac)$/i.test(file.name); },
  async createItem(files, core) {
    files = [...files].sort(naturalSort);
    const id = uid(); const toc = []; let metaTitle = null, metaAuthor = null, metaCover = null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; await db.putMedia(`${id}:${i}`, f);
      let meta = { chapters: [] }; try { meta = await AudioMeta().parse(f); } catch (_) {}
      const fileDur = (meta.duration && meta.duration > 0) ? meta.duration : await probeDuration(f);
      if (!metaTitle && meta.title) metaTitle = meta.title;
      if (!metaAuthor && meta.author) metaAuthor = meta.author;
      if (!metaCover && meta.coverBlob) metaCover = meta.coverBlob;
      if (meta.chapters && meta.chapters.length) {
        const cs = meta.chapters.slice().sort((a, b) => a.start - b.start);
        for (let j = 0; j < cs.length; j++) {
          const st = Math.max(0, cs[j].start || 0);
          const en = (cs[j].end != null && cs[j].end > st) ? cs[j].end : (j + 1 < cs.length ? cs[j + 1].start : fileDur);
          toc.push({ name: cs[j].title || `Kapitel ${toc.length + 1}`, mediaIndex: i, start: st, duration: Math.max(0, (en || fileDur) - st) });
        }
      } else { toc.push({ name: f.name.replace(/\.[^.]+$/, ''), mediaIndex: i, start: 0, duration: fileDur }); }
    }
    if (metaCover) await db.putCover(id, metaCover);
    const item = {
      id, type: 'audio', title: metaTitle || files[0].name.replace(/\.[^.]+$/, ''), author: metaAuthor || '',
      toc, parts: files.map((f, i) => ({ idx: i, mime: f.type || '' })),
      progress: { chapterIndex: 0, position: 0, updatedAt: 0 }, settings: {}, bookmarks: [], createdAt: Date.now(),
    };
    await db.putItem(item); return item;
  },
  async mount(item, stageEl, core) { const inst = new AudioInstance(item, stageEl, core); await inst.start(); return inst; },
};
