/* ============================================================
   esc//audio — Metadaten-Parser  (Vanilla, ohne Abhängigkeiten)
   Liest aus MP3 (ID3v2) und MP4/M4B/M4A (Atome):
     • Titel / Autor / Album
     • eingebettetes Cover  -> Blob
     • Kapitelmarken         -> [{ title, start, end? }]  (Sekunden)
   API:  await AudioMeta.parse(file)
         -> { title?, author?, album?, coverBlob?, duration?, chapters: [...] }
   Robust: jede Teil-Analyse ist gekapselt; bei Unklarheit kommt
   einfach weniger zurück (nie ein Wurf nach außen).
   ============================================================ */
(function (global) {
  'use strict';

  const ascii = (u8, o, n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]);
    return s;
  };
  const dec = (() => {
    const cache = {};
    return (label) => (cache[label] || (cache[label] = new TextDecoder(label)));
  })();
  const buf = (slice) => slice.arrayBuffer().then(ab => new Uint8Array(ab));

  /* ---------------------------------------------------------- */
  async function parse(file) {
    try {
      const head = await buf(file.slice(0, 16));
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {  // "ID3"
        return await parseID3(file, head);
      }
      if (ascii(head, 4, 4) === 'ftyp') {
        return await parseMP4(file);
      }
    } catch (_) { /* ignorieren -> leeres Ergebnis */ }
    return { chapters: [] };
  }

  /* ============================================================
     MP3 / ID3v2
     ============================================================ */
  async function parseID3(file, head) {
    const out = { chapters: [] };
    const major = head[3];
    const size = synchsafe(head, 6);
    const tag = await buf(file.slice(0, 10 + size));
    let p = 10;
    // erweiterten Header überspringen
    if (head[5] & 0x40) {
      const extSize = major === 4 ? synchsafe(tag, p) : be32(tag, p);
      p += (major === 4 ? extSize : extSize + 4);
    }
    const frames = readID3Frames(tag, p, 10 + size, major);
    for (const f of frames) {
      if (f.id === 'TIT2') out.title = textFrame(f.data);
      else if (f.id === 'TPE1') out.author = textFrame(f.data);
      else if (f.id === 'TALB') out.album = textFrame(f.data);
      else if (f.id === 'APIC' && !out.coverBlob) out.coverBlob = apicCover(f.data);
      else if (f.id === 'CHAP') {
        const c = chapFrame(f.data, major);
        if (c) out.chapters.push(c);
      }
    }
    out.chapters.sort((a, b) => a.start - b.start);
    return out;
  }

  function readID3Frames(u8, start, end, major) {
    const frames = [];
    let p = start;
    while (p + 10 <= end) {
      const id = ascii(u8, p, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;            // Padding erreicht
      const size = major === 4 ? synchsafe(u8, p + 4) : be32(u8, p + 4);
      if (size <= 0 || p + 10 + size > end) break;
      frames.push({ id, data: u8.subarray(p + 10, p + 10 + size) });
      p += 10 + size;
    }
    return frames;
  }

  function textFrame(d) {
    if (!d || !d.length) return '';
    const enc = d[0];
    return decodeText(d.subarray(1), enc).replace(/\u0000+$/, '').trim();
  }

  function decodeText(u8, enc) {
    try {
      if (enc === 1) return dec('utf-16').decode(u8);       // UTF-16 + BOM
      if (enc === 2) return dec('utf-16be').decode(u8);     // UTF-16BE
      if (enc === 3) return dec('utf-8').decode(u8);        // UTF-8
      return dec('latin1').decode(u8);                      // ISO-8859-1
    } catch (_) { return ''; }
  }

  function apicCover(d) {
    try {
      const enc = d[0];
      let p = 1;
      // MIME (latin1, null-terminiert)
      let mime = '';
      while (p < d.length && d[p] !== 0) mime += String.fromCharCode(d[p++]);
      p++;                       // 0-Byte
      p++;                       // Picture-Type
      // Beschreibung überspringen (Terminierung je nach Encoding)
      if (enc === 1 || enc === 2) { while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2; p += 2; }
      else { while (p < d.length && d[p] !== 0) p++; p++; }
      const bytes = d.subarray(p);
      if (!bytes.length) return null;
      return new Blob([bytes], { type: mime || 'image/jpeg' });
    } catch (_) { return null; }
  }

  function chapFrame(d, major) {
    try {
      let p = 0;
      while (p < d.length && d[p] !== 0) p++;   // element-id (latin1, null-term)
      p++;
      const startMs = be32(d, p); p += 4;
      const endMs = be32(d, p); p += 4;
      p += 8;                                    // start/end byte offsets
      let title = '';
      const subs = readID3Frames(d, p, d.length, major);
      for (const s of subs) if (s.id === 'TIT2') { title = textFrame(s.data); break; }
      const start = startMs / 1000;
      const end = (endMs && endMs !== 0xFFFFFFFF && endMs > startMs) ? endMs / 1000 : undefined;
      return { title: title || null, start, end };
    } catch (_) { return null; }
  }

  const synchsafe = (u8, o) => (u8[o] << 21) | (u8[o + 1] << 14) | (u8[o + 2] << 7) | u8[o + 3];
  const be32 = (u8, o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;

  /* ============================================================
     MP4 / M4B / M4A  (Atom-Baum)
     ============================================================ */
  async function parseMP4(file) {
    const out = { chapters: [] };
    // 'moov' auf oberster Ebene finden (kann vor oder hinter 'mdat' liegen)
    const moov = await findTopLevelAtom(file, 'moov');
    if (!moov) return out;
    const u8 = await buf(file.slice(moov.start, moov.end));
    const dv = new DataView(u8.buffer);

    const mvhd = findAtom(u8, dv, 0, u8.length, 'mvhd');
    if (mvhd) out.duration = mvhdDuration(u8, dv, mvhd.s);

    // Metadaten: moov/udta/meta/ilst
    const udta = findAtom(u8, dv, 0, u8.length, 'udta');
    let meta = findAtom(u8, dv, 0, u8.length, 'meta');
    if (meta) {
      // 'meta' ist FullBox: 4 Byte version/flags vor den Kindern
      const ilst = findAtom(u8, dv, meta.s + 4, meta.e, 'ilst');
      if (ilst) readIlst(u8, dv, ilst.s, ilst.e, out);
    }

    // Kapitel 1: Nero 'chpl' (moov/udta/chpl)
    if (udta) {
      const chpl = findAtom(u8, dv, udta.s, udta.e, 'chpl');
      if (chpl) {
        const ch = parseChpl(u8, dv, chpl.s, chpl.e);
        if (ch.length) out.chapters = ch;
      }
    }

    // Kapitel 2 (Fallback): QuickTime-Text-Kapitelspur
    if (!out.chapters.length) {
      try {
        const qt = await parseQtTextChapters(file, u8, dv, out.duration);
        if (qt.length) out.chapters = qt;
      } catch (_) { /* best effort */ }
    }

    out.chapters.sort((a, b) => a.start - b.start);
    return out;
  }

  // Oberste Atom-Ebene scannen, ohne die ganze Datei zu laden
  async function findTopLevelAtom(file, want) {
    let pos = 0;
    const size = file.size;
    while (pos + 8 <= size) {
      const h = await buf(file.slice(pos, pos + 16));
      const dv = new DataView(h.buffer);
      let asize = dv.getUint32(0);
      const type = ascii(h, 4, 4);
      let hdr = 8;
      if (asize === 1) { asize = dv.getUint32(8) * 4294967296 + dv.getUint32(12); hdr = 16; }
      else if (asize === 0) { asize = size - pos; }
      if (asize < hdr) break;
      if (type === want) return { start: pos + hdr, end: pos + asize };
      pos += asize;
    }
    return null;
  }

  // direktes Kind-Atom eines Bereichs finden (nicht rekursiv über Geschwister hinaus)
  function findAtom(u8, dv, s, e, want) {
    let p = s;
    while (p + 8 <= e) {
      let sz = dv.getUint32(p);
      const type = ascii(u8, p + 4, 4);
      let hdr = 8;
      if (sz === 1) { sz = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); hdr = 16; }
      else if (sz === 0) { sz = e - p; }
      if (sz < hdr || p + sz > e) break;
      if (type === want) return { s: p + hdr, e: p + sz };
      // in bekannte Container absteigen
      if (CONTAINERS.has(type)) {
        const childStart = (type === 'meta') ? p + hdr + 4 : p + hdr;
        const r = findAtom(u8, dv, childStart, p + sz, want);
        if (r) return r;
      }
      p += sz;
    }
    return null;
  }
  const CONTAINERS = new Set(['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia', 'minf', 'stbl', 'edts']);

  function mvhdDuration(u8, dv, s) {
    try {
      const version = u8[s];
      if (version === 1) {
        const ts = dv.getUint32(s + 20);
        const dur = dv.getUint32(s + 24) * 4294967296 + dv.getUint32(s + 28);
        return ts ? dur / ts : undefined;
      } else {
        const ts = dv.getUint32(s + 12);
        const dur = dv.getUint32(s + 16);
        return ts ? dur / ts : undefined;
      }
    } catch (_) { return undefined; }
  }

  function readIlst(u8, dv, s, e, out) {
    let p = s;
    while (p + 8 <= e) {
      let sz = dv.getUint32(p);
      const type = ascii(u8, p + 4, 4);
      if (sz < 8 || p + sz > e) break;
      const data = findAtom(u8, dv, p + 8, p + sz, 'data');
      if (data) {
        const flags = dv.getUint32(data.s) & 0xFFFFFF;
        const payload = u8.subarray(data.s + 8, data.e);   // 4 Byte typeflags + 4 Byte locale
        if (type === 'covr') {
          if (!out.coverBlob && payload.length) {
            const mime = flags === 14 ? 'image/png' : 'image/jpeg';
            out.coverBlob = new Blob([payload], { type: mime });
          }
        } else {
          const txt = (() => { try { return dec('utf-8').decode(payload).trim(); } catch (_) { return ''; } })();
          if (type === '\u00A9nam' && txt) out.title = txt;
          else if ((type === '\u00A9ART' || type === 'aART') && txt && !out.author) out.author = txt;
          else if (type === '\u00A9alb' && txt) out.album = txt;
        }
      }
      p += sz;
    }
  }

  // Nero 'chpl' — Header-Länge variiert je nach Muxer; beide Varianten probieren
  function parseChpl(u8, dv, s, e) {
    for (const headerLen of [9, 5]) {       // 4 (ver/flags) + 4 reserved + 1 count  ODER  4 + 1
      const r = tryChpl(u8, dv, s + headerLen - 1, e, u8[s + headerLen - 1]);
      if (r) return r;
    }
    return [];
  }
  function tryChpl(u8, dv, countPos, e, count) {
    if (!count || count > 2000) return null;
    const chapters = [];
    let p = countPos + 1;
    for (let i = 0; i < count; i++) {
      if (p + 9 > e) return null;
      const t100ns = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4);
      p += 8;
      const len = u8[p]; p += 1;
      if (p + len > e) return null;
      let title = '';
      try { title = dec('utf-8').decode(u8.subarray(p, p + len)).trim(); } catch (_) {}
      p += len;
      chapters.push({ title: title || null, start: t100ns / 1e7 });
    }
    // Plausibilität: Startzeiten müssen monoton steigen
    for (let i = 1; i < chapters.length; i++) if (chapters[i].start < chapters[i - 1].start - 1) return null;
    return chapters;
  }

  /* ---- QuickTime-Text-Kapitelspur (Fallback, best effort) ---- */
  async function parseQtTextChapters(file, u8, dv, fileDur) {
    // Text-Trak finden: trak mit hdlr-Typ 'text'
    let p = 0, textTrak = null;
    while (p + 8 <= u8.length) {
      let sz = dv.getUint32(p); const type = ascii(u8, p + 4, 4);
      if (sz < 8 || p + sz > u8.length) break;
      if (type === 'trak') {
        const hdlr = findAtom(u8, dv, p + 8, p + sz, 'hdlr');
        if (hdlr && ascii(u8, hdlr.s + 8, 4) === 'text') { textTrak = { s: p + 8, e: p + sz }; break; }
      }
      p += sz;
    }
    if (!textTrak) return [];

    const mdhd = findAtom(u8, dv, textTrak.s, textTrak.e, 'mdhd');
    const ts = mdhd ? (u8[mdhd.s] === 1 ? dv.getUint32(mdhd.s + 20) : dv.getUint32(mdhd.s + 12)) : 1000;

    const stts = findAtom(u8, dv, textTrak.s, textTrak.e, 'stts');
    const stsz = findAtom(u8, dv, textTrak.s, textTrak.e, 'stsz');
    const stco = findAtom(u8, dv, textTrak.s, textTrak.e, 'stco') || findAtom(u8, dv, textTrak.s, textTrak.e, 'co64');
    const stsc = findAtom(u8, dv, textTrak.s, textTrak.e, 'stsc');
    if (!stts || !stsz || !stco) return [];

    // Startzeiten aus stts (Sample-Dauern, kumulativ)
    const starts = [];
    {
      const n = dv.getUint32(stts.s + 4); let o = stts.s + 8, acc = 0;
      for (let i = 0; i < n; i++) {
        const cnt = dv.getUint32(o), dur = dv.getUint32(o + 4); o += 8;
        for (let j = 0; j < cnt; j++) { starts.push(acc / ts); acc += dur; }
      }
    }
    // Sample-Größen
    const sizes = [];
    {
      const uni = dv.getUint32(stsz.s + 4), cnt = dv.getUint32(stsz.s + 8);
      if (uni) for (let i = 0; i < cnt; i++) sizes.push(uni);
      else { let o = stsz.s + 12; for (let i = 0; i < cnt; i++) { sizes.push(dv.getUint32(o)); o += 4; } }
    }
    // Chunk-Offsets
    const is64 = ascii(u8, stco.s - 4, 4) === 'co64';
    const chunkOffs = [];
    {
      const n = dv.getUint32(stco.s + 4); let o = stco.s + 8;
      for (let i = 0; i < n; i++) {
        chunkOffs.push(is64 ? dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4) : dv.getUint32(o));
        o += is64 ? 8 : 4;
      }
    }
    // Sample-zu-Chunk
    const stscEntries = [];
    if (stsc) {
      const n = dv.getUint32(stsc.s + 4); let o = stsc.s + 8;
      for (let i = 0; i < n; i++) { stscEntries.push({ first: dv.getUint32(o), per: dv.getUint32(o + 4) }); o += 12; }
    } else stscEntries.push({ first: 1, per: 1 });

    // absolute Datei-Offsets je Sample berechnen
    const sampleOffsets = [];
    let sampleIdx = 0;
    for (let c = 0; c < chunkOffs.length; c++) {
      const per = perChunk(stscEntries, c + 1);
      let off = chunkOffs[c];
      for (let k = 0; k < per && sampleIdx < sizes.length; k++) {
        sampleOffsets.push(off);
        off += sizes[sampleIdx];
        sampleIdx++;
      }
    }

    // Titel aus mdat lesen (jeweils 2-Byte-Längenpräfix + Text)
    const chapters = [];
    for (let i = 0; i < starts.length && i < sampleOffsets.length; i++) {
      const slice = await buf(file.slice(sampleOffsets[i], sampleOffsets[i] + sizes[i]));
      let title = '';
      if (slice.length >= 2) {
        const len = (slice[0] << 8) | slice[1];
        const txt = slice.subarray(2, 2 + Math.min(len, slice.length - 2));
        try { title = dec('utf-8').decode(txt).trim(); } catch (_) {}
      }
      chapters.push({ title: title || null, start: starts[i] });
    }
    return chapters;
  }
  function perChunk(entries, chunkNo) {
    let per = entries[0] ? entries[0].per : 1;
    for (const e of entries) { if (e.first <= chunkNo) per = e.per; else break; }
    return per;
  }

  global.AudioMeta = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
