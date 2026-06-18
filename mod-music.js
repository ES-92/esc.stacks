/* ============================================================
   esc//shelf — Musik-Modul (eigene Dateien), Vanilla
   Album = Eintrag · Tracks · Warteschlange · Shuffle/Repeat ·
   Hintergrund-Wiedergabe · Media Session
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

const CSS = `
.mu{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;padding:4px}
.mu-head{display:flex;gap:14px;align-items:center;padding:6px 4px 12px;flex:none}
.mu-cover{width:96px;height:96px;border-radius:12px;overflow:hidden;background:var(--bg2);border:1px solid var(--line);flex:none;box-shadow:0 8px 26px rgba(0,0,0,.45)}
.mu-cover img{width:100%;height:100%;object-fit:cover}
.mu-cover .ph{width:100%;height:100%;display:grid;place-items:center;color:var(--txt-faint);font-family:var(--serif)}
.mu-meta{min-width:0}
.mu-album{font-family:var(--serif);font-size:19px;line-height:1.2}
.mu-artist{color:var(--txt-dim);font-size:13px;margin-top:2px}
.mu-count{color:var(--txt-faint);font-family:var(--mono);font-size:11px;margin-top:6px}
.mu-list{flex:1;overflow:auto;border-top:1px solid var(--line-soft)}
.mu-tr{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:11px 8px;background:none;border:none;color:var(--txt);border-bottom:1px solid var(--line-soft)}
.mu-tr .n{width:20px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--txt-faint);flex:none}
.mu-tr .ti{flex:1;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-tr .d{font-family:var(--mono);font-size:12px;color:var(--txt-faint)}
.mu-tr.cur{color:var(--amber-hi)}.mu-tr.cur .n{color:var(--amber-hi)}
.mu-bar{flex:none;padding:8px 4px calc(6px + var(--safe-b))}
.mu-now{font-family:var(--mono);font-size:11px;color:var(--txt-dim);text-align:center;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-scrub input{width:100%}
.mu-times{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--txt-dim);margin-top:2px}
.mu-tp{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:8px}
.mu-b{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:var(--txt);background:var(--bg2);border:1px solid var(--line)}
.mu-b.main{width:60px;height:60px;background:var(--amber);color:#1a1208;border:none}
.mu-b svg{width:21px;height:21px}.mu-b.main svg{width:26px;height:26px}
.mu-b.on{border-color:var(--amber);color:var(--amber-hi)}
`;
const I = {
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14l-10-7z"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l10 7-10 7z"/></svg>',
  shuffle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M21 3l-7 7M4 20l7-7M16 21h5v-5M4 4l16 16"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
};

class MusicInstance {
  constructor(item, host, core) {
    this.item = item; this.host = host; this.core = core;
    this.audio = new Audio(); this.audio.preload = 'metadata';
    this.tracks = item.toc || [];
    this.index = Math.min(item.progress?.trackIndex || 0, Math.max(0, this.tracks.length - 1));
    this.url = null; this.shuffle = false; this.repeat = false;
    this.queue = this.tracks.map((_, i) => i);
    this.onState = null; this._lastTick = 0;
  }
  async start() {
    if (!document.getElementById('mu-style')) { const s = document.createElement('style'); s.id = 'mu-style'; s.textContent = CSS; document.head.appendChild(s); }
    this.coverUrl = await coverURL(this.item.id);
    this.host.innerHTML = `
      <div class="mu">
        <div class="mu-head">
          <div class="mu-cover">${this.coverUrl ? `<img src="${this.coverUrl}">` : `<div class="ph">♪</div>`}</div>
          <div class="mu-meta">
            <div class="mu-album">${esc(this.item.title)}</div>
            <div class="mu-artist">${esc(this.item.author || 'Unbekannt')}</div>
            <div class="mu-count">${this.tracks.length} Titel</div>
          </div>
        </div>
        <div class="mu-list"></div>
        <div class="mu-bar">
          <div class="mu-now"></div>
          <div class="mu-scrub"><input type="range" min="0" max="1000" value="0"></div>
          <div class="mu-times"><span class="cur">0:00</span><span class="tot">0:00</span></div>
          <div class="mu-tp">
            <button class="mu-b" data-a="shuffle">${I.shuffle}</button>
            <button class="mu-b" data-a="prev">${I.prev}</button>
            <button class="mu-b main" data-a="toggle">${I.play}</button>
            <button class="mu-b" data-a="next">${I.next}</button>
            <button class="mu-b" data-a="repeat">${I.repeat}</button>
          </div>
        </div>
      </div>`;
    this.elNow = this.host.querySelector('.mu-now');
    this.elScrub = this.host.querySelector('.mu-scrub input');
    this.elCur = this.host.querySelector('.cur'); this.elTot = this.host.querySelector('.tot');
    this.elMain = this.host.querySelector('[data-a="toggle"]');
    this.audio.style.display = 'none'; this.host.appendChild(this.audio);
    this.host.querySelectorAll('[data-a]').forEach(b => b.onclick = () => this.action(b.dataset.a));
    this.elScrub.addEventListener('input', () => { this.scrubbing = true; });
    this.elScrub.addEventListener('change', () => { this.applyScrub(); this.scrubbing = false; });
    this.renderList();
    this.audio.addEventListener('timeupdate', () => this.onTime());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => { this.elMain.innerHTML = I.pause; this._lastTick = Date.now(); this.setSession(); this.onState && this.onState(); });
    this.audio.addEventListener('pause', () => { this.elMain.innerHTML = I.play; this._lastTick = 0; this.onState && this.onState(); });
    await this.loadTrack(this.index, this.item.progress?.position || 0, false);
  }
  action(a) {
    if (a === 'toggle') this.toggle();
    else if (a === 'prev') this.prev(); else if (a === 'next') this.next();
    else if (a === 'shuffle') this.toggleShuffle();
    else if (a === 'repeat') this.toggleRepeat();
  }
  toggle() { this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause(); }
  isPlaying() { return !this.audio.paused; }
  meta() { const t = this.tracks[this.index]; return { title: t ? t.name : this.item.title, author: this.item.title, cover: this.coverUrl, playing: !this.audio.paused }; }
  renderList() {
    const list = this.host.querySelector('.mu-list');
    list.innerHTML = this.tracks.map((t, i) =>
      `<button class="mu-tr ${i === this.index ? 'cur' : ''}" data-i="${i}"><span class="n">${i + 1}</span><span class="ti">${esc(t.name)}</span><span class="d">${fmt(t.duration)}</span></button>`).join('');
    list.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.loadTrack(+b.dataset.i, 0, true));
  }
  async loadTrack(i, pos, autoplay) {
    i = Math.max(0, Math.min(i, this.tracks.length - 1)); this.index = i;
    const rec = await db.getMedia(`${this.item.id}:${i}`); if (!rec) return;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(rec.blob);
    this.audio.src = this.url; this.audio.load();
    await new Promise(r => { const ok = () => { this.audio.removeEventListener('loadedmetadata', ok); r(); }; this.audio.addEventListener('loadedmetadata', ok); setTimeout(r, 4000); });
    if (pos && isFinite(this.audio.duration)) this.audio.currentTime = Math.min(pos, this.audio.duration - 0.25);
    if (autoplay) this.audio.play().catch(() => {});
    this.sync();
  }
  sync() {
    const t = this.tracks[this.index];
    this.elNow.textContent = `${this.index + 1}. ${t ? t.name : ''}`;
    this.host.querySelectorAll('.mu-tr').forEach(el => el.classList.toggle('cur', +el.dataset.i === this.index));
    this.paintScrub(); this.persist(); this.setSession();
  }
  queuePos() { return this.queue.indexOf(this.index); }
  onEnded() {
    const qp = this.queuePos();
    if (qp < this.queue.length - 1) this.loadTrack(this.queue[qp + 1], 0, true);
    else if (this.repeat) this.loadTrack(this.queue[0], 0, true);
    else this.audio.pause();
  }
  next() { const qp = this.queuePos(); if (qp < this.queue.length - 1) this.loadTrack(this.queue[qp + 1], 0, !this.audio.paused); else if (this.repeat) this.loadTrack(this.queue[0], 0, !this.audio.paused); }
  prev() { if ((this.audio.currentTime || 0) > 3) { this.audio.currentTime = 0; return; } const qp = this.queuePos(); if (qp > 0) this.loadTrack(this.queue[qp - 1], 0, !this.audio.paused); else this.audio.currentTime = 0; }
  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.host.querySelector('[data-a="shuffle"]').classList.toggle('on', this.shuffle);
    if (this.shuffle) {
      const rest = this.tracks.map((_, i) => i).filter(i => i !== this.index);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      this.queue = [this.index, ...rest];
    } else this.queue = this.tracks.map((_, i) => i);
  }
  toggleRepeat() { this.repeat = !this.repeat; this.host.querySelector('[data-a="repeat"]').classList.toggle('on', this.repeat); }
  onTime() {
    if (!this.scrubbing) this.paintScrub();
    const now = Date.now();
    if (this._lastTick && !this.audio.paused) { const dt = (now - this._lastTick) / 1000; if (dt > 0 && dt < 5) this.core.trackTime && this.core.trackTime(dt); }
    this._lastTick = this.audio.paused ? 0 : now;
    if (Date.now() - (this._save || 0) > 4000) { this._save = Date.now(); this.persist(); }
  }
  paintScrub() {
    const dur = isFinite(this.audio.duration) ? this.audio.duration : 0, cur = this.audio.currentTime || 0;
    this.elScrub.value = dur > 0 ? Math.min(1000, cur / dur * 1000) : 0;
    this.elCur.textContent = fmt(cur); this.elTot.textContent = '-' + fmt(Math.max(0, dur - cur));
  }
  applyScrub() { const dur = this.audio.duration; if (isFinite(dur)) this.audio.currentTime = Math.min(this.elScrub.value / 1000 * dur, dur - 0.05); }
  persist() { this.core.saveProgress(this.item, { trackIndex: this.index, position: this.audio.currentTime || 0 }); }
  setSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const t = this.tracks[this.index];
      navigator.mediaSession.metadata = new MediaMetadata({ title: t ? t.name : this.item.title, artist: this.item.author || '', album: this.item.title,
        artwork: this.coverUrl ? [{ src: this.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [] });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.audio.play());
      ms.setActionHandler('pause', () => this.audio.pause());
      ms.setActionHandler('previoustrack', () => this.prev());
      ms.setActionHandler('nexttrack', () => this.next());
    } catch (_) {}
  }
  destroy() { try { this.audio.pause(); } catch (_) {} if (this.url) URL.revokeObjectURL(this.url); this.audio.src = ''; this.host.innerHTML = ''; }
}

export default {
  id: 'music', label: 'Musik', badge: 'Musik',
  pick: { accept: 'audio/*,.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav', multiple: true },
  accepts(file) { return (file.type && file.type.startsWith('audio')) || /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i.test(file.name); },
  async createItem(files, core) {
    files = [...files].sort(naturalSort);
    // nach Album gruppieren
    const groups = new Map();
    const parsed = [];
    for (const f of files) { let m = {}; try { m = await AudioMeta().parse(f); } catch (_) {} parsed.push({ f, m }); }
    for (const { f, m } of parsed) {
      const key = (m.album || 'Unbekanntes Album').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ f, m });
    }
    let firstItem = null;
    for (const [album, list] of groups) {
      const id = uid(); const toc = []; let cover = null, artist = null;
      for (let i = 0; i < list.length; i++) {
        const { f, m } = list[i]; await db.putMedia(`${id}:${i}`, f);
        const dur = (m.duration && m.duration > 0) ? m.duration : await probeDuration(f);
        if (!cover && m.coverBlob) cover = m.coverBlob;
        if (!artist && m.author) artist = m.author;
        toc.push({ name: m.title || f.name.replace(/\.[^.]+$/, ''), mediaIndex: i, start: 0, duration: dur });
      }
      if (cover) await db.putCover(id, cover);
      const item = {
        id, type: 'music', title: album, author: artist || 'Verschiedene',
        toc, parts: list.map((_, i) => ({ idx: i, mime: list[i].f.type || '' })),
        progress: { trackIndex: 0, position: 0, updatedAt: 0 }, settings: {}, createdAt: Date.now(),
      };
      await db.putItem(item); if (!firstItem) firstItem = item;
    }
    return firstItem;
  },
  async mount(item, stageEl, core) { const inst = new MusicInstance(item, stageEl, core); await inst.start(); return inst; },
};
