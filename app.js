'use strict';
/* Local Player — HTML prototype. Vanilla JS, no build step.
   Sections: helpers · filename cleaner · poster providers · IndexedDB · library · views · modal · player · input */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const MOVIE_MIN = 3600;                       // exactly 60 minutes → Movies
const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|ts|mpg|mpeg|3gp|ogv|wmv|flv)$/i;
const SUB_EXT = /\.(vtt|srt)$/i;
const S = { saved: [], known: [], view: 'movies', items: [], posters: new Map(), pl: null, modal: null, uid: 0 };
const prefs = { scale: 1, vol: 1 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('lp') || '{}')); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem('lp', JSON.stringify(prefs)); } catch (e) {} };
const applyScale = () => document.documentElement.style.setProperty('--ui', prefs.scale);

const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? `${h} h ${pad(m)} min` : `${Math.max(1, m)} min`; };
const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); };
const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const extOf = n => ((n.match(/\.([a-z0-9]+)$/i) || [, ''])[1]).toUpperCase();
const pkey = it => it.name + '|' + it.size;
const byId = id => S.items.find(i => i.id === id);
let toastT;
function toast(m, ms = 3200) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

/* ---------- Filename cleaner ---------- */
// Technical tags. "web"/"blu" only count when followed by dl/rip/ray so real title words survive.
const TECH = /^(\d{3,4}p|4k|uhd|bluray|brrip|bdrip|webrip|hdrip|dvdrip|hdtv|hevc|x26[45]|h26[45]|avc|aac|ac3|eac3|dts|ddp|atmos|10bit|8bit|hdr|hdr10|truehd|flac|opus|ddp\d?|dd\d|dvdscr|hdcam|10bits|webdl|remux|proper|repack|yify|yts|amzn|nf|esub|subs?|multi)$/i;
const LANG = /^(hindi|english|tamil|telugu|french|spanish|german|korean|japanese|chinese|dubbed|dual|audio)$/i;
const isTag = (t, n = '') => TECH.test(t) || (/^(web|blu)$/i.test(t) && /^(dl|rip|ray)$/i.test(n));
function clean(name) {
  let s = name.replace(VIDEO_EXT, '')
    .replace(/[\[(]([^\])]*)[\])]/g, (m, x) => /\b(19|20)\d\d\b/.test(x) ? ' ' + x + ' ' : ' ')  // keep "(2019)", drop other brackets
    .replace(/\b[2-9]\.[01]\b/g, ' ')                       // audio layouts 5.1 / 7.1 / 2.0
    .replace(/[._\-+]+/g, ' ').trim();
  const t = s.split(/\s+/).filter(Boolean);
  const tagIdx = t.findIndex((x, i) => i > 0 && isTag(x, t[i + 1]));
  const lim = tagIdx < 0 ? t.length : tagIdx;
  let yi = -1;
  for (let i = lim - 1; i >= 1; i--) if (/^(19|20)\d\d$/.test(t[i])) { yi = i; break; }   // index>0 keeps titles like "2012"
  let head = t.slice(0, yi >= 0 ? yi : lim);
  if (yi < 0) while (head.length > 1 && LANG.test(head[head.length - 1])) head.pop();
  if (!head.length) head = t;
  let title = head.join(' ');
  if (title === title.toLowerCase() || title === title.toUpperCase()) title = title.replace(/\b\w/g, c => c.toUpperCase());
  return { title: title || name, year: yi >= 0 ? +t[yi] : null };
}

/* ---------- Poster providers ----------
   A provider exposes search(title, year) → [{id,title,year,poster(url)}].
   Poster search runs through our own Netlify function; the browser never holds a token. */
