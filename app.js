// Playmobil-Sammlung – einfache Familien-App (Supabase + Vanilla JS)
'use strict';

const SUPABASE_URL = 'https://nmuwmlmrmktjhquanejk.supabase.co';
// Öffentlicher Publishable Key (darf im Browser stehen; Schutz läuft über RLS)
const SUPABASE_KEY = 'sb_publishable_gLdgwbvvbcmTdgdfXI5c1A_7ZNlW1vt';
const BUCKET = 'bilder';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = { user: null, isAdmin: false, viewUid: null, viewEmail: null, viewKind: null, viewRecht: null, viewBereich: null, shares: [], merges: [], kisten: [], sets: [], teile: [], loaded: false, imgCache: {},
  filter: { q: '', farbe: '', kiste: '', set: '' } };
const app = document.getElementById('app');

// ---------- Hilfsfunktionen ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = n => (Number(n) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = n => (Number(n) || 0).toLocaleString('de-DE');
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const baseUrl = () => location.origin + location.pathname;
const kisteUrl = id => baseUrl() + '#kiste/' + id;
function toast(msg, ms = 2500) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); }
function fail(err) {
  console.error(err);
  const msg = err?.code === '42501' ? 'Keine Berechtigung (evtl. nur Leserecht).' : err?.code === '23505' ? 'Diese Nummer gibt es bei dir schon – bitte eine andere wählen.' : err?.code === '23503' ? 'Verknüpfung nicht erlaubt (gehört zu einem anderen Konto).' : (err?.message || err);
  toast('Fehler: ' + msg, 5000);
}
// Wessen Daten werden angezeigt? Normal: eigene. Admin kann andere Konten ansehen.
const owner = () => state.viewUid || state.user.id;
const kisteById = id => state.kisten.find(k => k.id === Number(id));
const setById = id => state.sets.find(s => s.id === Number(id));
const kisteLabel = k => k ? `${k.art} ${k.nummer}${k.name ? ' – ' + k.name : ''}` : '';
const setLabel = s => s ? `${s.set_nummer}${s.name ? ' ' + s.name : ''}` : '';
const teilSets = t => (t.teil_sets || []).map(x => setById(x.set_id)).filter(Boolean);
const teilTitle = t => t.beschreibung || (t.teile_nr ? 'Teil ' + t.teile_nr : 'Ohne Beschreibung');
const sortNat = (a, b) => String(a).localeCompare(String(b), 'de', { numeric: true });

const FARBEN = { rot: '#d32f2f', blau: '#1976d2', grün: '#388e3c', gruen: '#388e3c', gelb: '#fbc02d', schwarz: '#212121', weiß: '#fff', weiss: '#fff', grau: '#9e9e9e', braun: '#795548', orange: '#f57c00', rosa: '#f48fb1', pink: '#e91e63', lila: '#8e24aa', violett: '#8e24aa', silber: '#c0c0c0', gold: '#d4af37', beige: '#e8d8b0', türkis: '#26c6da', hellblau: '#64b5f6', dunkelblau: '#0d47a1', hellgrün: '#81c784', dunkelgrün: '#1b5e20', transparent: 'transparent' };
const dot = f => { const c = FARBEN[norm(f).trim()]; return c ? `<span class="colordot" style="background:${c}"></span>` : ''; };

// ---------- Daten ----------
async function loadAll() {
  const [k, s, t] = await Promise.all([
    sb.from('kisten').select('*').eq('user_id', owner()),
    sb.from('sets').select('*').eq('user_id', owner()),
    sb.from('teile').select('*, teil_sets(set_id)').eq('user_id', owner()).order('created_at', { ascending: false }),
  ]);
  for (const r of [k, s, t]) if (r.error) throw r.error;
  state.kisten = k.data.sort((a, b) => sortNat(a.nummer, b.nummer));
  state.sets = s.data.sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
  state.teile = t.data;
  state.loaded = true;
  await loadImageUrls(state.teile);
}

async function loadImageUrls(teile) {
  const paths = [...new Set(teile.map(t => t.bild_url).filter(p => p && !state.imgCache[p]))];
  if (!paths.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 12);
  if (error) { console.warn(error); return; }
  data.forEach(d => { if (d.signedUrl) state.imgCache[d.path] = d.signedUrl; });
}
const imgUrl = t => t.bild_url ? state.imgCache[t.bild_url] : null;
const thumb = t => { const u = imgUrl(t); return u ? `<img class="thumb" src="${esc(u)}" alt="" loading="lazy">` : `<div class="thumb">🧩</div>`; };

