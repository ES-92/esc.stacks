/* ============================================================
   esc//shelf — Radio-Modul (Internet-Streams), Vanilla
   Online-Modul: Live-Stream, kein Offline/kein Fortschritt.
   Eigener Hinzufügen-Dialog (manuell + Suche via radio-browser).
   ============================================================ */
import { db, uid, esc } from './core.js';

async function createStation(core, { name, url, favicon }) {
  const id = uid();
  const item = {
    id, type: 'radio', title: (name || url || 'Sender').trim(), author: '',
    streamUrl: url, favicon: favicon || '', toc: [], parts: [],
    progress: { updatedAt: Date.now() }, createdAt: Date.now(),
  };
  await db.putItem(item);
  return item;
}

async function searchStations(q) {
  const base = 'https://de1.api.radio-browser.info/json/stations/search';
  const r = await fetch(`${base}?name=${encodeURIComponent(q)}&limit=20&hidebroken=true&order=clickcount&reverse=true`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).map(s => ({ name: s.name, url: s.url_resolved || s.url, favicon: s.favicon, country: s.country }));
}

/* Kuratierte Startliste — alle HTTPS (sonst blockt die PWA den Stream).
   Sollte ein Stream irgendwann umziehen: Sender löschen und neu via Suche/URL anlegen. */
const PRESETS = [
  { name: 'Deutschlandfunk', url: 'https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3' },
  { name: 'Deutschlandfunk Kultur', url: 'https://st02.sslstream.dlf.de/dlf/02/128/mp3/stream.mp3' },
  { name: 'Deutschlandfunk Nova', url: 'https://st03.sslstream.dlf.de/dlf/03/128/mp3/stream.mp3' },
  { name: 'WDR 1LIVE', url: 'https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/128/stream.mp3' },
  { name: 'WDR 2', url: 'https://wdr-wdr2-rheinruhr.icecastssl.wdr.de/wdr/wdr2/rheinruhr/mp3/128/stream.mp3' },
  { name: 'ByteFM', url: 'https://bytefm--di--nacs-ice-01--02--cdn.cast.addradio.de/bytefm/main/mid/stream.mp3' },
];

const ADD_CSS = `
.ra-scrim{position:fixed;inset:0;background:rgba(6,8,11,.6);opacity:0;pointer-events:none;transition:.25s;z-index:84}
.ra-scrim.show{opacity:1;pointer-events:auto}
.ra-sheet{position:fixed;left:0;right:0;bottom:0;z-index:85;background:var(--bg2);border-top:1px solid var(--line);
  border-radius:20px 20px 0 0;padding:12px 18px calc(20px + var(--safe-b));max-width:560px;margin:0 auto;max-height:80vh;overflow:auto;
  transform:translateY(100%);transition:transform .28s cubic-bezier(.32,.72,0,1)}
.ra-sheet.show{transform:none}.ra-sheet h3{font-family:var(--serif);font-weight:500;margin:2px 0 12px}
.ra-handle{width:38px;height:4px;border-radius:99px;background:var(--line);margin:2px auto 12px}
.ra-in{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;color:var(--txt);font-size:14px;padding:11px 12px;margin-bottom:9px;outline:none}
.ra-in:focus{border-color:var(--amber)}
.ra-res{max-height:200px;overflow:auto;margin:2px 0 8px}
.ra-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 6px;background:none;border:none;color:var(--txt);border-bottom:1px solid var(--line-soft)}
.ra-row img{width:28px;height:28px;border-radius:6px;object-fit:cover;background:var(--bg);flex:none}
.ra-row .nm{flex:1;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-row .co{font-family:var(--mono);font-size:10px;color:var(--txt-faint)}
.ra-note{color:var(--txt-faint);font-size:12px;font-family:var(--mono);padding:6px 2px}
.ra-div{display:flex;align-items:center;gap:10px;color:var(--txt-faint);font-family:var(--mono);font-size:11px;margin:12px 0 8px}
.ra-sec{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-faint);margin:6px 2px 6px}
.ra-row .co.go{color:var(--amber-hi)}
.ra-div::before,.ra-div::after{content:"";flex:1;height:1px;background:var(--line)}
.ra-btn{width:100%;background:var(--amber);color:#1a1208;font-weight:650;border-radius:10px;padding:12px;font-size:14px}

.ra{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center}
.ra-logo{width:140px;height:140px;border-radius:18px;overflow:hidden;background:var(--bg2);border:1px solid var(--line);display:grid;place-items:center;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.ra-logo img{width:100%;height:100%;object-fit:cover}.ra-logo .ph{color:var(--txt-faint)}.ra-logo .ph svg{width:54px;height:54px}
.ra-name{font-family:var(--serif);font-size:22px;line-height:1.2}
.ra-live{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--txt-dim)}
.ra-live .dot{width:8px;height:8px;border-radius:50%;background:var(--txt-faint)}
.ra-live.on .dot{background:#e0584f;box-shadow:0 0 0 0 rgba(224,88,79,.6);animation:rapulse 1.6s infinite}
.ra-live.on{color:var(--amber-hi)}
@keyframes rapulse{0%{box-shadow:0 0 0 0 rgba(224,88,79,.5)}70%{box-shadow:0 0 0 9px rgba(224,88,79,0)}100%{box-shadow:0 0 0 0 rgba(224,88,79,0)}}
.ra-play{width:74px;height:74px;border-radius:50%;background:var(--amber);color:#1a1208;border:none;display:grid;place-items:center}
.ra-play svg{width:34px;height:34px}
`;
const ICON_RADIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9-9M7 14a5 5 0 0 1 5-5"/><rect x="2" y="13" width="20" height="8" rx="2"/><circle cx="7" cy="17" r="1.4"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