const KNOWN = { 'spider man far from home': 'Spider-Man: Far From Home', 'zootopia 2': 'Zootopia 2', 'blade runner 2049': 'Blade Runner 2049' };
const svgPoster = (t, h) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="hsl(${h} 30% 17%)"/><text x="100" y="150" text-anchor="middle" fill="#F1F5F9" font-size="16" font-family="sans-serif">${esc(t.slice(0, 20))}</text><text x="100" y="280" text-anchor="middle" fill="#8ABFD8" font-size="11" font-family="sans-serif">DEMO POSTER</text></svg>`);
const IMG = 'https://image.tmdb.org/t/p/w342';
const TMDB_MSG = { not_configured: 'TMDB is not configured. Add TMDB_READ_ACCESS_TOKEN in Netlify, then redeploy.', invalid_credentials: 'TMDB rejected the saved credentials. Check TMDB_READ_ACCESS_TOKEN in Netlify.', rate_limited: 'TMDB is busy. Wait a moment and try again.', unreachable: 'The search service could not reach TMDB. Try again later.', invalid_title: 'This title cannot be searched.', bad_response: 'TMDB sent an unexpected reply.', upstream_error: 'TMDB returned an error. Try again later.' };
async function tmdbQuery(t, y) {   // calls our own Netlify function; the browser never sees a token
  let r, j = null;
  try { r = await fetch('/api/tmdb-search?title=' + encodeURIComponent(t.slice(0, 120)) + (y ? '&year=' + y : ''), { headers: { accept: 'application/json' } }); }
  catch (e) { throw new Error('You appear to be offline, or the search service cannot be reached. The crown stays.'); }
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(r.status === 404 && !j ? 'The search function was not found. Deploy to Netlify with functions enabled (see NETLIFY-SETUP.md).' : TMDB_MSG[j && j.error] || 'The search failed. Try again later.');
  if (!j || !Array.isArray(j.results)) throw new Error(TMDB_MSG.bad_response);
  return j.results.map(x => ({ id: 'tmdb' + x.id, tmdbId: x.id, title: x.title, original: x.originalTitle, year: x.year, poster: x.posterPath ? IMG + x.posterPath : null }));
}
const PROVIDERS = {
  demo: { label: 'Demo data (test posters, not real artwork)',
    async search(t, y) { const o = KNOWN[t.toLowerCase()] || t, yr = y || 2019;
      return [[o, yr, 205], [o + ' (Extended)', yr - 1, 212], ['Another ' + t, yr - 6, 198]].map((c, i) => ({ id: 'demo' + i, title: c[0], year: c[1], poster: svgPoster(c[0], c[2]) })); } },
  tmdb: { label: 'TMDB',
    async search(t, y) { let r = await tmdbQuery(t, y); if (!r.length && y) r = await tmdbQuery(t); return r; } }   // year filter is strict, so retry without it
};

/* ---------- IndexedDB poster cache ---------- */
const idb = {   // stores: p = posters, h = saved folder handles
  db: null,
  open() { return this.db || (this.db = new Promise(r => { try { const q = indexedDB.open('lp', 2);
    q.onupgradeneeded = () => { const d = q.result; if (!d.objectStoreNames.contains('p')) d.createObjectStore('p', { keyPath: 'key' }); if (!d.objectStoreNames.contains('h')) d.createObjectStore('h', { keyPath: 'name' }); };
    q.onsuccess = () => r(q.result); q.onerror = () => r(null); } catch (e) { r(null); } })); },
  async tx(mode, f, st = 'p') { const d = await this.open(); if (!d) return; return new Promise(r => { const t = d.transaction(st, mode), o = f(t.objectStore(st)); t.oncomplete = () => r(o && o.result); t.onerror = () => r(); }); }
};
async function loadPosters() {
  const recs = (await idb.tx('readonly', s => s.getAll())) || [];
  recs.forEach(r => S.posters.set(r.key, { url: URL.createObjectURL(r.blob), title: r.title, year: r.year }));
  render();
}

/* ---------- Library ---------- */
function probe(file) {   // reads duration without playing; always releases the object URL
  return new Promise(res => {
    const v = document.createElement('video'), u = URL.createObjectURL(file); let done = 0;
    const end = r => { if (done) return; done = 1; clearTimeout(tm); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(u); res(r); };
    const tm = setTimeout(() => end(null), 6000);
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => end({ d: v.duration, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => end(null); v.src = u;
  });
}
const addFiles = fl => addEntries([...fl].map(f => ({ f, path: f.webkitRelativePath || f.name })));
async function runPool(tasks, n) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) await tasks[i++](); })); }
async function addEntries(entries) {   // metadata is read by a small pool (3 at a time) so the TV is not overwhelmed
  const seen = new Set(S.items.map(i => i.path + '|' + i.size)), tasks = []; let done = 0;
  for (const { f, path } of entries) {
    if (seen.has(path + '|' + f.size)) continue;
    seen.add(path + '|' + f.size);
    const it = { id: ++S.uid, name: f.name, path, size: f.size, file: f, kind: 'other' };
    if (VIDEO_EXT.test(f.name) || f.type.startsWith('video/')) {
      Object.assign(it, clean(f.name), { kind: 'pending' });
      tasks.push(async () => {
        const m = await probe(f);
        if (m && isFinite(m.d) && m.d > 0) Object.assign(it, { dur: m.d, w: m.w, h: m.h, kind: m.d >= MOVIE_MIN ? 'movie' : 'video' });   // category comes from real duration only
        else it.kind = 'bad';
        toast(`Reading media details (${++done} of ${tasks.length})`, 60000);
      });
    }
    it.title = it.title || f.name;
    S.items.push(it);
  }
  render();
  await runPool(tasks, 3);
  render(); toast(entries.length ? (tasks.length ? 'Library updated' : 'Files added') : 'Nothing selected');
}
// Saved folders (File System Access API, where supported). Only the folder handle is stored, never file contents.
const canKeep = () => !!window.showDirectoryPicker;
async function walk(dir, base, out, d) { for await (const [n, e] of dir.entries()) { if (out.length >= 5000) return; try { if (e.kind === 'file') out.push({ f: await e.getFile(), path: base + n }); else if (d < 6) await walk(e, base + n + '/', out, d + 1); } catch (x) {} } }
async function scanHandle(h) { const out = []; await walk(h, h.name + '/', out, 0); await addEntries(out); }
async function restoreFolders(ask) {
  const hs = (await idb.tx('readonly', s => s.getAll(), 'h')) || []; S.known = hs.map(r => r.name); S.saved = [];
  for (const r of hs) { try { let p = await r.handle.queryPermission({ mode: 'read' }); if (p !== 'granted' && ask) p = await r.handle.requestPermission({ mode: 'read' }); if (p === 'granted') await scanHandle(r.handle); else S.saved.push(r.name); } catch (e) { S.saved.push(r.name); } }
  render();
}
function loadDemo() {
  S.items = S.items.filter(i => !i.demo);
  const d = [['Zootopia-2.2025.1080p.10bit.BluRay.Hindi.5.1-English.5.1.HEVC.x265.mkv', 6480, 3.9e9],
    ['Spider.Man.Far.from.Home.2019.720p.mp4', 7740, 1.4e9], ['Blade_Runner_2049_2017_2160p_UHD_BluRay_x265.mkv', 9840, 8.2e9],
    ['The.Web.Of.Time.2021.WEB-DL.x264.mp4', 5400, 1.1e9], ['Alpine Timelapse 4K.mp4', 312, 4.2e8],
    ['Cooking.Basics.Ep03.720p.mp4', 1860, 3.1e8], ['Lecture_12_Thermodynamics.webm', 3120, 5.5e8]];
  d.forEach(([name, dur, size]) => S.items.push(Object.assign({ id: ++S.uid, name, path: name, size, demo: true, dur, w: 1920, h: 1080, kind: dur >= MOVIE_MIN ? 'movie' : 'video' }, clean(name))));
  ['notes.txt', 'cover.jpg'].forEach(name => S.items.push({ id: ++S.uid, name, path: name, size: 24000, demo: true, kind: 'other', title: name }));
  render(); toast('Demo library loaded. Demo entries are labelled and have no media.');
}
const disp = it => { const p = S.posters.get(pkey(it)); return { title: p ? p.title : it.title, year: p ? p.year : it.year, poster: p && p.url }; };
const list = k => S.items.filter(i => i.kind === k).sort((a, b) => disp(a).title.localeCompare(disp(b).title));

/* ---------- Views ---------- */
const head = (h, p) => `<h1>${h}</h1><p class="lede">${p}</p>`;
const empty = (h, p) => `<div class="empty"><h2>${h}</h2><p>${p}</p><div class="acts"><button class="btn" data-act="addfolder">Choose folder</button><button class="btn" data-act="addfiles">Choose files</button><button class="btn" data-act="demo">Load demo library</button></div></div>`;
const hue = it => 198 + [...it.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 19;   // stays inside the blue range
const resLabel = it => !it.w ? '' : it.w >= 3800 ? '4K' : it.w >= 1900 ? '1080p' : it.w >= 1200 ? '720p' : it.w + '×' + it.h;
const chips = it => `<span class="chips">${it.w ? `<i>${resLabel(it)}</i>` : ''}<i>${fmtSize(it.size)}</i><i>${extOf(it.name)}</i>${it.demo ? '<i class="demo">Demo entry</i>' : ''}</span>`;
const card = it => { const d = disp(it);
  return `<button class="card" data-act="play" data-id="${it.id}"><span class="poster" style="--h:${hue(it)}">${d.poster ? `<img loading="lazy" decoding="async" alt="" src="${d.poster}">` : '<i class="crown"></i>'}</span>
  <span class="info"><span class="t">${esc(d.title)}</span><span class="sub">${d.year ? `<span>${d.year}</span>` : ''}<span>${fmtDur(it.dur)}</span></span>${chips(it)}</span></button>`; };
const tile = it => `<button class="tile" data-act="play" data-id="${it.id}"><span class="thumb" style="--h:${hue(it)}"><b>${fmtT(it.dur)}</b></span><span class="t">${esc(it.title)}</span>${chips(it)}</button>`;
const hero = it => { const d = disp(it);   // large panel for the focused movie
  return `${d.poster ? `<img class="hb" alt="" src="${d.poster}">` : ''}<div class="hh"><div class="ht">${esc(d.title)}</div><div class="hm">${d.year ? `<span>${d.year}</span>` : ''}<span>${fmtDur(it.dur)}</span>${it.w ? `<span>${resLabel(it)}</span>` : ''}</div><div class="hf">${esc(it.name)}</div><button class="pri" data-act="play" data-id="${it.id}">Play</button></div>`; };
const frow = it => { const v = it.kind === 'movie' || it.kind === 'video';
  const st = v ? 'Plays in video player' : it.kind === 'pending' ? 'Reading details…' : it.kind === 'bad' ? 'Not readable here (unsupported codec or container)' : 'Not a video file';
  return `<button class="frow" data-act="${v ? 'play' : 'nofile'}" data-id="${it.id}"><span>${esc(extOf(it.name) || 'FILE')}</span><span class="n">${esc(it.name)}${it.demo ? ' (demo)' : ''}</span><span>${fmtSize(it.size)}</span><span>${st}</span></button>`; };

const V = {
  movies() { const l = list('movie');
    return (l.length ? `<section class="hero" id="hero">${hero(l[0])}</section><p class="lede">Movies of 60 minutes or longer</p><div class="grid wide">${l.map(card).join('')}</div>` : head('Movies', 'Nothing here yet') + empty('No movies yet', 'Add a folder or files. Anything 60 minutes or longer is sorted here.')); },
  videos() { const l = list('video');
    return head('Videos', 'Videos shorter than 60 minutes') + (l.length ? `<div class="grid tiles">${l.map(tile).join('')}</div>` : empty('No videos yet', 'Videos shorter than 60 minutes appear here.')); },
  files() { const l = [...S.items].sort((a, b) => a.name.localeCompare(b.name));
    return head('Files', 'Files from the selected location') + (l.length ? `<div class="files">${l.map(frow).join('')}</div>` : empty('No files selected', 'Browsers only see what you choose. The Android app will scan storage and USB drives.')); },
  settings() { const m = list('movie');
    const rows = m.map(it => { const d = disp(it), has = !!d.poster;
      return `<div class="line"><div><div>${esc(d.title)}${d.year ? ' (' + d.year + ')' : ''}${it.demo ? ' · demo' : ''}</div><div class="st">${has ? 'Poster cached' : 'No poster. The crown is shown'}</div></div><button class="btn" data-act="fetch" data-id="${it.id}">${has ? 'Change poster' : 'Fetch poster'}</button></div>`; }).join('');
    return head('Settings', 'Prototype preferences and the Thumbnail Manager')
      + `<h2>Interface</h2><div class="line"><span>Text size</span><div class="seg">${[0.85, 1, 1.2].map(s => `<button class="btn${prefs.scale === s ? ' on' : ''}" data-act="scale" data-s="${s}">${Math.round(s * 100)}%</button>`).join('')}</div></div>`
      + `<h2>Thumbnail Manager</h2><p class="lede">Posters come from TMDB. You choose every match yourself. Demo entries use labelled demo posters.</p>` + (rows || '<p class="lede">No movies detected yet.</p>')
      + `<h2>Library</h2><div class="line"><div><div>Folder memory</div><div class="st">${canKeep() ? 'Supported. Folders you add are remembered; the browser may ask permission again after you reopen it.' : 'Not supported in this browser. Select your folder again after reopening it. Browsers cannot scan the whole device.'}</div></div>${canKeep() && S.saved.length ? '<button class="btn" data-act="restorefolders">Reopen saved folders</button>' : ''}${canKeep() && S.known.length ? '<button class="btn" data-act="forgetfolders">Forget folders</button>' : ''}</div><h2>Storage</h2><div class="line"><span>Poster cache (IndexedDB)</span><button class="btn" data-act="clearposters">Clear</button></div><div class="line"><span>Library (files are never changed)</span><button class="btn" data-act="clearlib">Clear</button></div>`
      + `<h2>About and credits</h2><div class="line"><div><p class="notice">This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p class="st">Movie data and posters come from TMDB. Only posters you select are saved, on this device.</p></div><span class="tm"><img src="assets/tmdb-logo.svg" alt="TMDB" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><b hidden>TMDB</b></span></div>`; }
};
function render() {
  $('#main').innerHTML = V[S.view]();
  document.querySelectorAll('#nav button').forEach(b => { b.dataset.v === S.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
}

/* ---------- Poster picker modal ---------- */
async function openFetch(id) {
  const it = byId(id); S.modal = { id, prov: it.demo ? 'demo' : 'tmdb', cands: null, err: null };
  drawModal();
  try { S.modal.cands = await PROVIDERS[S.modal.prov].search(it.title, it.year); } catch (e) { S.modal.err = e.message; }
  if (S.modal) drawModal();
}
function drawModal() {
  const m = S.modal, it = byId(m.id), M = $('#modal'), lab = PROVIDERS[m.prov].label;
  const body = m.err ? `<p>${esc(m.err)}</p>` : !m.cands ? '<p>Searching…</p>'
    : !m.cands.length ? `<p>No matches found for “${esc(it.title)}”. The crown stays, and your file is untouched.</p>`
    : `<p class="lede">Source: ${lab}. Pick the correct poster. Nothing is chosen for you.</p><div class="cands">${m.cands.map((c, i) => `<button class="cand" data-act="pick" data-i="${i}"${c.poster ? '' : ' disabled'}>${c.poster ? `<img loading="lazy" alt="" src="${c.poster}" onerror="this.style.visibility='hidden'">` : '<span class="np"><i class="crown"></i></span>'}<span>${esc(c.title)}</span><span class="st">${c.year || 'Year unknown'}${c.poster ? '' : ', no poster'}</span></button>`).join('')}</div>`;
  M.innerHTML = `<div class="dlg"><h1>${esc(disp(it).title)}</h1>${body}<button class="btn" data-act="closemodal">Cancel</button></div>`;
  M.hidden = false; M.querySelector('button').focus();
}
function closeModal() {
  const id = S.modal && S.modal.id; S.modal = null; $('#modal').hidden = true;
  const b = document.querySelector(`[data-act=fetch][data-id="${id}"]`); (b || document.querySelector('#nav [aria-current]')).focus();
}
async function pickPoster(i) {
  const c = S.modal.cands[i], it = byId(S.modal.id), key = pkey(it);
  try {
    const blob = await (await fetch(c.poster)).blob(); if (!/^image\//.test(blob.type)) throw new Error('not an image');
    const old = S.posters.get(key); if (old) URL.revokeObjectURL(old.url);
    const saved = await idb.tx('readwrite', s => s.put({ key, blob, title: c.title, year: c.year, tmdbId: c.tmdbId || null }));
    S.posters.set(key, { url: URL.createObjectURL(blob), title: c.title, year: c.year });
    closeModal(); render(); toast(saved === undefined && !(await idb.open()) ? 'Poster applied for this session only (storage unavailable)' : 'Poster saved');
  } catch (e) { toast('The poster could not be downloaded. The crown stays.'); }
}

/* ---------- Player ---------- */
const P = $('#player'), V_ = $('#vid');
function showUI(grab) {
  P.classList.remove('idle'); clearTimeout(S.hide);
  if (grab && (!P.contains(document.activeElement) || document.activeElement === V_)) $('#b-pp').focus();   // only grab focus when asked; mouse moves never do
  if (!V_.paused) S.hide = setTimeout(() => P.classList.add('idle'), 4000);   // one-shot timer, only while playing
}
function releaseMedia() {
  V_.pause(); V_.removeAttribute('src'); V_.querySelectorAll('track').forEach(t => t.remove()); V_.load();
  if (S.pl) { if (S.pl.url) URL.revokeObjectURL(S.pl.url); if (S.pl.sub) URL.revokeObjectURL(S.pl.sub); S.pl.url = S.pl.sub = null; }
}
function openPlayer(id) {
  const it = byId(id); S.pl = { list: list(it.kind), it };
  P.hidden = false; V_.volume = prefs.vol; $('#vol').value = prefs.vol * 100; $('#vol').style.setProperty('--p', prefs.vol * 100 + '%'); loadItem(it);
}
function loadItem(it) {
  releaseMedia(); S.pl.it = it; $('#perr').hidden = true;
  const d = disp(it);
  $('#ptitle').textContent = d.title;
  $('#pinfo').textContent = [d.year, it.w && it.w + '×' + it.h, extOf(it.name), fmtSize(it.size), it.name].filter(Boolean).join('   ');
  const i = S.pl.list.indexOf(it); $('#b-prev').disabled = i < 1; $('#b-next').disabled = i >= S.pl.list.length - 1;
  if (!it.file) { playErr('This is a demo entry with no media behind it. Choose real files to test playback.'); return; }
  S.pl.url = URL.createObjectURL(it.file); V_.src = S.pl.url; V_.playbackRate = +parseFloat($('#b-speed').textContent) || 1;
  const base = it.path.replace(VIDEO_EXT, ''), sub = S.items.find(s => s.file && SUB_EXT.test(s.name) && s.path.replace(SUB_EXT, '') === base);
  if (sub) sub.file.text().then(t => {                       // sidecar .srt/.vtt with the same name
    if (!S.pl || S.pl.it !== it) return;
    const vtt = /^WEBVTT/.test(t) ? t : 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2');
    S.pl.sub = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    const tr = document.createElement('track'); tr.kind = 'subtitles'; tr.label = 'Subtitles'; tr.src = S.pl.sub; V_.appendChild(tr); tr.track.mode = 'showing';
  });
  V_.play().catch(() => {}); showUI(true);
}
function playErr(msg) { const e = $('#perr'); e.textContent = msg; e.hidden = false; P.classList.remove('idle'); clearTimeout(S.hide); }
function closePlayer() {
  const id = S.pl && S.pl.it.id; releaseMedia(); S.pl = null; clearTimeout(S.hide); P.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen();
  const b = document.querySelector(`#main [data-id="${id}"]`); (b || document.querySelector('#nav [aria-current]')).focus();
}
const togglePlay = () => V_.paused ? V_.play().catch(() => {}) : V_.pause();
const seekBy = d => { V_.currentTime = Math.min(V_.duration || 1e9, Math.max(0, V_.currentTime + d)); };
const setVol = p => { V_.volume = Math.min(1, Math.max(0, p / 100)); V_.muted = false; $('#vol').value = V_.volume * 100; $('#vol').style.setProperty('--p', V_.volume * 100 + '%'); prefs.vol = V_.volume; savePrefs(); };
const step = d => { const l = S.pl.list, n = l[l.indexOf(S.pl.it) + d]; n ? loadItem(n) : toast('No more videos in this direction'); };
const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen(); else { const r = P.requestFullscreen || P.webkitRequestFullscreen; r ? r.call(P) : toast('Fullscreen is not available here'); } };
function updTime() { const d = V_.duration; $('#time').textContent = fmtT(V_.currentTime) + ' / ' + fmtT(d); if (d) { const v = V_.currentTime / d * 1000; $('#seek').value = v; $('#seek').style.setProperty('--p', v / 10 + '%'); } }
V_.addEventListener('timeupdate', updTime);
V_.addEventListener('loadedmetadata', updTime);
V_.addEventListener('play', () => { $('#b-pp').textContent = 'Pause'; showUI(); });
V_.addEventListener('pause', () => { $('#b-pp').textContent = 'Play'; clearTimeout(S.hide); P.classList.remove('idle'); });
V_.addEventListener('ended', () => { const l = S.pl && S.pl.list; if (l && l.indexOf(S.pl.it) < l.length - 1) step(1); });
V_.addEventListener('error', () => { if (S.pl && S.pl.url) playErr(V_.error && V_.error.code === 4
  ? "This browser can't decode this file's format or codec. MKV and HEVC often fail in browsers; the Android app will use the TV's own decoders."
  : 'Playback stopped because of a read or decode error.'); });
