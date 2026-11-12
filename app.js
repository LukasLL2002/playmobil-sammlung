// Sortiva – sortieren & bewahren (Supabase + Vanilla JS)
'use strict';

const SUPABASE_URL = 'https://nmuwmlmrmktjhquanejk.supabase.co';
// Öffentlicher Publishable Key (darf im Browser stehen; Schutz läuft über RLS)
const SUPABASE_KEY = 'sb_publishable_gLdgwbvvbcmTdgdfXI5c1A_7ZNlW1vt';
const BUCKET = 'bilder';

if (!window.supabase?.createClient) {
  throw new Error('Verbindung konnte nicht vorbereitet werden. Bitte Seite neu laden.');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ASSET_V = '20261112-2';
const _scriptLoads = {};
function loadScript(src) {
  if (_scriptLoads[src]) return _scriptLoads[src];
  _scriptLoads[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Datei konnte nicht geladen werden. Bitte Verbindung prüfen.'));
    document.head.appendChild(s);
  });
  return _scriptLoads[src];
}
async function ensureQR() {
  if (typeof qrcode === 'function') return;
  await loadScript('vendor/qrcode/qrcode.min.js?v=1.4.4');
  if (typeof qrcode !== 'function') throw new Error('QR-Codes sind gerade nicht verfügbar.');
}
async function ensureReceipt() {
  if (typeof window.viewBon === 'function') return;
  await loadScript('receipt.js?v=' + ASSET_V);
  if (typeof window.viewBon !== 'function') throw new Error('Bon-Scanner ist gerade nicht verfügbar.');
}
async function openBonView() {
  if (typeof window.viewBon !== 'function') {
    app.innerHTML = '<div class="center muted" style="padding:3rem">Bon-Scanner wird geöffnet …</div>';
    await ensureReceipt();
  }
  window.viewBon();
}

const state = { user: null, isAdmin: false, viewUid: null, viewEmail: null, viewKind: null, viewRecht: null, viewBereich: null, shares: [], merges: [], kisten: [], sets: [], teile: [], loaded: false, imgCache: {},
  filter: { q: '', farbe: '', kiste: '', set: '', nr: '' } };
const app = document.getElementById('app');

// ---------- Hilfsfunktionen ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
/** Einzelpreis + Gesamt bei Menge > 1 (unit = Preis pro Stück/Packung). */
const priceLine = (unit, qty) => {
  if (unit == null || unit === '' || Number.isNaN(Number(unit))) return '';
  const u = Number(unit), q = Number(qty) || 0;
  if (q > 1) return `Einzelpreis: ${euro(u)} · Gesamt: ${euro(u * q)}`;
  return euro(u);
};
const priceLineHtml = (unit, qty) => { const t = priceLine(unit, qty); return t ? `<div class="sub price">${esc(t)}</div>` : ''; };

/** Ein sichtbares Eingabefeld + unsichtbare datalist-Vorschläge (kein doppeltes Select). */
function suggestField(id, value, suggestions, placeholder = '', _pickLabel = '') {
  const opts = [...new Set((suggestions || []).map(s => String(s).trim()).filter(Boolean))];
  const val = value == null ? '' : String(value);
  const listId = id + 'List';
  return `<div class="suggest" data-suggest="${esc(id)}">
    <input id="${id}" name="${id}" list="${listId}" value="${esc(val)}" placeholder="${esc(placeholder)}" autocomplete="off" inputmode="text">
    <datalist id="${listId}">${opts.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
  </div>`;
}
function writeInputValue(el, value) {
  if (!el) return false;
  const next = value == null ? '' : String(value);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, next); else el.value = next;
  try { el.setAttribute('value', next); } catch { /* */ }
  el.classList.add('suggest-applied');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return String(el.value) === next;
}
/** Früher Select-Sync – kein Select mehr, bewusst No-Op. */
function syncSuggestPick(_id, _value) { return true; }
function bindSuggest(id) {
  // datalist braucht keinen Extra-Listener; Input-Events bleiben am Feld
  const inp = document.getElementById(id);
  if (!inp) return;
}
const num = n => (Number(n) || 0).toLocaleString('de-DE');
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const baseUrl = () => location.origin + location.pathname;
const kisteUrl = id => baseUrl() + '#kiste/' + id;
function toast(msg, ms = 2500) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); }
function friendlyError(err) {
  if (!err) return 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return 'Du bist gerade offline. Neue Einträge werden gespeichert und später übertragen.';
  const code = err.code || err.status;
  if (code === '42501') return 'Du darfst das hier nicht ändern (nur Leserecht).';
  if (code === '23505') return 'Diesen Eintrag gibt es bei dir schon – bitte einen anderen Namen oder eine andere Nummer wählen.';
  if (code === '23503') return 'Dieser Eintrag gehört zu einem anderen Konto und kann so nicht verknüpft werden.';
  if (code === 'PGRST301' || code === 401) return 'Bitte melde dich erneut an.';
  let msg = String(err.message || err || '').trim();
  if (!msg) return 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
  // Technische DB-/Netz-Texte abmildern
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg))
    return 'Keine Verbindung. Prüfe dein Internet und versuche es erneut.';
  if (/JWT|refresh_token|session|Auth/i.test(msg)) return 'Bitte melde dich erneut an.';
  if (/row-level security|RLS|permission denied|violates/i.test(msg)) return 'Keine Berechtigung für diese Aktion.';
  if (/duplicate key/i.test(msg)) return 'Diesen Eintrag gibt es schon.';
  if (/column|relation|schema|null value|PGRST/i.test(msg)) return 'Speichern hat nicht geklappt. Bitte Eingaben prüfen und erneut versuchen.';
  if (msg.length > 160) msg = msg.slice(0, 157) + '…';
  return msg;
}
function fail(err) {
  console.error(err);
  toast(friendlyError(err), 5000);
}
// Wessen Daten werden angezeigt? Normal: eigene. Admin kann andere Konten ansehen.
const owner = () => state.viewUid || state.user.id;
const kisteById = id => state.kisten.find(k => k.id === Number(id));
const setById = id => state.sets.find(s => s.id === Number(id));
const kisteLabel = k => k ? `${k.art || 'Kiste'}${String(k.nummer ?? '').trim() ? ' ' + String(k.nummer).trim() : ''}${k.name ? ' – ' + k.name : (String(k.nummer ?? '').trim() ? '' : ' (ohne Nummer)')}` : '';
/** Teile-Nummer: „---“ usw. gilt als keine Nummer */
const cleanNr = v => { const s = String(v ?? '').trim(); return /^[-–—_]+$/.test(s) ? '' : s; };
const hasNr = t => !!cleanNr(t?.teile_nr) && !t?.nummer_unbekannt;
const NR_BADGE = '<span class="badge orange nrbadge">ohne Nr.</span>';
/** Lazy: Teilenummer-Suche */
async function openPartSearch(opts) {
  if (typeof window.partSearchDialog !== 'function') await loadScript('partsearch.js?v=' + ASSET_V);
  return window.partSearchDialog(opts);
}
/** Feld „Teile-Nr.“ mit „Keine Nummer gefunden“ und „Nummer suchen“ */
function nrFieldHtml(t) {
  const unk = !!t.nummer_unbekannt || (!!t.teile_nr && !cleanNr(t.teile_nr));
  return `<label for="nr">Teile-Nr.</label><input id="nr" value="${esc(unk ? '' : t.teile_nr)}" inputmode="text" placeholder="z.B. 30 01 2340" ${unk ? 'disabled' : ''}>
    <label class="sheetrow" style="margin:.35rem 0 0;font-weight:400"><input type="checkbox" id="nrUnk" ${unk ? 'checked' : ''}> Keine Nummer gefunden</label>
    <button type="button" class="btn small secondary" id="nrSearch" style="margin-top:.35rem">🔍 Teil suchen (Foto, Name, Beschreibung)</button>`;
}
function bindNrField(kind, getName) {
  const nr = document.getElementById('nr'), unk = document.getElementById('nrUnk');
  unk.onchange = () => { nr.disabled = unk.checked; if (unk.checked) nr.value = ''; else nr.focus(); };
  document.getElementById('nrSearch').onclick = () => openPartSearch({ kind, name: getName(), onPick: s => {
    unk.checked = false; nr.disabled = false; nr.value = s.nr || '';
    const b = document.getElementById(kind === 'lego' ? 'bes' : 'beschr'); if (b && !b.value.trim() && s.name) b.value = s.name;
    const fb = document.getElementById('farbe'); if (fb && !fb.value.trim() && s.farbe) fb.value = s.farbe;
    toast('Übernommen – bitte prüfen und speichern.');
  } }).catch(fail);
}
const nrValues = () => { const unk = document.getElementById('nrUnk').checked; return { teile_nr: unk ? null : (document.getElementById('nr').value.trim() || null), nummer_unbekannt: unk }; };
const setLabel = s => s ? `${s.set_nummer}${s.name ? ' ' + s.name : ''}` : '';
const teilSets = t => (t.teil_sets || []).map(x => setById(x.set_id)).filter(Boolean);
const teilTitle = t => t.beschreibung || (t.teile_nr ? 'Teil ' + t.teile_nr : 'Ohne Beschreibung');
const sortNat = (a, b) => String(a).localeCompare(String(b), 'de', { numeric: true });

const FARBEN = { rot: '#d32f2f', blau: '#1976d2', grün: '#388e3c', gruen: '#388e3c', gelb: '#fbc02d', schwarz: '#212121', weiß: '#fff', weiss: '#fff', grau: '#9e9e9e', braun: '#795548', orange: '#f57c00', rosa: '#f48fb1', pink: '#e91e63', lila: '#8e24aa', violett: '#8e24aa', silber: '#c0c0c0', gold: '#d4af37', beige: '#e8d8b0', türkis: '#26c6da', hellblau: '#64b5f6', dunkelblau: '#0d47a1', hellgrün: '#81c784', dunkelgrün: '#1b5e20', transparent: 'transparent' };
const dot = f => { const c = FARBEN[norm(f).trim()]; return c ? `<span class="colordot" style="background:${c}"></span>` : ''; };

// ---------- Daten ----------
/** Alle Zeilen holen – der Server liefert pro Abfrage höchstens 1000, deshalb seitenweise (stabil nach id sortiert). */
async function selectAll(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const r = await build().order('id', { ascending: true }).range(from, from + page - 1);
    if (r.error) return r;
    out.push(...r.data);
    if (r.data.length < page) return { data: out, error: null };
  }
}
async function loadAll() {
  const [k, s, t] = await Promise.all([
    selectAll(() => sb.from('kisten').select('*').eq('user_id', owner())),
    selectAll(() => sb.from('sets').select('*').eq('user_id', owner())),
    selectAll(() => sb.from('teile').select('*, teil_sets(set_id)').eq('user_id', owner())),
  ]);
  if (t.data) t.data.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id - a.id);
  for (const r of [k, s, t]) if (r.error) throw r.error;
  state.kisten = k.data.sort((a, b) => sortNat(a.nummer, b.nummer));
  state.sets = s.data.sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
  state.teile = t.data;
  state.loaded = true;
  // Bilder nachziehen – Liste kann schon erscheinen
  loadImageUrls([...state.teile, ...state.sets]).then(() => {
    const h = (location.hash || '').slice(1);
    // Nur Listen neu zeichnen – offene Formulare nicht verwerfen
    if (h === 'teile' || h === 'kisten' || h === 'sets' || h === 'reserve' || h === 'uebersicht' || /^(set|kiste)\/\d+$/.test(h) || /^teil\/\d+$/.test(h)) {
      try { route(); } catch { /* */ }
    }
  }).catch(e => console.warn(e));
}

// Mehrere Bilder: bilder[0] = Titelbild; ältere Einträge haben nur bild_url
const imgList = r => (r && Array.isArray(r.bilder) && r.bilder.length) ? r.bilder.filter(Boolean) : (r && r.bild_url ? [r.bild_url] : []);
async function loadImageUrls(rows) {
  const paths = [...new Set((rows || []).flatMap(imgList).filter(p => p && !state.imgCache[p]))];
  if (!paths.length) return;
  for (let i = 0; i < paths.length; i += 500) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 500), 60 * 60 * 12);
    if (error) { console.warn(error); return; }
    (data || []).forEach(d => { if (d.signedUrl) state.imgCache[d.path] = d.signedUrl; });
  }
}
const imgUrl = t => { const p = imgList(t)[0]; return p ? state.imgCache[p] || null : null; };
const thumb = (t, icon = '🧩') => { const u = imgUrl(t); const n = imgList(t).length;
  return u ? `<span class="thumbwrap"><img class="thumb" src="${esc(u)}" alt="" loading="lazy">${n > 1 ? `<span class="thumbcount">${n}</span>` : ''}</span>` : `<div class="thumb">${icon}</div>`; };
/** Bilder-Ansicht im Detail: großes Titelbild + kleine Vorschaubilder */
function photoStrip(row) {
  const urls = imgList(row).map(p => state.imgCache[p]).filter(Boolean);
  if (!urls.length) return '';
  return `<div class="pstrip"><img class="big-photo" data-pbig src="${esc(urls[0])}" alt="">
    ${urls.length > 1 ? `<div class="pthumbs">${urls.map((u, i) => `<img src="${esc(u)}" alt="Bild ${i + 1}" data-psrc="${esc(u)}" class="${i ? '' : 'on'}">`).join('')}</div>` : ''}</div>`;
}
function bindPhotoStrip(root = document) {
  root.querySelectorAll('.pstrip').forEach(s => s.querySelectorAll('[data-psrc]').forEach(im => im.onclick = () => {
    s.querySelector('[data-pbig]').src = im.dataset.psrc;
    s.querySelectorAll('[data-psrc]').forEach(x => x.classList.toggle('on', x === im));
  }));
}
/** Foto-Auswahl mit mehreren Bildern (hinzufügen, entfernen, Titelbild wählen) */
function galleryHtml(id) {
  return `<div class="gallery" id="${id}"></div>
    <div class="row" style="margin-top:.4rem">
      <label class="btn secondary grow" style="margin:0">📷 Foto aufnehmen<input data-gcam type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn secondary grow" style="margin:0">🖼️ Aus Galerie<input data-ggal type="file" accept="image/*" multiple hidden></label>
    </div>`;
}
function galleryEditor(id, paths) {
  const grid = document.getElementById(id);
  const wrap = grid.parentElement;
  const items = (paths || []).map(p => ({ path: p, url: state.imgCache[p] || '' }));
  const removed = [];
  let uploaded = [];
  const render = () => {
    grid.innerHTML = items.map((it, i) => `<div class="gthumb${i === 0 ? ' cover' : ''}">
      ${it.url ? `<img src="${esc(it.url)}" alt="">` : '<div class="gph">🖼️</div>'}
      ${i === 0 ? '<span class="gcover">Titelbild</span>' : `<button type="button" class="gmk" data-cover="${i}" title="Als Titelbild">★</button>`}
      <button type="button" class="gdel" data-del="${i}" aria-label="Bild entfernen" title="Bild entfernen">✕</button></div>`).join('')
      || '<p class="muted" style="margin:.2rem 0">Noch kein Foto.</p>';
  };
  const add = files => { for (const f of files || []) items.push({ file: f, url: URL.createObjectURL(f) }); render(); };
  wrap.querySelectorAll('[data-gcam],[data-ggal]').forEach(inp => inp.onchange = e => { add(e.target.files); e.target.value = ''; });
  grid.onclick = e => {
    const d = e.target.closest('[data-del]'), c = e.target.closest('[data-cover]');
    if (d) { e.preventDefault(); const [x] = items.splice(Number(d.dataset.del), 1); if (x?.path) removed.push(x.path); render(); }
    else if (c) { e.preventDefault(); const [x] = items.splice(Number(c.dataset.cover), 1); items.unshift(x); render(); }
  };
  render();
  return {
    items, removed, add,
    count: () => items.length,
    hasNew: () => items.some(x => x.file),
    async commit(folder) {
      const out = [];
      for (const it of items) {
        if (it.file) {
          toast('Foto wird gespeichert …', 10000);
          const blob = await shrinkImage(it.file);
          const path = `${owner()}/${folder}/${crypto.randomUUID()}.jpg`;
          const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
          if (up.error) throw up.error;
          state.imgCache[path] = it.url; it.path = path; delete it.file; uploaded.push(path);
        }
        if (it.path) out.push(it.path);
      }
      return out;
    },
    async cleanup() { if (removed.length) { try { await sb.storage.from(BUCKET).remove(removed.splice(0)); } catch (e) { console.warn(e); } } uploaded = []; },
    async rollback() { if (uploaded.length) { try { await sb.storage.from(BUCKET).remove(uploaded.splice(0)); } catch (e) { console.warn(e); } } },
  };
}
/** Preis kompakt für Listen: „0,76 € je Stück · 2,28 € gesamt“ */
const priceCompact = (unit, qty) => {
  if (unit == null || unit === '' || Number.isNaN(Number(unit))) return '';
  const u = Number(unit), q = Number(qty) || 0;
  return q > 1 ? `${euro(u)} je Stück · ${euro(u * q)} gesamt` : `${euro(u)} je Stück`;
};
const priceSubHtml = (unit, qty) => { const s = priceCompact(unit, qty); return s ? `<div class="sub price">${esc(s)}</div>` : ''; };

// ---------- Reserve / Sets ----------
const SET_ART = { reserve: { icon: '🏰', def: 'Reserve', tab: 'reserve' }, set: { icon: '🎁', def: 'Sets', tab: 'sets' } };
const setArt = s => (s && s.art === 'set') ? 'set' : 'reserve';
const artName = (art, lego) => tabLabel((lego ? 'l/' : '') + SET_ART[art].tab, SET_ART[art].def);
const artIcon = art => SET_ART[art]?.icon || '🏰';
/** Nummer vergleichen: Groß/klein, Leerzeichen und Striche egal */
const normNr = s => String(s ?? '').toLowerCase().replace(/[\s\-‐‑–—]+/g, '').trim();