class RadioInstance {
  constructor(item, host, core) {
    this.item = item; this.host = host; this.core = core;
    this.audio = new Audio(); this.audio.preload = 'none';
    this.onState = null; this._lastTick = 0;
  }
  async start() {
    if (!document.getElementById('ra-style')) { const s = document.createElement('style'); s.id = 'ra-style'; s.textContent = ADD_CSS; document.head.appendChild(s); }
    this.host.innerHTML = `
      <div class="ra">
        <div class="ra-logo">${this.item.favicon ? `<img src="${esc(this.item.favicon)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',innerHTML:'${ICON_RADIO.replace(/'/g, "\\'")}'}))">` : `<div class="ph">${ICON_RADIO}</div>`}</div>
        <div class="ra-name">${esc(this.item.title)}</div>
        <div class="ra-live"><span class="dot"></span><span class="st">Bereit</span></div>
        <button class="ra-play" data-a="toggle">${ICON_PLAY}</button>
      </div>`;
    this.live = this.host.querySelector('.ra-live');
    this.st = this.host.querySelector('.ra-live .st');
    this.btn = this.host.querySelector('[data-a="toggle"]');
    this.audio.style.display = 'none'; this.host.appendChild(this.audio);
    this.btn.onclick = () => this.toggle();
    this.audio.addEventListener('playing', () => { this.setLive(true, 'Live'); this._lastTick = Date.now(); this.setSession(); this.onState && this.onState(); });
    this.audio.addEventListener('waiting', () => this.setLive(false, 'Puffern …'));
    this.audio.addEventListener('pause', () => { this.setLive(false, 'Pausiert'); this._lastTick = 0; this.onState && this.onState(); });
    this.audio.addEventListener('error', () => this.setLive(false, 'Stream nicht erreichbar'));
    this.audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (this._lastTick && !this.audio.paused) { const dt = (now - this._lastTick) / 1000; if (dt > 0 && dt < 5) this.core.trackTime && this.core.trackTime(dt); }
      this._lastTick = this.audio.paused ? 0 : now;
    });
  }
  setLive(on, text) { this.live.classList.toggle('on', on); this.st.textContent = text; this.btn.innerHTML = (on || !this.audio.paused) ? ICON_STOP : ICON_PLAY; }
  toggle() {
    if (this.audio.paused) {
      if (this.audio.src !== this.item.streamUrl) this.audio.src = this.item.streamUrl;
      this.setLive(false, 'Verbinden …'); this.audio.play().catch(() => this.setLive(false, 'Stream nicht erreichbar'));
    } else { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
  }
  isPlaying() { return !this.audio.paused; }
  meta() { return { title: this.item.title, author: 'Radio · Live', cover: this.item.favicon || null, playing: !this.audio.paused }; }
  setSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: this.item.title, artist: 'Live-Radio', album: 'esc//stacks',
        artwork: this.item.favicon ? [{ src: this.item.favicon, sizes: '256x256' }] : [] });
      navigator.mediaSession.setActionHandler('play', () => this.toggle());
      navigator.mediaSession.setActionHandler('pause', () => this.toggle());
    } catch (_) {}
  }
  destroy() { try { this.audio.pause(); } catch (_) {} this.audio.removeAttribute('src'); this.host.innerHTML = ''; }
}

export default {
  id: 'radio', label: 'Radio', badge: 'Radio',
  addUI(core, onDone) {
    if (!document.getElementById('ra-style')) { const s = document.createElement('style'); s.id = 'ra-style'; s.textContent = ADD_CSS; document.head.appendChild(s); }
    const scrim = document.createElement('div'); scrim.className = 'ra-scrim';
    const sheet = document.createElement('div'); sheet.className = 'ra-sheet';
    sheet.innerHTML = `
      <div class="ra-handle"></div><h3>Radio hinzufügen</h3>
      <div class="ra-sec">Beliebte Sender</div>
      <div class="ra-presets">${PRESETS.map((s, i) => `<button class="ra-row" data-preset="${i}"><span class="nm">${esc(s.name)}</span><span class="co go">▶ Hinzufügen</span></button>`).join('')}</div>
      <div class="ra-div">oder suchen</div>
      <input class="ra-in" id="raSearch" placeholder="Sender suchen (online) …">
      <div class="ra-res" id="raRes"></div>
      <div class="ra-div">oder manuell</div>
      <input class="ra-in" id="raName" placeholder="Name (optional)">
      <input class="ra-in" id="raUrl" placeholder="Stream-URL (https://…)">
      <button class="ra-btn" id="raAdd">Hinzufügen</button>`;
    document.body.append(scrim, sheet);
    requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
    const close = () => { scrim.remove(); sheet.remove(); };
    scrim.onclick = close;
    sheet.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => {
      const s = PRESETS[+b.dataset.preset]; await createStation(core, s); close(); onDone && onDone(); core.toast && core.toast('„' + s.name + '" hinzugefügt');
    });
    const res = sheet.querySelector('#raRes');
    let t = null;
    sheet.querySelector('#raSearch').oninput = (e) => {
      const q = e.target.value.trim(); clearTimeout(t);
      if (q.length < 2) { res.innerHTML = ''; return; }
      res.innerHTML = `<div class="ra-note">Suche …</div>`;
      t = setTimeout(async () => {
        try {
          const list = await searchStations(q);
          if (!list.length) { res.innerHTML = `<div class="ra-note">Nichts gefunden.</div>`; return; }
          res.innerHTML = list.map((s, i) => `<button class="ra-row" data-i="${i}">${s.favicon ? `<img src="${esc(s.favicon)}" onerror="this.style.visibility='hidden'">` : ''}<span class="nm">${esc(s.name)}</span><span class="co">${esc(s.country || '')}</span></button>`).join('');
          res.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => { const s = list[+b.dataset.i]; await createStation(core, s); close(); onDone && onDone(); core.toast && core.toast('„' + s.name + '" hinzugefügt'); });
        } catch (_) { res.innerHTML = `<div class="ra-note">Suche nicht erreichbar — Sender unten manuell hinzufügen.</div>`; }
      }, 450);
    };
    sheet.querySelector('#raAdd').onclick = async () => {
      const url = sheet.querySelector('#raUrl').value.trim();
      const name = sheet.querySelector('#raName').value.trim();
      if (!/^https?:\/\//i.test(url)) { core.toast && core.toast('Bitte gültige Stream-URL angeben'); return; }
      const it = await createStation(core, { name, url }); close(); onDone && onDone(); core.toast && core.toast('„' + it.title + '" hinzugefügt');
    };
  },
  async mount(item, stageEl, core) { const inst = new RadioInstance(item, stageEl, core); await inst.start(); return inst; },
};