V_.addEventListener('click', togglePlay);
$('#seek').addEventListener('input', e => { e.target.style.setProperty('--p', e.target.value / 10 + '%'); if (V_.duration) V_.currentTime = e.target.value / 1000 * V_.duration; });
$('#vol').addEventListener('input', e => setVol(+e.target.value));
document.addEventListener('focusin', e => { const c = e.target.closest && e.target.closest('.card'), h = $('#hero'); if (c && h) { const it = byId(+c.dataset.id); if (it) h.innerHTML = hero(it); } });
P.addEventListener('mousemove', e => { if (e.movementX !== 0 || e.movementY !== 0) showUI(); });

/* ---------- Actions (event delegation) ---------- */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const ACT = {
  view: b => { S.view = b.dataset.v; render(); const m = $('#main'); m.classList.remove('in'); void m.offsetWidth; m.classList.add('in'); },
  addfolder: async () => {
    if (canKeep()) { try { const h = await window.showDirectoryPicker({ mode: 'read' }); await idb.tx('readwrite', s => s.put({ name: h.name, handle: h }), 'h'); if (!S.known.includes(h.name)) S.known.push(h.name); await scanHandle(h); } catch (e) { if (e.name !== 'AbortError') toast('That folder could not be opened.'); } return; }
     const i = $('#fFolder'); if ('webkitdirectory' in i) i.click(); else { toast('Folder picking is not supported here. Choose files instead.'); $('#fFiles').click(); } },
  addfiles: () => $('#fFiles').click(),
  demo: loadDemo,
  play: (b, id) => openPlayer(id),
  nofile: () => toast('This file type cannot be opened in the prototype.'),
  fetch: (b, id) => openFetch(id),
  pick: b => pickPoster(+b.dataset.i),
  closemodal: closeModal,
  scale: b => { prefs.scale = +b.dataset.s; applyScale(); savePrefs(); render(); const n = document.querySelector('[data-act=scale].on'); if (n) n.focus(); },
  restorefolders: () => restoreFolders(true),
  forgetfolders: async () => { await idb.tx('readwrite', s => s.clear(), 'h'); S.known = []; S.saved = []; render(); toast('Saved folders forgotten'); },
  clearposters: async () => { S.posters.forEach(p => URL.revokeObjectURL(p.url)); S.posters.clear(); await idb.tx('readwrite', s => s.clear()); render(); toast('Poster cache cleared'); },
  clearlib: () => { S.items = []; render(); toast('Library cleared. Your files were not touched.'); },
  pp: togglePlay, prev: () => step(-1), next: () => step(1), fs: toggleFs, close: closePlayer,
  mute: () => { V_.muted = !V_.muted; toast(V_.muted ? 'Muted' : 'Sound on'); },
  speed: b => { const i = (SPEEDS.indexOf(V_.playbackRate) + 1) % SPEEDS.length; V_.playbackRate = SPEEDS[i]; b.textContent = SPEEDS[i] + '×'; },
  cc: () => { const t = V_.textTracks[0]; if (!t) return toast('No subtitles found. Add a .srt or .vtt with the same name as the video.'); t.mode = t.mode === 'showing' ? 'hidden' : 'showing'; }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (!P.hidden) showUI();
  const f = ACT[b.dataset.act]; if (f) f(b, +b.dataset.id);
});
$('#fFolder').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('#fFiles').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

