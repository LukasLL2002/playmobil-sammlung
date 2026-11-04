// Playmobil-Sammlung – einfache Familien-App (Supabase + Vanilla JS)
'use strict';

const SUPABASE_URL = 'https://nmuwmlmrmktjhquanejk.supabase.co';
// Öffentlicher Publishable Key (darf im Browser stehen; Schutz läuft über RLS)
const SUPABASE_KEY = 'sb_publishable_gLdgwbvvbcmTdgdfXI5c1A_7ZNlW1vt';
const BUCKET = 'bilder';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = { user: null, kisten: [], sets: [], teile: [], loaded: false, imgCache: {},
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
function fail(err) { console.error(err); toast('Fehler: ' + (err?.message || err), 5000); }
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
    sb.from('kisten').select('*'),
    sb.from('sets').select('*'),
    sb.from('teile').select('*, teil_sets(set_id)').order('created_at', { ascending: false }),
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
  sb.auth.onAuthStateChange((_e, session) => {
    const was = !!state.user; state.user = session?.user || null;
    if (was !== !!state.user) { state.loaded = false; setTimeout(route, 0); }
  });
}
document.getElementById('logoutBtn').onclick = async () => { await sb.auth.signOut(); };

function renderLogin() {
  document.getElementById('topbar').classList.add('hidden');
  document.getElementById('tabbar').classList.add('hidden');
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
async function route() {
  if (!state.user) return renderLogin();
  document.getElementById('topbar').classList.remove('hidden');
  document.getElementById('tabbar').classList.remove('hidden');
  if (!state.loaded) {
    app.innerHTML = '<div class="center muted" style="padding:3rem">Lädt Sammlung …</div>';
    try { await loadAll(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Daten konnten nicht geladen werden. <button class="btn small" onclick="location.reload()">Neu laden</button></div>'; return; }
  }
  const [view, id] = (location.hash.slice(1) || 'teile').split('/');
  const tab = { teil: 'teile', kiste: 'kisten', set: 'sets', etiketten: 'kisten' }[view] || view;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  const views = { teile: viewTeile, teil: viewTeil, kisten: viewKisten, kiste: viewKiste, sets: viewSets, set: viewSet, uebersicht: viewStats, etiketten: viewLabels, passwort: viewPasswort };
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
        const path = `${crypto.randomUUID()}.${blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (up.error) throw up.error;
        row.bild_url = path;
      }
      let saved;
      if (isNew) { const r = await sb.from('teile').insert(row).select().single(); if (r.error) throw r.error; saved = r.data; }
      else { const r = await sb.from('teile').update(row).eq('id', t.id).select().single(); if (r.error) throw r.error; saved = r.data; }
      const before = (t.teil_sets || []).map(x => x.set_id);
      const add = chosenSets.filter(x => !before.includes(x)), rem = before.filter(x => !chosenSets.includes(x));
      if (add.length) { const r = await sb.from('teil_sets').insert(add.map(set_id => ({ teil_id: saved.id, set_id }))); if (r.error) throw r.error; }
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
    const r = k ? await sb.from('kisten').update(row).eq('id', k.id).select().single() : await sb.from('kisten').insert(row).select().single();
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
    const r = s ? await sb.from('sets').update(row).eq('id', s.id).select().single() : await sb.from('sets').insert(row).select().single();
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
  if (!k) { app.innerHTML = '<div class="card">Diese Kiste gibt es (noch) nicht. <a href="#kisten">Alle Kisten</a></div>'; return; }
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
  if (nfc) document.getElementById('nfc').onclick = async () => {
    try {
      const ndef = new NDEFReader();
      toast('Jetzt das Handy an den NFC-Aufkleber halten …', 15000);
      await ndef.write({ records: [{ recordType: 'url', data: kisteUrl(k.id) }] });
      toast('NFC-Tag beschrieben ✔ – Antippen öffnet jetzt diese Kiste.', 5000);
    } catch (e) { fail(e); }
  };
}

// ---------- QR-Etiketten ----------
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

// ---------- Start ----------
(async () => { await initAuth(); route(); })();
