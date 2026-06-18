/* ============================================================
   esc//shelf — Playlist-Modul (album-übergreifend), Vanilla
   Eintrag verweist auf Track eines Musik-Albums (itemId:trackIndex).
   Warteschlange · Shuffle/Repeat · Eintrag entfernen · Hintergrund.
   ============================================================ */
import { db, uid, esc, fmt, coverURL, createPlaylist } from './core.js';

const CSS = `
.pl{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;padding:4px}
.pl-head{display:flex;gap:14px;align-items:center;padding:6px 4px 12px;flex:none}
.pl-cover{width:90px;height:90px;border-radius:12px;overflow:hidden;background:var(--bg2);border:1px solid var(--line);flex:none;box-shadow:0 8px 26px rgba(0,0,0,.45)}
.pl-cover img{width:100%;height:100%;object-fit:cover}.pl-cover .ph{width:100%;height:100%;display:grid;place-items:center;color:var(--txt-faint)}
.pl-title{font-family:var(--serif);font-size:19px;line-height:1.2}
.pl-count{color:var(--txt-faint);font-family:var(--mono);font-size:11px;margin-top:5px}
.pl-list{flex:1;overflow:auto;border-top:1px solid var(--line-soft)}
.pl-empty{color:var(--txt-faint);padding:40px 14px;text-align:center;font-size:14px;line-height:1.6}
.pl-tr{display:flex;align-items:center;gap:10px;padding:11px 8px;border-bottom:1px solid var(--line-soft);color:var(--txt)}
.pl-tr .n{width:20px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--txt-faint);flex:none}
.pl-tr .grip{width:24px;flex:none;background:none;border:none;color:var(--txt-faint);font-size:15px;cursor:grab;touch-action:none;line-height:1}
.pl-tr.drag{background:var(--bg);opacity:.92;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.pl-tr .ti{flex:1;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:none;border:none;color:inherit;text-align:left}
.pl-tr .d{font-family:var(--mono);font-size:12px;color:var(--txt-faint)}
.pl-tr .x{color:var(--txt-faint);background:none;border:none;padding:2px 6px;font-size:15px}
.pl-tr.cur{color:var(--amber-hi)}.pl-tr.cur .n{color:var(--amber-hi)}
.pl-bar{flex:none;padding:8px 4px calc(6px + var(--safe-b))}
.pl-now{font-family:var(--mono);font-size:11px;color:var(--txt-dim);text-align:center;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-scrub input{width:100%}
.pl-times{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--txt-dim);margin-top:2px}
.pl-tp{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:8px}
.pl-b{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:var(--txt);background:var(--bg2);border:1px solid var(--line)}
.pl-b.main{width:60px;height:60px;background:var(--amber);color:#1a1208;border:none}
.pl-b svg{width:21px;height:21px}.pl-b.main svg{width:26px;height:26px}.pl-b.on{border-color:var(--amber);color:var(--amber-hi)}
.pl-addsheet-scrim{position:fixed;inset:0;background:rgba(6,8,11,.6);opacity:0;pointer-events:none;transition:.25s;z-index:88}
.pl-addsheet-scrim.show{opacity:1;pointer-events:auto}
.pl-addsheet{position:fixed;left:0;right:0;bottom:0;z-index:89;background:var(--bg2);border-top:1px solid var(--line);border-radius:20px 20px 0 0;padding:12px 18px calc(20px + var(--safe-b));max-width:560px;margin:0 auto;transform:translateY(100%);transition:transform .28s cubic-bezier(.32,.72,0,1)}
.pl-addsheet.show{transform:none}.pl-addsheet h3{font-family:var(--serif);font-weight:500;margin:2px 0 12px}
.pl-in{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;color:var(--txt);font-size:14px;padding:11px 12px;margin-bottom:10px;outline:none}
.pl-in:focus{border-color:var(--amber)}
.pl-mkbtn{width:100%;background:var(--amber);color:#1a1208;font-weight:650;border-radius:10px;padding:12px;font-size:14px}
`;
const I = {
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14l-10-7z"/></svg>',
  next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l10 7-10 7z"/></svg>',
  shuffle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M21 3l-7 7M4 20l7-7M16 21h5v-5M4 4l16 16"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
};