// ---------- Auth ----------
async function initAuth() {
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user || null;
  await checkAdmin();
  sb.auth.onAuthStateChange((_e, session) => {
    const was = !!state.user; state.user = session?.user || null;
    if (was !== !!state.user) { resetView(); state.isAdmin = false; setTimeout(async () => { await checkAdmin(); route(); }, 0); }
  });
}
document.getElementById('logoutBtn').onclick = async () => { sessionStorage.removeItem('viewAs'); await sb.auth.signOut(); };
async function checkAdmin() {
  state.isAdmin = false;
  if (!state.user) return;
  const { data, error } = await sb.rpc('is_admin');
  state.isAdmin = !error && data === true;
  await loadSocial();
  const va = JSON.parse(sessionStorage.getItem('viewAs') || 'null');
  if (va && va.id !== state.user.id) {
    if (va.kind === 'admin' && state.isAdmin) Object.assign(state, { viewUid: va.id, viewEmail: va.email, viewKind: 'admin', viewRecht: 'bearbeiten', viewBereich: 'beide' });
    else { const sh = shareOf(va.id); if (sh) viewAsShare(sh); }
  }
}
function resetView() { state.loaded = false; vstate.loaded = false; state.kisten = []; state.sets = []; state.teile = []; vstate.items = []; vstate.orte = []; }
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
const covers = (bereich, section) => bereich === 'beide' || bereich === section;
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
  const section = mode === 'v' ? 'vorrat' : 'playmobil';
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
    ${state.viewKind === 'share' ? `<span class="badge ${ro ? 'orange' : 'green'}">${ro ? '👁️ nur lesen' : '✏️ bearbeiten'}</span>` : ''}`;
  document.getElementById('sammlung').onchange = e => {
    const f = shareOf(e.target.value);
    f ? viewAsShare(f) : viewAs(null);
    location.hash = mode === 'v' ? '#v/liste' : '#teile';
    route();
  };
}

function renderLogin() {
  document.getElementById('topbar').classList.add('hidden');
  document.getElementById('tabbar').classList.add('hidden');
  document.getElementById('modebar').classList.add('hidden');
  document.getElementById('adminBanner').classList.add('hidden');
  app.innerHTML = `
  <div class="login card">
    <div class="logo">🧸</div>
    <h1 class="center">Playmobil-Sammlung</h1>
    <p class="center muted">Bitte melde dich an, um die Familien-Sammlung zu sehen.</p>
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
    if (error) toast(error.message.includes('Invalid') ? 'E-Mail oder Passwort falsch.' : error.message.includes('confirmed') ? 'Bitte zuerst die E-Mail bestätigen (Link im Postfach).' : 'Fehler: ' + error.message, 5000);
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
  pm: [['teile', '🔍', 'Teile'], ['kisten', '📦', 'Kisten'], ['sets', '🏰', 'Sets'], ['uebersicht', '📊', 'Übersicht'], ['teilen', '👥', 'Teilen']],
  v: [['v/liste', '🔍', 'Vorrat'], ['v/orte', '🗄️', 'Orte'], ['v/einkauf', '🛒', 'Einkauf'], ['v/uebersicht', '📊', 'Übersicht'], ['v/teilen', '👥', 'Teilen']],
};
function setMode(mode, tab) {
  document.body.classList.toggle('mode-v', mode === 'v');
  localStorage.setItem('modus', mode);
  document.getElementById('brand').textContent = mode === 'v' ? '🥫 Vorratskammer' : '🧸 Playmobil-Sammlung';
  document.getElementById('brand').href = mode === 'v' ? '#v/liste' : '#teile';
  document.querySelectorAll('#modebar a').forEach(a => a.classList.toggle('active', a.dataset.mode === mode));
  const nav = document.getElementById('tabbar');
  const pend = pendingCount();
  nav.innerHTML = (TABS[mode] || []).map(([h, i, l]) => `<a href="#${h}" class="${h === tab ? 'active' : ''}"><span>${i}${h.endsWith('teilen') && pend ? `<b class="tabbadge">${pend}</b>` : ''}</span>${l}</a>`).join('');
  renderChrome(mode);
}
async function route() {
  if (!state.user) return renderLogin();
  ['topbar', 'tabbar', 'modebar'].forEach(id => document.getElementById(id).classList.remove('hidden'));
  if (!location.hash || location.hash === '#') { location.replace('#' + (localStorage.getItem('modus') === 'v' ? 'v/liste' : 'teile')); return; }
  const parts = location.hash.slice(1).split('/');
  window.scrollTo(0, 0);
  // Geteilte Sammlung deckt diesen Bereich nicht ab (oder Freigabe entzogen) → zurück zu „Meine“
  if (state.viewKind === 'share') {
    const f = shareOf(state.viewUid), section = parts[0] === 'v' ? 'vorrat' : 'playmobil';
    if (!f || (parts[0] !== 'admin' && !covers(f.bereich, section))) viewAs(null);
    else if (f.recht !== state.viewRecht || f.bereich !== state.viewBereich) Object.assign(state, { viewRecht: f.recht, viewBereich: f.bereich });
  }
  if (parts[0] === 'v') return routeVorrat(parts[1] || 'liste', parts[2]);
  if (parts[0] === 'admin') return viewAdmin();
  if (!state.loaded) {
    setMode('pm', '');
    app.innerHTML = '<div class="center muted" style="padding:3rem">Lädt Sammlung …</div>';
    try { await loadAll(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Daten konnten nicht geladen werden. <button class="btn small" onclick="location.reload()">Neu laden</button></div>'; return; }
  }
  const [view, id] = parts;
  const tab = { teil: 'teile', kiste: 'kisten', set: 'sets', etiketten: 'kisten' }[view] || view;
  setMode('pm', tab);
  const views = { teile: viewTeile, teil: viewTeil, kisten: viewKisten, kiste: viewKiste, sets: viewSets, set: viewSet, uebersicht: viewStats, etiketten: viewLabels, passwort: viewPasswort, teilen: () => viewTeilen('playmobil') };
  (views[view] || viewTeile)(id);
}
window.addEventListener('hashchange', route);

// ---------- Teile-Liste & Suche ----------
function matches(t, f) {
  if (f.farbe && norm(t.farbe) !== norm(f.farbe)) return false;
  if (f.kiste && String(t.kiste_id) !== f.kiste && !(f.kiste === 'none' && !t.kiste_id)) return false;
  if (f.set && !(t.teil_sets || []).some(x => String(x.set_id) === f.set)) return false;
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
    <div class="sub">${t.teile_nr ? 'Nr. ' + esc(t.teile_nr) + ' · ' : ''}${dot(t.farbe)}${esc(t.farbe || '')}</div>
    <div class="sub">${k ? '📦 ' + esc(kisteLabel(k)) : ''}${sets.length ? ' · 🏰 ' + esc(sets.map(s => s.set_nummer).join(', ')) : ''}</div></div>
    <div class="right">${num(t.anzahl)}×${t.euro != null ? `<div class="sub">${euro(t.euro)}</div>` : ''}</div></a>`;
}

function viewTeile() {
  const f = state.filter;
  const farben = [...new Set(state.teile.map(t => (t.farbe || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  app.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="Suchen: Nummer, Name, Farbe, Set, Kiste …" value="${esc(f.q)}" autocomplete="off"></div>
    <div class="filters">
      <select id="fFarbe"><option value="">Alle Farben</option>${farben.map(x => `<option ${norm(x) === norm(f.farbe) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="fKiste"><option value="">Alle Kisten</option><option value="none" ${f.kiste === 'none' ? 'selected' : ''}>Ohne Kiste</option>${state.kisten.map(k => `<option value="${k.id}" ${String(k.id) === f.kiste ? 'selected' : ''}>${esc(kisteLabel(k))}</option>`).join('')}</select>
      <select id="fSet"><option value="">Alle Sets</option>${state.sets.map(s => `<option value="${s.id}" ${String(s.id) === f.set ? 'selected' : ''}>${esc(setLabel(s))}</option>`).join('')}</select>
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
  const u = imgUrl(t);
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">‹ Zurück</a>
    <div class="card">
      ${u ? `<img class="big-photo" src="${esc(u)}" alt="">` : ''}
      <h1>${esc(teilTitle(t))}</h1>
      <dl class="dl">
        <dt>Teile-Nr.</dt><dd>${esc(t.teile_nr || '–')}</dd>
        <dt>Farbe</dt><dd>${dot(t.farbe)}${esc(t.farbe || '–')}</dd>
        <dt>Anzahl</dt><dd>${num(t.anzahl)}</dd>
        <dt>Wert (Euro)</dt><dd>${t.euro != null ? euro(t.euro) + (t.anzahl > 1 ? ` <span class="muted">(gesamt ${euro(t.euro * t.anzahl)})</span>` : '') : '–'}</dd>
        <dt>In Kiste</dt><dd>${k ? `<a href="#kiste/${k.id}">📦 ${esc(kisteLabel(k))}</a>` : '–'}</dd>
        <dt>Sets</dt><dd>${teilSets(t).map(s => `<a class="badge" href="#set/${s.id}">${esc(setLabel(s))}</a>`).join('') || '–'}</dd>
        ${t.notiz ? `<dt>Notiz</dt><dd>${esc(t.notiz)}</dd>` : ''}
      </dl>
    </div>
    <div class="row">
      <a class="btn grow" href="#teil/${t.id}:bearbeiten">✏️ Bearbeiten</a>
      <button class="btn danger" id="del">🗑️ Löschen</button>
    </div>`;
  document.getElementById('del').onclick = async () => {
    if (!confirm('Dieses Teil wirklich löschen?')) return;
    const { error } = await sb.from('teile').delete().eq('id', t.id);
    if (error) return fail(error);
    if (t.bild_url) await sb.storage.from(BUCKET).remove([t.bild_url]);
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
  let file = null;
  const farben = [...new Set(state.teile.map(x => (x.farbe || '').trim()).filter(Boolean))];
  const u = imgUrl(t);
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">‹ Abbrechen</a>
    <h1>${isNew ? 'Neues Teil' : 'Teil bearbeiten'}</h1>
    <form id="f" class="card">
      <label>Foto</label>
      <img id="prev" class="photo-preview ${u ? '' : 'hidden'}" src="${esc(u || '')}" alt="">
      <div class="row">
        <label class="btn secondary grow" style="margin:0">📷 Foto aufnehmen<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn secondary grow" style="margin:0">🖼️ Aus Galerie<input id="gal" type="file" accept="image/*" hidden></label>
      </div>
      <div class="grid2">
        <div><label for="nr">Teile-Nr.</label><input id="nr" value="${esc(t.teile_nr)}" inputmode="text" placeholder="z.B. 30 01 2340"></div>
        <div><label for="farbe">Farbe</label><input id="farbe" value="${esc(t.farbe)}" list="farbliste" placeholder="z.B. rot"></div>
      </div>
      <datalist id="farbliste">${[...new Set([...farben, 'rot', 'blau', 'grün', 'gelb', 'schwarz', 'weiß', 'grau', 'braun', 'orange', 'rosa', 'lila', 'silber', 'gold', 'beige', 'transparent'])].map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <label for="beschr">Beschreibung</label><input id="beschr" value="${esc(t.beschreibung)}" placeholder="z.B. Ritterhelm mit Visier">
      <div class="grid2">
        <div><label for="anz">Anzahl</label><input id="anz" type="number" min="0" step="1" inputmode="numeric" value="${esc(t.anzahl ?? 1)}"></div>
        <div><label for="eur">Euro (pro Stück)</label><input id="eur" type="text" inputmode="decimal" value="${t.euro != null ? String(t.euro).replace('.', ',') : ''}" placeholder="0,00"></div>
      </div>
      <label for="kiste">In Kiste / Tüte</label>
      <div class="row"><select id="kiste" class="grow" style="flex:1"></select><button type="button" class="btn small secondary" id="newKiste">＋ Neu</button></div>
      <label>Sets</label>
      <div class="row"><select id="setSel" style="flex:1"></select><button type="button" class="btn small secondary" id="newSet">＋ Neu</button></div>
      <div id="chips" class="chips"></div>
      <label for="notiz">Notiz</label><textarea id="notiz">${esc(t.notiz)}</textarea>
      <div style="height:1rem"></div>
      <button class="btn block" type="submit" id="save">💾 Speichern</button>
      ${isNew ? '<div style="height:.5rem"></div><button class="btn secondary block" type="button" id="saveMore">💾 Speichern & nächstes Teil</button>' : ''}
    </form>`;
  const kSel = document.getElementById('kiste'), sSel = document.getElementById('setSel');
  const fillKisten = sel => { kSel.innerHTML = `<option value="">– keine –</option>` + state.kisten.map(k => `<option value="${k.id}">${esc(kisteLabel(k))}</option>`).join(''); kSel.value = sel ?? ''; };
  const fillSets = () => { sSel.innerHTML = `<option value="">Set hinzufügen …</option>` + state.sets.filter(s => !chosenSets.includes(s.id)).map(s => `<option value="${s.id}">${esc(setLabel(s))}</option>`).join('');
    document.getElementById('chips').innerHTML = chosenSets.map(id => `<span class="chip">🏰 ${esc(setLabel(setById(id)))}<button type="button" data-id="${id}" aria-label="entfernen">×</button></span>`).join(''); };
  fillKisten(t.kiste_id); fillSets();
  sSel.onchange = () => { if (sSel.value) { chosenSets.push(Number(sSel.value)); fillSets(); } };
  document.getElementById('chips').onclick = e => { const id = e.target.dataset?.id; if (id) { chosenSets = chosenSets.filter(x => x !== Number(id)); fillSets(); } };
  document.getElementById('newKiste').onclick = async () => { const k = await kisteDialog(); if (k) fillKisten(k.id); };
  document.getElementById('newSet').onclick = async () => { const s = await setDialog(); if (s) { chosenSets.push(s.id); fillSets(); } };
  const onFile = e => { file = e.target.files[0]; if (file) { const p = document.getElementById('prev'); p.src = URL.createObjectURL(file); p.classList.remove('hidden'); } };
  document.getElementById('cam').onchange = onFile; document.getElementById('gal').onchange = onFile;

  async function save(more) {
    const btns = app.querySelectorAll('button[type=submit],#saveMore'); btns.forEach(b => b.disabled = true);
    try {
      const eurRaw = document.getElementById('eur').value.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
      const row = {
        teile_nr: document.getElementById('nr').value.trim() || null,
        farbe: document.getElementById('farbe').value.trim() || null,
        beschreibung: document.getElementById('beschr').value.trim() || null,
        anzahl: Math.max(0, parseInt(document.getElementById('anz').value, 10) || 0),
        euro: eurRaw === '' ? null : Number(eurRaw),
        kiste_id: kSel.value ? Number(kSel.value) : null,
        notiz: document.getElementById('notiz').value.trim() || null,
      };
      if (row.euro != null && isNaN(row.euro)) throw new Error('Euro-Betrag ist keine Zahl.');
      if (!row.teile_nr && !row.beschreibung && !file) throw new Error('Bitte mindestens Teile-Nr., Beschreibung oder Foto angeben.');
      const oldPath = t.bild_url;
      if (file) {
        toast('Foto wird hochgeladen …', 10000);
        const blob = await shrinkImage(file);
        const path = `${owner()}/teile/${crypto.randomUUID()}.${blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (up.error) throw up.error;
        row.bild_url = path;
      }
      let saved;
      if (isNew) { const r = await sb.from('teile').insert({ ...row, user_id: owner() }).select().single(); if (r.error) throw r.error; saved = r.data; }
      else { const r = await sb.from('teile').update(row).eq('id', t.id).select().single(); if (r.error) throw r.error; saved = r.data; }
      const before = (t.teil_sets || []).map(x => x.set_id);
      const add = chosenSets.filter(x => !before.includes(x)), rem = before.filter(x => !chosenSets.includes(x));
      if (add.length) { const r = await sb.from('teil_sets').insert(add.map(set_id => ({ teil_id: saved.id, set_id, user_id: owner() }))); if (r.error) throw r.error; }
      if (rem.length) { const r = await sb.from('teil_sets').delete().eq('teil_id', saved.id).in('set_id', rem); if (r.error) throw r.error; }
      if (file && oldPath) await sb.storage.from(BUCKET).remove([oldPath]);
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
    d.querySelector('form').onsubmit = async e => { e.preventDefault(); try { d._result = await d._save(d); d.close(); } catch (err) { fail(err); } };
    d._resolve = resolve; d._ready && d._ready(d);
    dialog.current = d;
  });
}
function kisteFields(k = {}) {
  return `<div class="grid2">
    <div><label>Art</label><select name="art"><option ${k.art !== 'Tüte' ? 'selected' : ''}>Kiste</option><option ${k.art === 'Tüte' ? 'selected' : ''}>Tüte</option></select></div>
    <div><label>Nummer</label><input name="nummer" required value="${esc(k.nummer ?? (state.kisten.length + 1))}"></div></div>
    <div class="grid2"><div><label>Farbe</label><input name="farbe" value="${esc(k.farbe)}" placeholder="z.B. blau"></div>
    <div><label>Name</label><input name="name" value="${esc(k.name)}" placeholder="z.B. Ritter"></div></div>
    <label>Ort</label><input name="ort" value="${esc(k.ort)}" placeholder="z.B. Keller, Regal 2">
    <label>Notiz</label><textarea name="notiz">${esc(k.notiz)}</textarea>`;
}
const formVals = (form, names) => Object.fromEntries(names.map(n => [n, (form.elements[n].value || '').trim() || null]));
function kisteDialog(k) {
  const p = dialog(`<form><h2 style="margin-top:0">${k ? 'Kiste bearbeiten' : 'Neue Kiste / Tüte'}</h2>${kisteFields(k)}
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  dialog.current._save = async d => {
    const row = formVals(d.querySelector('form'), ['art', 'nummer', 'farbe', 'name', 'ort', 'notiz']);
    const r = k ? await sb.from('kisten').update(row).eq('id', k.id).select().single() : await sb.from('kisten').insert({ ...row, user_id: owner() }).select().single();
    if (r.error) throw r.error;
    state.kisten = (k ? state.kisten.map(x => x.id === k.id ? r.data : x) : [...state.kisten, r.data]).sort((a, b) => sortNat(a.nummer, b.nummer));
    toast('Kiste gespeichert ✔'); return r.data;
  };
  return p;
}
function setDialog(s) {
  const p = dialog(`<form><h2 style="margin-top:0">${s ? 'Set bearbeiten' : 'Neues Set'}</h2>
    <label>Set-Nummer</label><input name="set_nummer" required value="${esc(s?.set_nummer)}" placeholder="z.B. 3666" inputmode="numeric">
    <label>Name</label><input name="name" value="${esc(s?.name)}" placeholder="z.B. Ritterburg">
    <label>Notiz</label><textarea name="notiz">${esc(s?.notiz)}</textarea>
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  dialog.current._save = async d => {
    const row = formVals(d.querySelector('form'), ['set_nummer', 'name', 'notiz']);
    const r = s ? await sb.from('sets').update(row).eq('id', s.id).select().single() : await sb.from('sets').insert({ ...row, user_id: owner() }).select().single();
    if (r.error) throw r.error;
    state.sets = (s ? state.sets.map(x => x.id === s.id ? r.data : x) : [...state.sets, r.data]).sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
    toast('Set gespeichert ✔'); return r.data;
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
        <div class="info"><div class="title">${esc(k.art)} ${esc(k.nummer)}${k.name ? ' – ' + esc(k.name) : ''}</div>
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
      <h1 style="margin-bottom:.3rem">${k.art === 'Tüte' ? '🛍️' : '📦'} ${esc(k.art)} ${esc(k.nummer)}${k.name ? ' – ' + esc(k.name) : ''}</h1>
      <div class="muted">${k.farbe ? dot(k.farbe) + 'Farbe: ' + esc(k.farbe) : ''}${k.ort ? ' · 📍 ' + esc(k.ort) : ''}</div>
      ${k.notiz ? `<p>${esc(k.notiz)}</p>` : ''}
      <p><span class="badge">${num(s.teile)} Teile</span><span class="badge">${num(s.stueck)} Stück</span><span class="badge green">${euro(s.wert)}</span></p>
      <div class="row">
        <a class="btn small" href="#teil/neu?kiste=${k.id}">＋ Teil hinzufügen</a>
        <button class="btn small secondary" id="ek">✏️ Bearbeiten</button>
        ${nfc ? '<button class="btn small secondary" id="nfc">📲 NFC-Tag beschreiben</button>' : ''}
        <a class="btn small secondary" href="#etiketten/${k.id}">🏷️ QR-Etikett</a>
        <button class="btn small secondary" id="cp">🔗 Link kopieren</button>
        ${teile.length ? '' : '<button class="btn small danger" id="dk">🗑️ Löschen</button>'}
      </div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">Link für NFC-Aufkleber: <code style="word-break:break-all">${esc(kisteUrl(k.id))}</code></p>
    </div>
    <div class="list">${teile.map(teilItem).join('') || '<div class="card center muted">Diese Kiste ist noch leer.</div>'}</div>`;
  document.getElementById('ek').onclick = async () => { if (await kisteDialog(k)) route(); };
  document.getElementById('cp').onclick = async () => { try { await navigator.clipboard.writeText(kisteUrl(k.id)); toast('Link kopiert ✔'); } catch { prompt('Link kopieren:', kisteUrl(k.id)); } };
  const dk = document.getElementById('dk');
  if (dk) dk.onclick = async () => { if (!confirm('Leere Kiste löschen?')) return; const { error } = await sb.from('kisten').delete().eq('id', k.id); if (error) return fail(error); state.kisten = state.kisten.filter(x => x.id !== k.id); location.hash = '#kisten'; };
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
function viewLabels(id) {
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

// ---------- Sets ----------
function viewSets() {
  app.innerHTML = `
    <h1>🏰 Sets</h1>
    <button class="btn block" id="ns" style="margin-bottom:.8rem">＋ Neues Set</button>
    <div class="list">${state.sets.map(s => { const teile = state.teile.filter(t => (t.teil_sets || []).some(x => x.set_id === s.id));
      const da = teile.filter(t => t.anzahl > 0).length;
      return `<a class="item" href="#set/${s.id}"><div class="thumb">🏰</div>
        <div class="info"><div class="title">${esc(s.set_nummer)} ${esc(s.name || '')}</div>
        <div class="sub">${num(teile.length)} Teile erfasst</div></div>
        <div class="right"><span class="badge ${da === teile.length ? 'green' : 'red'}">${da}/${teile.length} da</span></div></a>`; }).join('') || '<div class="card center muted">Noch keine Sets angelegt.</div>'}</div>`;
  document.getElementById('ns').onclick = async () => { const s = await setDialog(); if (s) location.hash = '#set/' + s.id; };
}

function viewSet(id) {
  const s = setById(id);
  if (!s) { app.innerHTML = '<div class="card">Set nicht gefunden. <a href="#sets">Alle Sets</a></div>'; return; }
  const teile = state.teile.filter(t => (t.teil_sets || []).some(x => x.set_id === s.id));
  const da = teile.filter(t => t.anzahl > 0), fehlt = teile.filter(t => !(t.anzahl > 0));
  const sum = sumTeile(teile);
  app.innerHTML = `
    <a class="back" href="#sets">‹ Alle Sets</a>
    <div class="card">
      <h1 style="margin-bottom:.3rem">🏰 ${esc(s.set_nummer)} ${esc(s.name || '')}</h1>
      ${s.notiz ? `<p>${esc(s.notiz)}</p>` : ''}
      <p><span class="badge green">${da.length} Teile vorhanden</span>${fehlt.length ? `<span class="badge red">${fehlt.length} fehlen</span>` : ''}<span class="badge">${num(sum.stueck)} Stück</span><span class="badge">${euro(sum.wert)}</span></p>
      <div class="row"><a class="btn small" href="#teil/neu?set=${s.id}">＋ Teil zu diesem Set</a><button class="btn small secondary" id="es">✏️ Bearbeiten</button>
      ${teile.length ? '' : '<button class="btn small danger" id="ds">🗑️ Löschen</button>'}</div>
    </div>
    ${fehlt.length ? `<h2>Fehlt (Anzahl 0)</h2><div class="list">${fehlt.map(teilItem).join('')}</div>` : ''}
    <h2>Vorhanden</h2><div class="list">${da.map(teilItem).join('') || '<div class="card center muted">Noch keine Teile zugeordnet.</div>'}</div>`;
  document.getElementById('es').onclick = async () => { if (await setDialog(s)) route(); };
  const ds = document.getElementById('ds');
  if (ds) ds.onclick = async () => { if (!confirm('Set löschen?')) return; const { error } = await sb.from('sets').delete().eq('id', s.id); if (error) return fail(error); state.sets = state.sets.filter(x => x.id !== s.id); location.hash = '#sets'; };
}

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
      <div class="stat"><b>${num(state.sets.length)}</b>Sets</div>
      <div class="stat"><b>${num(ohneKiste)}</b>Teile ohne Kiste</div>
    </div>
    ${topK.length ? `<h2>Wertvollste Kisten</h2><div class="list">${topK.map(x => `<a class="item" href="#kiste/${x.k.id}"><div class="thumb">📦</div><div class="info"><div class="title">${esc(kisteLabel(x.k))}</div><div class="sub">${num(x.stueck)} Stück</div></div><div class="right">${euro(x.wert)}</div></a>`).join('')}</div>` : ''}
    <h2>Export</h2>
    <div class="card"><p style="margin-top:0">Alle Teile als Tabelle (CSV, öffnet in Excel / Numbers / LibreOffice).</p>
    <button class="btn block" id="csv">⬇️ CSV herunterladen</button></div>
    <p class="muted center" style="font-size:.85rem">Angemeldet als ${esc(state.user.email)}</p>`;
  document.getElementById('csv').onclick = exportCsv;
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
const vstate = { loaded: false, orte: [], items: [], filter: { q: '', kat: '', ort: '', nur: '' } };
const KATEGORIEN = ['Konserven', 'Nudeln', 'Reis & Getreide', 'Getränke', 'Backen', 'Gewürze', 'Frühstück', 'Snacks', 'Tiefkühl', 'Haushalt', 'Sonstiges'];
const EINHEITEN = ['Stück', 'Packung', 'Dose', 'Glas', 'Flasche', 'kg', 'g', 'l', 'ml'];
const ortById = id => vstate.orte.find(o => o.id === Number(id));
const ortUrl = id => baseUrl() + '#v/ort/' + id;
const dec = n => (Number(n) || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const parseDec = v => { v = String(v ?? '').trim().replace(/\s|€/g, '').replace(',', '.'); if (v === '') return null; const n = Number(v); if (isNaN(n)) throw new Error('„' + v + '“ ist keine Zahl.'); return n; };
function mhdDays(it) { if (!it.mhd) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(it.mhd + 'T00:00:00') - t) / 864e5); }
const mhdState = it => { const d = mhdDays(it); return d == null ? '' : d < 0 ? 'bad' : d <= 14 ? 'warn' : ''; };
const isLow = it => it.mindestbestand != null && Number(it.menge) < Number(it.mindestbestand);
const mhdText = it => { const d = mhdDays(it); if (d == null) return ''; const ds = new Date(it.mhd + 'T00:00:00').toLocaleDateString('de-DE');
  return d < 0 ? `<span class="badge red">abgelaufen ${ds}</span>` : d <= 14 ? `<span class="badge orange">MHD ${ds} (${d === 0 ? 'heute' : 'in ' + d + ' T.'})</span>` : `<span class="badge">MHD ${ds}</span>`; };
const vsort = (a, b) => a.name.localeCompare(b.name, 'de');

async function loadVorrat() {
  const [o, v] = await Promise.all([sb.from('vorrat_orte').select('*').eq('user_id', owner()), sb.from('vorrat').select('*').eq('user_id', owner())]);
  for (const r of [o, v]) if (r.error) throw r.error;
  vstate.orte = o.data.sort((a, b) => sortNat(a.name, b.name));
  vstate.items = v.data.sort(vsort);
  vstate.loaded = true;
  await loadImageUrls(vstate.items);
}

async function routeVorrat(view, id) {
  const tab = { artikel: 'v/liste', ort: 'v/orte', etiketten: 'v/orte' }[view] || 'v/' + view;
  setMode('v', tab);
  if (!vstate.loaded) {
    app.innerHTML = '<div class="center muted" style="padding:3rem">Lädt Vorrat …</div>';
    try { await loadVorrat(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Daten konnten nicht geladen werden. <button class="btn small" onclick="location.reload()">Neu laden</button></div>'; return; }
  }
  const views = { liste: vListe, artikel: vForm, orte: vOrte, ort: vOrt, einkauf: vEinkauf, uebersicht: vStats, etiketten: vLabels, teilen: () => viewTeilen('vorrat') };
  (views[view] || vListe)(id);
}

function vMatches(it, f) {
  if (f.kat && it.kategorie !== f.kat) return false;
  if (f.ort && String(it.ort_id) !== f.ort && !(f.ort === 'none' && !it.ort_id)) return false;
  if (f.nur === 'mhd' && !mhdState(it)) return false;
  if (f.nur === 'low' && !isLow(it)) return false;
  if (!f.q) return true;
  const o = ortById(it.ort_id);
  const hay = norm([it.name, it.kategorie, it.einheit, it.barcode, it.notiz, o?.name].join(' '));
  return norm(f.q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function vItem(it) {
  const o = ortById(it.ort_id);
  const cls = mhdState(it) || (isLow(it) ? 'warn' : '');
  return `<div class="vitem ${cls}" data-id="${it.id}">
    <a class="info" href="#v/artikel/${it.id}" style="display:flex;gap:.6rem;align-items:center">${imgUrl(it) ? thumb(it) : '<div class="thumb">🥫</div>'}
      <div style="min-width:0;flex:1"><div class="title">${esc(it.name)}</div>
      <div class="sub">${esc(it.kategorie || '')}${o ? ' · 📍 ' + esc(o.name) : ''}</div>
      <div>${mhdText(it)}${isLow(it) ? `<span class="badge red">unter Mindestbestand (${dec(it.mindestbestand)})</span>` : ''}</div></div></a>
    <div class="qty"><button type="button" data-d="-1" aria-label="weniger">−</button>
      <div class="n">${dec(it.menge)}<small>${esc(it.einheit || '')}</small></div>
      <button type="button" data-d="1" aria-label="mehr">+</button></div></div>`;
}

// +1 / −1 direkt in der Liste
function bindQty(container, rerender) {
  container.onclick = async e => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    const id = Number(b.closest('.vitem').dataset.id);
    const it = vstate.items.find(x => x.id === id);
    const neu = Math.max(0, Number(it.menge) + Number(b.dataset.d));
    if (neu === Number(it.menge)) return;
    const alt = it.menge; it.menge = neu; rerender();
    const { error } = await sb.from('vorrat').update({ menge: neu }).eq('id', id);
    if (error) { it.menge = alt; rerender(); fail(error); }
  };
}

function vListe() {
  const f = vstate.filter;
  const kats = [...new Set([...KATEGORIEN, ...vstate.items.map(i => i.kategorie).filter(Boolean)])];
  const scan = 'BarcodeDetector' in window;
  app.innerHTML = `
    <div class="row" style="margin-bottom:.6rem;flex-wrap:nowrap"><div class="search grow" style="flex:1;margin:0"><input id="q" type="search" placeholder="Vorrat durchsuchen …" value="${esc(f.q)}" autocomplete="off"></div>
      ${scan ? '<button class="btn secondary" id="scan" title="Barcode scannen">▥</button>' : ''}</div>
    <div class="filters">
      <select id="fKat"><option value="">Alle Kategorien</option>${kats.map(k => `<option ${k === f.kat ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <select id="fOrt"><option value="">Alle Orte</option><option value="none" ${f.ort === 'none' ? 'selected' : ''}>Ohne Ort</option>${vstate.orte.map(o => `<option value="${o.id}" ${String(o.id) === f.ort ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      <select id="fNur"><option value="">Alles</option><option value="mhd" ${f.nur === 'mhd' ? 'selected' : ''}>MHD bald/abgelaufen</option><option value="low" ${f.nur === 'low' ? 'selected' : ''}>Unter Mindestbestand</option></select>
    </div>
    <div id="count" class="muted" style="margin-bottom:.5rem"></div>
    <div id="list" class="list"></div>
    <a class="fab" href="#v/artikel/neu" title="Neuer Artikel" style="background:#2e7d32">＋</a>`;
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
  if (scan) document.getElementById('scan').onclick = async () => {
    const code = await scanBarcode(); if (!code) return;
    const hit = vstate.items.find(i => i.barcode === code);
    if (hit) location.hash = '#v/artikel/' + hit.id;
    else if (confirm(`Barcode ${code} ist noch nicht erfasst. Neuen Artikel anlegen?`)) location.hash = '#v/artikel/neu?barcode=' + encodeURIComponent(code);
  };
  render();
}

// Barcode per Kamera (BarcodeDetector, nur wo unterstützt)
function scanBarcode() {
  return new Promise(async resolve => {
    let stream, timer, done = false;
    const d = document.createElement('dialog');
    d.innerHTML = `<div class="scanbox"><h2 style="margin-top:0">Barcode scannen</h2><video playsinline muted></video><p class="muted">Barcode vor die Kamera halten …</p><button class="btn secondary block" type="button">Abbrechen</button></div>`;
    document.body.appendChild(d); d.showModal();
    const finish = code => { if (done) return; done = true; clearInterval(timer); stream && stream.getTracks().forEach(t => t.stop()); d.close(); d.remove(); resolve(code || null); };
    d.querySelector('button').onclick = () => finish(null);
    d.addEventListener('cancel', () => finish(null));
    try {
      const det = new BarcodeDetector();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = d.querySelector('video'); v.srcObject = stream; await v.play();
      timer = setInterval(async () => { try { const r = await det.detect(v); if (r[0]) finish(r[0].rawValue); } catch { } }, 300);
    } catch (e) { fail(e); finish(null); }
  });
}

function vForm(id) {
  const pre = new URLSearchParams(location.hash.split('?')[1] || '');
  const isNew = !id || id.startsWith('neu');
  let it = isNew ? null : vstate.items.find(x => x.id === Number(id));
  if (!isNew && !it) { app.innerHTML = '<div class="card">Artikel nicht gefunden. <a href="#v/liste">Zur Liste</a></div>'; return; }
  it = it || { name: '', kategorie: pre.get('kat') || '', menge: 1, einheit: pre.get('einheit') || 'Stück', mindestbestand: null, ort_id: pre.get('ort') ? Number(pre.get('ort')) : null, mhd: null, preis: null, barcode: pre.get('barcode') || '', notiz: '' };
  let file = null;
  const u = imgUrl(it);
  const scan = 'BarcodeDetector' in window;
  const kats = [...new Set([...KATEGORIEN, ...vstate.items.map(i => i.kategorie).filter(Boolean)])];
  const decIn = v => v == null ? '' : String(v).replace('.', ',');
  app.innerHTML = `
    <a class="back" href="#v/liste">‹ Zurück</a>
    <h1>${isNew ? 'Neuer Artikel' : 'Artikel bearbeiten'}</h1>
    <form id="f" class="card">
      <label for="name">Name</label><input id="name" required value="${esc(it.name)}" placeholder="z.B. Tomaten gehackt">
      <div class="grid2">
        <div><label for="kat">Kategorie</label><input id="kat" list="katliste" value="${esc(it.kategorie)}" placeholder="z.B. Konserven"></div>
        <div><label for="ein">Einheit</label><input id="ein" list="einliste" value="${esc(it.einheit)}"></div>
      </div>
      <datalist id="katliste">${kats.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      <datalist id="einliste">${EINHEITEN.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      <div class="grid2">
        <div><label for="menge">Menge</label><input id="menge" inputmode="decimal" value="${decIn(it.menge)}"></div>
        <div><label for="min">Mindestbestand</label><input id="min" inputmode="decimal" value="${decIn(it.mindestbestand)}" placeholder="optional"></div>
      </div>
      <div class="grid2">
        <div><label for="mhd">MHD (haltbar bis)</label><input id="mhd" type="date" value="${esc(it.mhd || '')}"></div>
        <div><label for="preis">Preis (€ pro Einheit)</label><input id="preis" inputmode="decimal" value="${decIn(it.preis)}" placeholder="0,00"></div>
      </div>
      <label for="ort">Ort</label>
      <div class="row"><select id="ort" style="flex:1"></select><button type="button" class="btn small secondary" id="newOrt">＋ Neu</button></div>
      <label for="bc">Barcode (optional)</label>
      <div class="row"><input id="bc" style="flex:1" inputmode="numeric" value="${esc(it.barcode)}">${scan ? '<button type="button" class="btn small secondary" id="scanBc">▥ Scannen</button>' : ''}</div>
      <label>Foto (optional)</label>
      <img id="prev" class="photo-preview ${u ? '' : 'hidden'}" src="${esc(u || '')}" alt="">
      <div class="row">
        <label class="btn secondary grow" style="margin:0">📷 Foto<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn secondary grow" style="margin:0">🖼️ Galerie<input id="gal" type="file" accept="image/*" hidden></label>
      </div>
      <label for="notiz">Notiz</label><textarea id="notiz">${esc(it.notiz)}</textarea>
      <div style="height:1rem"></div>
      <button class="btn block" type="submit" style="background:#2e7d32">💾 Speichern</button>
      ${isNew ? '<div style="height:.5rem"></div><button class="btn secondary block" type="button" id="saveMore">💾 Speichern & nächster Artikel</button>'
        : '<div style="height:.5rem"></div><button class="btn danger block" type="button" id="del">🗑️ Löschen</button>'}
    </form>`;
  const oSel = document.getElementById('ort');
  const fillOrte = sel => { oSel.innerHTML = '<option value="">– kein Ort –</option>' + vstate.orte.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join(''); oSel.value = sel ?? ''; };
  fillOrte(it.ort_id);
  document.getElementById('newOrt').onclick = async () => { const o = await ortDialog(); if (o) fillOrte(o.id); };
  if (scan) document.getElementById('scanBc').onclick = async () => { const c = await scanBarcode(); if (c) document.getElementById('bc').value = c; };
  const onFile = e => { file = e.target.files[0]; if (file) { const p = document.getElementById('prev'); p.src = URL.createObjectURL(file); p.classList.remove('hidden'); } };
  document.getElementById('cam').onchange = onFile; document.getElementById('gal').onchange = onFile;
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
      const row = {
        name: document.getElementById('name').value.trim(),
        kategorie: document.getElementById('kat').value.trim() || null,
        einheit: document.getElementById('ein').value.trim() || null,
        menge: Math.max(0, parseDec(document.getElementById('menge').value) ?? 0),
        mindestbestand: parseDec(document.getElementById('min').value),
        mhd: document.getElementById('mhd').value || null,
        preis: parseDec(document.getElementById('preis').value),
        ort_id: oSel.value ? Number(oSel.value) : null,
        barcode: document.getElementById('bc').value.trim() || null,
        notiz: document.getElementById('notiz').value.trim() || null,
      };
      if (!row.name) throw new Error('Bitte einen Namen eingeben.');
      const oldPath = it.bild_url;
      if (file) {
        toast('Foto wird hochgeladen …', 10000);
        const blob = await shrinkImage(file);
        const path = `${owner()}/vorrat/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (up.error) throw up.error;
        row.bild_url = path;
      }
      const r = isNew ? await sb.from('vorrat').insert({ ...row, user_id: owner() }).select().single() : await sb.from('vorrat').update(row).eq('id', it.id).select().single();
      if (r.error) throw r.error;
      if (file && oldPath) await sb.storage.from(BUCKET).remove([oldPath]);
      await loadImageUrls([r.data]);
      vstate.items = (isNew ? [...vstate.items, r.data] : vstate.items.map(x => x.id === r.data.id ? r.data : x)).sort(vsort);
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

function vLabels(id) {
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
  const it = vstate.items;
  const bald = it.filter(i => mhdState(i) === 'warn'), weg = it.filter(i => mhdState(i) === 'bad');
  const wert = it.reduce((s, i) => s + (Number(i.preis) || 0) * (Number(i.menge) || 0), 0);
  const soon = it.filter(i => mhdState(i)).sort((a, b) => mhdDays(a) - mhdDays(b));
  app.innerHTML = `
    <h1>📊 Übersicht Vorrat</h1>
    <div class="stats">
      <div class="stat"><b>${num(it.length)}</b>Artikel</div>
      <div class="stat"><b style="color:#e65100">${num(bald.length)}</b>MHD in ≤ 14 Tagen</div>
      <div class="stat"><b style="color:var(--red)">${num(weg.length)}</b>abgelaufen</div>
      <div class="stat"><b>${num(it.filter(isLow).length)}</b>unter Mindestbestand</div>
      <div class="stat"><b>${euro(wert)}</b>Gesamtwert</div>
      <div class="stat"><b>${num(vstate.orte.length)}</b>Orte</div>
    </div>
    ${soon.length ? `<h2>Bald verbrauchen</h2><div id="list" class="list">${soon.map(vItem).join('')}</div>` : ''}
    <h2>Export</h2>
    <div class="card"><p style="margin-top:0">Gesamten Vorrat als Tabelle (CSV für Excel/Numbers).</p><button class="btn block" id="csv">⬇️ CSV herunterladen</button></div>`;
  const l = document.getElementById('list'); if (l) bindQty(l, () => route());
  document.getElementById('csv').onclick = vExportCsv;
}

function vExportCsv() {
  const head = ['Name', 'Kategorie', 'Menge', 'Einheit', 'Mindestbestand', 'MHD', 'Preis', 'Wert gesamt', 'Ort', 'Barcode', 'Notiz', 'Status'];
  const cell = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const d = n => n == null ? '' : String(n).replace('.', ',');
  const rows = vstate.items.map(i => [i.name, i.kategorie, d(i.menge), i.einheit, d(i.mindestbestand), i.mhd ? new Date(i.mhd + 'T00:00:00').toLocaleDateString('de-DE') : '', d(i.preis),
    i.preis != null ? d((Number(i.preis) * Number(i.menge)).toFixed(2)) : '', ortById(i.ort_id)?.name, i.barcode, i.notiz,
    [mhdState(i) === 'bad' ? 'abgelaufen' : mhdState(i) === 'warn' ? 'MHD bald' : '', isLow(i) ? 'nachkaufen' : ''].filter(Boolean).join(', ')]);
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
  for (const dir of [uid, `${uid}/teile`, `${uid}/vorrat`]) {
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
  app.innerHTML = '<div class="center muted" style="padding:3rem">Lädt Benutzer …</div>';
  const { data: users, error } = await sb.rpc('admin_list_users');
  if (error) { fail(error); app.innerHTML = '<div class="card">Benutzerliste konnte nicht geladen werden.</div>'; return; }
  app.innerHTML = `
    <h1>🛡️ Admin</h1>
    <p class="muted">${num(users.length)} Konten. Du kannst die Daten jedes Kontos ansehen und bearbeiten oder zurücksetzen.</p>
    <div class="list">${users.map(u => `<div class="card" style="margin:0">
      <div style="font-weight:700;overflow-wrap:anywhere">${esc(u.email || u.id)} ${u.is_admin ? '<span class="badge">Admin</span>' : ''}${u.id === state.user.id ? '<span class="badge green">du</span>' : ''}</div>
      <div class="sub muted" style="font-size:.85rem">Registriert ${new Date(u.created_at).toLocaleDateString('de-DE')}${u.last_sign_in_at ? ' · zuletzt angemeldet ' + new Date(u.last_sign_in_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''}</div>
      <p style="margin:.4rem 0"><span class="badge">🧸 ${num(u.teile)} Teile · ${num(u.kisten)} Kisten · ${num(u.sets)} Sets</span><span class="badge green">🥫 ${num(u.vorrat)} Artikel · ${num(u.vorrat_orte)} Orte</span></p>
      <div class="row">
        <button class="btn small" data-act="pm" data-id="${u.id}">🧸 Playmobil ansehen</button>
        <button class="btn small" data-act="v" data-id="${u.id}" style="background:#2e7d32">🥫 Vorrat ansehen</button>
        <button class="btn small danger" data-act="reset" data-id="${u.id}">♻️ Daten zurücksetzen</button>
      </div></div>`).join('')}</div>
    <h2>Konten zusammenführen</h2>
    <div class="card">
      <p class="muted" style="margin-top:0">Verschiebt die Daten eines Kontos in ein anderes (ohne Zustimmung der Nutzer). Gleiche Kisten/Sets/Orte und gleiche Teile/Artikel werden zusammengelegt.</p>
      <div class="grid2"><div><label>Von (Quelle)</label><select id="mVon">${users.map(u => `<option value="${u.id}">${esc(u.email)}</option>`).join('')}</select></div>
      <div><label>Nach (Ziel)</label><select id="mNach">${users.map((u, i) => `<option value="${u.id}" ${i === 1 ? 'selected' : ''}>${esc(u.email)}</option>`).join('')}</select></div></div>
      <label>Bereich</label><select id="mBer"><option value="beide">Playmobil + Vorratskammer</option><option value="playmobil">Nur Playmobil</option><option value="vorrat">Nur Vorratskammer</option></select>
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
    location.hash = b.dataset.act === 'v' ? '#v/liste' : '#teile';
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
const BEREICH_TXT = { playmobil: '🧸 Playmobil', vorrat: '🥫 Vorratskammer', beide: '🧸+🥫 beide Bereiche' };
const RECHT_TXT = { lesen: '👁️ nur lesen', bearbeiten: '✏️ bearbeiten' };

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
  return `<p>Aus <b>${esc(vonTxt)}</b> werden nach <b>${esc(nachTxt)}</b> verschoben (${BEREICH_TXT[bereich]}):</p><ul>${li.join('')}</ul>
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
  setMode(section === 'vorrat' ? 'v' : 'pm', section === 'vorrat' ? 'v/teilen' : 'teilen');
  const me = state.user.id, other = section === 'vorrat' ? 'playmobil' : 'vorrat';
  const sTxt = section === 'vorrat' ? 'Vorratskammer' : 'Playmobil-Sammlung';
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
      <b>${esc(f.owner_email)}</b> möchte ${BEREICH_TXT[f.bereich]} mit dir teilen (${RECHT_TXT[f.recht]}).
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
      <div class="grid2"><div><label>Recht</label><select name="recht"><option value="lesen">👁️ nur lesen</option><option value="bearbeiten">✏️ bearbeiten</option></select></div>
      <div><label>Bereich</label><select name="bereich"><option value="${section}">${BEREICH_TXT[section]}</option><option value="beide">${BEREICH_TXT.beide}</option></select></div></div>
      <div style="height:.8rem"></div><button class="btn block">📨 Einladen</button>
    </form>
    ${mine.length ? `<div class="list">${mine.map(f => `<div class="card" style="margin:0">
      <b style="overflow-wrap:anywhere">${esc(f.member_email)}</b> ${f.status === 'eingeladen' ? '<span class="badge orange">eingeladen</span>' : '<span class="badge green">hat Zugriff</span>'} <span class="badge">${BEREICH_TXT[f.bereich]}</span>
      <div class="row" style="margin-top:.5rem"><select data-a="recht" data-id="${f.id}" style="flex:1"><option value="lesen" ${f.recht === 'lesen' ? 'selected' : ''}>👁️ nur lesen</option><option value="bearbeiten" ${f.recht === 'bearbeiten' ? 'selected' : ''}>✏️ bearbeiten</option></select>
      <button class="btn small danger" data-a="revoke" data-id="${f.id}">Zugriff entziehen</button></div></div>`).join('')}</div>` : `<p class="muted">Du teilst deine ${sTxt} noch mit niemandem.</p>`}

    <h2>🔀 Sammlungen zusammenführen</h2>
    <form class="card" id="mergeForm">
      <p class="muted" style="margin-top:0">Legt zwei Konten zu einem zusammen. Das andere Konto muss zustimmen. Gleiche Kisten/Sets/Orte werden zusammengelegt, gleiche Teile/Artikel addiert.</p>
      <label>E-Mail des anderen Kontos</label><input name="email" type="email" required placeholder="name@beispiel.de">
      <label>Richtung</label><select name="richtung"><option value="zu_dir">Meine Daten → in das andere Konto</option><option value="zu_mir">Daten des anderen Kontos → zu mir</option></select>
      <label>Bereich</label><select name="bereich"><option value="${section}">${BEREICH_TXT[section]}</option><option value="beide">${BEREICH_TXT.beide}</option></select>
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
        else if (a === 'recht') { const f = byId(state.shares, id); const { error } = await sb.rpc('freigabe_aendern', { p_id: id, p_bereich: f.bereich, p_recht: el.value }); if (error) throw error; toast('Recht geändert.'); }
        else if (a === 'view') { viewAsShare(byId(state.shares, id)); location.hash = section === 'vorrat' ? '#v/liste' : '#teile'; return; }
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
(async () => { await initAuth(); route(); })();