/* ---------- Remote / keyboard navigation ---------- */
function move(dir, root) {   // spatial focus: nearest focusable in the pressed direction
  const els = [...root.querySelectorAll('button,input')].filter(x => x.getClientRects().length && !x.disabled);
  const cur = document.activeElement;
  if (!els.includes(cur)) { if (els[0]) els[0].focus(); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bs = 1e12;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const p = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy;
    const q = (dir === 'ArrowRight' || dir === 'ArrowLeft') ? Math.abs(dy) : Math.abs(dx);
    if (p <= 1) continue;
    const sc = p + q * 3; if (sc < bs) { bs = sc; best = el; }
  }
  if (best) best.focus();
}
function playerKey(e) {
  const k = e.key, f = document.activeElement, idle = P.classList.contains('idle');
  if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closePlayer(); return; }
  const keys = { ' ': togglePlay, k: togglePlay, MediaPlayPause: togglePlay, f: toggleFs, m: () => ACT.mute(), j: () => seekBy(-10), l: () => seekBy(10), n: () => step(1), p: () => step(-1), MediaTrackNext: () => step(1), MediaTrackPrevious: () => step(-1) };
  if (keys[k] && !(k === ' ' && f.tagName === 'BUTTON')) { e.preventDefault(); keys[k](); showUI(); return; }
  if (k.startsWith('Arrow')) {
    e.preventDefault(); const wasIdle = idle; showUI(idle);
    const dx = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
    if (wasIdle) { if (dx) seekBy(dx * 10); return; }        // hidden controls: left/right seek, up/down reveal
    if (dx && f.id === 'seek') seekBy(dx * 10);
    else if (dx && f.id === 'vol') setVol(V_.volume * 100 + dx * 5);
    else move(k, P);
    return;
  }
  if (k === 'Enter' && idle) { e.preventDefault(); togglePlay(); }
  showUI();
}
document.addEventListener('keydown', e => {
  const k = e.key;
  if (!$('#modal').hidden) { if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closeModal(); } else if (k.startsWith('Arrow')) { e.preventDefault(); move(k, $('#modal')); } return; }
  if (!P.hidden) { playerKey(e); return; }
  if (k.startsWith('Arrow')) { e.preventDefault(); move(k, document.body); }
  else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); document.querySelector('#nav [aria-current]').focus(); }   // Back returns to the menu
});

/* ---------- Start ---------- */
window.addEventListener('beforeunload', () => { S.posters.forEach(p => URL.revokeObjectURL(p.url)); });
applyScale(); render(); loadPosters().then(() => { if (canKeep()) restoreFolders(false); });
document.querySelector('#nav [aria-current]').focus();