class PlaylistInstance {
  constructor(item, host, core) {
    this.item = item; this.host = host; this.core = core;
    this.audio = new Audio(); this.audio.preload = 'metadata';
    this.entries = item.entries || [];
    this.index = Math.min(item.progress?.entryIndex || 0, Math.max(0, this.entries.length - 1));
    this.url = null; this.shuffle = false; this.repeat = false;
    this.queue = this.entries.map((_, i) => i);
    this.onState = null; this._lastTick = 0;
  }
  async start() {
    if (!document.getElementById('pl-style')) { const s = document.createElement('style'); s.id = 'pl-style'; s.textContent = CSS; document.head.appendChild(s); }
    this.coverUrl = await coverURL(this.item.id);
    this.host.innerHTML = `
      <div class="pl">
        <div class="pl-head">
          <div class="pl-cover">${this.coverUrl ? `<img src="${this.coverUrl}">` : `<div class="ph">♪</div>`}</div>
          <div><div class="pl-title">${esc(this.item.title)}</div><div class="pl-count"></div></div>
        </div>
        <div class="pl-list"></div>
        <div class="pl-bar">
          <div class="pl-now"></div>
          <div class="pl-scrub"><input type="range" min="0" max="1000" value="0"></div>
          <div class="pl-times"><span class="cur">0:00</span><span class="tot">0:00</span></div>
          <div class="pl-tp">
            <button class="pl-b" data-a="shuffle">${I.shuffle}</button>
            <button class="pl-b" data-a="prev">${I.prev}</button>
            <button class="pl-b main" data-a="toggle">${I.play}</button>
            <button class="pl-b" data-a="next">${I.next}</button>
            <button class="pl-b" data-a="repeat">${I.repeat}</button>
          </div>
        </div>
      </div>`;
    this.elNow = this.host.querySelector('.pl-now');
    this.elScrub = this.host.querySelector('.pl-scrub input');
    this.elCur = this.host.querySelector('.cur'); this.elTot = this.host.querySelector('.tot');
    this.elMain = this.host.querySelector('[data-a="toggle"]');
    this.audio.style.display = 'none'; this.host.appendChild(this.audio);
    this.host.querySelectorAll('.pl-tp [data-a]').forEach(b => b.onclick = () => this.action(b.dataset.a));
    this.elScrub.addEventListener('input', () => { this.scrubbing = true; });
    this.elScrub.addEventListener('change', () => { this.applyScrub(); this.scrubbing = false; });
    this.renderList();
    this.audio.addEventListener('timeupdate', () => this.onTime());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => { this.elMain.innerHTML = I.pause; this._lastTick = Date.now(); this.setSession(); this.onState && this.onState(); });
    this.audio.addEventListener('pause', () => { this.elMain.innerHTML = I.play; this._lastTick = 0; this.onState && this.onState(); });
    if (this.entries.length) await this.loadEntry(this.index, this.item.progress?.position || 0, false);
    else this.elNow.textContent = 'Leer — Titel aus einem Album hinzufügen';
  }
  action(a) {
    if (a === 'toggle') this.toggle(); else if (a === 'prev') this.prev(); else if (a === 'next') this.next();
    else if (a === 'shuffle') this.toggleShuffle(); else if (a === 'repeat') this.toggleRepeat();
  }
  toggle() { if (!this.entries.length) return; this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause(); }
  isPlaying() { return !this.audio.paused; }
  meta() { const e = this.entries[this.index]; return { title: e ? e.name : this.item.title, author: this.item.title, cover: this.coverUrl, playing: !this.audio.paused }; }
  renderList() {
    const list = this.host.querySelector('.pl-list');
    this.host.querySelector('.pl-count').textContent = `${this.entries.length} Titel`;
    if (!this.entries.length) { list.innerHTML = `<div class="pl-empty">Diese Playlist ist leer.<br>Öffne ein Album und tippe bei einem Titel auf <b>+</b>.</div>`; return; }
    list.innerHTML = this.entries.map((e, i) =>
      `<div class="pl-tr ${i === this.index ? 'cur' : ''}" data-i="${i}"><button class="grip" data-grip aria-label="Verschieben">⠿</button><span class="n">${i + 1}</span><button class="ti" data-play="${i}">${esc(e.name)}</button><span class="d">${fmt(e.duration)}</span><button class="x" data-del="${i}">✕</button></div>`).join('');
    list.querySelectorAll('[data-play]').forEach(b => b.onclick = () => this.loadEntry(+b.dataset.play, 0, true));
    list.querySelectorAll('[data-del]').forEach(b => b.onclick = () => this.removeEntry(+b.dataset.del));
    this.enableDrag(list);
  }
  enableDrag(list) {
    list.querySelectorAll('[data-grip]').forEach(g => {
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const rowEl = g.closest('.pl-tr'); rowEl.classList.add('drag');
        const move = (ev) => {
          const rows = [...list.querySelectorAll('.pl-tr')];
          for (const r of rows) { if (r === rowEl) continue; const rect = r.getBoundingClientRect();
            if (ev.clientY > rect.top && ev.clientY < rect.bottom) { const mid = rect.top + rect.height / 2;
              if (ev.clientY < mid) list.insertBefore(rowEl, r); else list.insertBefore(rowEl, r.nextSibling); break; } }
        };
        const up = () => {
          document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
          rowEl.classList.remove('drag');
          const order = [...list.querySelectorAll('.pl-tr')].map(r => +r.dataset.i);
          this.applyReorder(order);
        };
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
      });
    });
  }
  async applyReorder(order) {
    if (order.length !== this.entries.length) return;
    const changed = order.some((v, i) => v !== i);
    if (!changed) return;
    const old = this.index;
    this.entries = order.map(i => this.entries[i]); this.item.entries = this.entries;
    this.index = Math.max(0, order.indexOf(old));
    this.queue = this.entries.map((_, k) => k);
    await db.putItem(this.item); this.persist(); this.renderList();
  }
  async removeEntry(i) {
    this.entries.splice(i, 1); this.item.entries = this.entries;
    if (this.index >= this.entries.length) this.index = Math.max(0, this.entries.length - 1);
    this.queue = this.entries.map((_, k) => k);
    await db.putItem(this.item); this.renderList(); this.persist();
  }
  async loadEntry(i, pos, autoplay) {
    if (!this.entries.length) return;
    i = Math.max(0, Math.min(i, this.entries.length - 1)); this.index = i;
    const e = this.entries[i];
    const rec = await db.getMedia(`${e.itemId}:${e.trackIndex}`);
    if (!rec) { this.elNow.textContent = '⚠ Quelle nicht gefunden: ' + e.name; return; }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(rec.blob);
    this.audio.src = this.url; this.audio.load();
    await new Promise(r => { const ok = () => { this.audio.removeEventListener('loadedmetadata', ok); r(); }; this.audio.addEventListener('loadedmetadata', ok); setTimeout(r, 4000); });
    if (pos && isFinite(this.audio.duration)) this.audio.currentTime = Math.min(pos, this.audio.duration - 0.25);
    if (autoplay) this.audio.play().catch(() => {});
    this.sync();
  }
  sync() {
    const e = this.entries[this.index];
    this.elNow.textContent = e ? `${this.index + 1}. ${e.name}` : '';
    this.host.querySelectorAll('.pl-tr').forEach(el => el.classList.toggle('cur', +el.dataset.i === this.index));
    this.paintScrub(); this.persist(); this.setSession();
  }
  queuePos() { return this.queue.indexOf(this.index); }
  onEnded() { const qp = this.queuePos(); if (qp < this.queue.length - 1) this.loadEntry(this.queue[qp + 1], 0, true); else if (this.repeat) this.loadEntry(this.queue[0], 0, true); else this.audio.pause(); }
  next() { const qp = this.queuePos(); if (qp < this.queue.length - 1) this.loadEntry(this.queue[qp + 1], 0, !this.audio.paused); else if (this.repeat) this.loadEntry(this.queue[0], 0, !this.audio.paused); }
  prev() { if ((this.audio.currentTime || 0) > 3) { this.audio.currentTime = 0; return; } const qp = this.queuePos(); if (qp > 0) this.loadEntry(this.queue[qp - 1], 0, !this.audio.paused); else this.audio.currentTime = 0; }
  toggleShuffle() {
    this.shuffle = !this.shuffle; this.host.querySelector('[data-a="shuffle"]').classList.toggle('on', this.shuffle);
    if (this.shuffle) { const rest = this.entries.map((_, i) => i).filter(i => i !== this.index);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      this.queue = [this.index, ...rest]; } else this.queue = this.entries.map((_, i) => i);
  }
  toggleRepeat() { this.repeat = !this.repeat; this.host.querySelector('[data-a="repeat"]').classList.toggle('on', this.repeat); }
  onTime() {
    if (!this.scrubbing) this.paintScrub();
    const now = Date.now();
    if (this._lastTick && !this.audio.paused) { const dt = (now - this._lastTick) / 1000; if (dt > 0 && dt < 5) this.core.trackTime && this.core.trackTime(dt); }
    this._lastTick = this.audio.paused ? 0 : now;
    if (Date.now() - (this._save || 0) > 4000) { this._save = Date.now(); this.persist(); }
  }
  paintScrub() { const dur = isFinite(this.audio.duration) ? this.audio.duration : 0, cur = this.audio.currentTime || 0;
    this.elScrub.value = dur > 0 ? Math.min(1000, cur / dur * 1000) : 0; this.elCur.textContent = fmt(cur); this.elTot.textContent = '-' + fmt(Math.max(0, dur - cur)); }
  applyScrub() { const dur = this.audio.duration; if (isFinite(dur)) this.audio.currentTime = Math.min(this.elScrub.value / 1000 * dur, dur - 0.05); }
  persist() { this.core.saveProgress(this.item, { entryIndex: this.index, position: this.audio.currentTime || 0 }); }
  setSession() {
    if (!('mediaSession' in navigator)) return;
    try { const e = this.entries[this.index];
      navigator.mediaSession.metadata = new MediaMetadata({ title: e ? e.name : this.item.title, artist: this.item.title, album: 'Playlist',
        artwork: this.coverUrl ? [{ src: this.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [] });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.audio.play()); ms.setActionHandler('pause', () => this.audio.pause());
      ms.setActionHandler('previoustrack', () => this.prev()); ms.setActionHandler('nexttrack', () => this.next());
    } catch (_) {}
  }
  destroy() { try { this.audio.pause(); } catch (_) {} if (this.url) URL.revokeObjectURL(this.url); this.audio.src = ''; this.host.innerHTML = ''; }
}

export default {
  id: 'playlist', label: 'Playlist', badge: 'Playlist',
  addUI(core, onDone) {
    const scrim = document.createElement('div'); scrim.className = 'pl-addsheet-scrim';
    const sheet = document.createElement('div'); sheet.className = 'pl-addsheet';
    if (!document.getElementById('pl-style')) { const s = document.createElement('style'); s.id = 'pl-style'; s.textContent = CSS; document.head.appendChild(s); }
    sheet.innerHTML = `<h3>Neue Playlist</h3><input class="pl-in" id="plName" placeholder="Name der Playlist"><button class="pl-mkbtn" id="plMk">Erstellen</button>`;
    document.body.append(scrim, sheet);
    requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
    const close = () => { scrim.remove(); sheet.remove(); };
    scrim.onclick = close;
    sheet.querySelector('#plMk').onclick = async () => {
      const name = sheet.querySelector('#plName').value.trim() || 'Neue Playlist';
      const pl = await createPlaylist(name); close(); onDone && onDone(); core.toast && core.toast('Playlist „' + pl.title + '" erstellt');
    };
  },
  async mount(item, stageEl, core) { const inst = new PlaylistInstance(item, stageEl, core); await inst.start(); return inst; },
};