// ---------- Eigene Reiter-Namen ----------
const tabNames = { uid: null, namen: {} };
const tabLabel = (key, def) => String(tabNames.namen?.[key] || '').trim() || def;
async function loadTabNames() {
  const uid = owner();
  if (!uid || tabNames.uid === uid) return;
  try {
    const { data, error } = await withTimeout(sb.from('tab_namen').select('namen').eq('user_id', uid).maybeSingle(), 5000, 'timeout');
    tabNames.namen = (!error && data && data.namen) || {};
  } catch { tabNames.namen = {}; }
  tabNames.uid = uid;
}
function tabRenameDialog(mode) {
  const tabs = TABS[mode] || [];
  const p = dialog(`<form><h2 style="margin-top:0">✏️ Reiter umbenennen</h2>
    <p class="muted" style="margin-top:0">Leer lassen = Standardname.</p>
    ${tabs.map(([h, i, l]) => `<label for="tn_${esc(h.replace('/', '_'))}">${i} ${esc(l)}</label>
      <input id="tn_${esc(h.replace('/', '_'))}" name="${esc(h)}" maxlength="24" value="${esc(tabNames.namen?.[h] || '')}" placeholder="${esc(l)}">`).join('')}
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  dialog.current._save = async d => {
    const namen = { ...(tabNames.namen || {}) };
    for (const [h] of tabs) { const v = (d.querySelector(`[name="${h}"]`).value || '').trim(); if (v) namen[h] = v; else delete namen[h]; }
    const { error } = await sb.from('tab_namen').upsert({ user_id: state.user.id, namen, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
    tabNames.namen = namen; tabNames.uid = state.user.id;
    toast('Reiter gespeichert ✔'); return true;
  };
  return p;
}

// ---------- Auth ----------
function withTimeout(promise, ms, msg) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(msg)), ms); }),
  ]);
}
async function initAuth() {
  const { data } = await withTimeout(
    sb.auth.getSession(),
    12000,
    'Anmelden kann ohne Internet nicht klappen. Bitte Verbindung prüfen und erneut versuchen.'
  );
  state.user = data.session?.user || null;
  await checkAdmin();
  sb.auth.onAuthStateChange((_e, session) => {
    const was = !!state.user; state.user = session?.user || null;
    if (was !== !!state.user) { resetView(); state.isAdmin = false; setTimeout(async () => { await checkAdmin(); route(); }, 0); }
  });
}
const _logoutBtn = document.getElementById('logoutBtn'); if (_logoutBtn) _logoutBtn.onclick = async () => { sessionStorage.removeItem('viewAs'); await sb.auth.signOut(); };
function setLoggedInChrome(on) {
  const who = document.getElementById('who');
  const lo = document.getElementById('logoutBtn');
  if (lo) lo.classList.toggle('hidden', !on);
  if (who && !on) { who.textContent = ''; who.classList.add('muted'); }
}
async function checkAdmin() {
  state.isAdmin = false;
  if (!state.user) return;
  const { data, error } = await sb.rpc('is_admin');
  state.isAdmin = !error && data === true;
  await loadSocial();
  try { if (typeof loadCustom === 'function') { await loadCustom(); refreshModebarCustom(); } } catch (e) { console.warn(e); }
  const va = JSON.parse(sessionStorage.getItem('viewAs') || 'null');
  if (va && va.id !== state.user.id) {
    if (va.kind === 'admin' && state.isAdmin) Object.assign(state, { viewUid: va.id, viewEmail: va.email, viewKind: 'admin', viewRecht: 'bearbeiten', viewBereich: 'beide' });
    else { const sh = shareOf(va.id); if (sh) viewAsShare(sh); }
  }
}
function resetView() { state.loaded = false; vstate.loaded = false; if (typeof lstate !== 'undefined') { lstate.loaded = false; lstate.kisten = []; lstate.sets = []; lstate.teile = []; } if (typeof cstate !== 'undefined') { cstate.loaded = false; cstate.bereiche = []; cstate.felder = []; cstate.orte = []; cstate.eintraege = []; } state.kisten = []; state.sets = []; state.teile = []; vstate.items = []; vstate.orte = []; vstate.chargen = {}; vstate.lastEntnahme = {}; }
// kind: 'admin' (Admin sieht fremde Daten) oder 'share' (mit mir geteilte Sammlung)
function viewAs(id, email, kind = 'admin', recht = 'bearbeiten', bereich = 'beide') {
  if (id && id !== state.user.id) {
    Object.assign(state, { viewUid: id, viewEmail: email, viewKind: kind, viewRecht: recht, viewBereich: bereich });
    sessionStorage.setItem('viewAs', JSON.stringify({ id, email, kind }));
  } else {
    Object.assign(state, { viewUid: null, viewEmail: null, viewKind: null, viewRecht: null, viewBereich: null });
    sessionStorage.removeItem('viewAs');
  }
  resetView();
}
const covers = (bereich, section) => bereich === section || bereich === 'alle' || (bereich === 'beide' && (section === 'playmobil' || section === 'vorrat')) || (section && section.startsWith('c:') && (bereich === section || bereich === 'alle'));
const shareOf = ownerId => state.shares.find(f => f.owner_id === ownerId && f.member_id === state.user.id && f.status === 'angenommen');
const viewAsShare = f => viewAs(f.owner_id, f.owner_email, 'share', f.recht, f.bereich);
const sharesFor = section => state.shares.filter(f => f.member_id === state.user.id && f.status === 'angenommen' && covers(f.bereich, section));
const pendingCount = () => state.shares.filter(f => f.member_id === state.user.id && f.status === 'eingeladen').length
  + state.merges.filter(z => z.status === 'offen' && z.antragsteller_id !== state.user.id && [z.von_id, z.nach_id].includes(state.user.id)).length;

async function loadSocial() {
  const [f, z] = await Promise.all([sb.rpc('meine_freigaben'), sb.rpc('meine_zusammenfuehrungen')]);
  state.shares = f.error ? [] : f.data; state.merges = z.error ? [] : z.data;
  if (f.error || z.error) console.warn(f.error || z.error);
  // Unterbrochene Zusammenführung? Fotos fertig verschieben.
  for (const m of state.merges.filter(m => m.status === 'angenommen' && m.ergebnis)) finishMerge({ ...m.ergebnis, id: m.id }).catch(console.warn);
}

function renderChrome(mode) {
  const w = document.getElementById('who'); w.textContent = state.user?.email || ''; w.title = 'Angemeldet als ' + w.textContent;
  document.querySelector('#modebar a[data-mode="admin"]').classList.toggle('hidden', !state.isAdmin);
  const section = mode === 'v' ? 'vorrat' : mode === 'lego' ? 'lego' : String(mode).startsWith('c') ? 'c:' + String(mode).slice(1) : 'playmobil';
  const ban = document.getElementById('adminBanner');
  const ro = state.viewKind === 'share' && state.viewRecht !== 'bearbeiten';
  document.body.classList.toggle('readonly', ro && mode !== 'admin');
  const shared = mode === 'admin' ? [] : sharesFor(section);
  const show = mode !== 'admin' && (state.viewUid || shared.length);
  ban.classList.toggle('hidden', !show);
  ban.classList.toggle('admin', state.viewKind === 'admin');
  if (!show) return;
  if (state.viewKind === 'admin') {
    ban.innerHTML = `<span>🛡️ Admin-Ansicht: Daten von <b>${esc(state.viewEmail)}</b></span> <button class="btn small secondary" id="exitView">Zurück zu meinen Daten</button>`;
    document.getElementById('exitView').onclick = () => { viewAs(null); location.hash = '#admin'; };
    return;
  }
  ban.innerHTML = `<label class="switch">Sammlung:
      <select id="sammlung"><option value="">📁 Meine Sammlung</option>${shared.map(f => `<option value="${f.owner_id}" ${f.owner_id === state.viewUid ? 'selected' : ''}>👥 ${esc(f.owner_email)}</option>`).join('')}</select></label>
    ${state.viewKind === 'share' ? `<span class="badge ${ro ? 'orange' : 'green'}">${ro ? '👁️ nur ansehen' : '✏️ ansehen und ändern'}</span>` : ''}`;
  document.getElementById('sammlung').onchange = e => {
    const f = shareOf(e.target.value);
    f ? viewAsShare(f) : viewAs(null);
    location.hash = mode === 'v' ? '#v/liste' : '#teile';
    route();
  };
}

function renderLogin() {
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('tabbar').classList.add('hidden');
  document.getElementById('modebar').classList.add('hidden');
  document.getElementById('adminBanner').classList.add('hidden');
  setLoggedInChrome(false);
  document.getElementById('brand').textContent = '📦 Sortiva';
  app.innerHTML = `
  <div class="login card">
    <div class="logo">🧸</div>
    <h1 class="center">Sortiva</h1>
    <p class="center muted">Deine Sammlungen – bitte anmelden.</p>
    <form id="loginForm">
      <label for="em">E-Mail</label>
      <input id="em" type="email" autocomplete="email" required>
      <label for="pw">Passwort</label>
      <input id="pw" type="password" autocomplete="current-password" minlength="6" required>
      <div style="height:1rem"></div>
      <button class="btn block" type="submit">Anmelden</button>
      <div style="height:.6rem"></div>
      <button class="btn secondary block" type="button" id="signupBtn">Neues Konto erstellen</button>
      <p class="center"><a href="#" id="resetLink">Passwort vergessen?</a></p>
    </form>
  </div>`;
  const em = () => document.getElementById('em').value.trim();
  const pw = () => document.getElementById('pw').value;
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: em(), password: pw() });
    if (error) toast(error.message.includes('Invalid') ? 'E-Mail oder Passwort falsch.' : error.message.includes('confirmed') ? 'Bitte zuerst die E-Mail bestätigen (Link im Postfach).' : friendlyError(error), 5000);
  };
  document.getElementById('signupBtn').onclick = async () => {
    if (!em() || pw().length < 6) return toast('Bitte E-Mail und ein Passwort (mind. 6 Zeichen) eingeben.');
    const { data, error } = await sb.auth.signUp({ email: em(), password: pw(), options: { emailRedirectTo: baseUrl() } });
    if (error) return fail(error);
    toast(data.session ? 'Konto erstellt – willkommen!' : 'Konto erstellt. Bitte den Bestätigungs-Link in der E-Mail öffnen.', 6000);
  };
  document.getElementById('resetLink').onclick = async e => {
    e.preventDefault();
    if (!em()) return toast('Bitte zuerst die E-Mail eingeben.');
    const { error } = await sb.auth.resetPasswordForEmail(em(), { redirectTo: baseUrl() + '#passwort' });
    error ? fail(error) : toast('E-Mail zum Zurücksetzen wurde gesendet.');
  };
}

// ---------- Router ----------
const TABS = {
  pm: [['teile', '🔍', 'Teile'], ['kisten', '📦', 'Kisten'], ['reserve', '🏰', 'Reserve'], ['sets', '🎁', 'Sets'], ['uebersicht', '📊', 'Übersicht'], ['teilen', '👥', 'Teilen']],
  v: [['v/liste', '🔍', 'Vorrat'], ['v/orte', '🗄️', 'Orte'], ['v/einkauf', '🛒', 'Einkauf'], ['v/uebersicht', '📊', 'Übersicht'], ['v/teilen', '👥', 'Teilen']],
  lego: [['l/teile', '🔍', 'Teile'], ['l/kisten', '📦', 'Kisten'], ['l/reserve', '🏰', 'Reserve'], ['l/sets', '🎁', 'Sets'], ['l/uebersicht', '📊', 'Übersicht'], ['l/teilen', '👥', 'Teilen']],
};
function setMode(mode, tab) {
  document.body.classList.toggle('mode-v', mode === 'v');
  document.body.classList.toggle('mode-lego', mode === 'lego');
  document.body.classList.toggle('mode-c', String(mode).startsWith('c'));
  if (!String(mode).startsWith('c')) localStorage.setItem('modus', mode);
  if (mode === 'v') { document.getElementById('brand').textContent = '📦 Sortiva · Vorrat'; document.getElementById('brand').href = '#v/liste'; }
  else if (mode === 'lego') { document.getElementById('brand').textContent = '📦 Sortiva · LEGO'; document.getElementById('brand').href = '#l/teile'; }
  else if (!String(mode).startsWith('c')) { document.getElementById('brand').textContent = '📦 Sortiva'; document.getElementById('brand').href = '#teile'; }
  document.querySelectorAll('#modebar a').forEach(a => a.classList.toggle('active', a.dataset.mode === mode));
  const nav = document.getElementById('tabbar');
  const pend = pendingCount();
  const tabs = TABS[mode] || [];
  nav.classList.toggle('many', tabs.length > 5);
  nav.innerHTML = tabs.map(([h, i, l]) => `<a href="#${h}" class="${h === tab ? 'active' : ''}"><span>${i}${h.endsWith('teilen') && pend ? `<b class="tabbadge">${pend}</b>` : ''}</span><em>${esc(tabLabel(h, l))}</em></a>`).join('');
  renderChrome(mode);
}
async function route() {
  if (!state.user) return renderLogin();
  setLoggedInChrome(true);
  ['topbar', 'tabbar', 'modebar'].forEach(id => document.getElementById(id).classList.remove('hidden'));
  if (!location.hash || location.hash === '#') { location.replace('#' + (localStorage.getItem('modus') === 'v' ? 'v/liste' : 'teile')); return; }
  const parts = location.hash.slice(1).split('/');
  window.scrollTo(0, 0);
  // Geteilte Sammlung deckt diesen Bereich nicht ab (oder Freigabe entzogen) → zurück zu „Meine“
  if (state.viewKind === 'share') {
    const f = shareOf(state.viewUid);
    const section = parts[0] === 'v' ? 'vorrat' : parts[0] === 'l' ? 'lego' : parts[0] === 'c' ? 'c:' + parts[1] : 'playmobil';
    if (!f || (parts[0] !== 'admin' && parts[0] !== 'bereiche' && !covers(f.bereich, section))) viewAs(null);
    else if (f.recht !== state.viewRecht || f.bereich !== state.viewBereich) Object.assign(state, { viewRecht: f.recht, viewBereich: f.bereich });
  }
  if (parts[0] !== 'admin') await loadTabNames();
  if (parts[0] === 'v') return routeVorrat(parts[1] || 'liste', parts[2]);
  if (parts[0] === 'l') return routeLego(parts[1] || 'teile', parts[2]);
  if (parts[0] === 'c' || parts[0] === 'bereiche') return routeCustom(parts);
  if (parts[0] === 'admin') return viewAdmin();
  if (parts[0] === 'import' && parts[1] === 'playmobil') return viewImport('playmobil');
  if (!state.loaded) {
    setMode('pm', '');
    app.innerHTML = '<div class="center muted" style="padding:3rem">Sammlung wird geladen …</div>';
    try { await loadAll(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Daten konnten nicht geladen werden. <button class="btn small" onclick="location.reload()">Neu laden</button></div>'; return; }
  }
  const [view, id] = parts;
  const tab = view === 'set' ? (setArt(setById(id)) === 'set' ? 'sets' : 'reserve') : ({ teil: 'teile', kiste: 'kisten', etiketten: 'kisten', doppelte: 'uebersicht' }[view] || view);
  setMode('pm', tab);
  const views = { teile: viewTeile, teil: viewTeil, kisten: viewKisten, kiste: viewKiste, reserve: () => viewSets('reserve'), sets: () => viewSets('set'), set: viewSet, uebersicht: viewStats, etiketten: viewLabels, passwort: viewPasswort, teilen: () => viewTeilen('playmobil'), import: () => viewImport('playmobil'), doppelte: () => viewDupes(false) };
  (views[view] || viewTeile)(id);
}
window.addEventListener('hashchange', route);

// ---------- Teile-Liste & Suche ----------
function matches(t, f) {
  if (f.farbe && norm(t.farbe) !== norm(f.farbe)) return false;
  if (f.kiste && String(t.kiste_id) !== f.kiste && !(f.kiste === 'none' && !t.kiste_id)) return false;
  if (f.set && !(t.teil_sets || []).some(x => String(x.set_id) === f.set)) return false;
  if (f.nr === 'ohne' && hasNr(t)) return false;
  if (f.nr === 'mit' && !hasNr(t)) return false;
  if (!f.q) return true;
  const k = kisteById(t.kiste_id);
  const hay = norm([t.teile_nr, t.beschreibung, t.farbe, t.notiz, k && kisteLabel(k), k?.farbe, k?.ort, ...teilSets(t).map(setLabel)].join(' '));
  return norm(f.q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function teilItem(t) {
  const k = kisteById(t.kiste_id);
  const sets = teilSets(t);
  return `<a class="item" href="#teil/${t.id}">${thumb(t)}
    <div class="info"><div class="title">${esc(teilTitle(t))}</div>
    <div class="sub">${hasNr(t) ? 'Nr. ' + esc(t.teile_nr) + ' · ' : NR_BADGE + ' '}${cleanNr(t.farbe) ? dot(t.farbe) + esc(t.farbe) : ''}</div>
    <div class="sub">${[k ? '📦 ' + esc(kisteLabel(k)) : '', ...['reserve', 'set'].map(a => { const l = sets.filter(s => setArt(s) === a); return l.length ? artIcon(a) + ' ' + esc(l.map(s => s.set_nummer).join(', ')) : ''; })].filter(Boolean).join(' · ')}</div>
    ${priceSubHtml(t.euro, t.anzahl)}</div>
    <div class="right"><b>${num(t.anzahl)}×</b></div></a>`;
}

function viewTeile() {
  const f = state.filter;
  const farben = [...new Set(state.teile.map(t => (t.farbe || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  app.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="Suchen: Nummer, Name, Farbe, Set, Kiste …" value="${esc(f.q)}" autocomplete="off"></div>
    <div class="filters">
      <select id="fFarbe"><option value="">Alle Farben</option>${farben.map(x => `<option ${norm(x) === norm(f.farbe) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="fKiste"><option value="">Alle Kisten</option><option value="none" ${f.kiste === 'none' ? 'selected' : ''}>Ohne Kiste</option>${state.kisten.map(k => `<option value="${k.id}" ${String(k.id) === f.kiste ? 'selected' : ''}>${esc(kisteLabel(k))}</option>`).join('')}</select>
      <select id="fSet"><option value="">Alle ${esc(artName('reserve'))} &amp; ${esc(artName('set'))}</option>${setOptions(state.sets, false, f.set)}</select>
      <select id="fNr"><option value="">Alle Nummern</option><option value="mit" ${f.nr === 'mit' ? 'selected' : ''}>Mit Nummer</option><option value="ohne" ${f.nr === 'ohne' ? 'selected' : ''}>Ohne Nummer</option></select>
    </div>
    <div class="row" id="teileActions" style="margin:.4rem 0 .6rem;gap:.4rem;flex-wrap:wrap">
      <a class="btn small" href="#teil/neu" id="addTeil">＋ Teil</a>
      <a class="btn small secondary" href="#import" id="impTeile">📥 Aus Excel übernehmen</a>
    </div>
    <div id="count" class="muted" style="margin-bottom:.5rem"></div>
    <div id="list" class="list"></div>
    <a class="fab" href="#teil/neu" title="Neues Teil">＋</a>`;
  const render = () => {
    const res = state.teile.filter(t => matches(t, f));
    document.getElementById('count').textContent = `${num(res.length)} von ${num(state.teile.length)} Teilen · ${num(res.reduce((s, t) => s + (t.anzahl || 0), 0))} Stück`;
    document.getElementById('list').innerHTML = res.length ? res.slice(0, 300).map(teilItem).join('') + (res.length > 300 ? '<p class="muted center">… bitte Suche verfeinern</p>' : '')
      : state.teile.length ? '<div class="card center muted">Nichts gefunden.</div>'
        : '<div class="card center"><p>Noch keine Teile erfasst.</p><a class="btn" href="#teil/neu">＋ Erstes Teil anlegen</a></div>';
  };
  document.getElementById('q').oninput = e => { f.q = e.target.value; render(); };
  document.getElementById('fFarbe').onchange = e => { f.farbe = e.target.value; render(); };
  document.getElementById('fKiste').onchange = e => { f.kiste = e.target.value; render(); };
  document.getElementById('fSet').onchange = e => { f.set = e.target.value; render(); };
  document.getElementById('fNr').onchange = e => { f.nr = e.target.value; render(); };
  render();
}

// ---------- Teil: Detail & Formular ----------
function viewTeil(id) {
  if (id === 'neu' || (id && id.startsWith('neu'))) return teilForm(null);
  const [tid, mode] = id.split(':');
  const t = state.teile.find(x => x.id === Number(tid));
  if (!t) { app.innerHTML = '<div class="card">Teil nicht gefunden. <a href="#teile">Zur Liste</a></div>'; return; }
  if (mode === 'bearbeiten') return teilForm(t);
  const k = kisteById(t.kiste_id);
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">‹ Zurück</a>
    <div class="card">
      ${photoStrip(t)}
      <h1>${esc(teilTitle(t))}</h1>
      <dl class="dl">
        <dt>Teile-Nr.</dt><dd>${hasNr(t) ? esc(t.teile_nr) : 'Keine Nummer gefunden'}</dd>
        <dt>Farbe</dt><dd>${dot(t.farbe)}${esc(t.farbe || '–')}</dd>
        <dt>Anzahl</dt><dd>${num(t.anzahl)}</dd>
        <dt>Preis</dt><dd>${t.euro != null ? esc(priceLine(t.euro, t.anzahl)) : '–'}</dd>
        <dt>In Kiste</dt><dd>${k ? `<a href="#kiste/${k.id}">📦 ${esc(kisteLabel(k))}</a>` : '–'}</dd>
        <dt>${esc(artName('reserve'))} / ${esc(artName('set'))}</dt><dd>${teilSets(t).map(s => `<a class="badge" href="#set/${s.id}">${artIcon(setArt(s))} ${esc(setLabel(s))}</a>`).join('') || '–'}</dd>
        ${t.notiz ? `<dt>Notiz</dt><dd>${esc(t.notiz)}</dd>` : ''}
      </dl>
    </div>
    <div class="row">
      <a class="btn grow" href="#teil/${t.id}:bearbeiten">✏️ Bearbeiten</a>
      <button class="btn danger" id="del">🗑️ Löschen</button>
    </div>`;
  bindPhotoStrip(app);
  document.getElementById('del').onclick = async () => {
    if (!confirm('Dieses Teil wirklich löschen?')) return;
    const { error } = await sb.from('teile').delete().eq('id', t.id);
    if (error) return fail(error);
    if (imgList(t).length) await sb.storage.from(BUCKET).remove(imgList(t));
    state.teile = state.teile.filter(x => x.id !== t.id);
    toast('Gelöscht.'); location.hash = '#teile';
  };
}

function teilForm(t) {
  const isNew = !t;
  // Vorauswahl der Kiste, wenn aus einer Kiste heraus angelegt (#teil/neu?kiste=3)
  const pre = new URLSearchParams(location.hash.split('?')[1] || '');
  t = t || { teile_nr: '', farbe: '', beschreibung: '', euro: null, anzahl: 1, kiste_id: pre.get('kiste') ? Number(pre.get('kiste')) : null, notiz: '', teil_sets: pre.get('set') ? [{ set_id: Number(pre.get('set')) }] : [] };
  let chosenSets = (t.teil_sets || []).map(x => x.set_id);
  const farben = [...new Set(state.teile.map(x => (x.farbe || '').trim()).filter(Boolean))];
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">‹ Abbrechen</a>
    <h1>${isNew ? 'Neues Teil' : 'Teil bearbeiten'}</h1>
    <form id="f" class="card">
      <label>Fotos</label>
      ${galleryHtml('tgal')}
      <div class="grid2">
        <div>${nrFieldHtml(t)}</div>
        <div><label for="farbe">Farbe</label>${suggestField('farbe', t.farbe, [...farben, 'rot', 'blau', 'grün', 'gelb', 'schwarz', 'weiß', 'grau', 'braun', 'orange', 'rosa', 'lila', 'silber', 'gold', 'beige', 'transparent'], 'z.B. rot', 'Farbe wählen')}</div>
      </div>
      <label for="beschr">Beschreibung</label><input id="beschr" value="${esc(t.beschreibung)}" placeholder="z.B. Ritterhelm mit Visier">
      <div class="grid2">
        <div><label for="anz">Anzahl</label><input id="anz" type="number" min="0" step="1" inputmode="numeric" value="${esc(t.anzahl ?? 1)}"></div>
        <div><label for="eur">Einzelpreis (€ / Stück)</label><input id="eur" type="text" inputmode="decimal" value="${t.euro != null ? String(t.euro).replace('.', ',') : ''}" placeholder="0,00"><div id="eurPrev" class="muted" style="font-size:.85rem;margin-top:.25rem"></div></div>
      </div>
      <label for="kiste">In Kiste / Tüte</label>
      <div class="row"><select id="kiste" class="grow" style="flex:1"></select><button type="button" class="btn small secondary" id="newKiste">＋ Neu</button></div>
      <label>${esc(artName('reserve'))} / ${esc(artName('set'))}</label>
      <select id="setSel"></select>
      <div class="row" style="margin-top:.4rem"><button type="button" class="btn small secondary grow" id="newRes">＋ Neu in ${esc(artName('reserve'))}</button><button type="button" class="btn small secondary grow" id="newSet">＋ Neu in ${esc(artName('set'))}</button></div>
      <div id="chips" class="chips"></div>
      <label for="notiz">Notiz</label><textarea id="notiz">${esc(t.notiz)}</textarea>
      <div style="height:1rem"></div>
      <button class="btn block" type="submit" id="save">💾 Speichern</button>
      ${isNew ? '<div style="height:.5rem"></div><button class="btn secondary block" type="button" id="saveMore">💾 Speichern & nächstes Teil</button>' : ''}
    </form>`;
  const kSel = document.getElementById('kiste'), sSel = document.getElementById('setSel');
  const fillKisten = sel => { kSel.innerHTML = `<option value="">– keine –</option>` + state.kisten.map(k => `<option value="${k.id}">${esc(kisteLabel(k))}</option>`).join(''); kSel.value = sel ?? ''; };
  const fillSets = () => { sSel.innerHTML = `<option value="">Zuordnen …</option>` + setOptions(state.sets.filter(s => !chosenSets.includes(s.id)), false);
    document.getElementById('chips').innerHTML = chosenSets.map(id => { const s = setById(id); return `<span class="chip">${artIcon(setArt(s))} ${esc(setLabel(s))}<button type="button" data-id="${id}" aria-label="entfernen">×</button></span>`; }).join(''); };
  const gal = galleryEditor('tgal', imgList(t));
  fillKisten(t.kiste_id); fillSets();
  sSel.onchange = () => { if (sSel.value) { chosenSets.push(Number(sSel.value)); fillSets(); } };
  document.getElementById('chips').onclick = e => { const id = e.target.dataset?.id; if (id) { chosenSets = chosenSets.filter(x => x !== Number(id)); fillSets(); } };
  document.getElementById('newKiste').onclick = async () => { const k = await kisteDialog(); if (k) fillKisten(k.id); };
  const addNewSet = async art => { const s = await setDialog(null, art, { fromPart: true, kiste_id: kSel.value || null }); if (s && !chosenSets.includes(s.id)) { chosenSets.push(s.id); } fillSets(); };
  document.getElementById('newRes').onclick = () => addNewSet('reserve');
  document.getElementById('newSet').onclick = () => addNewSet('set');
  bindSuggest('farbe');
  bindNrField('playmobil', () => document.getElementById('beschr').value.trim());
  const updEurPrev = () => {
    const el = document.getElementById('eurPrev'); if (!el) return;
    try {
      const raw = document.getElementById('eur').value.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
      const u = raw === '' ? null : Number(raw);
      const q = Math.max(0, parseInt(document.getElementById('anz').value, 10) || 0);
      el.textContent = u != null && !isNaN(u) ? priceLine(u, q) : '';
    } catch { el.textContent = ''; }
  };
  document.getElementById('eur').oninput = updEurPrev;
  document.getElementById('anz').oninput = updEurPrev;
  updEurPrev();

  async function save(more) {
    const btns = app.querySelectorAll('button[type=submit],#saveMore'); btns.forEach(b => b.disabled = true);
    try {
      const eurRaw = document.getElementById('eur').value.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
      const row = {
        ...nrValues(),
        farbe: document.getElementById('farbe').value.trim() || null,
        beschreibung: document.getElementById('beschr').value.trim() || null,
        anzahl: Math.max(0, parseInt(document.getElementById('anz').value, 10) || 0),
        euro: eurRaw === '' ? null : Number(eurRaw),
        kiste_id: kSel.value ? Number(kSel.value) : null,
        notiz: document.getElementById('notiz').value.trim() || null,
      };
      if (row.euro != null && isNaN(row.euro)) throw new Error('Euro-Betrag ist keine Zahl.');
      if (!row.teile_nr && !row.beschreibung && !gal.count()) throw new Error('Bitte mindestens Teile-Nr., Beschreibung oder Foto angeben.');
      row.bilder = await gal.commit('teile');
      row.bild_url = row.bilder[0] || null;
      let saved;
      try {
        if (isNew) { const r = await sb.from('teile').insert({ ...row, user_id: owner() }).select().single(); if (r.error) throw r.error; saved = r.data; }
        else { const r = await sb.from('teile').update(row).eq('id', t.id).select().single(); if (r.error) throw r.error; saved = r.data; }
      } catch (e) { await gal.rollback(); throw e; }
      const before = (t.teil_sets || []).map(x => x.set_id);
      const add = chosenSets.filter(x => !before.includes(x)), rem = before.filter(x => !chosenSets.includes(x));
      if (add.length) { const r = await sb.from('teil_sets').insert(add.map(set_id => ({ teil_id: saved.id, set_id, user_id: owner() }))); if (r.error) throw r.error; }
      if (rem.length) { const r = await sb.from('teil_sets').delete().eq('teil_id', saved.id).in('set_id', rem); if (r.error) throw r.error; }
      await gal.cleanup();
      saved.teil_sets = chosenSets.map(set_id => ({ set_id }));
      await loadImageUrls([saved]);
      state.teile = isNew ? [saved, ...state.teile] : state.teile.map(x => x.id === saved.id ? saved : x);
      toast('Gespeichert ✔');
      if (more) { const q = new URLSearchParams(); if (row.kiste_id) q.set('kiste', row.kiste_id); if (chosenSets[0]) q.set('set', chosenSets[0]);
        const h = '#teil/neu' + (q.toString() ? '?' + q : '') + '&t=' + Date.now(); location.hash = h; }
      else location.hash = '#teil/' + saved.id;
    } catch (e) { fail(e); btns.forEach(b => b.disabled = false); }
  }
  document.getElementById('f').onsubmit = e => { e.preventDefault(); save(false); };
  const sm = document.getElementById('saveMore'); if (sm) sm.onclick = () => save(true);
}

// Bild verkleinern (max. 1600 px, JPEG), damit Upload schnell ist
async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob || file;
  } catch { return file; }
}

// ---------- Dialoge: neue Kiste / neues Set ----------
function dialog(html) {
  return new Promise(resolve => {
    const d = document.createElement('dialog'); d.innerHTML = html; document.body.appendChild(d); d.showModal();
    d.querySelector('[data-cancel]').onclick = () => { d.close(); };
    d.addEventListener('close', () => { d.remove(); resolve(d._result || null); });
    d.querySelector('form').onsubmit = async e => { e.preventDefault(); const sb_ = d.querySelector('button[type=submit]'); if (sb_) sb_.disabled = true;
      try { const r = await d._save(d); if (r === dialog.KEEP) return; d._result = r; d.close(); } catch (err) { fail(err); } finally { if (sb_) sb_.disabled = false; } };
    d._resolve = resolve; d._ready && d._ready(d);
    dialog.current = d;
  });
}
dialog.KEEP = Symbol('keep');
function kisteFields(k = {}) {
  return `<div class="grid2">
    <div><label>Art</label><select name="art"><option ${k.art !== 'Tüte' ? 'selected' : ''}>Kiste</option><option ${k.art === 'Tüte' ? 'selected' : ''}>Tüte</option></select></div>
    <div><label>Nummer <span class="muted" style="font-weight:400">(freiwillig)</span></label><input name="nummer" value="${esc(k.nummer ?? '')}" placeholder="z.B. ${esc(String(state.kisten.length + 1))}, A-G oder leer" autocomplete="off"></div></div>
    <div class="grid2"><div><label>Farbe</label><input name="farbe" value="${esc(k.farbe)}" placeholder="z.B. blau"></div>
    <div><label>Name</label><input name="name" value="${esc(k.name)}" placeholder="z.B. Ritter"></div></div>
    <label>Ort</label><input name="ort" value="${esc(k.ort)}" placeholder="z.B. Keller, Regal 2">
    <label>Notiz</label><textarea name="notiz">${esc(k.notiz)}</textarea>`;
}
const kisteNrKey = v => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** Kiste/Tüte löschen – Teile darin bleiben erhalten (nur ohne Kiste) */
async function deleteKiste(table, partTable, k, teile, label) {
  const n = teile.length;
  const msg = n ? `„${label}“ löschen?\n\nDie ${n} Teil${n > 1 ? 'e' : ''} darin ${n > 1 ? 'werden' : 'wird'} NICHT gelöscht – sie sind danach nur keiner Kiste mehr zugeordnet.` : `„${label}“ löschen?`;
  if (!confirm(msg)) return false;
  if (n) { const u = await sb.from(partTable).update({ kiste_id: null }).eq('kiste_id', k.id); if (u.error) { fail(u.error); return false; } }
  const { error } = await sb.from(table).delete().eq('id', k.id);
  if (error) { fail(error); return false; }
  teile.forEach(t => { t.kiste_id = null; });
  toast(n ? `Gelöscht. ${n} Teil${n > 1 ? 'e sind' : ' ist'} jetzt ohne Kiste.` : 'Gelöscht.', 4000);
  return true;
}
const formVals = (form, names) => Object.fromEntries(names.map(n => [n, (form.elements[n].value || '').trim() || null]));
function kisteDialog(k) {
  const p = dialog(`<form><h2 style="margin-top:0">${k ? 'Kiste bearbeiten' : 'Neue Kiste / Tüte'}</h2>${kisteFields(k)}
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  dialog.current._save = async d => {
    const row = formVals(d.querySelector('form'), ['art', 'nummer', 'farbe', 'name', 'ort', 'notiz']);
    if (row.nummer && state.kisten.some(x => x.id !== k?.id && (x.art || 'Kiste') === row.art && kisteNrKey(x.nummer) === kisteNrKey(row.nummer))) throw new Error(`${row.art} ${row.nummer} gibt es schon. Bitte eine andere Nummer wählen oder leer lassen.`);
    const r = k ? await sb.from('kisten').update(row).eq('id', k.id).select().single() : await sb.from('kisten').insert({ ...row, user_id: owner() }).select().single();
    if (r.error) { if (String(r.error.code) === '23505') throw new Error('Diese Nummer gibt es schon. Bitte eine andere wählen oder leer lassen.'); throw r.error; }
    state.kisten = (k ? state.kisten.map(x => x.id === k.id ? r.data : x) : [...state.kisten, r.data]).sort((a, b) => sortNat(a.nummer, b.nummer));
    toast('Kiste gespeichert ✔'); return r.data;
  };
  return p;
}
const SETCFG = {
  pm: { table: 'sets', lego: false, folder: 'teile', list: () => state.sets, put: l => { state.sets = l; }, href: id => '#set/' + id,
    countTeile: s => state.teile.filter(t => (t.teil_sets || []).some(x => x.set_id === s.id)).length,
    st: () => state, kisten: () => state.kisten, partTable: 'teile', link: 'teil_sets', rel: 'teil_sets' },
  lego: { table: 'lego_sets', lego: true, folder: 'lego', list: () => lstate.sets, put: l => { lstate.sets = l; }, href: id => '#l/set/' + id,
    countTeile: s => lstate.teile.filter(t => (t.lego_teil_sets || []).some(x => x.set_id === s.id)).length,
    st: () => lstate, kisten: () => lstate.kisten, partTable: 'lego_teile', link: 'lego_teil_sets', rel: 'lego_teil_sets' },
};
/** Reserve/Sets haben nur Nummer, Name, Beschreibung, Notiz und Fotos (Farbe/Anzahl/Preis/Kiste gehören zu Teilen) */
const SET_PART_FIELDS = ['beschreibung'];
/** Auswahlliste mit zwei Gruppen (Reserve / Sets) */
function setOptions(list, lego, selected) {
  return ['reserve', 'set'].map(a => { const l = list.filter(s => setArt(s) === a); return l.length
    ? `<optgroup label="${artIcon(a)} ${esc(artName(a, lego))}">${l.map(s => `<option value="${s.id}" ${String(s.id) === String(selected ?? '') ? 'selected' : ''}>${esc(setLabel(s))}</option>`).join('')}</optgroup>` : ''; }).join('');
}
/** Kern einer Set-Nummer: nur Buchstaben/Ziffern, klein, ohne führende Nullen; LEGO „-1“ zählt nicht */
function nrCore(s, lego) {
  let v = String(s ?? '').normalize('NFKC').toLowerCase().trim();
  if (lego) v = v.replace(/-1$/, '');
  return v.replace(/[^0-9a-zäöüß]/g, '').replace(/^0+(?=\d)/, '');
}
/** Führende Zahl („3112 – Gefängnis“ → 3112) */
/** Führende Zahl („3112 – Gefängnis“ → 3112; Teilenummern wie „30 14 3640“ zählen ganz) */
const nrLead = s => ((String(s ?? '').normalize('NFKC').match(/^\s*0*(\d+(?:[ .\u00a0]\d+)*)/) || [])[1] || '').replace(/\D/g, '');
/** Wie ähnlich ist eine vorhandene Nummer? 'exact' | 'near' | null */
function nrMatch(typed, existing, lego) {
  const a = nrCore(typed, lego), b = nrCore(existing, lego);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const la = nrLead(typed), lb = nrLead(existing);
  if (la && la === lb) return 'near';
  if (!la && !lb && Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return 'near';
  return null;
}
/** Vorhandene Einträge (Reserve UND Sets) mit gleicher/ähnlicher Nummer – geprüft direkt in der Datenbank, nicht nur in der geladenen Liste */
async function findSetCandidates(cfg, art, nummer, exceptId) {
  const lead = nrLead(nummer), core = nrCore(nummer, cfg.lego);
  if (!core) return [];
  let pool = cfg.list();
  try {
    let q = sb.from(cfg.table).select('*').eq('user_id', owner());
    q = lead ? q.ilike('set_nummer', `%${lead}%`) : q.ilike('set_nummer', `%${String(nummer).trim().replace(/[%_\\]/g, '').slice(0, 3)}%`);
    const r = await q.limit(200);
    if (!r.error && r.data) {
      const known = new Set(pool.map(x => x.id)), extra = r.data.filter(x => !known.has(x.id));
      if (extra.length) { cfg.put([...pool, ...extra].sort((a, b) => sortNat(a.set_nummer, b.set_nummer))); pool = cfg.list(); }
    }
  } catch { /* offline: geladene Liste reicht */ }
  return pool.filter(x => x.id !== exceptId).map(x => ({ s: x, m: nrMatch(nummer, x.set_nummer, cfg.lego) })).filter(x => x.m)
    .sort((a, b) => (a.m === 'exact' ? 0 : 1) - (b.m === 'exact' ? 0 : 1) || (setArt(a.s) === art ? 0 : 1) - (setArt(b.s) === art ? 0 : 1) || sortNat(a.s.set_nummer, b.s.set_nummer))
    .slice(0, 5);
}
const findDupSet = (cfg, art, nummer, exceptId) => { const n = nrCore(nummer, cfg.lego); return n ? cfg.list().find(x => x.id !== exceptId && setArt(x) === art && nrCore(x.set_nummer, cfg.lego) === n) : null; };
/** Vorhandene (gleiche oder ähnliche) Einträge zeigen und fragen, was passieren soll.
 *  cands: [{ s, m: 'exact'|'near' }]. Antwort: { a: 'update'|'link'|'open'|'create', dup } oder null (Abbrechen) */
function askDuplicate(cfg, cands, row, opts = {}) {
  return new Promise(resolve => {
    const art = opts.art || 'reserve';
    const sameExact = cands.some(c => c.m === 'exact' && setArt(c.s) === art);
    const allNear = cands.every(c => c.m === 'near');
    const d = document.createElement('dialog'); d.className = 'dupdlg';
    const tile = (c, i) => { const s = c.s, a = setArt(s);
      return `<label class="item" data-dup="${s.id}" style="cursor:pointer">${cands.length > 1 ? `<input type="radio" name="dupPick" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-right:.4rem">` : ''}${thumb(s, artIcon(a))}
        <div class="info"><div class="title">${esc(s.set_nummer)} ${esc(s.name || '')}</div>
        <div class="sub">${artIcon(a)} in „${esc(artName(a, cfg.lego))}“ · ${c.m === 'exact' ? 'gleiche Nummer' : 'ähnliche Nummer'}</div>
        <div class="sub">${num(cfg.countTeile(s))} Teile zugeordnet${imgList(s).length ? ' · ' + num(imgList(s).length) + ' Foto(s)' : ''}</div></div></label>`; };
    d.innerHTML = `<h2 style="margin-top:0">${allNear ? 'Ähnliche Nummer vorhanden – was tun?' : 'Schon vorhanden – was tun?'}</h2>
      <p style="margin-top:0">Du hast <b>${esc(row.set_nummer)}</b> eingegeben. ${cands.length > 1 ? 'Diese Einträge gibt es schon – bitte einen auswählen:' : 'Diesen Eintrag gibt es schon:'}</p>
      <div class="list">${cands.map(tile).join('')}</div>
      <p style="margin-bottom:.3rem"><b>Aktualisieren</b> übernimmt beim ausgewählten Eintrag nur <b>Nummer</b> und <b>Name</b> (→ <b>${esc(row.set_nummer)} ${esc(row.name || '')}</b>).<br>
        <span class="muted" style="font-size:.85rem">Fotos, Notiz und alle schon zugeordneten Teile bleiben erhalten${opts.fromPart ? ' – dieses Teil wird zusätzlich zugeordnet' : ''}.</span></p>
      ${opts.fromPart ? `<p class="muted" style="font-size:.85rem;margin-top:0"><b>Diesem Teil zuordnen</b> lässt den vorhandenen Eintrag unverändert und wählt ihn nur für dieses Teil aus.</p>` : ''}
      ${sameExact ? '' : `<p class="muted" style="font-size:.85rem;margin-top:0"><b>Mit dieser Nummer anlegen</b> legt trotzdem einen neuen Eintrag „${esc(row.set_nummer)}“ in „${esc(artName(art, cfg.lego))}“ an.</p>`}
      <div class="row" style="flex-wrap:wrap"><button class="btn grow" type="button" data-yes>Aktualisieren</button>
        ${opts.fromPart ? `<button class="btn grow" type="button" data-link>Diesem Teil zuordnen</button>` : `<button class="btn secondary grow" type="button" data-open>Vorhandenes öffnen</button>`}
        ${sameExact ? '' : `<button class="btn secondary grow" type="button" data-create>Mit dieser Nummer anlegen</button>`}
        <button class="btn secondary grow" type="button" data-no>Abbrechen</button></div>`;
    document.body.appendChild(d); d.showModal();
    let ans = null;
    const sel = () => cands[Number(d.querySelector('input[name=dupPick]:checked')?.value || 0)].s;
    const pick = v => () => { ans = { a: v, dup: v === 'create' ? null : sel() }; d.close(); };
    d.querySelector('[data-yes]').onclick = pick('update');
    d.querySelector('[data-link]')?.addEventListener('click', pick('link'));
    d.querySelector('[data-open]')?.addEventListener('click', pick('open'));
    d.querySelector('[data-create]')?.addEventListener('click', pick('create'));
    d.querySelector('[data-no]').onclick = () => d.close();
    d.addEventListener('close', () => { d.remove(); resolve(ans); });
  });
}
async function overwriteSet(cfg, dup, row) {
  const upd = { set_nummer: row.set_nummer, name: row.name || dup.name || null };
  const r = await sb.from(cfg.table).update(upd).eq('id', dup.id).select().single();
  if (r.error) throw r.error;
  cfg.put(cfg.list().map(x => x.id === dup.id ? r.data : x).sort((a, b) => sortNat(a.set_nummer, b.set_nummer)));
  toast('Nummer und Name aktualisiert ✔');
  return r.data;
}
function setDialog(s, art, opts) { return setDialogX(SETCFG.pm, s, art, opts); }
function setDialogX(cfg, s, art = 'reserve', opts = {}) {
  art = s ? setArt(s) : (art === 'set' ? 'set' : 'reserve');
  const nm = artName(art, cfg.lego);
  const fromPart = !!opts.fromPart;
  const p = dialog(`<form><h2 style="margin-top:0">${artIcon(art)} ${s ? 'Bearbeiten' : 'Neu'} – ${esc(nm)}</h2>
    ${fromPart ? `<p class="muted" style="margin-top:0">Wird gleich dem Teil im Formular zugeordnet. Das Teil selbst (mit Kiste, Anzahl, Preis) bitte danach wie gewohnt speichern.</p>` : ''}
    <label>Nummer</label><input name="set_nummer" required value="${esc(s?.set_nummer)}" placeholder="${cfg.lego ? 'z.B. 75192' : 'z.B. 3666'}" autocomplete="off">
    <label>Name</label><input name="name" value="${esc(s?.name)}" placeholder="${cfg.lego ? 'z.B. Millennium Falcon' : 'z.B. Ritterburg'}">
    ${fromPart ? '' : `<label>Beschreibung</label><input name="beschreibung" value="${esc(s?.beschreibung)}" placeholder="z.B. komplett mit Anleitung">`}
    ${cfg.lego ? `<div class="grid2"><div><label>Jahr</label><input name="jahr" inputmode="numeric" value="${esc(s?.jahr ?? '')}"></div>
      <div><label>Teile (laut Anleitung)</label><input name="teile_anzahl" inputmode="numeric" value="${esc(s?.teile_anzahl ?? '')}"></div></div>` : ''}
    <label>Notiz</label><textarea name="notiz">${esc(s?.notiz)}</textarea>
    <label>Fotos</label>${galleryHtml('sgal')}
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  const gal = galleryEditor('sgal', imgList(s));
  dialog.current._save = async d => {
    const f = d.querySelector('form');
    const row = formVals(f, (cfg.lego ? ['set_nummer', 'name', 'notiz', 'jahr', 'teile_anzahl'] : ['set_nummer', 'name', 'notiz']).concat(fromPart ? [] : SET_PART_FIELDS));
    if (cfg.lego) for (const k of ['jahr', 'teile_anzahl']) { if (row[k] != null) { const n = parseInt(row[k], 10); if (Number.isNaN(n)) throw new Error('Bitte bei „' + (k === 'jahr' ? 'Jahr' : 'Teile') + '“ eine Zahl eingeben.'); row[k] = n; } }
    const cands = await findSetCandidates(cfg, art, row.set_nummer, s?.id);
    if (s) {
      const same = cands.find(c => c.m === 'exact' && setArt(c.s) === art);
      if (same) throw new Error('Diese Nummer gibt es in „' + nm + '“ schon (' + setLabel(same.s) + ').');
    } else if (cands.length) {
      const ans = await askDuplicate(cfg, cands, row, { fromPart, art });
      if (!ans) return dialog.KEEP;
      if (ans.a !== 'create') {
        await gal.rollback();
        const dup = ans.dup;
        if (ans.a === 'open') { setTimeout(() => { location.hash = cfg.href(dup.id); }, 0); return null; }
        if (ans.a === 'link') { toast('„' + setLabel(dup) + '“ ausgewählt – bitte das Teil speichern'); return dup; }
        return await overwriteSet(cfg, dup, row);
      }
    }
    row.bilder = await gal.commit(cfg.folder);
    let r;
    try {
      r = s ? await sb.from(cfg.table).update(row).eq('id', s.id).select().single()
        : await sb.from(cfg.table).insert({ ...row, art, user_id: owner() }).select().single();
      if (r.error) throw r.error;
    } catch (e) {
      await gal.rollback();
      if (String(e?.code) === '23505') throw new Error('Diese Nummer gibt es hier schon.');
      throw e;
    }
    await gal.cleanup();
    cfg.put((s ? cfg.list().map(x => x.id === s.id ? r.data : x) : [...cfg.list(), r.data]).sort((a, b) => sortNat(a.set_nummer, b.set_nummer)));
    toast(fromPart ? 'Angelegt und zugeordnet – bitte das Teil noch speichern.' : 'Gespeichert ✔', fromPart ? 4500 : 2500); return r.data;
  };
  return p;
}

// ---------- Kisten ----------
const sumTeile = list => ({ teile: list.length, stueck: list.reduce((s, t) => s + (t.anzahl || 0), 0), wert: list.reduce((s, t) => s + (Number(t.euro) || 0) * (t.anzahl || 0), 0) });

function viewKisten() {
  app.innerHTML = `
    <h1>📦 Kisten & Tüten</h1>
    <div class="row noprint" style="margin-bottom:.8rem"><button class="btn grow" id="nk">＋ Neue Kiste/Tüte</button><a class="btn secondary" href="#etiketten">🏷️ QR-Etiketten</a></div>
    <div class="list">${state.kisten.map(k => { const s = sumTeile(state.teile.filter(t => t.kiste_id === k.id));
      return `<a class="item" href="#kiste/${k.id}"><div class="thumb">${k.art === 'Tüte' ? '🛍️' : '📦'}</div>
        <div class="info"><div class="title">${esc(kisteLabel(k))}</div>
        <div class="sub">${dot(k.farbe)}${esc(k.farbe || '')}${k.ort ? ' · 📍 ' + esc(k.ort) : ''}</div></div>
        <div class="right">${num(s.teile)} Teile<div class="sub">${num(s.stueck)} Stück</div></div></a>`; }).join('') || '<div class="card center muted">Noch keine Kisten angelegt.</div>'}</div>`;
  document.getElementById('nk').onclick = async () => { const k = await kisteDialog(); if (k) location.hash = '#kiste/' + k.id; };
}

function viewKiste(id) {
  const k = kisteById(id);
  if (!k) { app.innerHTML = '<div class="card">Diese Kiste gibt es (noch) nicht. <a href="#kisten">Alle Kisten</a></div>'; openForeign('kisten', id); return; }
  const teile = state.teile.filter(t => t.kiste_id === k.id);
  const s = sumTeile(teile);
  const nfc = 'NDEFReader' in window;
  app.innerHTML = `
    <a class="back" href="#kisten">‹ Alle Kisten</a>
    <div class="card">
      <h1 style="margin-bottom:.3rem">${k.art === 'Tüte' ? '🛍️' : '📦'} ${esc(kisteLabel(k))}</h1>
      <div class="muted">${k.farbe ? dot(k.farbe) + 'Farbe: ' + esc(k.farbe) : ''}${k.ort ? ' · 📍 ' + esc(k.ort) : ''}</div>
      ${k.notiz ? `<p>${esc(k.notiz)}</p>` : ''}
      <p><span class="badge">${num(s.teile)} Teile</span><span class="badge">${num(s.stueck)} Stück</span><span class="badge green">${euro(s.wert)}</span></p>
      <div class="row">
        <a class="btn small" href="#teil/neu?kiste=${k.id}">＋ Teil hinzufügen</a>
        <button class="btn small secondary" id="ek">✏️ Bearbeiten</button>
        ${nfc ? '<button class="btn small secondary" id="nfc">📲 NFC-Tag beschreiben</button>' : ''}
        <a class="btn small secondary" href="#etiketten/${k.id}">🏷️ QR-Etikett</a>
        <button class="btn small secondary" id="cp">🔗 Link kopieren</button>
        <button class="btn small danger" id="dk">🗑️ Löschen</button>
      </div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">Link für NFC-Aufkleber: <code style="word-break:break-all">${esc(kisteUrl(k.id))}</code></p>
    </div>
    <div class="list">${teile.map(teilItem).join('') || '<div class="card center muted">Diese Kiste ist noch leer.</div>'}</div>`;
  document.getElementById('ek').onclick = async () => { if (await kisteDialog(k)) route(); };
  document.getElementById('cp').onclick = async () => { try { await navigator.clipboard.writeText(kisteUrl(k.id)); toast('Link kopiert ✔'); } catch { prompt('Link kopieren:', kisteUrl(k.id)); } };
  const dk = document.getElementById('dk');
  if (dk) dk.onclick = async () => { if (!(await deleteKiste('kisten', 'teile', k, teile, kisteLabel(k)))) return; state.kisten = state.kisten.filter(x => x.id !== k.id); location.hash = '#kisten'; };
  if (nfc) document.getElementById('nfc').onclick = () => writeNfc(kisteUrl(k.id), 'diese Kiste');
}

// ---------- NFC & QR ----------
async function writeNfc(url, what) {
  try {
    const ndef = new NDEFReader();
    toast('Jetzt das Handy an den NFC-Aufkleber halten …', 15000);
    await ndef.write({ records: [{ recordType: 'url', data: url }] });
    toast('NFC-Tag beschrieben ✔ – Antippen öffnet jetzt ' + what + '.', 5000);
  } catch (e) { fail(e); }
}
function qrSvg(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
async function viewLabels(id) {
  app.innerHTML = '<div class="center muted" style="padding:2rem">Etiketten werden vorbereitet …</div>';
  try { await ensureQR(); } catch (e) { return fail(e); }
  const list = id ? state.kisten.filter(k => k.id === Number(id)) : state.kisten;
  app.innerHTML = `
    <div class="noprint">
      <a class="back" href="${id ? '#kiste/' + id : '#kisten'}">‹ Zurück</a>
      <h1>🏷️ QR-Etiketten</h1>
      <p class="muted">Ausdrucken, ausschneiden und auf die Kiste/Tüte kleben. Mit der Handy-Kamera scannen öffnet die Kiste. ${id ? '' : 'Häkchen entfernen, um Etiketten nicht zu drucken.'}</p>
      <button class="btn" onclick="window.print()">🖨️ Drucken</button><div style="height:1rem"></div>
    </div>
    <div class="labels">${list.map(k => `<div class="label">
      ${id ? '' : `<label class="noprint" style="margin:0;font-weight:400"><input type="checkbox" checked data-skip> drucken</label>`}
      ${qrSvg(kisteUrl(k.id))}
      <div class="ln">${esc(k.art)} ${esc(k.nummer)}</div>
      <div class="lt">${esc(k.name || '')}${k.farbe ? ' · ' + esc(k.farbe) : ''}</div></div>`).join('') || '<p class="muted">Noch keine Kisten.</p>'}</div>`;
  app.querySelectorAll('[data-skip]').forEach(cb => cb.onchange = () => cb.closest('.label').classList.toggle('skip', !cb.checked));
}

// ---------- Reserve & Sets ----------
/** Ohne eigenes Foto: Titelbild aus den zugeordneten Teilen nehmen */
const setCoverRow = (s, teile) => imgUrl(s) ? s : ((teile || []).find(t => imgUrl(t)) || s);
/** Fotos im Detail: eigene Fotos, sonst die Fotos der zugeordneten Teile */
function setPhotos(s, teile) {
  if (imgList(s).length) return photoStrip(s);
  const bilder = [...new Set((teile || []).flatMap(imgList))].filter(p => state.imgCache[p]).slice(0, 24);
  return bilder.length ? `<div class="muted" style="font-size:.85rem;margin-bottom:.2rem">📷 Fotos der Teile</div>${photoStrip({ bilder })}` : '';
}
function setListItem(s, n, da, href, extra = '', teile = []) {
  const art = setArt(s);
  return `<a class="item" href="${href}">${thumb(setCoverRow(s, teile), artIcon(art))}
    <div class="info"><div class="title">${esc(s.set_nummer)} ${esc(s.name || '')}</div>
    ${s.beschreibung ? `<div class="sub">${esc(s.beschreibung)}</div>` : ''}
    <div class="sub">${extra}${num(n)} Teile erfasst</div></div>
    <div class="right">${da == null ? `<b>${num(n)}</b>` : `<span class="badge ${da === n ? 'green' : 'red'}">${da}/${n} da</span>`}</div></a>`;
}
/** Angaben eines Reserve/Set-Eintrags (wie bei Teilen) */
function setFactsHtml(s) {
  return s.beschreibung ? `<dl class="dl" id="setFacts"><dt>Beschreibung</dt><dd>${esc(s.beschreibung)}</dd></dl>` : '';
}
/** Reserve & Sets als Tabelle (CSV) */
function exportSetsCsv(lego) {
  const cfg = SETCFG[lego ? 'lego' : 'pm'];
  const head = ['Bereich', 'Nummer', 'Name', 'Beschreibung', 'Notiz', 'Teile zugeordnet', 'Fotos'].concat(lego ? ['Jahr', 'Teile laut Anleitung'] : []);
  const cellv = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = cfg.list().map(s => {
    return [artName(setArt(s), lego), s.set_nummer, s.name, s.beschreibung, s.notiz, cfg.countTeile(s), imgList(s).length || ''].concat(lego ? [s.jahr, s.teile_anzahl] : []); });
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(cellv).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${lego ? 'lego' : 'playmobil'}-reserve-sets-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
/** Suche in Reserve/Sets: Nummer (ohne Leerzeichen/Striche), Name, Notiz, Beschreibung, Farbe */
const setSearchQ = {};
function setMatches(s, q) {
  q = String(q || '').trim(); if (!q) return true;
  const nr = normNr(s.set_nummer), qn = normNr(q);
  if (qn && nr.includes(qn)) return true;
  const txt = norm([s.set_nummer, s.name, s.notiz, s.beschreibung, s.farbe].filter(Boolean).join(' '));
  return norm(q).split(/\s+/).filter(Boolean).every(w => txt.includes(w) || (normNr(w) && nr.includes(normNr(w))));
}
function setSearchHtml(nm, val) {
  return `<div class="search" style="display:flex;gap:.4rem;align-items:center"><input id="sq" type="search" style="flex:1" placeholder="${esc(nm)} durchsuchen: Nummer, Name, Notiz …" value="${esc(val || '')}" autocomplete="off">
    <button type="button" class="btn small secondary" id="sqClear" title="Suche leeren" ${val ? '' : 'hidden'}>✕</button></div>
    <div id="sCount" class="muted" style="margin-bottom:.5rem"></div><div id="sList" class="list"></div>`;
}
function bindSetSearch(key, list, nm, itemHtml) {
  const q = document.getElementById('sq'), clr = document.getElementById('sqClear');
  const render = () => {
    const v = setSearchQ[key] || '', res = list.filter(s => setMatches(s, v));
    clr.hidden = !v;
    document.getElementById('sCount').textContent = v ? `${num(res.length)} von ${num(list.length)} Einträgen` : `${num(list.length)} Einträge`;
    document.getElementById('sList').innerHTML = res.map(itemHtml).join('')
      || (list.length ? '<div class="card center muted">Nichts gefunden.</div>' : `<div class="card center muted">Hier ist noch nichts angelegt.</div>`);
  };
  q.oninput = () => { setSearchQ[key] = q.value; render(); };
  clr.onclick = () => { setSearchQ[key] = ''; q.value = ''; render(); q.focus(); };
  render();
}
function viewSets(art = 'reserve') {
  const nm = artName(art);
  const list = state.sets.filter(s => setArt(s) === art);
  app.innerHTML = `
    <h1>${artIcon(art)} ${esc(nm)}</h1>
    <button class="btn block" id="ns" style="margin-bottom:.8rem">＋ Neu in ${esc(nm)}</button>
    ${setSearchHtml(nm, setSearchQ['pm-' + art])}`;
  bindSetSearch('pm-' + art, list, nm, s => { const teile = state.teile.filter(t => (t.teil_sets || []).some(x => x.set_id === s.id));
    return setListItem(s, teile.length, teile.filter(t => t.anzahl > 0).length, '#set/' + s.id, '', teile); });
  document.getElementById('ns').onclick = async () => { const s = await setDialog(null, art); if (s) location.hash = '#set/' + s.id; };
}

function viewSet(id) {
  const s = setById(id);
  if (!s) { app.innerHTML = '<div class="card">Nicht gefunden. <a href="#reserve">Zur Übersicht</a></div>'; return; }
  const art = setArt(s), back = art === 'set' ? '#sets' : '#reserve';
  const teile = state.teile.filter(t => (t.teil_sets || []).some(x => x.set_id === s.id));
  const da = teile.filter(t => t.anzahl > 0), fehlt = teile.filter(t => !(t.anzahl > 0));
  const sum = sumTeile(teile);
  app.innerHTML = `
    <a class="back" href="${back}">‹ ${esc(artName(art))}</a>
    <div class="card">
      ${setPhotos(s, teile)}
      <h1 style="margin-bottom:.3rem">${artIcon(art)} ${esc(s.set_nummer)} ${esc(s.name || '')}</h1>
      ${setFactsHtml(s, false)}
      ${s.notiz ? `<p>${esc(s.notiz)}</p>` : ''}
      <p><span class="badge green">${da.length} Teile vorhanden</span>${fehlt.length ? `<span class="badge red">${fehlt.length} fehlen</span>` : ''}<span class="badge">${num(sum.stueck)} Stück</span><span class="badge">${euro(sum.wert)}</span></p>
      <div class="row"><a class="btn small" href="#teil/neu?set=${s.id}">＋ Teil zuordnen</a><button class="btn small secondary" id="es">✏️ Bearbeiten</button>
      ${teile.length ? '' : '<button class="btn small danger" id="ds">🗑️ Löschen</button>'}</div>
    </div>
    ${fehlt.length ? `<h2>Fehlt (Anzahl 0)</h2><div class="list">${fehlt.map(teilItem).join('')}</div>` : ''}
    <h2>Vorhanden</h2><div class="list">${da.map(teilItem).join('') || '<div class="card center muted">Noch keine Teile zugeordnet.</div>'}</div>`;
  bindPhotoStrip(app);
  document.getElementById('es').onclick = async () => { const r = await setDialog(s); if (r) { if (r.id !== s.id) location.hash = '#set/' + r.id; else route(); } };
  const ds = document.getElementById('ds');
  if (ds) ds.onclick = async () => { if (!confirm('Wirklich löschen?')) return; const { error } = await sb.from('sets').delete().eq('id', s.id); if (error) return fail(error);
    if (imgList(s).length) sb.storage.from(BUCKET).remove(imgList(s)).catch(console.warn);
    state.sets = state.sets.filter(x => x.id !== s.id); location.hash = back; };
}

/** Knopf „Reiter umbenennen“ (nur in der eigenen Sammlung) */
const renameTabsBtn = mode => state.viewUid ? '' : `<button class="btn block secondary" id="renTabs" data-mode="${mode}">✏️ Reiter umbenennen</button>`;
function bindRenameTabs() { const b = document.getElementById('renTabs'); if (b) b.onclick = async () => { if (await tabRenameDialog(b.dataset.mode)) route(); }; }

// ---------- Übersicht & CSV ----------
function viewStats() {
  const s = sumTeile(state.teile);
  const ohneKiste = state.teile.filter(t => !t.kiste_id).length;
  const topK = state.kisten.map(k => ({ k, ...sumTeile(state.teile.filter(t => t.kiste_id === k.id)) })).sort((a, b) => b.wert - a.wert).slice(0, 5);
  app.innerHTML = `
    <h1>📊 Übersicht</h1>
    <div class="stats">
      <div class="stat"><b>${num(s.teile)}</b>verschiedene Teile</div>
      <div class="stat"><b>${num(s.stueck)}</b>Stück insgesamt</div>
      <div class="stat"><b>${euro(s.wert)}</b>Gesamtwert</div>
      <div class="stat"><b>${num(state.kisten.length)}</b>Kisten & Tüten</div>
      <div class="stat"><b>${num(state.sets.filter(x => setArt(x) === 'reserve').length)}</b>${esc(artName('reserve'))}</div>
      <div class="stat"><b>${num(state.sets.filter(x => setArt(x) === 'set').length)}</b>${esc(artName('set'))}</div>
      <div class="stat"><b>${num(ohneKiste)}</b>Teile ohne Kiste</div>
    </div>
    ${topK.length ? `<h2>Wertvollste Kisten</h2><div class="list">${topK.map(x => `<a class="item" href="#kiste/${x.k.id}"><div class="thumb">📦</div><div class="info"><div class="title">${esc(kisteLabel(x.k))}</div><div class="sub">${num(x.stueck)} Stück</div></div><div class="right">${euro(x.wert)}</div></a>`).join('')}</div>` : ''}
    <h2>Daten übernehmen &amp; sichern</h2>
    <div class="card"><a class="btn block secondary" href="#import">📥 Aus Excel oder Tabelle übernehmen</a>
      <div style="height:.5rem"></div>
      <button class="btn block" id="csv">⬇️ Als Tabelle speichern</button>
      <div style="height:.5rem"></div>
      <button class="btn block secondary" id="csvSets">⬇️ ${esc(artName('reserve'))} &amp; ${esc(artName('set'))} als Tabelle</button></div>
    <h2>Aufräumen</h2><div class="card"><a class="btn block secondary" id="dupBtn" href="#doppelte">🔁 Doppelte prüfen</a>
      <p class="muted" style="font-size:.85rem;margin:.4rem 0 0">Einträge in ${esc(artName('reserve'))} &amp; ${esc(artName('set'))} mit gleicher oder ähnlicher Nummer finden und zusammenführen.</p></div>
    ${state.viewUid ? '' : `<h2>Einstellungen</h2><div class="card">${renameTabsBtn('pm')}</div>`}
    <p class="muted center" style="font-size:.85rem">Angemeldet als ${esc(state.user.email)}</p>`;
  document.getElementById('csv').onclick = exportCsv;
  document.getElementById('csvSets').onclick = () => exportSetsCsv(false);
  bindRenameTabs();
}

function exportCsv() {
  const head = ['Teile-Nr.', 'Farbe', 'Beschreibung', 'Sets', 'Euro', 'Anzahl', 'Wert gesamt', 'In Kiste', 'Kisten-Farbe', 'Ort', 'Notiz', 'Bild', 'Erfasst am'];
  const cell = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const dec = n => n == null ? '' : String(Number(n).toFixed(2)).replace('.', ',');
  const rows = state.teile.map(t => { const k = kisteById(t.kiste_id); return [t.teile_nr, t.farbe, t.beschreibung, teilSets(t).map(setLabel).join(', '), dec(t.euro), t.anzahl, t.euro != null ? dec(t.euro * t.anzahl) : '', k ? `${k.art} ${k.nummer}${k.name ? ' ' + k.name : ''}` : '', k?.farbe, k?.ort, t.notiz, t.bild_url ? 'ja' : '', new Date(t.created_at).toLocaleDateString('de-DE')]; });
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `playmobil-sammlung-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------- Passwort neu setzen (nach Reset-Link) ----------
function viewPasswort() {
  app.innerHTML = `<div class="card login"><h1>Neues Passwort</h1><form id="pf"><label>Neues Passwort</label><input id="np" type="password" minlength="6" required autocomplete="new-password"><div style="height:1rem"></div><button class="btn block">Speichern</button></form></div>`;
  document.getElementById('pf').onsubmit = async e => { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: document.getElementById('np').value }); if (error) return fail(error); toast('Passwort geändert ✔'); location.hash = '#teile'; };
}

// =====================================================================
// ---------- Bereich: Vorratskammer ----------
// =====================================================================
const vstate = { loaded: false, orte: [], items: [], chargen: {}, lastEntnahme: {}, filter: { q: '', kat: '', ort: '', nur: '' } };
const KATEGORIEN = ['Konserven', 'Nudeln', 'Reis & Getreide', 'Getränke', 'Backen', 'Gewürze', 'Frühstück', 'Snacks', 'Tiefkühl', 'Gemüse', 'Obst', 'Milchprodukte', 'Fleisch & Wurst', 'Fisch', 'Brot & Backwaren', 'Süßigkeiten', 'Haushalt', 'Sonstiges'];
const EINHEITEN = ['Stück', 'Packung', 'Dose', 'Glas', 'Flasche', 'kg', 'g', 'l', 'ml'];
const PACK_UNITS = new Set(['packung', 'dose', 'glas', 'flasche']);
const BASIS_EINHEITEN = ['l', 'ml', 'kg', 'g', 'Stück'];
const isPackUnit = u => PACK_UNITS.has(norm(u || ''));
function formatGebinde(it) {
  const n = Number(it.menge) || 0;
  const u = (it.einheit || '').trim() || 'Stück';
  const gi = it.gebinde_inhalt != null ? Number(it.gebinde_inhalt) : null;
  const be = (it.basis_einheit || '').trim();
  if (!isPackUnit(u) || gi == null || !be || !(gi > 0)) return '';
  const total = Math.round(n * gi * 1000) / 1000;
  const beLabel = be === 'l' ? 'Liter' : be;
  return `${dec(n)} ${u} à ${dec(gi)} ${beLabel} · Gesamt ${dec(total)} ${beLabel}`;
}

/** Lokale Produkt→Kategorie/Einheit-Hinweise (kein Netz). */
const PRODUCT_HINTS = [
  { keys: ['tomat', 'gurke', 'zucchini', 'paprika', 'karotte', 'möhre', 'moehre', 'zwiebel', 'knoblauch', 'salat', 'spinat', 'kohl', 'brokkoli', 'blumenkohl', 'bohne', 'erbse', 'mais', 'kartoffel', 'gemüse', 'gemuese'], kat: 'Gemüse', ein: 'kg', min: 1 },
  { keys: ['apfel', 'birne', 'banane', 'orange', 'zitrone', 'beere', 'traube', 'kiwi', 'mango', 'obst', 'früchte', 'fruechte'], kat: 'Obst', ein: 'kg', min: 1 },
  { keys: ['milch', 'joghurt', 'quark', 'sahne', 'käse', 'kaese', 'frischkäse', 'frischkaese', 'schmand', 'molke'], kat: 'Milchprodukte', ein: 'l' },
  { keys: ['butter', 'margarine'], kat: 'Milchprodukte', ein: 'Packung' },
  { keys: ['wurst', 'salami', 'schinken', 'hack', 'fleisch', 'steak', 'hähnchen', 'haehnchen', 'huhn', 'pute', 'rind', 'schwein'], kat: 'Fleisch & Wurst', ein: 'kg' },
  { keys: ['fisch', 'lachs', 'thunfisch', 'hering', 'forelle'], kat: 'Fisch', ein: 'Packung' },
  { keys: ['brot', 'brötchen', 'broetchen', 'toast', 'baguette'], kat: 'Brot & Backwaren', ein: 'Stück' },
  { keys: ['wasser', 'saft', 'cola', 'limo', 'limonade', 'bier', 'wein', 'schorle', 'tee', 'kaffee'], kat: 'Getränke', ein: 'l' },
  { keys: ['nudel', 'spaghetti', 'penne', 'macaroni'], kat: 'Nudeln', ein: 'kg' },
  { keys: ['reis', 'couscous', 'quinoa', 'mehl', 'hafer', 'getreide'], kat: 'Reis & Getreide', ein: 'kg' },
  { keys: ['dose', 'konserve', 'eingelegt'], kat: 'Konserven', ein: 'Dose' },
  { keys: ['tiefkühl', 'tiefkuehl', 'tk-', 'frozen', 'eis '], kat: 'Tiefkühl', ein: 'Packung' },
  { keys: ['müsli', 'muesli', 'cornflakes', 'marmelade', 'honig', 'nutella'], kat: 'Frühstück', ein: 'Packung' },
  { keys: ['chips', 'cracker', 'riegel', 'schokolade', 'gummi', 'süß', 'suess'], kat: 'Snacks', ein: 'Packung' },
  { keys: ['gewürz', 'gewuerz', 'pfeffer', 'salz', 'paprikapulver', 'curry', 'oregano'], kat: 'Gewürze', ein: 'Stück' },
  { keys: ['spül', 'spuel', 'waschmittel', 'putz', 'toilettenpapier', 'müllbeutel', 'muellbeutel'], kat: 'Haushalt', ein: 'Packung' },
];
function findSimilarVorrat(name, excludeId) {
  const n = norm(name).trim();
  if (n.length < 2) return null;
  const list = vstate.items.filter(i => i.id !== excludeId);
  let hit = list.find(i => norm(i.name) === n);
  if (hit) return hit;
  hit = list.find(i => { const m = norm(i.name); return m.length >= 3 && (m.includes(n) || n.includes(m)); });
  return hit || null;
}
function dictProductHint(name) {
  const n = norm(name);
  if (n.length < 3) return null;
  for (const h of PRODUCT_HINTS) {
    if (h.keys.some(k => n.includes(norm(k)))) return { kategorie: h.kat, einheit: h.ein, mindestbestand: h.min ?? null, source: 'dict' };
  }
  return null;
}
function productSuggest(name, excludeId) {
  const prev = findSimilarVorrat(name, excludeId);
  if (prev) {
    return {
      kategorie: prev.kategorie || null,
      einheit: prev.einheit || null,
      mindestbestand: prev.mindestbestand != null ? prev.mindestbestand : null,
      ort_id: prev.ort_id || null,
      source: 'prev',
      label: prev.name,
    };
  }
  return dictProductHint(name);
}
const ortById = id => vstate.orte.find(o => o.id === Number(id));
const ortUrl = id => baseUrl() + '#v/ort/' + id;
const dec = n => (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const parseDec = v => { v = String(v ?? '').trim().replace(/\s|€/g, '').replace(',', '.'); if (v === '') return null; const n = Number(v); if (isNaN(n)) throw new Error('„' + v + '“ ist keine gültige Zahl. Bitte z.B. 1,5 eingeben.'); return n; };
/** MHD-Datum als YYYY-MM-DD (Chargen oder Parent). */
function parseMhdRaw(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}
function localDay(y, m, d) { return new Date(y, m - 1, d); }
function dayFromISO(iso) {
  const s = parseMhdRaw(iso); if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return localDay(y, m, d);
}
/** Frühestes MHD: Chargen mit Menge > 0, sonst Parent-Feld. */
function mhdDateOf(it) {
  if (!it) return null;
  const lots = (vstate.chargen && vstate.chargen[it.id]) || [];
  let best = null;
  for (const l of lots) {
    if (!(Number(l.menge) > 0)) continue;
    const s = parseMhdRaw(l.mhd);
    if (s && (!best || s < best)) best = s;
  }
  if (best) return best;
  return parseMhdRaw(it.mhd);
}
/** Tage bis MHD (negativ = abgelaufen). Optional now für Tests. */
function mhdDays(it, now) {
  const iso = mhdDateOf(it);
  if (!iso) return null;
  const target = dayFromISO(iso); if (!target) return null;
  const t = now ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((target - t) / 864e5);
}
const mhdState = (it, now) => { const d = mhdDays(it, now); return d == null ? '' : d < 0 ? 'bad' : d <= 14 ? 'warn' : ''; };
const isLow = it => it.mindestbestand != null && Number(it.menge) < Number(it.mindestbestand);
const mhdText = it => {
  const iso = mhdDateOf(it); const d = mhdDays(it);
  if (d == null || !iso) return '';
  const ds = dayFromISO(iso).toLocaleDateString('de-DE');
  return d < 0 ? `<span class="badge red">abgelaufen ${ds}</span>` : d <= 14 ? `<span class="badge orange">MHD ${ds} (${d === 0 ? 'heute' : 'in ' + d + ' T.'})</span>` : `<span class="badge">MHD ${ds}</span>`;
};
window.mhdDateOf = mhdDateOf;
window.mhdDays = mhdDays;
window.mhdState = mhdState;
const vsort = (a, b) => a.name.localeCompare(b.name, 'de');

async function loadVorrat() {
  const [o, v, c] = await Promise.all([
    selectAll(() => sb.from('vorrat_orte').select('*').eq('user_id', owner())),
    selectAll(() => sb.from('vorrat').select('*').eq('user_id', owner())),
    selectAll(() => sb.from('vorrat_chargen').select('*').eq('user_id', owner())),
  ]);
  for (const r of [o, v, c]) if (r.error) throw r.error;
  vstate.orte = o.data.sort((a, b) => sortNat(a.name, b.name));
  vstate.items = v.data.sort(vsort);
  vstate.chargen = {};
  for (const ch of c.data) (vstate.chargen[ch.vorrat_id] ||= []).push(ch);
  for (const id of Object.keys(vstate.chargen)) vstate.chargen[id].sort((a, b) => String(a.mhd || '9999').localeCompare(String(b.mhd || '9999')));
  // Frühestes Chargen-MHD auf Artikel spiegeln (Anzeige/Filter, ohne DB-Schreiben)
  for (const it of vstate.items) {
    const earliest = mhdDateOf(it);
    if (earliest) it.mhd = earliest;
  }
  vstate.lastEntnahme = {};
  try {
    const er = await sb.from('vorrat_entnahmen').select('vorrat_id, datum').eq('user_id', owner()).order('datum', { ascending: false }).limit(500);
    if (!er.error) {
      for (const e of er.data || []) {
        if (vstate.lastEntnahme[e.vorrat_id] == null) vstate.lastEntnahme[e.vorrat_id] = e.datum;
      }
    } else {
      console.warn('Entnahmen nicht geladen', er.error);
    }
  } catch (e) { console.warn(e); }
  vstate.loaded = true;
  loadImageUrls(vstate.items).then(() => {
    const h = (location.hash || '').slice(1);
    if (h === 'v/liste' || h === 'v/orte' || h === 'v/einkauf' || h === 'v/uebersicht') {
      try { route(); } catch { /* */ }
    }
  }).catch(e => console.warn(e));
}

async function routeVorrat(view, id) {
  const hashQ = new URLSearchParams((location.hash.split('?')[1] || ''));
  view = String(view || 'liste').split('?')[0];
  if (id) id = String(id).split('?')[0];
  const tab = { artikel: 'v/liste', ort: 'v/orte', etiketten: 'v/orte', bon: 'v/liste' }[view] || 'v/' + view;
  setMode('v', tab);
  if (!vstate.loaded) {
    app.innerHTML = '<div class="center muted" style="padding:3rem">Vorrat wird geladen …</div>';
    try { await loadVorrat(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Vorrat konnte nicht geladen werden. <button class="btn small" type="button" onclick="location.reload()">Erneut versuchen</button></div>'; return; }
  }
  if (hashQ.has('nur')) vstate.filter.nur = hashQ.get('nur') || '';
  if (hashQ.has('kat')) vstate.filter.kat = hashQ.get('kat') || '';
  if (hashQ.has('ort')) vstate.filter.ort = hashQ.get('ort') || '';
  const views = {
    liste: vListe, artikel: vForm, orte: vOrte, ort: vOrt, einkauf: vEinkauf, uebersicht: vStats, etiketten: vLabels,
    teilen: () => viewTeilen('vorrat'), import: () => viewImport('vorrat'),
    plz: (typeof viewPlzSettings === 'function' ? viewPlzSettings : () => { app.innerHTML = '<div class="card">PLZ-Einstellungen gerade nicht verfügbar. <a href="#v/liste">Zur Liste</a></div>'; }),
    bon: () => { openBonView().catch(fail); },
  };
  try {
    (views[view] || vListe)(id);
  } catch (e) {
    fail(e);
    app.innerHTML = '<div class="card">Vorrat konnte nicht geladen werden. <button class="btn small" type="button" onclick="location.hash=\'#v/liste\';location.reload()">Erneut versuchen</button></div>';
  }
}

function vMatches(it, f) {
  if (f.kat && it.kategorie !== f.kat) return false;
  if (f.ort && String(it.ort_id) !== f.ort && !(f.ort === 'none' && !it.ort_id)) return false;
  if (f.nur === 'mhd') {
    if (!(Number(it.menge) > 0)) return false;
    if (!mhdState(it)) return false;
  }
  if (f.nur === 'low' && !isLow(it)) return false;
  if (!f.q) return true;
  const o = ortById(it.ort_id);
  const hay = norm([it.name, it.kategorie, it.einheit, it.barcode, it.notiz, o?.name].join(' '));
  return norm(f.q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function vItem(it) {
  const o = ortById(it.ort_id);
  const cls = mhdState(it) || (isLow(it) ? 'warn' : '');
  const lots = vstate.chargen[it.id] || [];
  const lotHint = lots.length > 1 ? `<span class="badge">${lots.length} Chargen</span>` : '';
  return `<div class="vitem ${cls}" data-id="${it.id}">
    <a class="info" href="#v/artikel/${it.id}" style="display:flex;gap:.6rem;align-items:center">${imgUrl(it) ? thumb(it) : '<div class="thumb">🥫</div>'}
      <div style="min-width:0;flex:1"><div class="title">${esc(it.name)}</div>
      <div class="sub">${esc(it.kategorie || '')}${o ? ' · 📍 ' + esc(o.name) : ''}</div>
      <div>${mhdText(it)}${lotHint}${isLow(it) ? `<span class="badge red">unter Mindestbestand (${dec(it.mindestbestand)})</span>` : ''}</div>
      ${formatGebinde(it) ? `<div class="sub">${esc(formatGebinde(it))}</div>` : ''}
      ${it.preis != null ? `<div class="sub price">${esc(priceLine(it.preis, it.menge))}</div>` : ''}
      ${vstate.lastEntnahme[it.id] ? `<div class="sub muted">Zuletzt abgezogen ${esc(new Date(vstate.lastEntnahme[it.id] + 'T00:00:00').toLocaleDateString('de-DE'))}</div>` : ''}</div></a>
    <div class="qty"><button type="button" data-d="-1" aria-label="weniger">−</button>
      <div class="n">${dec(it.menge)}<small>${esc(it.einheit || '')}</small></div>
      <button type="button" data-d="1" aria-label="mehr">+</button>
      <button type="button" class="offerbtn" data-offer title="Angebote">🛒</button></div></div>`;
}

// +1 / Entnahme mit Menge+Datum
function todayISO() {
  const t = new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function lotLabel(l, unit) {
  const mhd = l.mhd ? 'MHD ' + new Date(l.mhd + 'T00:00:00').toLocaleDateString('de-DE') : 'ohne MHD';
  return `${dec(l.menge)} ${unit || ''} · ${mhd}`.replace(/\s+/g, ' ').trim();
}
/** FIFO: ältestes MHD zuerst. Gibt { plan:[{lot,take}], left } zurück. */
function planEntnahme(lots, amount) {
  let left = Math.round(Number(amount) * 100) / 100;
  const plan = [];
  const sorted = [...lots].filter(l => Number(l.menge) > 0)
    .sort((a, b) => String(a.mhd || '9999').localeCompare(String(b.mhd || '9999')));
  for (const l of sorted) {
    if (left <= 0) break;
    const have = Number(l.menge);
    const take = Math.min(have, left);
    if (take > 0) {
      plan.push({ lot: l, take: Math.round(take * 100) / 100 });
      left = Math.round((left - take) * 100) / 100;
    }
  }
  return { plan, left };
}
async function pickCharge(it, delta) {
  const lots = [...(vstate.chargen[it.id] || [])];
  if (!lots.length) {
    const { data, error } = await sb.from('vorrat_chargen').insert({ vorrat_id: it.id, user_id: owner(), menge: Math.max(0, Number(it.menge) + delta), mhd: it.mhd, ort_id: it.ort_id }).select().single();
    if (error) throw error; (vstate.chargen[it.id] ||= []).push(data); return data;
  }
  if (lots.length === 1) return lots[0];
  return new Promise(resolve => {
    const sorted = lots.filter(l => delta < 0 ? l.menge > 0 : true);
    if (!sorted.length) return resolve(lots[0]);
    if (sorted.length === 1) return resolve(sorted[0]);
    const d = document.createElement('dialog');
    d.innerHTML = `<form><h2 style="margin-top:0">Welche Charge?</h2>
      <p class="muted">${delta < 0 ? 'Entnehmen aus:' : 'Hinzufügen zu:'}</p>
      ${sorted.map(l => `<button type="button" class="btn block secondary" data-id="${l.id}" style="margin:.3rem 0;text-align:left">${esc(lotLabel(l, it.einheit))}${l.notiz ? ' · ' + esc(l.notiz) : ''}</button>`).join('')}
      <button type="button" class="btn secondary block" data-cancel style="margin-top:.6rem">Abbrechen</button></form>`;
    document.body.appendChild(d); d.showModal();
    d.querySelector('[data-cancel]').onclick = () => { d.close(); d.remove(); resolve(null); };
    d.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { const l = lots.find(x => x.id === Number(b.dataset.id)); d.close(); d.remove(); resolve(l); });
  });
}
async function askEntnahme(it) {
  let lots = [...(vstate.chargen[it.id] || [])].filter(l => Number(l.menge) > 0);
  const total = lots.reduce((s, l) => s + Number(l.menge), 0) || Number(it.menge) || 0;
  if (!(total > 0)) { toast('Nichts mehr zum Abziehen.'); return null; }
  const unit = it.einheit || '';
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    const lotSelect = lots.length > 1 ? `<label for="enLot">Aus Charge</label>
      <select id="enLot">
        <option value="fifo">Ältestes MHD zuerst</option>
        ${[...lots].sort((a, b) => String(a.mhd || '9999').localeCompare(String(b.mhd || '9999')))
          .map(l => `<option value="${l.id}">${esc(lotLabel(l, unit))}</option>`).join('')}
      </select>` : (lots.length === 1 ? `<p class="muted" style="font-size:.9rem">Charge: ${esc(lotLabel(lots[0], unit))}</p>` : '');
    d.innerHTML = `<form id="enForm">
      <h2 style="margin-top:0">Vom Vorrat abziehen</h2>
      <p class="muted" style="margin-top:0">${esc(it.name)} · verfügbar ${dec(total)} ${esc(unit)}</p>
      <label for="enMenge">Menge${unit ? ' (' + esc(unit) + ')' : ''}</label>
      <input id="enMenge" inputmode="decimal" value="1" required autocomplete="off">
      <label for="enDatum">Datum</label>
      <input id="enDatum" type="date" value="${todayISO()}" required>
      ${lotSelect}
      <div class="row" style="margin-top:1rem;gap:.5rem">
        <button type="button" class="btn secondary grow" data-cancel>Abbrechen</button>
        <button type="submit" class="btn grow" style="background:#c62828">Abziehen</button>
      </div>
    </form>`;
    document.body.appendChild(d); d.showModal();
    const finish = v => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-cancel]').onclick = () => finish(null);
    d.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    d.querySelector('#enForm').onsubmit = e => {
      e.preventDefault();
      let menge;
      try { menge = parseDec(document.getElementById('enMenge').value); } catch (err) { return toast(err.message); }
      if (!(menge > 0)) return toast('Bitte eine Menge größer 0 eingeben.');
      if (menge > total + 1e-9) return toast(`Nur ${dec(total)} ${unit} verfügbar.`);
      const datum = document.getElementById('enDatum').value;
      if (!datum) return toast('Bitte ein Datum wählen.');
      const lotEl = document.getElementById('enLot');
      const lotId = lotEl ? lotEl.value : (lots[0] ? String(lots[0].id) : 'fifo');
      finish({ menge, datum, lotId });
    };
  });
}
async function applyEntnahme(it, spec) {
  const menge = Math.round(Number(spec.menge) * 100) / 100;
  const datum = spec.datum;
  let lots = [...(vstate.chargen[it.id] || [])];
  if (!lots.length) {
    const { data, error } = await sb.from('vorrat_chargen').insert({
      vorrat_id: it.id, user_id: owner(), menge: Math.max(0, Number(it.menge) || 0), mhd: it.mhd, ort_id: it.ort_id,
    }).select().single();
    if (error) throw error;
    lots = [data];
    vstate.chargen[it.id] = lots;
  }
  const available = lots.reduce((s, l) => s + Number(l.menge), 0);
  if (menge > available + 1e-9) throw new Error(`Nur ${dec(available)} ${it.einheit || ''} verfügbar.`);

  let plan;
  if (spec.lotId && spec.lotId !== 'fifo') {
    const lot = lots.find(x => String(x.id) === String(spec.lotId));
    if (!lot) throw new Error('Charge nicht gefunden.');
    if (Number(lot.menge) + 1e-9 < menge) throw new Error('In dieser Charge nicht genug.');
    plan = [{ lot, take: menge }];
  } else {
    const r = planEntnahme(lots, menge);
    if (r.left > 1e-9) throw new Error('Nicht genug Bestand.');
    plan = r.plan;
  }

  const snapshots = plan.map(p => ({ id: p.lot.id, menge: Number(p.lot.menge) }));
  try {
    for (const p of plan) {
      const neu = Math.max(0, Math.round((Number(p.lot.menge) - p.take) * 100) / 100);
      const { data, error } = await sb.from('vorrat_chargen').update({ menge: neu }).eq('id', p.lot.id).select().single();
      if (error) throw error;
      Object.assign(p.lot, data);
    }
    const { error: e2 } = await sb.from('vorrat_entnahmen').insert({
      user_id: owner(), vorrat_id: it.id, menge, datum,
    });
    if (e2) throw e2;
  } catch (e) {
    for (const s of snapshots) {
      try {
        const { data } = await sb.from('vorrat_chargen').update({ menge: s.menge }).eq('id', s.id).select().single();
        const lot = lots.find(l => l.id === s.id);
        if (data && lot) Object.assign(lot, data);
      } catch (rb) { console.error(rb); }
    }
    throw e;
  }
  const { data: fresh } = await sb.from('vorrat').select('*').eq('id', it.id).single();
  if (fresh) Object.assign(it, fresh);
  vstate.lastEntnahme[it.id] = datum;
  toast(`Abgezogen: ${dec(menge)} ${it.einheit || ''}`.trim());
}
function bindQty(container, rerender) {
  container.onclick = async e => {
    const ob = e.target.closest('button[data-offer]');
    if (ob) { const id = Number(ob.closest('.vitem').dataset.id); const it = vstate.items.find(x => x.id === id); return openAngebote(it); }
    const b = e.target.closest('button[data-d]'); if (!b) return;
    const id = Number(b.closest('.vitem').dataset.id);
    const it = vstate.items.find(x => x.id === id);
    const delta = Number(b.dataset.d);
    try {
      if (delta < 0) {
        const spec = await askEntnahme(it);
        if (!spec) return;
        await applyEntnahme(it, spec);
        rerender();
        return;
      }
      const lot = await pickCharge(it, delta); if (!lot) return;
      const neu = Math.max(0, Number(lot.menge) + delta);
      const { data, error } = await sb.from('vorrat_chargen').update({ menge: neu }).eq('id', lot.id).select().single();
      if (error) throw error;
      Object.assign(lot, data);
      const { data: fresh } = await sb.from('vorrat').select('*').eq('id', it.id).single();
      if (fresh) Object.assign(it, fresh);
      rerender();
    } catch (err) { fail(err); }
  };
}
window.planEntnahme = planEntnahme;
window.askEntnahme = askEntnahme;
window.applyEntnahme = applyEntnahme;

function vListe() {
  const f = vstate.filter;
  const kats = [...new Set([...KATEGORIEN, ...vstate.items.map(i => i.kategorie).filter(Boolean)])];
  app.innerHTML = `
    <div class="row" style="margin-bottom:.6rem;flex-wrap:nowrap"><div class="search grow" style="flex:1;margin:0"><input id="q" type="search" placeholder="Vorrat durchsuchen …" value="${esc(f.q)}" autocomplete="off"></div>
      <button class="btn secondary" id="scan" title="Barcode scannen">▥</button></div>
    <div class="filters">
      <select id="fKat"><option value="">Alle Kategorien</option>${kats.map(k => `<option ${k === f.kat ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <select id="fOrt"><option value="">Alle Orte</option><option value="none" ${f.ort === 'none' ? 'selected' : ''}>Ohne Ort</option>${vstate.orte.map(o => `<option value="${o.id}" ${String(o.id) === f.ort ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      <select id="fNur"><option value="">Alles</option><option value="mhd" ${f.nur === 'mhd' ? 'selected' : ''}>MHD bald/abgelaufen</option><option value="low" ${f.nur === 'low' ? 'selected' : ''}>Unter Mindestbestand</option></select>
    </div>
    <div id="count" class="muted" style="margin-bottom:.5rem"></div>
    <div id="list" class="list"></div>
    <div class="fab-stack">
      <a class="fab fab-secondary" href="#v/bon" title="Kassenbon scannen" style="background:#1565c0">📷</a>
      <a class="fab" href="#v/artikel/neu" title="Neuer Artikel" style="background:#2e7d32">＋</a>
    </div>`;
  const list = document.getElementById('list');
  const render = () => {
    const res = vstate.items.filter(i => vMatches(i, f));
    document.getElementById('count').textContent = `${num(res.length)} von ${num(vstate.items.length)} Artikeln`;
    list.innerHTML = res.map(vItem).join('') || (vstate.items.length ? '<div class="card center muted">Nichts gefunden.</div>'
      : '<div class="card center"><p>Noch nichts im Vorrat erfasst.</p><a class="btn" href="#v/artikel/neu">＋ Ersten Artikel anlegen</a></div>');
  };
  bindQty(list, render);
  document.getElementById('q').oninput = e => { f.q = e.target.value; render(); };
  document.getElementById('fKat').onchange = e => { f.kat = e.target.value; render(); };
  document.getElementById('fOrt').onchange = e => { f.ort = e.target.value; render(); };
  document.getElementById('fNur').onchange = e => { f.nur = e.target.value; render(); };
  document.getElementById('scan').onclick = async () => {
    const code = await scanBarcode(); if (!code) return;
    const hit = findVorratByBarcode(code);
    if (hit) location.hash = '#v/artikel/' + hit.id;
    else location.hash = '#v/artikel/neu?barcode=' + encodeURIComponent(code);
  };
  render();
}

// ---------- Barcode / Open Food Facts ----------
function normalizeBarcode(raw) {
  return String(raw ?? '').replace(/[\s-]+/g, '').trim();
}
/** GTIN-8/12/13/14 mit Prüfziffer; Buchstaben und zufällige QR-Texte raus. */
function isValidGtin(code) {
  const s = normalizeBarcode(code);
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(s)) return false;
  const digits = s.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += (i % 2 === 0) ? d * 3 : d; });
  return ((10 - (sum % 10)) % 10) === check;
}
function findVorratByBarcode(code) {
  const c = normalizeBarcode(code);
  if (!c) return null;
  return vstate.items.find(i => normalizeBarcode(i.barcode) === c) || null;
}

async function ensureZXing() {
  if (window.ZXing?.BrowserMultiFormatReader) return window.ZXing;
  await loadScript('vendor/zxing/index.min.js?v=0.21.3');
  if (!window.ZXing?.BrowserMultiFormatReader) throw new Error('Barcode-Scanner ist gerade nicht verfügbar.');
  return window.ZXing;
}

/**
 * Open Food Facts (ODbL) – öffentliche Produkt-API, kein Key.
 * Browser darf keinen eigenen User-Agent setzen; Accept + fields reichen.
 */
async function lookupOpenFoodFacts(ean) {
  const code = normalizeBarcode(ean);
  if (!isValidGtin(code)) return { ok: false, reason: 'invalid' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code)
      + '.json?fields=code,product_name,product_name_de,generic_name,quantity,brands,categories_tags';
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (res.status === 404) return { ok: false, reason: 'notfound' };
    if (!res.ok) throw new Error('off-http-' + res.status);
    const data = await res.json();
    if (!data || data.status !== 1 || !data.product) return { ok: false, reason: 'notfound' };
    return { ok: true, product: data.product };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' };
    return { ok: false, reason: 'network', error: e };
  } finally {
    clearTimeout(to);
  }
}

function offProductName(p) {
  if (!p) return '';
  const de = String(p.product_name_de || '').trim();
  const en = String(p.product_name || '').trim();
  const gen = String(p.generic_name || '').trim();
  const brand = String(p.brands || '').split(',')[0].trim();
  let name = de || en || gen;
  if (!name && brand) name = brand;
  else if (name && brand && !norm(name).includes(norm(brand))) name = brand + ' ' + name;
  return name.trim();
}

function offCategoryFromTags(tags) {
  const hay = (tags || []).join(' ').toLowerCase();
  const rules = [
    [/waters|mineral-waters|spring-waters|beverages|sodas|colas|juices|soft-drinks|teas|coffees|plant-milks/, 'Getränke'],
    [/milks|yogurts|cheeses|dairy|cream|butters/, 'Milchprodukte'],
    [/meats|sausages|poultries|hams/, 'Fleisch & Wurst'],
    [/fishes|seafoods|salmons|tunas/, 'Fisch'],
    [/breakfasts|spreads|cereals|honeys|jams|nutella/, 'Frühstück'],
    [/pastas|noodles/, 'Nudeln'],
    [/rices|flours|grains|quinoa|couscous/, 'Reis & Getreide'],
    [/canned|preserves|pickles/, 'Konserven'],
    [/frozen|ice-creams/, 'Tiefkühl'],
    [/snacks|chips|crackers/, 'Snacks'],
    [/sweets|chocolates|candies|biscuits|cookies/, 'Süßigkeiten'],
    [/breads|bakery/, 'Brot & Backwaren'],
    [/vegetables/, 'Gemüse'],
    [/fruits/, 'Obst'],
    [/spices|sauces|condiments|herbs/, 'Gewürze'],
    [/baking|desserts|sugars/, 'Backen'],
    [/cleaning|household/, 'Haushalt'],
  ];
  for (const [re, kat] of rules) if (re.test(hay)) return kat;
  return null;
}

/** Menge/Einheit/Gebinde aus OFF-quantity (z.B. "1,5 L", "6x0,33l", "400 g"). */
function parseOffQuantity(q) {
  if (q == null || q === '') return null;
  const s = String(q).trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
  let m = s.match(/(\d+)\s*[x×]\s*([\d.]+)\s*(l|liter|ml|cl|kg|g)\b/);
  if (m) {
    const n = Number(m[1]), amt0 = Number(m[2]);
    let unit = m[3] === 'liter' ? 'l' : m[3];
    let amt = amt0;
    if (unit === 'cl') { amt = amt0 / 100; unit = 'l'; }
    const pack = (unit === 'l' || unit === 'ml') ? 'Flasche' : 'Packung';
    return { menge: n, einheit: pack, gebinde_inhalt: amt, basis_einheit: unit };
  }
  m = s.match(/([\d.]+)\s*(l|liter|ml|cl|kg|g)\b/);
  if (!m) return null;
  let amt = Number(m[1]);
  let unit = m[2] === 'liter' ? 'l' : m[2];
  if (unit === 'cl') { amt = amt / 100; unit = 'l'; }
  if (unit === 'kg') return { menge: 1, einheit: 'kg', gebinde_inhalt: null, basis_einheit: null };
  if (unit === 'g') {
    if (amt >= 1000) return { menge: 1, einheit: 'kg', gebinde_inhalt: null, basis_einheit: null };
    return { menge: 1, einheit: 'Packung', gebinde_inhalt: amt, basis_einheit: 'g' };
  }
  if (unit === 'ml') {
    if (amt >= 1000) return { menge: 1, einheit: 'Flasche', gebinde_inhalt: Math.round(amt / 10) / 100, basis_einheit: 'l' };
    return { menge: 1, einheit: 'Flasche', gebinde_inhalt: amt, basis_einheit: 'ml' };
  }
  // Liter
  return { menge: 1, einheit: 'Flasche', gebinde_inhalt: amt, basis_einheit: 'l' };
}

function mapOffToSuggest(product) {
  const name = offProductName(product);
  const qty = parseOffQuantity(product.quantity);
  let kategorie = offCategoryFromTags(product.categories_tags);
  const local = name ? productSuggest(name, null) : null;
  if (!kategorie && local?.kategorie) kategorie = local.kategorie;
  let einheit = qty?.einheit || null;
  if (!einheit && local?.einheit) einheit = local.einheit;
  return {
    name,
    kategorie,
    einheit,
    mindestbestand: local?.mindestbestand != null ? local.mindestbestand : null,
    ort_id: local?.ort_id || null,
    menge: qty?.menge ?? null,
    gebinde_inhalt: qty?.gebinde_inhalt ?? null,
    basis_einheit: qty?.basis_einheit ?? null,
    brands: product.brands || '',
    quantityRaw: product.quantity || '',
    source: 'off',
  };
}

/** Kamera-Scan + manuelle Eingabe. BarcodeDetector oder lazy ZXing. */
function scanBarcode() {
  return new Promise(resolve => {
    let stream = null, timer = null, reader = null, done = false, starting = false;
    const canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const d = document.createElement('dialog');
    d.className = 'scan-dialog';
    d.innerHTML = `<div class="scanbox">
      <h2 style="margin-top:0">Barcode scannen</h2>
      <video playsinline muted autoplay></video>
      <p class="muted" id="scanStatus">Barcode vor die Kamera halten …</p>
      <label for="scanManual" class="muted" style="display:block;margin-top:.6rem">Barcode manuell eingeben</label>
      <div class="row"><input id="scanManual" inputmode="numeric" autocomplete="off" placeholder="z.B. 3057640257773" style="flex:1">
        <button type="button" class="btn small" id="scanManualGo" style="background:#2e7d32">OK</button></div>
      <div class="row" style="margin-top:.6rem;gap:.4rem">
        <button type="button" class="btn secondary grow" id="scanAgain">🔄 Neu scannen</button>
        <button type="button" class="btn secondary grow" id="scanCancel">Abbrechen</button>
      </div>
    </div>`;
    document.body.appendChild(d);
    d.showModal();
    const status = d.querySelector('#scanStatus');
    const video = d.querySelector('video');
    const stopAll = () => {
      clearInterval(timer); timer = null;
      try { reader?.reset?.(); reader?.stopContinuousDecode?.(); reader?.stopAsyncDecode?.(); } catch { /* */ }
      reader = null;
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      try { video.srcObject = null; } catch { /* */ }
    };
    const finish = code => {
      if (done) return;
      done = true;
      stopAll();
      d.close(); d.remove();
      resolve(code ? normalizeBarcode(code) : null);
    };
    d.querySelector('#scanCancel').onclick = () => finish(null);
    d.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    const acceptCode = raw => {
      const c = normalizeBarcode(raw);
      if (!c) return;
      if (!/^\d+$/.test(c)) { status.textContent = 'Bitte nur Ziffern (EAN/GTIN), keine QR-Texte.'; return; }
      if (!isValidGtin(c)) { status.textContent = 'Barcode ungültig (Prüfziffer). Bitte erneut versuchen.'; return; }
      status.textContent = 'Erkannt: ' + c;
      finish(c);
    };
    d.querySelector('#scanManualGo').onclick = () => acceptCode(d.querySelector('#scanManual').value);
    d.querySelector('#scanManual').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); acceptCode(e.target.value); }
    });

    async function startCamera() {
      if (starting || done) return;
      starting = true;
      stopAll();
      if (!canCam) {
        status.textContent = 'Keine Kamera – bitte Barcode manuell eingeben.';
        starting = false;
        return;
      }
      status.textContent = 'Kamera wird geöffnet …';
      const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
      try {
        if ('BarcodeDetector' in window) {
          let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
          let det;
          try { det = new BarcodeDetector({ formats }); }
          catch { det = new BarcodeDetector(); }
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          video.srcObject = stream;
          await video.play();
          status.textContent = 'Barcode vor die Kamera halten …';
          timer = setInterval(async () => {
            if (done) return;
            try {
              const r = await det.detect(video);
              for (const hit of r || []) {
                const raw = hit.rawValue || hit.rawValue === 0 ? String(hit.rawValue) : '';
                if (isValidGtin(raw)) { acceptCode(raw); return; }
              }
            } catch { /* frame skip */ }
          }, 280);
        } else {
          status.textContent = 'Scanner wird geladen …';
          const ZXing = await ensureZXing();
          const hints = new Map();
          try {
            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
              ZXing.BarcodeFormat.EAN_13,
              ZXing.BarcodeFormat.EAN_8,
              ZXing.BarcodeFormat.UPC_A,
              ZXing.BarcodeFormat.UPC_E,
              ZXing.BarcodeFormat.CODE_128,
            ]);
            hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
          } catch { /* */ }
          reader = new ZXing.BrowserMultiFormatReader(hints);
          status.textContent = 'Barcode vor die Kamera halten …';
          await reader.decodeFromVideoDevice(undefined, video, (result, err) => {
            if (done || !result) return;
            try {
              const raw = result.getText ? result.getText() : String(result.text || '');
              if (isValidGtin(raw)) acceptCode(raw);
            } catch { /* */ }
          });
          stream = video.srcObject;
        }
      } catch (e) {
        console.warn('[scan]', e);
        const denied = /NotAllowed|Permission|denied/i.test(String(e?.name || e?.message || e));
        status.textContent = denied
          ? 'Kein Kamerazugriff – bitte Barcode manuell eingeben.'
          : 'Kamera nicht verfügbar – bitte Barcode manuell eingeben.';
      } finally {
        starting = false;
      }
    }
    d.querySelector('#scanAgain').onclick = () => {
      d.querySelector('#scanManual').value = '';
      status.textContent = 'Neu scannen …';
      startCamera();
    };
    startCamera();
  });
}

function vForm(id) {
  const pre = new URLSearchParams(location.hash.split('?')[1] || '');
  const isNew = !id || id.startsWith('neu');
  let it = isNew ? null : vstate.items.find(x => x.id === Number(id));
  if (!isNew && !it) { app.innerHTML = '<div class="card">Artikel nicht gefunden. <a href="#v/liste">Zur Liste</a></div>'; return; }
  it = it || { name: '', kategorie: pre.get('kat') || '', menge: 1, einheit: pre.get('einheit') || 'Stück', mindestbestand: null, ort_id: pre.get('ort') ? Number(pre.get('ort')) : null, mhd: null, preis: null, barcode: pre.get('barcode') || '', angebotsname: '', notiz: '', gebinde_inhalt: null, basis_einheit: null };
  let file = null;
  const u = imgUrl(it);
  const kats = [...new Set([...KATEGORIEN, ...vstate.items.map(i => i.kategorie).filter(Boolean)])];
  const decIn = v => v == null ? '' : String(v).replace('.', ',');
  // Draft-Chargen für neue Artikel; bei Bearbeitung live aus DB
  let draftLots = isNew
    ? [{ _k: 1, menge: it.menge ?? 1, mhd: it.mhd || '', ort_id: it.ort_id || null, notiz: '' }]
    : null;
  let draftKey = 2;
  const touched = { kat: !!it.kategorie, ein: !!(it.einheit && !(isNew && it.einheit === 'Stück' && !pre.get('einheit'))), min: it.mindestbestand != null, ort: !!it.ort_id };
  // Neue Artikel: Einheit „Stück“ Default zählt als unberührt, damit Vorschlag greifen kann
  if (isNew && !pre.get('einheit')) touched.ein = false;

  let editDrafts = [];
  const isEmptyLot = l => !(Number(l.menge) > 0) && !l.mhd;
  const dbLots = () => vstate.chargen[it.id] || [];
  const listLots = () => isNew ? draftLots : [...dbLots(), ...editDrafts];
  const activeLots = () => listLots().filter(l => !isEmptyLot(l));
  const lotSum = () => activeLots().reduce((s, l) => s + (Number(l.menge) || 0), 0);
  const lotCount = () => activeLots().length;

  app.innerHTML = `
    <a class="back" href="#v/liste">‹ Zurück</a>
    <h1>${isNew ? 'Neuer Artikel' : 'Artikel bearbeiten'}</h1>
    ${!isNew && vstate.lastEntnahme[it.id] ? `<p class="muted" style="margin-top:0">Zuletzt abgezogen am ${esc(new Date(vstate.lastEntnahme[it.id] + 'T00:00:00').toLocaleDateString('de-DE'))}</p>` : ''}
    <form id="f" class="card">
      <label for="name">Name</label><input id="name" required value="${esc(it.name)}" placeholder="z.B. Tomaten gehackt" autocomplete="off">
      <div id="nameHint" class="name-hint hidden">
        <span id="nameHintText"></span>
        <button type="button" class="btn small" id="applyHint" style="background:#2e7d32">Alle Vorschläge übernehmen</button>
      </div>
      <label for="angebotsname">Angebotsname <span class="muted">(für Prospekt-Suche, z.B. Milch)</span></label>
      <input id="angebotsname" value="${esc(it.angebotsname || '')}" placeholder="leer = aus Artikelname">
      <label for="kat">Kategorie</label>
      ${suggestField('kat', it.kategorie, kats, 'z.B. Konserven', 'Gemüse, Konserven… wählen')}
      <label for="ein">Einheit</label>
      ${suggestField('ein', it.einheit, EINHEITEN, 'Stück', 'Einheit wählen')}
      <div id="gebindeBox" class="${isPackUnit(it.einheit) ? '' : 'hidden'}">
        <div class="grid2">
          <div><label for="gebinde">Inhalt je Packung</label><input id="gebinde" inputmode="decimal" value="${decIn(it.gebinde_inhalt)}" placeholder="z.B. 1"></div>
          <div><label for="basis">Basis-Einheit</label>
            <select id="basis"><option value="">– wählen –</option>
              ${BASIS_EINHEITEN.map(b => `<option value="${b}" ${it.basis_einheit === b ? 'selected' : ''}>${b === 'l' ? 'Liter (l)' : b}</option>`).join('')}
            </select>
          </div>
        </div>
        <p class="muted" id="gebindeHelp" style="font-size:.9rem;margin:.3rem 0 .5rem"></p>
      </div>
      <div class="grid2">
        <div><label for="min">Mindestbestand</label><input id="min" inputmode="decimal" value="${decIn(it.mindestbestand)}" placeholder="optional"></div>
        <div><label for="preis">Einzelpreis (€ pro Packung/Stück)</label><input id="preis" inputmode="decimal" value="${decIn(it.preis)}" placeholder="0,00"><div id="preisPrev" class="muted" style="font-size:.85rem;margin-top:.25rem"></div></div>
      </div>
      <div id="chargenBox">
        <h2 style="margin:.6rem 0 .2rem">Mengen &amp; MHDs</h2>
        <p class="muted" style="margin:0 0 .35rem;font-size:.9rem">Je Menge ein Haltbarkeitsdatum.</p>
        <p class="muted" id="chargenSum" style="margin:0 0 .5rem"></p>
        <div id="chargenList" class="list"></div>
        <button type="button" class="btn small secondary" id="addCharge">＋ Weiterer MHD-Eintrag</button>
      </div>
      ${isNew ? '' : `<p style="margin-top:.8rem"><button type="button" class="btn small secondary" id="btnOffer">🛒 Angebote ansehen</button>
        <a class="btn small secondary" href="#v/plz">📍 PLZ</a></p>`}
      <details id="moreDetails" style="margin-top:.6rem">
        <summary><b>Weitere Details</b> <span class="muted">(Ort, Barcode, Foto, Notiz)</span></summary>
      <label for="ort">Ort</label>
      <div class="row"><select id="ort" style="flex:1"></select><button type="button" class="btn small secondary" id="newOrt">＋ Neu</button></div>
      <label for="bc">Barcode (optional)</label>
      <div class="row"><input id="bc" style="flex:1" inputmode="numeric" value="${esc(it.barcode)}"><button type="button" class="btn small secondary" id="scanBc">▥ Scannen</button></div>
      <p id="offAttr" class="muted hidden" style="font-size:.85rem;margin:.25rem 0 0">Produktdaten: <a href="https://openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> · Bitte Produkt prüfen</p>
      <p id="bcStatus" class="muted" style="font-size:.85rem;margin:.2rem 0 0"></p>
      <label>Foto (optional)</label>
      <img id="prev" class="photo-preview ${u ? '' : 'hidden'}" src="${esc(u || '')}" alt="">
      <div class="row">
        <label class="btn secondary grow" style="margin:0">📷 Foto<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn secondary grow" style="margin:0">🖼️ Galerie<input id="gal" type="file" accept="image/*" hidden></label>
      </div>
      <label for="notiz">Notiz</label><textarea id="notiz">${esc(it.notiz)}</textarea>
      </details>
      <div style="height:1rem"></div>
      <button class="btn block" type="submit" style="background:#2e7d32">💾 Speichern</button>
      ${isNew ? '<div style="height:.5rem"></div><button class="btn secondary block" type="button" id="saveMore">💾 Speichern & nächster Artikel</button>'
        : '<div style="height:.5rem"></div><button class="btn danger block" type="button" id="del">🗑️ Löschen</button>'}
    </form>`;
  const oSel = document.getElementById('ort');
  const fillOrte = sel => { oSel.innerHTML = '<option value="">– kein Ort –</option>' + vstate.orte.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join(''); oSel.value = sel ?? ''; };
  fillOrte(it.ort_id);
  document.getElementById('newOrt').onclick = async () => { const o = await ortDialog(); if (o) { fillOrte(o.id); touched.ort = true; renderChargen(); } };
  oSel.onchange = () => { touched.ort = true; };
  let offAttrShown = false;
  const bcStatus = () => document.getElementById('bcStatus');
  const showOffAttr = () => {
    const el = document.getElementById('offAttr');
    if (el && !offAttrShown) { el.classList.remove('hidden'); offAttrShown = true; }
  };
  function setLotMengeIfEmpty(menge) {
    if (menge == null || !(Number(menge) > 0)) return;
    if (!isNew || !draftLots || !draftLots.length) return;
    const lot = draftLots[0];
    // Nur setzen wenn Nutzer noch keine eigene Menge/MHD-Kombination „fertig“ hat – MHD behalten
    if (Number(lot.menge) === 1 || Number(lot.menge) === 0 || lot.menge == null) {
      lot.menge = Number(menge);
      renderChargen();
    }
  }
  function fillGebindeFromOff(sug) {
    if (!sug) return;
    const ein = document.getElementById('ein');
    if (sug.einheit && ein && (!touched.ein || !String(ein.value || '').trim() || ein.value === 'Stück')) {
      writeInputValue(ein, sug.einheit);
      syncSuggestPick('ein', sug.einheit);
      touched.ein = true;
    }
    updGebindeUI();
    const box = document.getElementById('gebindeBox');
    const gi = document.getElementById('gebinde');
    const be = document.getElementById('basis');
    if (sug.gebinde_inhalt != null && gi && isPackUnit(document.getElementById('ein')?.value)) {
      if (!String(gi.value || '').trim()) writeInputValue(gi, decIn(sug.gebinde_inhalt));
      if (be && sug.basis_einheit && !be.value) be.value = sug.basis_einheit;
      if (box) box.classList.remove('hidden');
      updGebindeUI();
    } else if (sug.basis_einheit == null && sug.einheit && (sug.einheit === 'kg' || sug.einheit === 'g' || sug.einheit === 'l' || sug.einheit === 'ml')) {
      // reine Mengen-Einheit – kein Gebinde
    }
    setLotMengeIfEmpty(sug.menge);
  }
  let barcodeLookupBusy = false;
  async function applyBarcodeLookup(raw, { fromScan = false } = {}) {
    const code = normalizeBarcode(raw);
    const st = bcStatus();
    const bc = document.getElementById('bc');
    if (!code) { if (st) st.textContent = ''; return; }
    if (barcodeLookupBusy) return;
    barcodeLookupBusy = true;
    try {
    // Barcode ohne change-Event setzen (sonst Lookup-Schleife)
    if (bc) {
      const proto = HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(bc, code); else bc.value = code;
      try { bc.setAttribute('value', code); } catch { /* */ }
    }
    const det = document.getElementById('moreDetails'); if (det) det.open = true;

    // 1) eigener Vorrat zuerst (kein Netz)
    const hit = findVorratByBarcode(code);
    if (hit && (isNew || hit.id !== it.id)) {
      if (st) st.textContent = 'Schon im Vorrat: ' + hit.name;
      const choice = await new Promise(resolve => {
        const dlg = document.createElement('dialog');
        dlg.innerHTML = `<div class="card" style="border:0;box-shadow:none;margin:0">
          <h2 style="margin-top:0">Schon im Vorrat</h2>
          <p><b>${esc(hit.name)}</b> hat diesen Barcode schon.</p>
          <button type="button" class="btn block" id="exEdit" style="background:#2e7d32">Zum Artikel</button>
          <div style="height:.4rem"></div>
          <button type="button" class="btn block secondary" id="exQty">Menge hinzufügen</button>
          <div style="height:.4rem"></div>
          <button type="button" class="btn secondary block" id="exKeep">Hier lassen / neu</button>
        </div>`;
        document.body.appendChild(dlg); dlg.showModal();
        const fin = v => { dlg.close(); dlg.remove(); resolve(v); };
        dlg.querySelector('#exEdit').onclick = () => fin('edit');
        dlg.querySelector('#exQty').onclick = () => fin('qty');
        dlg.querySelector('#exKeep').onclick = () => fin('keep');
        dlg.addEventListener('cancel', e => { e.preventDefault(); fin('keep'); });
      });
      if (choice === 'edit') { location.hash = '#v/artikel/' + hit.id; return; }
      if (choice === 'qty') { location.hash = '#v/artikel/' + hit.id + '?add=1'; return; }
      // keep: barcode bleibt, kein Auto-Fill vom alten Artikel
    }

    if (!isValidGtin(code)) {
      if (st) st.textContent = 'Barcode gesetzt. Keine Prüfziffer – Name bitte selbst eingeben.';
      return;
    }
    if (st) st.textContent = 'Produkt wird gesucht …';
    const res = await lookupOpenFoodFacts(code);
    if (res.reason === 'offline' || res.reason === 'network' || res.reason === 'timeout') {
      if (st) st.textContent = res.reason === 'timeout'
        ? 'Keine Antwort – bitte Name selbst eingeben.'
        : 'Keine Verbindung – bitte Name selbst eingeben.';
      toast('Keine Verbindung', 3500);
      return;
    }
    if (!res.ok) {
      if (st) st.textContent = 'Produkt nicht gefunden – bitte Name selbst eingeben';
      toast('Produkt nicht gefunden – bitte Name selbst eingeben', 4000);
      return;
    }
    const sug = mapOffToSuggest(res.product);
    if (!sug.name) {
      if (st) st.textContent = 'Produkt nicht gefunden – bitte Name selbst eingeben';
      return;
    }
    const nameEl = document.getElementById('name');
    // Name setzen (Scan soll Produkt füllen; Nutzer kann danach ändern)
    if (nameEl) writeInputValue(nameEl, sug.name);
    applySuggest({
      kategorie: sug.kategorie,
      einheit: sug.einheit,
      mindestbestand: sug.mindestbestand,
      ort_id: sug.ort_id,
    }, { force: false });
    fillGebindeFromOff(sug);
    showOffAttr();
    if (st) st.textContent = 'Vorschlag übernommen – bitte Produkt prüfen.';
    toast('Produkt gefunden – bitte prüfen', 3000);
    // Namens-Hinweise nachziehen
    try { showHint(); } catch { /* showHint später definiert */ }
    } finally {
      barcodeLookupBusy = false;
    }
  }
  document.getElementById('scanBc').onclick = async () => {
    const c = await scanBarcode();
    if (c) await applyBarcodeLookup(c, { fromScan: true });
  };
  document.getElementById('bc').addEventListener('change', async e => {
    const c = normalizeBarcode(e.target.value);
    if (c && isValidGtin(c)) await applyBarcodeLookup(c);
  });
  const onFile = e => { file = e.target.files[0]; if (file) { const p = document.getElementById('prev'); p.src = URL.createObjectURL(file); p.classList.remove('hidden'); } };
  document.getElementById('cam').onchange = onFile; document.getElementById('gal').onchange = onFile;
  bindSuggest('kat'); bindSuggest('ein');
  document.getElementById('kat').addEventListener('input', () => { touched.kat = true; });
  document.getElementById('ein').addEventListener('input', () => { touched.ein = true; updGebindeUI(); renderChargen(); });
  document.getElementById('min').addEventListener('input', () => { touched.min = true; });
  const bo = document.getElementById('btnOffer'); if (bo) bo.onclick = () => openAngebote(it);

  function updGebindeUI() {
    const box = document.getElementById('gebindeBox'); if (!box) return;
    const ein = document.getElementById('ein')?.value?.trim() || '';
    const show = isPackUnit(ein);
    box.classList.toggle('hidden', !show);
    const lab = box.querySelector('label[for=gebinde]');
    if (lab) lab.textContent = 'Inhalt je ' + (ein || 'Packung');
    const giEl = document.getElementById('gebinde'), beEl = document.getElementById('basis'), help = document.getElementById('gebindeHelp');
    if (!giEl || !beEl || !help) return;
    let gi = null; try { gi = parseDec(giEl.value); } catch { gi = null; }
    const be = beEl.value;
    const n = lotSum();
    if (!show || gi == null || !be || !(gi > 0)) { help.textContent = show ? 'z.B. 3 Packungen à 1 Liter → Gesamt 3 Liter' : ''; return; }
    const total = Math.round(n * gi * 1000) / 1000;
    const beLabel = be === 'l' ? 'Liter' : be;
    const einLabel = (n === 1 ? ein : (ein === 'Packung' ? 'Packungen' : ein + (ein.endsWith('e') || ein === 'Glas' ? 'n' : 'en')));
    help.textContent = `${dec(n)} ${einLabel} à ${dec(gi)} ${beLabel} = Gesamt ${dec(total)} ${beLabel}`;
  }
  document.getElementById('gebinde')?.addEventListener('input', updGebindeUI);
  document.getElementById('basis')?.addEventListener('change', updGebindeUI);

  const updPreisPrev = () => {
    const el = document.getElementById('preisPrev'); if (!el) return;
    try {
      const u = parseDec(document.getElementById('preis').value);
      const q = lotSum();
      el.textContent = u != null ? priceLine(u, q) : '';
    } catch { el.textContent = ''; }
  };
  document.getElementById('preis').oninput = updPreisPrev;

  function updSumLabel() {
    const el = document.getElementById('chargenSum');
    if (!el) return;
    const n = lotCount(), s = lotSum(), ein = document.getElementById('ein')?.value?.trim() || it.einheit || '';
    const emptyN = listLots().filter(isEmptyLot).length;
    el.textContent = `Gesamt: ${dec(s)}${ein ? ' ' + ein : ''} · ${n} ${n === 1 ? 'Eintrag' : 'Einträge'}`
      + (emptyN ? ` · ${emptyN} leer (zählen nicht)` : '');
    updPreisPrev();
    updGebindeUI();
  }

  function ortOptions(sel) {
    return '<option value="">– Ort –</option>' + vstate.orte.map(o => `<option value="${o.id}" ${String(o.id) === String(sel || '') ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  }

  function renderChargen() {
    const box = document.getElementById('chargenList'); if (!box) return;
    const einLabel = () => {
      const v = document.getElementById('ein')?.value?.trim();
      return v || it.einheit || 'Stück';
    };
    const unit = einLabel();
    if (isNew) {
      box.innerHTML = draftLots.map((l, idx) => `<div class="card charge-card" style="margin:0" data-k="${l._k}">
        <div class="mhd-row">
          <label class="mhd-inline" for="menge_${l._k}">Menge</label>
          <input id="menge_${l._k}" data-f="menge" inputmode="decimal" value="${decIn(l.menge)}" aria-label="Menge">
          <span class="muted mhd-unit">${esc(unit)}</span>
          <span class="mhd-dot">·</span>
          <label class="mhd-inline" for="mhd_${l._k}">MHD</label>
          <input id="mhd_${l._k}" data-f="mhd" type="date" value="${esc(l.mhd || '')}" aria-label="MHD">
          ${draftLots.length > 1 ? `<button type="button" class="btn small danger mhd-x" data-del-d title="Entfernen">✕</button>` : ''}
        </div>
      </div>`).join('');
      box.querySelectorAll('[data-k]').forEach(card => {
        const k = Number(card.dataset.k);
        const lot = draftLots.find(x => x._k === k);
        card.querySelector('[data-f=menge]').oninput = e => { try { lot.menge = parseDec(e.target.value) ?? 0; } catch { lot.menge = 0; } updSumLabel(); };
        card.querySelector('[data-f=mhd]').onchange = e => { lot.mhd = e.target.value || ''; };
        const db = card.querySelector('[data-del-d]');
        if (db) db.onclick = e => { e.preventDefault(); draftLots = draftLots.filter(x => x._k !== k); renderChargen(); };
      });
    } else {
      const lots = listLots();
      box.innerHTML = lots.map((l) => {
        const key = l._draft ? `d${l._k}` : `c${l.id}`;
        const idAttr = l._draft ? `data-dk="${l._k}"` : `data-cid="${l.id}"`;
        return `<div class="card charge-card" style="margin:0" ${idAttr}>
        <div class="mhd-row">
          <label class="mhd-inline" for="menge_${key}">Menge</label>
          <input id="menge_${key}" data-f="menge" inputmode="decimal" value="${decIn(l.menge)}" aria-label="Menge">
          <span class="muted mhd-unit">${esc(unit)}</span>
          <span class="mhd-dot">·</span>
          <label class="mhd-inline" for="mhd_${key}">MHD</label>
          <input id="mhd_${key}" data-f="mhd" type="date" value="${esc(l.mhd || '')}" aria-label="MHD">
          <button type="button" class="btn small danger mhd-x" data-del-x title="Entfernen">✕</button>
        </div>
        ${l._draft ? '' : `<details class="mhd-more"><summary class="muted">Notiz / Ort</summary>
          <label for="ort_${key}">Ort</label><select id="ort_${key}" data-f="ort_id">${ortOptions(l.ort_id)}</select>
          <label for="notiz_${key}">Notiz</label><input id="notiz_${key}" data-f="notiz" value="${esc(l.notiz || '')}">
          <button type="button" class="btn small secondary" data-save-c style="margin-top:.4rem">💾 Charge speichern</button>
        </details>`}
      </div>`;
      }).join('') || '<p class="muted">Noch kein Eintrag – bitte hinzufügen.</p>';
      box.querySelectorAll('[data-save-c]').forEach(btn => btn.onclick = async e => {
        e.preventDefault();
        const card = btn.closest('[data-cid]'); const cid = Number(card.dataset.cid);
        const row = {
          menge: Math.max(0, parseDec(card.querySelector('[data-f=menge]').value) ?? 0),
          mhd: card.querySelector('[data-f=mhd]').value || null,
          ort_id: card.querySelector('[data-f=ort_id]')?.value ? Number(card.querySelector('[data-f=ort_id]').value) : null,
          notiz: card.querySelector('[data-f=notiz]')?.value.trim() || null,
        };
        const { data, error } = await sb.from('vorrat_chargen').update(row).eq('id', cid).select().single();
        if (error) return fail(error);
        const arr = vstate.chargen[it.id]; const i = arr.findIndex(x => x.id === cid); arr[i] = data;
        const { data: fresh } = await sb.from('vorrat').select('*').eq('id', it.id).single(); if (fresh) Object.assign(it, fresh);
        toast('Gespeichert.'); renderChargen();
      });
      box.querySelectorAll('[data-del-x]').forEach(btn => btn.onclick = async e => {
        e.preventDefault();
        const card = btn.closest('[data-cid],[data-dk]');
        if (card.dataset.dk) {
          editDrafts = editDrafts.filter(x => x._k !== Number(card.dataset.dk));
          renderChargen();
          return;
        }
        if (!confirm('Diesen MHD-Eintrag löschen?')) return;
        const cid = Number(card.dataset.cid);
        const { error } = await sb.from('vorrat_chargen').delete().eq('id', cid); if (error) return fail(error);
        vstate.chargen[it.id] = dbLots().filter(x => x.id !== cid);
        const { data: fresh } = await sb.from('vorrat').select('*').eq('id', it.id).single(); if (fresh) Object.assign(it, fresh);
        renderChargen();
      });
      box.querySelectorAll('[data-cid]').forEach(card => {
        const cid = Number(card.dataset.cid);
        const lot = dbLots().find(x => x.id === cid);
        if (!lot) return;
        card.querySelector('[data-f=menge]').oninput = e => { try { lot.menge = parseDec(e.target.value) ?? 0; } catch { } updSumLabel(); };
        card.querySelector('[data-f=mhd]').onchange = e => { lot.mhd = e.target.value || null; updSumLabel(); };
      });
      box.querySelectorAll('[data-dk]').forEach(card => {
        const k = Number(card.dataset.dk);
        const lot = editDrafts.find(x => x._k === k);
        if (!lot) return;
        card.querySelector('[data-f=menge]').oninput = e => { try { lot.menge = parseDec(e.target.value) ?? 0; } catch { lot.menge = 0; } updSumLabel(); };
        card.querySelector('[data-f=mhd]').onchange = e => { lot.mhd = e.target.value || ''; updSumLabel(); };
      });
    }
    updSumLabel();
  }

  document.getElementById('addCharge').onclick = e => {
    e.preventDefault();
    const empty = listLots().find(isEmptyLot);
    if (empty) {
      renderChargen();
      const sel = empty._draft
        ? `[data-dk="${empty._k}"]`
        : (empty._k != null && isNew ? `[data-k="${empty._k}"]` : `[data-cid="${empty.id}"]`);
      const card = document.querySelector(sel);
      const inp = card?.querySelector('[data-f=menge]');
      if (inp) { inp.focus(); inp.select?.(); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      toast('Leere Zeile nutzen – Menge/MHD eintragen');
      return;
    }
    if (isNew) {
      const k = draftKey++;
      draftLots.push({ _k: k, menge: 0, mhd: '', ort_id: null, notiz: '' });
      renderChargen();
      document.querySelector(`[data-k="${k}"]`)?.querySelector('[data-f=menge]')?.focus();
      return;
    }
    // Bestehend: nur lokaler Entwurf – kein leeres DB-Phantom
    const k = draftKey++;
    editDrafts.push({ _draft: true, _k: k, menge: 0, mhd: '', ort_id: null, notiz: '' });
    renderChargen();
    document.querySelector(`[data-dk="${k}"]`)?.querySelector('[data-f=menge]')?.focus();
  };

  // Namens-Vorschläge – form-delegated apply, robust writers
  const hintEl = document.getElementById('nameHint');
  const hintText = document.getElementById('nameHintText');
  let hintTimer = null, lastSug = null;
  function applySuggest(sug, { force = false } = {}) {
    if (!sug) return false;
    const kat = document.getElementById('kat');
    const ein = document.getElementById('ein');
    const min = document.getElementById('min');
    if (!kat || !ein || !min) {
      console.error('[vForm] applySuggest missing fields', { kat: !!kat, ein: !!ein, min: !!min });
      return false;
    }
    let ok = true;
    if (sug.kategorie && (force || !String(kat.value || '').trim())) {
      ok = writeInputValue(kat, sug.kategorie) && ok;
      syncSuggestPick('kat', sug.kategorie);
      if (force) touched.kat = true;
    }
    if (sug.einheit && (force || !String(ein.value || '').trim() || (!touched.ein && ein.value === 'Stück'))) {
      ok = writeInputValue(ein, sug.einheit) && ok;
      syncSuggestPick('ein', sug.einheit);
      if (force) touched.ein = true;
      updGebindeUI();
      renderChargen();
    }
    if (sug.mindestbestand != null && (force || !String(min.value || '').trim())) {
      ok = writeInputValue(min, decIn(sug.mindestbestand)) && ok;
      if (force) touched.min = true;
    }
    if (sug.ort_id && (force || !oSel.value)) {
      fillOrte(sug.ort_id);
      if (force) touched.ort = true;
      const det = document.getElementById('moreDetails'); if (det && force) det.open = true;
    }
    updSumLabel();
    if (force) {
      if (sug.kategorie && kat.value !== String(sug.kategorie)) { console.error('[vForm] kat mismatch', kat.value, sug.kategorie); ok = false; }
      if (sug.einheit && ein.value !== String(sug.einheit)) { console.error('[vForm] ein mismatch', ein.value, sug.einheit); ok = false; }
      if (sug.mindestbestand != null && String(min.value) !== decIn(sug.mindestbestand)) { console.error('[vForm] min mismatch', min.value); ok = false; }
    }
    return ok;
  }
  function showHint() {
    const name = document.getElementById('name').value.trim();
    const sug = productSuggest(name, it.id);
    lastSug = sug;
    if (!sug || (!sug.kategorie && !sug.einheit && sug.mindestbestand == null)) {
      hintEl.classList.add('hidden');
      if (hintText) hintText.textContent = '';
      return;
    }
    const parts = [];
    if (sug.kategorie) parts.push(sug.kategorie);
    if (sug.einheit) parts.push(sug.einheit);
    if (sug.mindestbestand != null) parts.push('Min. ' + dec(sug.mindestbestand));
    if (sug.ort_id) { const o = ortById(sug.ort_id); if (o) parts.push('Ort ' + o.name); }
    const src = sug.source === 'prev' ? `wie „${sug.label}“` : 'Vorschlag';
    if (hintText) hintText.innerHTML = `${esc(src)}: <b>${esc(parts.join(' · '))}</b>`;
    hintEl.classList.remove('hidden');
    applySuggest(sug, { force: false });
  }
  const formEl = document.getElementById('f');
  formEl.addEventListener('click', e => {
    const btn = e.target.closest('#applyHint');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const sug = lastSug || productSuggest(document.getElementById('name').value.trim(), it.id);
    if (!sug) return toast('Kein Vorschlag für diesen Namen.');
    const ok = applySuggest(sug, { force: true });
    toast(ok ? 'Alle Vorschläge übernommen ✔' : 'Übernehmen fehlgeschlagen – bitte erneut tippen');
    if (!ok) console.error('[vForm] apply failed', sug, {
      kat: document.getElementById('kat')?.value,
      ein: document.getElementById('ein')?.value,
      min: document.getElementById('min')?.value,
    });
  });
  const nameEl = document.getElementById('name');
  nameEl.addEventListener('input', () => { clearTimeout(hintTimer); hintTimer = setTimeout(showHint, 450); });
  nameEl.addEventListener('change', showHint);
  nameEl.addEventListener('blur', showHint);
  if (it.name) showHint();
  updGebindeUI();
  renderChargen();
  // Vorausgefüllter Barcode (Liste → Neu) oder ?add=1 (Menge hinzufügen)
  if (isNew && it.barcode && !it.name) {
    applyBarcodeLookup(it.barcode).catch(err => console.warn('[barcode]', err));
  }
  if (!isNew && pre.get('add') === '1') {
    const det = document.getElementById('moreDetails');
    setTimeout(() => document.getElementById('addCharge')?.click(), 200);
  }

  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    if (!confirm('Diesen Artikel löschen?')) return;
    const { error } = await sb.from('vorrat').delete().eq('id', it.id); if (error) return fail(error);
    if (it.bild_url) await sb.storage.from(BUCKET).remove([it.bild_url]);
    vstate.items = vstate.items.filter(x => x.id !== it.id); toast('Gelöscht.'); location.hash = '#v/liste';
  };
  async function save(more) {
    const btns = app.querySelectorAll('form button'); btns.forEach(b => b.disabled = true);
    try {
      const einVal = document.getElementById('ein').value.trim() || null;
      let gebinde_inhalt = null, basis_einheit = null;
      if (isPackUnit(einVal)) {
        gebinde_inhalt = parseDec(document.getElementById('gebinde').value);
        basis_einheit = document.getElementById('basis').value || null;
        if (gebinde_inhalt != null && !basis_einheit) throw new Error('Bitte Basis-Einheit zum Inhalt wählen (z.B. Liter).');
        if (basis_einheit && gebinde_inhalt == null) throw new Error('Bitte Inhalt je Packung eingeben.');
      }
      const row = {
        name: document.getElementById('name').value.trim(),
        angebotsname: document.getElementById('angebotsname').value.trim() || null,
        kategorie: document.getElementById('kat').value.trim() || null,
        einheit: einVal,
        mindestbestand: parseDec(document.getElementById('min').value),
        preis: parseDec(document.getElementById('preis').value),
        ort_id: oSel.value ? Number(oSel.value) : null,
        barcode: document.getElementById('bc').value.trim() || null,
        notiz: document.getElementById('notiz').value.trim() || null,
        gebinde_inhalt,
        basis_einheit,
      };
      if (!row.name) throw new Error('Bitte einen Namen eingeben.');
      if (isNew) {
        const lots = draftLots.filter(l => !isEmptyLot(l));
        const use = lots.length ? lots : [{ _k: 1, menge: 0, mhd: '', ort_id: row.ort_id, notiz: '' }];
        draftLots = use;
        const sum = use.reduce((s, l) => s + Math.max(0, Number(l.menge) || 0), 0);
        const withMhd = use.filter(l => l.mhd).map(l => l.mhd).sort();
        row.menge = sum;
        row.mhd = withMhd[0] || null;
      }
      const oldPath = it.bild_url;
      if (file) {
        toast('Foto wird gespeichert …', 10000);
        const blob = await shrinkImage(file);
        const path = `${owner()}/vorrat/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (up.error) throw up.error;
        row.bild_url = path;
      }
      if (!isNew) {
        const cards = [...document.querySelectorAll('#chargenList [data-cid]')];
        for (const card of cards) {
          const cid = Number(card.dataset.cid);
          const crow = {
            menge: Math.max(0, parseDec(card.querySelector('[data-f=menge]').value) ?? 0),
            mhd: card.querySelector('[data-f=mhd]').value || null,
            ort_id: card.querySelector('[data-f=ort_id]')?.value ? Number(card.querySelector('[data-f=ort_id]').value) : null,
            notiz: card.querySelector('[data-f=notiz]')?.value.trim() || null,
          };
          const ur = await sb.from('vorrat_chargen').update(crow).eq('id', cid).select().single();
          if (ur.error) throw ur.error;
          const arr = vstate.chargen[it.id] || [];
          const ix = arr.findIndex(x => x.id === cid); if (ix >= 0) arr[ix] = ur.data;
        }
        const toInsert = editDrafts.filter(l => !isEmptyLot(l)).map(l => ({
          vorrat_id: it.id, user_id: owner(),
          menge: Math.max(0, Number(l.menge) || 0),
          mhd: l.mhd || null,
          ort_id: row.ort_id,
          notiz: (l.notiz || '').trim() || null,
        }));
        if (toInsert.length) {
          const ins = await sb.from('vorrat_chargen').insert(toInsert).select();
          if (ins.error) throw ins.error;
          (vstate.chargen[it.id] ||= []).push(...(ins.data || []));
          editDrafts = [];
        }
      }
      const r = isNew ? await sb.from('vorrat').insert({ ...row, user_id: owner() }).select().single() : await sb.from('vorrat').update(row).eq('id', it.id).select().single();
      if (r.error) throw r.error;
      if (file && oldPath) await sb.storage.from(BUCKET).remove([oldPath]);
      await loadImageUrls([r.data]);
      // nach Chargen-Sync frische Mengen holen
      if (!isNew) {
        const { data: fresh } = await sb.from('vorrat').select('*').eq('id', it.id).single();
        if (fresh) Object.assign(r.data, fresh);
      }
      vstate.items = (isNew ? [...vstate.items, r.data] : vstate.items.map(x => x.id === r.data.id ? r.data : x)).sort(vsort);
      if (isNew) {
        // Auto-Trigger legt 1 Charge an → ersetzen durch alle Drafts
        const { data: existing } = await sb.from('vorrat_chargen').select('id').eq('vorrat_id', r.data.id);
        if (existing?.length) {
          await sb.from('vorrat_chargen').delete().eq('vorrat_id', r.data.id);
        }
        const rows = draftLots.map(l => ({
          vorrat_id: r.data.id,
          user_id: owner(),
          menge: Math.max(0, Number(l.menge) || 0),
          mhd: l.mhd || null,
          ort_id: l.ort_id || row.ort_id || null,
          notiz: (l.notiz || '').trim() || null,
        }));
        const ins = await sb.from('vorrat_chargen').insert(rows).select();
        if (ins.error) throw ins.error;
        vstate.chargen[r.data.id] = ins.data || [];
        const { data: fresh } = await sb.from('vorrat').select('*').eq('id', r.data.id).single();
        if (fresh) {
          Object.assign(r.data, fresh);
          vstate.items = vstate.items.map(x => x.id === fresh.id ? fresh : x);
        }
      }
      toast('Gespeichert ✔');
      if (more) { const q = new URLSearchParams(); if (row.ort_id) q.set('ort', row.ort_id); if (row.kategorie) q.set('kat', row.kategorie); if (row.einheit) q.set('einheit', row.einheit); q.set('t', Date.now()); location.hash = '#v/artikel/neu?' + q; }
      else location.hash = '#v/liste';
    } catch (e) { fail(e); btns.forEach(b => b.disabled = false); }
  }
  document.getElementById('f').onsubmit = e => { e.preventDefault(); save(false); };
  const sm = document.getElementById('saveMore'); if (sm) sm.onclick = () => save(true);
}

// ---------- Orte (Regale/Fächer) ----------
function ortDialog(o) {
  const p = dialog(`<form><h2 style="margin-top:0">${o ? 'Ort bearbeiten' : 'Neuer Ort'}</h2>
    <label>Name</label><input name="name" required value="${esc(o?.name)}" placeholder="z.B. Regal 2 Fach 3">
    <label>Farbe</label><input name="farbe" value="${esc(o?.farbe)}" placeholder="optional">
    <label>Notiz</label><textarea name="notiz">${esc(o?.notiz)}</textarea>
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  dialog.current._save = async d => {
    const row = formVals(d.querySelector('form'), ['name', 'farbe', 'notiz']);
    const r = o ? await sb.from('vorrat_orte').update(row).eq('id', o.id).select().single() : await sb.from('vorrat_orte').insert({ ...row, user_id: owner() }).select().single();
    if (r.error) throw r.error;
    vstate.orte = (o ? vstate.orte.map(x => x.id === o.id ? r.data : x) : [...vstate.orte, r.data]).sort((a, b) => sortNat(a.name, b.name));
    toast('Ort gespeichert ✔'); return r.data;
  };
  return p;
}

function vOrte() {
  app.innerHTML = `
    <h1>🗄️ Orte in der Vorratskammer</h1>
    <div class="row" style="margin-bottom:.8rem"><button class="btn grow" id="no">＋ Neuer Ort</button><a class="btn secondary" href="#v/etiketten">🏷️ QR-Etiketten</a></div>
    <div class="list">${vstate.orte.map(o => { const n = vstate.items.filter(i => i.ort_id === o.id);
      return `<a class="item" href="#v/ort/${o.id}"><div class="thumb">🗄️</div><div class="info"><div class="title">${esc(o.name)}</div>
        <div class="sub">${dot(o.farbe)}${esc(o.farbe || '')}</div></div><div class="right">${num(n.length)} Artikel</div></a>`; }).join('') || '<div class="card center muted">Noch keine Orte angelegt.</div>'}</div>`;
  document.getElementById('no').onclick = async () => { const o = await ortDialog(); if (o) location.hash = '#v/ort/' + o.id; };
}

function vOrt(id) {
  const o = ortById(id);
  if (!o) { app.innerHTML = '<div class="card">Diesen Ort gibt es (noch) nicht. <a href="#v/orte">Alle Orte</a></div>'; openForeign('vorrat_orte', id); return; }
  const nfc = 'NDEFReader' in window;
  app.innerHTML = `
    <a class="back" href="#v/orte">‹ Alle Orte</a>
    <div class="card">
      <h1 style="margin-bottom:.3rem">🗄️ ${esc(o.name)}</h1>
      ${o.farbe ? `<div class="muted">${dot(o.farbe)}Farbe: ${esc(o.farbe)}</div>` : ''}${o.notiz ? `<p>${esc(o.notiz)}</p>` : ''}
      <div class="row" style="margin-top:.6rem">
        <a class="btn small" href="#v/artikel/neu?ort=${o.id}">＋ Artikel hinzufügen</a>
        <button class="btn small secondary" id="eo">✏️ Bearbeiten</button>
        ${nfc ? '<button class="btn small secondary" id="nfc">📲 NFC-Tag beschreiben</button>' : ''}
        <a class="btn small secondary" href="#v/etiketten/${o.id}">🏷️ QR-Etikett</a>
        <button class="btn small secondary" id="cp">🔗 Link kopieren</button>
        <button class="btn small danger" id="do">🗑️ Löschen</button>
      </div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">Link für NFC-Aufkleber: <code style="word-break:break-all">${esc(ortUrl(o.id))}</code></p>
    </div>
    <div id="list" class="list"></div>`;
  const list = document.getElementById('list');
  const render = () => { const n = vstate.items.filter(i => i.ort_id === o.id); list.innerHTML = n.map(vItem).join('') || '<div class="card center muted">Hier liegt noch nichts.</div>'; document.getElementById('do').classList.toggle('hidden', n.length > 0); };
  bindQty(list, render); render();
  document.getElementById('eo').onclick = async () => { if (await ortDialog(o)) route(); };
  document.getElementById('cp').onclick = async () => { try { await navigator.clipboard.writeText(ortUrl(o.id)); toast('Link kopiert ✔'); } catch { prompt('Link kopieren:', ortUrl(o.id)); } };
  document.getElementById('do').onclick = async () => { if (!confirm('Leeren Ort löschen?')) return; const { error } = await sb.from('vorrat_orte').delete().eq('id', o.id); if (error) return fail(error); vstate.orte = vstate.orte.filter(x => x.id !== o.id); location.hash = '#v/orte'; };
  if (nfc) document.getElementById('nfc').onclick = () => writeNfc(ortUrl(o.id), 'diesen Ort');
}

async function vLabels(id) {
  app.innerHTML = '<div class="center muted" style="padding:2rem">Etiketten werden vorbereitet …</div>';
  try { await ensureQR(); } catch (e) { return fail(e); }
  const list = id ? vstate.orte.filter(o => o.id === Number(id)) : vstate.orte;
  app.innerHTML = `
    <div class="noprint"><a class="back" href="${id ? '#v/ort/' + id : '#v/orte'}">‹ Zurück</a><h1>🏷️ QR-Etiketten (Vorrat)</h1>
      <p class="muted">Ausdrucken und ans Regal/Fach kleben. Mit der Handy-Kamera scannen öffnet den Ort.</p>
      <button class="btn" onclick="window.print()">🖨️ Drucken</button><div style="height:1rem"></div></div>
    <div class="labels">${list.map(o => `<div class="label">
      ${id ? '' : '<label class="noprint" style="margin:0;font-weight:400"><input type="checkbox" checked data-skip> drucken</label>'}
      ${qrSvg(ortUrl(o.id))}<div class="ln" style="font-size:1.15rem">${esc(o.name)}</div><div class="lt">Vorratskammer</div></div>`).join('') || '<p class="muted">Noch keine Orte.</p>'}</div>`;
  app.querySelectorAll('[data-skip]').forEach(cb => cb.onchange = () => cb.closest('.label').classList.toggle('skip', !cb.checked));
}

// ---------- Einkaufsliste ----------
function vEinkauf() {
  const low = vstate.items.filter(isLow);
  const line = i => `${i.name}: ${dec(Number(i.mindestbestand) - Number(i.menge))} ${i.einheit || ''} (da: ${dec(i.menge)}, min: ${dec(i.mindestbestand)})`.replace(/\s+\(/, ' (');
  app.innerHTML = `
    <h1>🛒 Einkaufsliste</h1>
    <p class="muted">Alles, was unter dem Mindestbestand liegt.</p>
    ${low.length ? `<button class="btn block" id="copy" style="margin-bottom:.8rem">📋 Liste kopieren</button>` : ''}
    <div id="list" class="list"></div>`;
  const list = document.getElementById('list');
  const render = () => { const l = vstate.items.filter(isLow); list.innerHTML = l.map(i => vItem(i).replace('<div class="sub">', `<div class="sub"><b>Fehlt: ${dec(Number(i.mindestbestand) - Number(i.menge))} ${esc(i.einheit || '')}</b> · `)).join('') || '<div class="card center">🎉 Alles da – nichts unter Mindestbestand.</div>'; };
  bindQty(list, render); render();
  const c = document.getElementById('copy');
  if (c) c.onclick = async () => {
    const txt = 'Einkaufsliste:\n' + vstate.items.filter(isLow).map(i => '• ' + line(i)).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Einkaufsliste kopiert ✔'); } catch { prompt('Kopieren:', txt); }
  };
}

// ---------- Übersicht & CSV ----------
function vStats() {
  const it = vstate.items.filter(i => Number(i.menge) > 0);
  const bald = it.filter(i => mhdState(i) === 'warn');
  const weg = it.filter(i => mhdState(i) === 'bad');
  const wert = vstate.items.reduce((s, i) => s + (Number(i.preis) || 0) * (Number(i.menge) || 0), 0);
  const soon = it.filter(i => mhdState(i)).sort((a, b) => (mhdDays(a) ?? 9999) - (mhdDays(b) ?? 9999));
  const low = vstate.items.filter(isLow);
  app.innerHTML = `
    <h1>📊 Übersicht Vorrat</h1>
    <div class="stats">
      <div class="stat"><b>${num(vstate.items.length)}</b>Artikel</div>
      <a class="stat" href="#v/liste?nur=mhd" style="text-decoration:none;color:inherit"><b style="color:#e65100">${num(bald.length)}</b>MHD in ≤ 14 Tagen</a>
      <a class="stat" href="#v/liste?nur=mhd" style="text-decoration:none;color:inherit"><b style="color:var(--red)">${num(weg.length)}</b>abgelaufen</a>
      <a class="stat" href="#v/liste?nur=low" style="text-decoration:none;color:inherit"><b>${num(low.length)}</b>unter Mindestbestand</a>
      <div class="stat"><b>${euro(wert)}</b>Gesamtwert</div>
      <div class="stat"><b>${num(vstate.orte.length)}</b>Orte</div>
    </div>
    <h2>Bald verbrauchen</h2>
    ${soon.length
      ? `<div id="list" class="list">${soon.map(vItem).join('')}</div>`
      : `<div class="card center muted">Keine Artikel mit MHD in den nächsten 14 Tagen oder abgelaufen.</div>`}
    <h2>Daten &amp; Angebote</h2>
    <div class="card">
      <p class="muted" style="margin-top:0;font-size:.9rem">Deine Daten als Excel-Datei herunterladen. Fotos bleiben in der App.</p>
      <button class="btn block" id="xlsx" style="background:#2e7d32">⬇️ Als Excel speichern</button>
      <div style="height:.5rem"></div>
      <a class="btn block secondary" href="#v/import">📥 Aus Excel oder Tabelle übernehmen</a>
      <div style="height:.5rem"></div>
      <button class="btn block secondary" id="csv">⬇️ Als Tabelle speichern</button>
      <div style="height:.5rem"></div>
      <a class="btn block secondary" href="#v/plz">📍 PLZ &amp; Märkte in der Nähe</a>
    </div>`;
  const l = document.getElementById('list'); if (l) bindQty(l, () => route());
  document.getElementById('csv').onclick = vExportCsv;
  document.getElementById('xlsx').onclick = () => vExportXlsx().catch(fail);
}

function excelSafeText(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  // Formel-Einschleusung verhindern (=, +, -, @ am Anfang)
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}
function localYmd(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function excelDateCell(iso) {
  const s = parseMhdRaw(iso);
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  // SheetJS: Date-Objekt → echtes Excel-Datum
  return new Date(y, m - 1, d);
}
async function vExportXlsx() {
  const btn = document.getElementById('xlsx');
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Excel wird erstellt …'; }
  try {
    if (typeof ensureXLSX !== 'function') throw new Error('Excel-Hilfe fehlt. Bitte Seite neu laden.');
    await ensureXLSX();
    const wb = XLSX.utils.book_new();

    // Blatt 1: Vorrat (ein Zeile pro Artikel)
    const vHead = ['Name', 'Angebotsname', 'Kategorie', 'Einheit', 'Gesamtmenge', 'Mindestbestand', 'Einzelpreis', 'Inhalt je Packung', 'Inhaltseinheit', 'MHD (frühestes)', 'Ort', 'Barcode', 'Notiz'];
    const vRows = vstate.items.map(it => {
      const o = ortById(it.ort_id);
      return [
        excelSafeText(it.name),
        excelSafeText(it.angebotsname),
        excelSafeText(it.kategorie),
        excelSafeText(it.einheit),
        it.menge == null ? '' : Number(it.menge),
        it.mindestbestand == null ? '' : Number(it.mindestbestand),
        it.preis == null ? '' : Number(it.preis),
        it.gebinde_inhalt == null ? '' : Number(it.gebinde_inhalt),
        excelSafeText(it.basis_einheit),
        excelDateCell(mhdDateOf(it) || it.mhd),
        excelSafeText(o?.name),
        excelSafeText(it.barcode),
        excelSafeText(it.notiz),
      ];
    });
    const wsV = XLSX.utils.aoa_to_sheet([vHead, ...vRows]);
    // Datumsformat Spalte MHD (Index 9)
    const rangeV = XLSX.utils.decode_range(wsV['!ref'] || 'A1');
    for (let R = 1; R <= rangeV.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: 9 });
      const cell = wsV[addr];
      if (cell && cell.v instanceof Date) { cell.t = 'd'; cell.z = 'yyyy-mm-dd'; }
    }
    XLSX.utils.book_append_sheet(wb, wsV, 'Vorrat');

    // Blatt 2: Mengen & MHD (eine Zeile pro Charge)
    const cHead = ['Artikel', 'Menge', 'Einheit', 'MHD', 'Ort', 'Notiz'];
    const cRows = [];
    for (const it of vstate.items) {
      const lots = vstate.chargen[it.id] || [];
      const unit = it.einheit || '';
      if (!lots.length) {
        cRows.push([
          excelSafeText(it.name),
          it.menge == null ? '' : Number(it.menge),
          excelSafeText(unit),
          excelDateCell(it.mhd),
          excelSafeText(ortById(it.ort_id)?.name),
          excelSafeText(it.notiz),
        ]);
        continue;
      }
      for (const lot of lots) {
        cRows.push([
          excelSafeText(it.name),
          lot.menge == null ? '' : Number(lot.menge),
          excelSafeText(unit),
          excelDateCell(lot.mhd),
          excelSafeText(ortById(lot.ort_id || it.ort_id)?.name),
          excelSafeText(lot.notiz),
        ]);
      }
    }
    const wsC = XLSX.utils.aoa_to_sheet([cHead, ...cRows]);
    const rangeC = XLSX.utils.decode_range(wsC['!ref'] || 'A1');
    for (let R = 1; R <= rangeC.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: 3 });
      const cell = wsC[addr];
      if (cell && cell.v instanceof Date) { cell.t = 'd'; cell.z = 'yyyy-mm-dd'; }
    }
    XLSX.utils.book_append_sheet(wb, wsC, 'Mengen & MHD');

    // Blatt 3: Orte
    const oHead = ['Name', 'Farbe', 'Notiz'];
    const oRows = vstate.orte.map(o => [excelSafeText(o.name), excelSafeText(o.farbe), excelSafeText(o.notiz)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([oHead, ...oRows]), 'Orte');

    const fname = 'Sortiva-Vorrat-' + localYmd() + '.xlsx';
    XLSX.writeFile(wb, fname, { compression: true });
    toast('Excel gespeichert: ' + fname);
  } catch (e) {
    console.error(e);
    toast('Excel-Datei konnte nicht erstellt werden. Prüfe die Verbindung und versuche es noch einmal.', 5000);
    throw e;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇️ Als Excel speichern'; }
  }
}

function vExportCsv() {
  const head = ['Name', 'Kategorie', 'Menge', 'Einheit', 'Mindestbestand', 'MHD', 'Chargen_MHDs', 'Preis', 'Wert gesamt', 'Ort', 'Barcode', 'Notiz', 'Status'];
  const cell = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const d = n => n == null ? '' : String(n).replace('.', ',');
  const rows = vstate.items.map(i => {
    const lots = (vstate.chargen[i.id] || []).map(c => `${d(c.menge)}${c.mhd ? '@' + new Date(c.mhd + 'T00:00:00').toLocaleDateString('de-DE') : ''}`).join(' | ');
    return [i.name, i.kategorie, d(i.menge), i.einheit, d(i.mindestbestand), i.mhd ? new Date(i.mhd + 'T00:00:00').toLocaleDateString('de-DE') : '', lots, d(i.preis),
    i.preis != null ? d((Number(i.preis) * Number(i.menge)).toFixed(2)) : '', ortById(i.ort_id)?.name, i.barcode, i.notiz,
    [mhdState(i) === 'bad' ? 'abgelaufen' : mhdState(i) === 'warn' ? 'MHD bald' : '', isLow(i) ? 'nachkaufen' : ''].filter(Boolean).join(', ')];
  });
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `vorratskammer-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

// =====================================================================
// ---------- Admin-Bereich (nur sichtbar, wenn is_admin()) ----------
// =====================================================================
async function removeUserFiles(uid) {
  const all = [];
  for (const dir of [uid, `${uid}/teile`, `${uid}/vorrat`, `${uid}/lego`, `${uid}/custom`]) {
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(BUCKET).list(dir, { limit: 1000, offset });
      if (error) throw error;
      const files = data.filter(f => f.id); // Ordner haben keine id
      all.push(...files.map(f => `${dir}/${f.name}`));
      if (data.length < 1000) break; offset += 1000;
    }
  }
  for (let i = 0; i < all.length; i += 100) { const { error } = await sb.storage.from(BUCKET).remove(all.slice(i, i + 100)); if (error) throw error; }
  return all.length;
}
async function resetUser(u) {
  const files = await removeUserFiles(u.id);
  const { data, error } = await sb.rpc('admin_reset_user', { target: u.id });
  if (error) throw error;
  return { ...data, bilder: files };
}

async function viewAdmin() {
  setMode('admin', '');
  if (!state.isAdmin) { app.innerHTML = '<div class="card">Kein Zugriff – nur für Admins.</div>'; return; }
  app.innerHTML = '<div class="center muted" style="padding:3rem">Benutzer werden geladen …</div>';
  const { data: users, error } = await sb.rpc('admin_list_users');
  if (error) { fail(error); app.innerHTML = '<div class="card">Benutzerliste konnte nicht geladen werden.</div>'; return; }
  app.innerHTML = `
    <h1>🛡️ Admin</h1>
    <p class="muted">${num(users.length)} Konten. Du kannst die Daten jedes Kontos ansehen und bearbeiten oder zurücksetzen.</p>
    <div class="list">${users.map(u => `<div class="card" style="margin:0">
      <div style="font-weight:700;overflow-wrap:anywhere">${esc(u.email || u.id)} ${u.is_admin ? '<span class="badge">Admin</span>' : ''}${u.id === state.user.id ? '<span class="badge green">du</span>' : ''}</div>
      <div class="sub muted" style="font-size:.85rem">Registriert ${new Date(u.created_at).toLocaleDateString('de-DE')}${u.last_sign_in_at ? ' · zuletzt angemeldet ' + new Date(u.last_sign_in_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''}</div>
      <p style="margin:.4rem 0"><span class="badge">🧸 ${num(u.teile)} Teile · ${num(u.kisten)} Kisten · ${num(u.sets)} Sets</span><span class="badge green">🥫 ${num(u.vorrat)} Artikel · ${num(u.vorrat_orte)} Orte</span>
        <span class="badge" style="background:#fff8e1;color:#f57f17">🧱 ${num(u.lego_teile||0)} LEGO · ${num(u.custom_bereiche||0)} eigene</span></p>
      <div class="row">
        <button class="btn small" data-act="pm" data-id="${u.id}">🧸 Playmobil</button>
        <button class="btn small" data-act="v" data-id="${u.id}" style="background:#2e7d32">🥫 Vorrat</button>
        <button class="btn small" data-act="lego" data-id="${u.id}" style="background:#f9a825;color:#111">🧱 LEGO</button>
        <button class="btn small danger" data-act="reset" data-id="${u.id}">♻️ Reset</button>
      </div></div>`).join('')}</div>
    <h2>Konten zusammenführen</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Verschiebt die Daten eines Kontos in ein anderes (ohne Zustimmung der Nutzer). Gleiche Kisten/Sets/Orte und gleiche Teile/Artikel werden zusammengelegt.</p>
      <div class="grid2"><div><label>Von (Quelle)</label><select id="mVon">${users.map(u => `<option value="${u.id}">${esc(u.email)}</option>`).join('')}</select></div>
      <div><label>Nach (Ziel)</label><select id="mNach">${users.map((u, i) => `<option value="${u.id}" ${i === 1 ? 'selected' : ''}>${esc(u.email)}</option>`).join('')}</select></div></div>
      <label>Bereich</label><select id="mBer"><option value="alle">Alles (Playmobil+Vorrat+LEGO)</option><option value="beide">Playmobil + Vorrat</option><option value="playmobil">Nur Playmobil</option><option value="vorrat">Nur Vorrat</option><option value="lego">Nur LEGO</option></select>
      <div style="height:.8rem"></div><button class="btn block" id="mGo">🔀 Vorschau &amp; zusammenführen</button>
    </div>
    <h2>Gefahrenzone</h2>
    <div class="card"><p style="margin-top:0">Alle Daten <b>aller</b> Konten löschen (Konten selbst bleiben bestehen).</p>
      <button class="btn danger block" id="resetAll">♻️ Alles zurücksetzen</button></div>`;
  app.querySelectorAll('button[data-act]').forEach(b => b.onclick = async () => {
    const u = users.find(x => x.id === b.dataset.id);
    if (b.dataset.act === 'reset') {
      const typed = prompt(`ACHTUNG: Alle Playmobil- und Vorrats-Daten inkl. Fotos von\n${u.email}\nwerden endgültig gelöscht.\n\nZum Bestätigen die E-Mail-Adresse eintippen:`);
      if (typed == null) return;
      if (typed.trim().toLowerCase() !== String(u.email).toLowerCase()) return toast('E-Mail stimmt nicht – nichts gelöscht.');
      try { b.disabled = true; const r = await resetUser(u); toast(`Zurückgesetzt: ${r.teile} Teile, ${r.vorrat} Artikel, ${r.bilder} Fotos gelöscht.`, 5000); if (u.id === owner()) resetView(); viewAdmin(); }
      catch (e) { fail(e); b.disabled = false; }
      return;
    }
    viewAs(u.id, u.email, 'admin');
    location.hash = b.dataset.act === 'v' ? '#v/liste' : b.dataset.act === 'lego' ? '#l/teile' : '#teile';
  });
  document.getElementById('mGo').onclick = async () => {
    const von = users.find(u => u.id === document.getElementById('mVon').value), nach = users.find(u => u.id === document.getElementById('mNach').value);
    const bereich = document.getElementById('mBer').value;
    if (von.id === nach.id) return toast('Quelle und Ziel müssen verschieden sein.');
    const { data: pv, error } = await sb.rpc('admin_merge_vorschau', { p_von: von.id, p_nach: nach.id, p_bereich: bereich });
    if (error) return fail(error);
    if (!await confirmDialog('Konten zusammenführen?', mergeSummary(pv, bereich, von.email, nach.email), '🔀 Jetzt zusammenführen')) return;
    try {
      const { data: res, error: e2 } = await sb.rpc('admin_zusammenfuehren', { p_von: von.id, p_nach: nach.id, p_bereich: bereich });
      if (e2) throw e2;
      await finishMerge(res); resetView(); toast(mergeDoneText(res), 6000); viewAdmin();
    } catch (e) { fail(e); }
  };
  document.getElementById('resetAll').onclick = async () => {
    const typed = prompt(`ACHTUNG: Die Daten ALLER ${users.length} Konten (inkl. deiner eigenen) werden endgültig gelöscht.\n\nZum Bestätigen „ALLES LÖSCHEN“ eintippen:`);
    if (typed == null) return;
    if (typed.trim() !== 'ALLES LÖSCHEN') return toast('Eingabe stimmt nicht – nichts gelöscht.');
    try { for (const u of users) await resetUser(u); resetView(); toast('Alle Daten zurückgesetzt.', 4000); viewAdmin(); } catch (e) { fail(e); }
  };
}

// =====================================================================
// ---------- Teilen & Zusammenführen ----------
// =====================================================================
const BEREICH_TXT = { playmobil: '🧸 Playmobil', vorrat: '🥫 Vorratskammer', lego: '🧱 LEGO', beide: '🧸+🥫 Playmobil+Vorrat', alle: '📦 alle Bereiche' };
const RECHT_TXT = { lesen: '👁️ nur ansehen', bearbeiten: '✏️ ansehen und ändern' };

function confirmDialog(title, html, ok = 'OK', danger = false) {
  const p = dialog(`<form><h2 style="margin-top:0">${title}</h2><div>${html}</div>
    <div class="row" style="margin-top:1rem"><button type="button" class="btn secondary grow" data-cancel>Abbrechen</button><button class="btn grow ${danger ? 'danger' : ''}" type="submit">${ok}</button></div></form>`);
  dialog.current._save = async () => true;
  return p;
}
function mergeSummary(p, bereich, vonTxt, nachTxt) {
  const li = [];
  if (covers(bereich, 'playmobil')) li.push(`<li>🧸 <b>${num(p.teile)}</b> Teile (${num(p.stueck)} Stück)${p.teile_gleich ? ` – davon ${num(p.teile_gleich)} gleiche Teile (Nr.+Farbe, gleiche Kiste): Anzahl wird addiert` : ''}</li>
    <li>📦 <b>${num(p.kisten)}</b> Kisten/Tüten${p.kisten_gleich ? ` – ${num(p.kisten_gleich)} mit gleicher Nummer werden zusammengelegt` : ''}</li>
    <li>🏰 <b>${num(p.sets)}</b> Sets${p.sets_gleich ? ` – ${num(p.sets_gleich)} mit gleicher Set-Nummer werden zusammengelegt` : ''}</li>
    <li>📷 ${num(p.bilder_teile)} Fotos</li>`);
  if (covers(bereich, 'vorrat')) li.push(`<li>🥫 <b>${num(p.vorrat)}</b> Artikel${p.vorrat_gleich ? ` – ${num(p.vorrat_gleich)} gleiche (Name+Einheit+Ort): Menge wird addiert` : ''}</li>
    <li>🗄️ <b>${num(p.orte)}</b> Orte${p.orte_gleich ? ` – ${num(p.orte_gleich)} mit gleichem Namen werden zusammengelegt` : ''}</li>
    <li>📷 ${num(p.bilder_vorrat)} Fotos</li>`);
  if (bereich === 'lego' || bereich === 'alle') li.push(`<li>🧱 LEGO-Daten werden mitverschoben (Kisten/Sets/Teile zusammengelegt analog Playmobil)</li>`);
  return `<p>Aus <b>${esc(vonTxt)}</b> werden nach <b>${esc(nachTxt)}</b> verschoben (${BEREICH_TXT[bereich] || esc(bereich)}):</p><ul>${li.join('')}</ul>
    <p class="muted">Danach ist dieser Bereich bei ${esc(vonTxt)} leer. Das lässt sich nicht rückgängig machen.</p>`;
}
const mergeDoneText = r => `Zusammengeführt: ${num((r.teile_neu || 0) + (r.teile_zusammengelegt || 0))} Teile, ${num((r.vorrat_neu || 0) + (r.vorrat_zusammengelegt || 0))} Artikel, ${num((r.dateien || []).length)} Fotos.`;

// Fotos nach dem Zusammenführen in den Ordner des Ziel-Kontos verschieben, dann abschließen.
async function finishMerge(res) {
  if (finishMerge.running?.has(res.id)) return; (finishMerge.running ||= new Set()).add(res.id);
  try {
    for (const f of res.dateien || []) {
      const { error } = await sb.storage.from(BUCKET).move(f.von, f.nach);
      if (error && !/not.?found|exist/i.test(error.message)) console.warn('Foto verschieben:', f.von, error.message);
    }
    if ((res.loeschen || []).length) await sb.storage.from(BUCKET).remove(res.loeschen);
    const { error } = await sb.rpc('zusammenfuehrung_abschliessen', { p_id: res.id });
    if (error) throw error;
  } finally { finishMerge.running.delete(res.id); }
}

// Link zu einer Kiste/einem Ort aus einer geteilten Sammlung (z. B. per NFC/QR) → passende Sammlung öffnen
async function openForeign(table, id) {
  const { data } = await sb.from(table).select('user_id').eq('id', Number(id)).maybeSingle();
  if (!data || data.user_id === owner()) return;
  if (data.user_id === state.user.id) viewAs(null);
  else if (shareOf(data.user_id)) viewAsShare(shareOf(data.user_id));
  else if (state.isAdmin) viewAs(data.user_id, '(anderes Konto)', 'admin');
  else return;
  route();
}

async function viewTeilen(section) {
  app.innerHTML = '<div class="center muted" style="padding:3rem">Lädt …</div>';
  await loadSocial();
  const modeFor = section === 'vorrat' ? 'v' : section === 'lego' ? 'lego' : section.startsWith('c:') ? 'c' + section.slice(2) : 'pm';
  const tabFor = section === 'vorrat' ? 'v/teilen' : section === 'lego' ? 'l/teilen' : section.startsWith('c:') ? 'c/' + section.slice(2) + '/teilen' : 'teilen';
  setMode(modeFor, tabFor);
  const me = state.user.id;
  const sTxt = section === 'vorrat' ? 'Vorratskammer' : section === 'lego' ? 'LEGO-Sammlung' : section.startsWith('c:') ? ((cstate.bereiche || []).find(b => b.id === section.slice(2))?.name || 'Eigener Bereich') : 'Playmobil-Sammlung';
  const bereichOpts = section.startsWith('c:')
    ? `<option value="${section}">${esc(sTxt)}</option><option value="alle">${BEREICH_TXT.alle}</option>`
    : `<option value="${section}">${BEREICH_TXT[section] || esc(section)}</option>
       <option value="beide">${BEREICH_TXT.beide}</option>
       <option value="lego">${BEREICH_TXT.lego}</option>
       <option value="alle">${BEREICH_TXT.alle}</option>`;
  const invites = state.shares.filter(f => f.member_id === me && f.status === 'eingeladen');
  const withMe = state.shares.filter(f => f.member_id === me && f.status === 'angenommen' && covers(f.bereich, section));
  const mine = state.shares.filter(f => f.owner_id === me && covers(f.bereich, section));
  const mIn = state.merges.filter(z => z.status === 'offen' && z.antragsteller_id !== me && [z.von_id, z.nach_id].includes(me));
  const mOut = state.merges.filter(z => z.status === 'offen' && z.antragsteller_id === me);
  const mOld = state.merges.filter(z => !['offen'].includes(z.status)).slice(0, 5);
  const mText = z => z.von_id === me ? `Deine Daten → <b>${esc(z.nach_email)}</b>` : z.nach_id === me ? `Daten von <b>${esc(z.von_email)}</b> → zu dir` : `${esc(z.von_email)} → ${esc(z.nach_email)}`;
  const banner = state.viewUid ? `<div class="card" style="background:#fff8e1">Du siehst gerade eine andere Sammlung. Teilen &amp; Zusammenführen betrifft immer <b>deine eigenen</b> Daten.</div>` : '';
  app.innerHTML = `
    <h1>👥 Teilen &amp; Zusammenführen</h1>${banner}
    ${invites.length ? `<h2>📨 Einladungen an dich</h2><div class="list">${invites.map(f => `<div class="card" style="margin:0">
      <b>${esc(f.owner_email)}</b> möchte ${BEREICH_TXT[f.bereich] || esc(f.bereich)} mit dir teilen (${RECHT_TXT[f.recht]}).
      <div class="row" style="margin-top:.5rem"><button class="btn small" data-a="accept" data-id="${f.id}">✅ Annehmen</button><button class="btn small secondary" data-a="del" data-id="${f.id}">Ablehnen</button></div></div>`).join('')}</div>` : ''}
    ${mIn.length ? `<h2>🔀 Anfragen zum Zusammenführen</h2><div class="list">${mIn.map(z => `<div class="card" style="margin:0">
      ${mText(z)} <span class="badge">${BEREICH_TXT[z.bereich]}</span>
      <div class="row" style="margin-top:.5rem"><button class="btn small" data-a="mprev" data-id="${z.id}">🔎 Vorschau &amp; annehmen</button><button class="btn small secondary" data-a="mno" data-id="${z.id}">Ablehnen</button></div></div>`).join('')}</div>` : ''}

    <h2>Mit mir geteilt</h2>
    ${withMe.length ? `<div class="list">${withMe.map(f => `<div class="card" style="margin:0">
      <b>${esc(f.owner_email)}</b> <span class="badge ${f.recht === 'bearbeiten' ? 'green' : 'orange'}">${RECHT_TXT[f.recht]}</span> <span class="badge">${BEREICH_TXT[f.bereich]}</span>
      <div class="row" style="margin-top:.5rem"><button class="btn small" data-a="view" data-id="${f.id}">👀 Ansehen</button><button class="btn small secondary" data-a="leave" data-id="${f.id}">Verlassen</button></div></div>`).join('')}</div>`
      : `<p class="muted">Niemand teilt eine ${sTxt} mit dir.</p>`}

    <h2>Meine ${sTxt} teilen</h2>
    <form class="card" id="invForm">
      <label>E-Mail der Person (braucht ein eigenes Konto)</label><input name="email" type="email" required placeholder="name@beispiel.de">
      <div class="grid2"><div><label>Was darf die Person?</label><select name="recht"><option value="lesen">👁️ nur ansehen</option><option value="bearbeiten">✏️ ansehen und ändern</option></select></div>
      <div><label>Bereich</label><select name="bereich">${bereichOpts}</select></div></div>
      <div style="height:.8rem"></div><button class="btn block">📨 Einladen</button>
    </form>
    ${mine.length ? `<div class="list">${mine.map(f => `<div class="card" style="margin:0">
      <b style="overflow-wrap:anywhere">${esc(f.member_email)}</b> ${f.status === 'eingeladen' ? '<span class="badge orange">eingeladen</span>' : '<span class="badge green">hat Zugriff</span>'} <span class="badge">${BEREICH_TXT[f.bereich]}</span>
      <div class="row" style="margin-top:.5rem"><select data-a="recht" data-id="${f.id}" style="flex:1"><option value="lesen" ${f.recht === 'lesen' ? 'selected' : ''}>👁️ nur ansehen</option><option value="bearbeiten" ${f.recht === 'bearbeiten' ? 'selected' : ''}>✏️ ansehen und ändern</option></select>
      <button class="btn small danger" data-a="revoke" data-id="${f.id}">Zugriff entziehen</button></div></div>`).join('')}</div>` : `<p class="muted">Du teilst deine ${sTxt} noch mit niemandem.</p>`}

    <h2>🔀 Sammlungen zusammenführen</h2>
    <form class="card" id="mergeForm">
      <p class="muted" style="margin-top:0">Legt zwei Konten zu einem zusammen. Das andere Konto muss zustimmen. Gleiche Kisten/Sets/Orte werden zusammengelegt, gleiche Teile/Artikel addiert.</p>
      <label>E-Mail des anderen Kontos</label><input name="email" type="email" required placeholder="name@beispiel.de">
      <label>Richtung</label><select name="richtung"><option value="zu_dir">Meine Daten → in das andere Konto</option><option value="zu_mir">Daten des anderen Kontos → zu mir</option></select>
      <label>Bereich</label><select name="bereich">${section.startsWith('c:') ? bereichOpts : `<option value="${section}">${BEREICH_TXT[section]}</option><option value="beide">${BEREICH_TXT.beide}</option><option value="lego">${BEREICH_TXT.lego}</option><option value="alle">${BEREICH_TXT.alle}</option>`}</select>
      <div style="height:.8rem"></div><button class="btn block secondary">🔀 Anfrage senden</button>
    </form>
    ${mOut.length ? `<h3>Gesendete Anfragen</h3><div class="list">${mOut.map(z => `<div class="card" style="margin:0">${mText(z)} <span class="badge">${BEREICH_TXT[z.bereich]}</span> <span class="badge orange">wartet</span>
      <div class="row" style="margin-top:.5rem"><button class="btn small secondary" data-a="mdel" data-id="${z.id}">Zurückziehen</button></div></div>`).join('')}</div>` : ''}
    ${mOld.length ? `<h3>Verlauf</h3><div class="list">${mOld.map(z => `<div class="card" style="margin:0;font-size:.9rem">${mText(z)} <span class="badge ${z.status === 'abgelehnt' ? 'red' : 'green'}">${{ abgelehnt: 'abgelehnt', angenommen: 'läuft …', erledigt: 'erledigt' }[z.status]}</span>
      ${z.status !== 'angenommen' ? `<button class="btn-link" data-a="mdel" data-id="${z.id}">entfernen</button>` : ''}</div>`).join('')}</div>` : ''}`;

  const byId = (list, id) => list.find(x => String(x.id) === String(id));
  const again = () => { setTimeout(() => viewTeilen(section), 0); };
  app.querySelectorAll('[data-a]').forEach(el => {
    const ev = el.tagName === 'SELECT' ? 'onchange' : 'onclick';
    el[ev] = async () => {
      const id = Number(el.dataset.id), a = el.dataset.a;
      try {
        if (a === 'accept') { const { error } = await sb.rpc('freigabe_annehmen', { p_id: id }); if (error) throw error; toast('Einladung angenommen. Wähle die Sammlung oben aus.', 4000); }
        else if (a === 'del' || a === 'leave' || a === 'revoke') {
          if (a !== 'del' && !await confirmDialog(a === 'leave' ? 'Geteilte Sammlung verlassen?' : 'Zugriff entziehen?', a === 'leave' ? 'Du siehst diese Sammlung danach nicht mehr.' : 'Die Person sieht deine Daten danach nicht mehr.', 'Ja', true)) return;
          const { error } = await sb.from('freigaben').delete().eq('id', id); if (error) throw error;
          const f = byId(state.shares, id); if (a === 'leave' && f && state.viewUid === f.owner_id) viewAs(null);
          toast(a === 'revoke' ? 'Zugriff entzogen.' : a === 'leave' ? 'Verlassen.' : 'Abgelehnt.');
        }
        else if (a === 'recht') { const f = byId(state.shares, id); const { error } = await sb.rpc('freigabe_aendern', { p_id: id, p_bereich: f.bereich, p_recht: el.value }); if (error) throw error; toast('Berechtigung geändert.'); }
        else if (a === 'view') { const sh = byId(state.shares, id); viewAsShare(sh); location.hash = sh.bereich === 'vorrat' || (sh.bereich === 'beide' && section === 'vorrat') ? '#v/liste' : sh.bereich === 'lego' ? '#l/teile' : sh.bereich?.startsWith('c:') ? '#c/' + sh.bereich.slice(2) : '#teile'; return; }
        else if (a === 'mno') { const { error } = await sb.rpc('zusammenfuehrung_ablehnen', { p_id: id }); if (error) throw error; toast('Anfrage abgelehnt.'); }
        else if (a === 'mdel') { const { error } = await sb.from('zusammenfuehrungen').delete().eq('id', id); if (error) throw error; }
        else if (a === 'mprev') {
          const z = byId(state.merges, id);
          const { data: pv, error } = await sb.rpc('zusammenfuehrung_vorschau', { p_id: id }); if (error) throw error;
          const lbl = u => u === me ? 'deinem Konto' : z.von_id === u ? z.von_email : z.nach_email;
          if (!await confirmDialog('Zusammenführen?', mergeSummary(pv, z.bereich, lbl(z.von_id), lbl(z.nach_id)), '🔀 Annehmen & zusammenführen')) return;
          el.disabled = true; toast('Wird zusammengeführt …', 8000);
          const { data: res, error: e2 } = await sb.rpc('zusammenfuehrung_annehmen', { p_id: id }); if (e2) throw e2;
          await finishMerge(res); resetView(); toast(mergeDoneText(res), 6000);
        }
        again();
      } catch (e) { fail(e); el.disabled = false; }
    };
  });
  document.getElementById('invForm').onsubmit = async e => {
    e.preventDefault(); const v = formVals(e.target, ['email', 'recht', 'bereich']);
    const { data, error } = await sb.rpc('freigabe_einladen', { p_email: v.email, p_bereich: v.bereich, p_recht: v.recht });
    if (error) return fail(error); toast(data, 5000); again();
  };
  document.getElementById('mergeForm').onsubmit = async e => {
    e.preventDefault(); const v = formVals(e.target, ['email', 'richtung', 'bereich']);
    const txt = v.richtung === 'zu_dir'
      ? `Alle deine Daten (${BEREICH_TXT[v.bereich]}) werden in das Konto <b>${esc(v.email)}</b> verschoben. Bei dir ist der Bereich danach leer.`
      : `Alle Daten (${BEREICH_TXT[v.bereich]}) von <b>${esc(v.email)}</b> werden in dein Konto verschoben.`;
    if (!await confirmDialog('Anfrage zum Zusammenführen senden?', `<p>${txt}</p><p>Gleiche Kisten-/Set-Nummern und Orte werden zusammengelegt, gleiche Teile (Nr.+Farbe in gleicher Kiste) bzw. Artikel (Name+Einheit+Ort) addiert. Erst wenn das andere Konto zustimmt (mit genauer Vorschau), wird zusammengeführt.</p>`, 'Anfrage senden')) return;
    const { data, error } = await sb.rpc('zusammenfuehrung_anfragen', { p_email: v.email, p_richtung: v.richtung, p_bereich: v.bereich });
    if (error) return fail(error); toast(data, 5000); again();
  };
}

// ---------- Start ----------
if (!window.__HARNESS) (async () => {
  const boot = document.getElementById('bootMsg');
  try {
    await initAuth();
  } catch (e) {
    console.error(e);
    document.getElementById('topbar')?.classList.remove('hidden');
    app.innerHTML = `<div class="card center" style="margin:1.5rem auto;max-width:28rem">
      <p style="margin-top:0">${esc(friendlyError(e))}</p>
      <button class="btn block" type="button" id="bootRetry">Erneut versuchen</button>
    </div>`;
    document.getElementById('bootRetry').onclick = () => location.reload();
    return;
  }
  if (boot) boot.textContent = '';
  route();
})();

// ---------- Doppelte prüfen (Reserve/Sets) ----------
/** Gruppen möglicher Doppelter: gleiche Nummer (ohne Leer-/Sonderzeichen) oder gleiche führende Zahl – über beide Reiter */
function setDupGroups(list, lego) {
  const parent = list.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const byCore = new Map(), byLead = new Map();
  list.forEach((s, i) => {
    const c = nrCore(s.set_nummer, lego), l = nrLead(s.set_nummer);
    if (c) { if (byCore.has(c)) unite(byCore.get(c), i); else byCore.set(c, i); }
    if (l) { if (byLead.has(l)) unite(byLead.get(l), i); else byLead.set(l, i); }
  });
  const g = new Map();
  list.forEach((s, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(s); });
  return [...g.values()].filter(x => x.length > 1).map(items => {
    items.sort((a, b) => a.id - b.id);
    const lead = nrLead(items[0].set_nummer) || nrCore(items[0].set_nummer, lego);
    return { key: lead + '|' + items.map(x => x.id).join(','), lead, items };
  }).sort((a, b) => sortNat(a.lead, b.lead));
}
/** Vorschlag, welcher Eintrag bleibt: die meisten Teile, dann Fotos, dann längster Name */
function dupBest(cfg, items) {
  const score = s => [cfg.countTeile(s), imgList(s).length, (s.name || '').length + String(s.set_nummer).length];
  return [...items].sort((a, b) => { const x = score(a), y = score(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || a.id - b.id; })[0];
}
/** Vorschlag für Nummer + Name: „3112 – Gefängnisfestung“ → Nummer 3112, Name Gefängnisfestung */
function dupSuggest(keep, items) {
  const split = s => { const m = String(s.set_nummer || '').match(/^\s*([0-9][0-9A-Za-z]*)\s*[-–—:]\s*(\S.*)$/); return m ? { nr: m[1], rest: m[2].trim() } : null; };
  const sp = split(keep);
  const nummer = sp ? sp.nr : String(keep.set_nummer).trim();
  const name = keep.name || items.map(s => s.name).find(Boolean) || (sp && sp.rest) || items.map(split).filter(Boolean).map(x => x.rest).find(Boolean) || '';
  return { nummer, name };
}
async function viewDupes(lego) {
  const cfg = SETCFG[lego ? 'lego' : 'pm'], bereich = lego ? 'lego' : 'playmobil', base = lego ? '#l/' : '#';
  const ro = document.body.classList.contains('readonly');
  app.innerHTML = `<a class="back" href="${base}uebersicht">‹ Übersicht</a><h1>🔁 Doppelte prüfen</h1><div class="center muted" style="padding:2rem">Wird geprüft …</div>`;
  let dismissed = new Set();
  try { const r = await sb.from('dup_ignoriert').select('gruppe').eq('user_id', owner()).eq('bereich', bereich); if (r.error) throw r.error; dismissed = new Set(r.data.map(x => x.gruppe)); } catch (e) { console.warn(e); }
  const skipped = viewDupes.skipped = viewDupes.skipped || new Set();
  let shown = 20;
  const render = () => {
    const groups = setDupGroups(cfg.list(), lego).filter(g => !dismissed.has(g.key));
    const open = groups.filter(g => !skipped.has(g.key));
    app.innerHTML = `<a class="back" href="${base}uebersicht">‹ Übersicht</a><h1>🔁 Doppelte prüfen</h1>
      <p class="muted" style="margin-top:0">Einträge in ${esc(artName('reserve', lego))} und ${esc(artName('set', lego))} mit gleicher oder ähnlicher Nummer (z.B. „3112“ und „3112 – Gefängnisfestung“).</p>
      <div class="card" id="dupSum"><b>${num(groups.length)}</b> ${groups.length === 1 ? 'Gruppe' : 'Gruppen'} mit möglichen Doppelten${skipped.size && open.length !== groups.length ? ` · ${num(groups.length - open.length)} übersprungen` : ''}</div>
      ${ro ? '<p class="muted">Nur ansehen – Zusammenführen ist hier nicht möglich.</p>' : ''}
      <div id="dupList">${open.slice(0, shown).map((g, gi) => groupHtml(g, gi)).join('') || '<div class="card center muted">Keine Doppelten gefunden. 🎉</div>'}</div>
      ${open.length > shown ? `<button class="btn block secondary" id="dupMore">Weitere ${num(Math.min(20, open.length - shown))} von ${num(open.length - shown)} zeigen</button>` : ''}`;
    const more = document.getElementById('dupMore'); if (more) more.onclick = () => { shown += 20; render(); };
    open.slice(0, shown).forEach((g, gi) => bindGroup(g, gi));
  };
  const groupHtml = (g, gi) => {
    const keep = dupBest(cfg, g.items), sug = dupSuggest(keep, g.items);
    return `<div class="card dupgroup" data-g="${gi}" data-key="${esc(g.key)}">
      <div class="muted" style="font-size:.85rem;margin-bottom:.3rem">${num(g.items.length)} Einträge · Nummer ${esc(g.lead)}</div>
      <div class="list">${g.items.map(s => { const a = setArt(s);
        return `<div class="item" data-sid="${s.id}">${thumb(s, artIcon(a))}<div class="info"><div class="title">${esc(s.set_nummer)} ${esc(s.name || '')}</div>
          <div class="sub">${artIcon(a)} ${esc(artName(a, lego))} · ${num(cfg.countTeile(s))} Teile · ${num(imgList(s).length)} Fotos</div>
          ${ro ? '' : `<div class="sub"><label style="display:inline"><input type="radio" name="keep${gi}" value="${s.id}" ${s.id === keep.id ? 'checked' : ''}> bleibt</label>
          &nbsp; <label style="display:inline"><input type="checkbox" data-inc="${s.id}" checked> zusammenführen</label></div>`}</div></div>`; }).join('')}</div>
      ${ro ? '' : `<div class="grid2" style="margin-top:.4rem"><div><label>Nummer danach</label><input data-f="nummer" value="${esc(sug.nummer)}"></div><div><label>Name danach</label><input data-f="name" value="${esc(sug.name)}"></div></div>
      <div class="row" style="flex-wrap:wrap;margin-top:.5rem"><button class="btn grow" type="button" data-act="merge">Zusammenführen</button>
        <button class="btn secondary grow" type="button" data-act="ignore">Nicht doppelt</button><button class="btn secondary grow" type="button" data-act="skip">Überspringen</button></div>`}</div>`;
  };
  const bindGroup = (g, gi) => {
    const el = document.querySelector(`.dupgroup[data-g="${gi}"]`); if (!el || ro) return;
    const nr = el.querySelector('[data-f=nummer]'), na = el.querySelector('[data-f=name]');
    el.querySelectorAll(`input[name="keep${gi}"]`).forEach(r => r.onchange = () => {
      const keep = g.items.find(s => s.id === Number(r.value)), sug = dupSuggest(keep, g.items); nr.value = sug.nummer; na.value = sug.name;
      el.querySelector(`[data-inc="${keep.id}"]`).checked = true; });
    el.querySelector('[data-act=skip]').onclick = () => { skipped.add(g.key); render(); };
    el.querySelector('[data-act=ignore]').onclick = async () => {
      const r = await sb.from('dup_ignoriert').insert({ user_id: owner(), bereich, gruppe: g.key });
      if (r.error && String(r.error.code) !== '23505') return fail(r.error);
      dismissed.add(g.key); toast('Gemerkt – diese Gruppe wird nicht mehr angezeigt.'); render(); };
    el.querySelector('[data-act=merge]').onclick = async () => {
      const keepId = Number(el.querySelector(`input[name="keep${gi}"]:checked`).value), keep = g.items.find(s => s.id === keepId);
      const merge = g.items.filter(s => s.id !== keepId && el.querySelector(`[data-inc="${s.id}"]`).checked);
      if (!merge.length) return toast('Bitte mindestens einen weiteren Eintrag zum Zusammenführen auswählen.');
      const nummer = nr.value.trim(), name = na.value.trim();
      if (!nummer) return toast('Bitte eine Nummer angeben.');
      const links = new Set(); for (const t of cfg.st().teile) for (const x of t[cfg.rel] || []) if (merge.some(m => m.id === x.set_id)) links.add(t.id);
      const fotos = merge.reduce((n, s) => n + imgList(s).length, 0);
      const msg = `Zusammenführen?\n\nBleibt erhalten: „${setLabel(keep)}“ (${artName(setArt(keep), lego)})\n→ danach: Nummer „${nummer}“, Name „${name || '–'}“\n\nWird übernommen und danach gelöscht:\n${merge.map(s => '• ' + setLabel(s) + ' (' + artName(setArt(s), lego) + ')').join('\n')}\n\nÜbernommen werden: ${links.size} Teile-Verknüpfungen, ${fotos} Fotos, Notizen (angehängt); leere Felder werden ergänzt.\nKein Teil wird gelöscht. Das Löschen der zusammengeführten Einträge kann nicht rückgängig gemacht werden.`;
      if (!confirm(msg)) return;
      const btn = el.querySelector('[data-act=merge]'); btn.disabled = true; btn.textContent = 'Wird zusammengeführt …';
      const r = await sb.rpc('sets_zusammenfuehren', { p_lego: lego, p_keep: keepId, p_merge: merge.map(s => s.id), p_nummer: nummer, p_name: name || null });
      if (r.error) { btn.disabled = false; btn.textContent = 'Zusammenführen'; return fail(r.error); }
      const fresh = await sb.from(cfg.table).select('*').eq('id', keepId).single();
      const gone = new Set(merge.map(s => s.id));
      cfg.put(cfg.list().filter(s => !gone.has(s.id)).map(s => s.id === keepId && fresh.data ? fresh.data : s).sort((a, b) => sortNat(a.set_nummer, b.set_nummer)));
      for (const t of cfg.st().teile) { const rel = t[cfg.rel]; if (!rel || !rel.some(x => gone.has(x.set_id))) continue;
        const ids = [...new Set(rel.map(x => gone.has(x.set_id) ? keepId : x.set_id))]; t[cfg.rel] = ids.map(set_id => ({ set_id })); }
      if (fresh.data) loadImageUrls([fresh.data]).catch(() => {});
      toast(`Zusammengeführt ✔ (${r.data?.geloescht ?? merge.length} Einträge übernommen)`); render(); };
  };
  render();
}
