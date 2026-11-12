// LEGO-Sammlung (analog Playmobil) + optionale Rebrickable-Suche
'use strict';

const lstate = { loaded: false, kisten: [], sets: [], teile: [], filter: { q: '', farbe: '', kiste: '', set: '', nr: '' } };
const lkisteById = id => lstate.kisten.find(k => k.id === Number(id));
const lsetById = id => lstate.sets.find(s => s.id === Number(id));
const lkisteLabel = k => kisteLabel(k);
const lsetLabel = s => s ? `${s.set_nummer}${s.name ? ' ' + s.name : ''}` : '';
const lteilSets = t => (t.lego_teil_sets || []).map(x => lsetById(x.set_id)).filter(Boolean);
const lteilTitle = t => t.beschreibung || (hasNr(t) ? 'Teil ' + t.teile_nr : 'Ohne Beschreibung');
/** LEGO-Kiste anlegen/bearbeiten (Nummer freiwillig, freier Text) */
function lKisteDialog(k) {
  const p = dialog(`<form><h2 style="margin-top:0">${k ? 'Kiste bearbeiten' : 'Neue Kiste / Tüte'}</h2>
    <div class="grid2"><div><label>Art</label><select name="art"><option ${k?.art !== 'Tüte' ? 'selected' : ''}>Kiste</option><option ${k?.art === 'Tüte' ? 'selected' : ''}>Tüte</option></select></div>
    <div><label>Nummer <span class="muted" style="font-weight:400">(freiwillig)</span></label><input name="nummer" value="${esc(k?.nummer ?? '')}" placeholder="z.B. ${lstate.kisten.length + 1}, A-G oder leer" autocomplete="off"></div></div>
    <label>Name</label><input name="name" value="${esc(k?.name ?? '')}" placeholder="z.B. Steine rot">
    <label>Ort</label><input name="ort" value="${esc(k?.ort ?? '')}" placeholder="z.B. Regal 2">
    <div class="row" style="margin-top:1rem"><button class="btn grow" type="submit">Speichern</button><button class="btn secondary" type="button" data-cancel>Abbrechen</button></div></form>`);
  dialog.current._save = async d => {
    const row = formVals(d.querySelector('form'), ['art', 'nummer', 'name', 'ort']);
    if (row.nummer && lstate.kisten.some(x => x.id !== k?.id && (x.art || 'Kiste') === row.art && kisteNrKey(x.nummer) === kisteNrKey(row.nummer))) throw new Error(`${row.art} ${row.nummer} gibt es schon. Bitte eine andere Nummer wählen oder leer lassen.`);
    const r = k ? await sb.from('lego_kisten').update(row).eq('id', k.id).select().single() : await sb.from('lego_kisten').insert({ ...row, user_id: owner() }).select().single();
    if (r.error) { if (String(r.error.code) === '23505') throw new Error('Diese Nummer gibt es schon. Bitte eine andere wählen oder leer lassen.'); throw r.error; }
    lstate.kisten = (k ? lstate.kisten.map(x => x.id === k.id ? r.data : x) : [...lstate.kisten, r.data]).sort((a, b) => sortNat(a.nummer, b.nummer));
    toast('Kiste gespeichert ✔'); return r.data;
  };
  return p;
}
const rebrickableKey = () => localStorage.getItem('rebrickableKey') || '';

async function loadLego() {
  const [k, s, t] = await Promise.all([
    selectAll(() => sb.from('lego_kisten').select('*').eq('user_id', owner())),
    selectAll(() => sb.from('lego_sets').select('*').eq('user_id', owner())),
    selectAll(() => sb.from('lego_teile').select('*, lego_teil_sets(set_id)').eq('user_id', owner())),
  ]);
  if (t.data) t.data.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.id - a.id);
  for (const r of [k, s, t]) if (r.error) throw r.error;
  lstate.kisten = k.data.sort((a, b) => sortNat(a.nummer, b.nummer));
  lstate.sets = s.data.sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
  lstate.teile = t.data;
  lstate.loaded = true;
  loadImageUrls([...lstate.teile, ...lstate.sets]).then(() => {
    const h = (location.hash || '').slice(1);
    if (h === 'l/teile' || h === 'l/kisten' || h === 'l/sets' || h === 'l/reserve' || h === 'l/uebersicht' || /^l\/(set|kiste|teil)\/\d+$/.test(h)) {
      try { route(); } catch { /* */ }
    }
  }).catch(e => console.warn(e));
}

async function routeLego(view, id) {
  if (!lstate.loaded) {
    setMode('lego', '');
    app.innerHTML = '<div class="center muted" style="padding:3rem">LEGO-Sammlung wird geladen …</div>';
    try { await loadLego(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Daten konnten nicht geladen werden.</div>'; return; }
  }
  const rbArt = new URLSearchParams(location.hash.split('?')[1] || '').get('art') === 'set' ? 'set' : 'reserve';
  const tab = view === 'set' ? (setArt(lsetById(id)) === 'set' ? 'l/sets' : 'l/reserve')
    : view === 'rebrickable' ? (rbArt === 'set' ? 'l/sets' : 'l/reserve')
      : ({ teil: 'l/teile', kiste: 'l/kisten', import: 'l/uebersicht' }[view] || 'l/' + view);
  setMode('lego', tab);
  const views = {
    teile: lTeile, teil: lTeil, kisten: lKisten, kiste: lKiste, reserve: () => lSets('reserve'), sets: () => lSets('set'), set: lSet,
    uebersicht: lStats, teilen: () => viewTeilen('lego'), import: () => viewImport('lego'), rebrickable: () => lRebrickable(rbArt),
  };
  (views[view] || lTeile)(id);
}

function lMatches(t, f) {
  if (f.farbe && norm(t.farbe) !== norm(f.farbe)) return false;
  if (f.kiste && String(t.kiste_id) !== f.kiste && !(f.kiste === 'none' && !t.kiste_id)) return false;
  if (f.set && !(t.lego_teil_sets || []).some(x => String(x.set_id) === f.set)) return false;
  if (f.nr === 'ohne' && hasNr(t)) return false;
  if (f.nr === 'mit' && !hasNr(t)) return false;
  if (!f.q) return true;
  const hay = norm([t.teile_nr, t.farbe, t.beschreibung, t.notiz, lkisteLabel(lkisteById(t.kiste_id)), ...lteilSets(t).map(lsetLabel)].join(' '));
  return norm(f.q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function lTeile() {
  const f = lstate.filter;
  const farben = [...new Set(lstate.teile.map(t => (t.farbe || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  app.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="LEGO-Teile suchen …" value="${esc(f.q)}"></div>
    <div class="filters">
      <select id="fFarbe"><option value="">Alle Farben</option>${farben.map(x => `<option ${x === f.farbe ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="fKiste"><option value="">Alle Kisten</option><option value="none" ${f.kiste === 'none' ? 'selected' : ''}>Ohne Kiste</option>${lstate.kisten.map(k => `<option value="${k.id}" ${String(k.id) === f.kiste ? 'selected' : ''}>${esc(lkisteLabel(k))}</option>`).join('')}</select>
      <select id="fSet"><option value="">Alle ${esc(artName('reserve', true))} &amp; ${esc(artName('set', true))}</option>${setOptions(lstate.sets, true, f.set)}</select>
      <select id="fNr"><option value="">Alle Nummern</option><option value="mit" ${f.nr === 'mit' ? 'selected' : ''}>Mit Nummer</option><option value="ohne" ${f.nr === 'ohne' ? 'selected' : ''}>Ohne Nummer</option></select>
    </div>
    <div class="row" style="margin:.4rem 0 .6rem;gap:.4rem;flex-wrap:wrap">
      <a class="btn small" href="#l/teil/neu" style="background:#f9a825;color:#111">＋ Teil</a>
      <a class="btn small secondary" href="#l/import" id="impTeile">📥 Aus Excel übernehmen</a>
    </div>
    <div id="count" class="muted" style="margin-bottom:.5rem"></div>
    <div id="list" class="list"></div>
    <a class="fab" href="#l/teil/neu" title="Neues Teil" style="background:#f9a825;color:#111">＋</a>`;
  const list = document.getElementById('list');
  const render = () => {
    const res = lstate.teile.filter(t => lMatches(t, f));
    document.getElementById('count').textContent = `${num(res.length)} von ${num(lstate.teile.length)} Teilen · ${num(res.reduce((s, t) => s + (t.anzahl || 0), 0))} Stück`;
    list.innerHTML = res.map(t => {
      const k = lkisteById(t.kiste_id);
      return `<a class="card item" href="#l/teil/${t.id}">${thumb(t)}
        <div class="info"><div class="title">${esc(lteilTitle(t))}</div>
        <div class="sub">${hasNr(t) ? esc(t.teile_nr) + ' · ' : NR_BADGE + ' '}${cleanNr(t.farbe) ? dot(t.farbe) + ' ' + esc(t.farbe) : ''}${k ? ' · 📦 ' + esc(lkisteLabel(k)) : ''}</div>
        <div class="sub">${lteilSets(t).map(s => artIcon(setArt(s)) + ' ' + esc(lsetLabel(s))).join(' · ')}</div>
        ${priceSubHtml(t.euro, t.anzahl)}</div>
        <div class="right"><b>${num(t.anzahl)}×</b></div></a>`;
    }).join('') || (lstate.teile.length ? '<div class="card center muted">Nichts gefunden.</div>'
      : '<div class="card center"><p>Noch keine LEGO-Teile.</p><a class="btn" href="#l/teil/neu" style="background:#f9a825;color:#111">＋ Erstes Teil</a><div style="height:.5rem"></div><a class="btn secondary" href="#l/import">📥 Importieren</a></div>');
  };
  document.getElementById('q').oninput = e => { f.q = e.target.value; render(); };
  document.getElementById('fFarbe').onchange = e => { f.farbe = e.target.value; render(); };
  document.getElementById('fKiste').onchange = e => { f.kiste = e.target.value; render(); };
  document.getElementById('fSet').onchange = e => { f.set = e.target.value; render(); };
  document.getElementById('fNr').onchange = e => { f.nr = e.target.value; render(); };
  render();
}

function lTeil(id) {
  const isNew = !id || id.startsWith('neu');
  let t = isNew ? null : lstate.teile.find(x => x.id === Number(String(id).split(':')[0]));
  if (!isNew && !t) { app.innerHTML = '<div class="card">Teil nicht gefunden. <a href="#l/teile">Zur Liste</a></div>'; return; }
  const edit = isNew || String(id).includes('bearbeiten') || isNew;
  if (!isNew && !String(id).includes('bearbeiten') && !edit) {
    // detail view
  }
  if (!isNew && !String(id).endsWith(':bearbeiten') && id !== 'neu') {
    const sets = lteilSets(t); const k = lkisteById(t.kiste_id);
    app.innerHTML = `
      <a class="back" href="#l/teile">‹ Alle Teile</a>
      <div class="card">${photoStrip(t)}<h1 style="margin-top:.4rem">${esc(lteilTitle(t))}</h1>
        <p>${hasNr(t) ? '<b>Nr.</b> ' + esc(t.teile_nr) : 'Keine Nummer gefunden'}${t.farbe ? ' · ' + dot(t.farbe) + ' ' + esc(t.farbe) : ''}</p>
        <p>${k ? '📦 <a href="#l/kiste/' + k.id + '">' + esc(lkisteLabel(k)) + '</a>' : 'Ohne Kiste'} · <b>${num(t.anzahl)}×</b></p>
        ${t.euro != null ? `<p class="price">${esc(priceLine(t.euro, t.anzahl))}</p>` : ''}
        ${sets.length ? `<p>${sets.map(s => `<a class="badge" href="#l/set/${s.id}">${artIcon(setArt(s))} ${esc(lsetLabel(s))}</a>`).join(' ')}</p>` : ''}
        ${t.notiz ? `<p class="muted">${esc(t.notiz)}</p>` : ''}
        <div class="row"><a class="btn grow" href="#l/teil/${t.id}:bearbeiten">✏️ Bearbeiten</a>
          <button class="btn danger grow" id="del">🗑️ Löschen</button></div></div>`;
    bindPhotoStrip(app);
    document.getElementById('del').onclick = async () => {
      if (!confirm('Teil löschen?')) return;
      const { error } = await sb.from('lego_teile').delete().eq('id', t.id); if (error) return fail(error);
      if (imgList(t).length) await sb.storage.from(BUCKET).remove(imgList(t));
      lstate.teile = lstate.teile.filter(x => x.id !== t.id); toast('Gelöscht.'); location.hash = '#l/teile';
    };
    return;
  }
  t = t || { teile_nr: '', farbe: '', beschreibung: '', anzahl: 1, euro: null, kiste_id: null, notiz: '' };
  let chosenSets = (t.lego_teil_sets || []).map(x => x.set_id);
  app.innerHTML = `
    <a class="back" href="${isNew ? '#l/teile' : '#l/teil/' + t.id}">‹ Zurück</a>
    <h1>${isNew ? 'Neues LEGO-Teil' : 'LEGO-Teil bearbeiten'}</h1>
    <form id="f" class="card">
      <div class="grid2"><div>${nrFieldHtml(t)}</div>
        <div><label>Farbe</label><input id="farbe" value="${esc(t.farbe)}"></div></div>
      <label>Beschreibung</label><input id="bes" value="${esc(t.beschreibung)}">
      <div class="grid2"><div><label>Anzahl</label><input id="anz" inputmode="numeric" value="${t.anzahl ?? 1}"></div>
        <div><label>Einzelpreis (€ / Stück)</label><input id="euro" inputmode="decimal" value="${t.euro != null ? String(t.euro).replace('.', ',') : ''}"><div id="eurPrev" class="muted" style="font-size:.85rem;margin-top:.25rem"></div></div></div>
      <label>Kiste</label><div class="row"><select id="kiste" style="flex:1"></select><button type="button" class="btn small secondary" id="nk">＋</button></div>
      <label>${esc(artName('reserve', true))} / ${esc(artName('set', true))}</label><div id="setTags" class="row" style="flex-wrap:wrap"></div><select id="addSet"></select>
      <div class="row" style="margin-top:.4rem"><button type="button" class="btn small secondary grow" id="newRes">＋ Neu in ${esc(artName('reserve', true))}</button><button type="button" class="btn small secondary grow" id="newSet">＋ Neu in ${esc(artName('set', true))}</button></div>
      <label>Fotos</label>${galleryHtml('lgal')}
      <label>Notiz</label><textarea id="notiz">${esc(t.notiz)}</textarea>
      <div style="height:1rem"></div><button class="btn block" style="background:#f9a825;color:#111">💾 Speichern</button>
    </form>`;
  const kSel = document.getElementById('kiste'), sSel = document.getElementById('addSet');
  const fillK = sel => { kSel.innerHTML = '<option value="">– keine –</option>' + lstate.kisten.map(k => `<option value="${k.id}">${esc(lkisteLabel(k))}</option>`).join(''); kSel.value = sel ?? ''; };
  const fillS = () => { sSel.innerHTML = '<option value="">Zuordnen …</option>' + setOptions(lstate.sets.filter(s => !chosenSets.includes(s.id)), true); };
  const renderTags = () => {
    document.getElementById('setTags').innerHTML = chosenSets.map(id => { const s = lsetById(id); return `<span class="badge">${artIcon(setArt(s))} ${esc(lsetLabel(s))} <button type="button" data-x="${id}">×</button></span>`; }).join('');
    document.getElementById('setTags').querySelectorAll('button').forEach(b => b.onclick = () => { chosenSets = chosenSets.filter(x => x !== Number(b.dataset.x)); renderTags(); fillS(); });
  };
  fillK(t.kiste_id); fillS(); renderTags();
  sSel.onchange = () => { if (sSel.value) { chosenSets.push(Number(sSel.value)); renderTags(); fillS(); } };
  document.getElementById('nk').onclick = async () => { const k = await lKisteDialog(); if (k) fillK(k.id); };
  bindNrField('lego', () => document.getElementById('bes').value.trim());
  const gal = galleryEditor('lgal', imgList(t));
  const addNewSet = async art => { const s = await setDialogX(SETCFG.lego, null, art, { fromPart: true, kiste_id: kSel.value || null }); if (s && !chosenSets.includes(s.id)) chosenSets.push(s.id); renderTags(); fillS(); };
  document.getElementById('newRes').onclick = () => addNewSet('reserve');
  document.getElementById('newSet').onclick = () => addNewSet('set');
  const updEurPrev = () => {
    const el = document.getElementById('eurPrev'); if (!el) return;
    try {
      const u = parseDec(document.getElementById('euro').value);
      const q = Math.max(0, parseInt(document.getElementById('anz').value, 10) || 0);
      el.textContent = u != null ? priceLine(u, q) : '';
    } catch { el.textContent = ''; }
  };
  document.getElementById('euro').oninput = updEurPrev;
  document.getElementById('anz').oninput = updEurPrev;
  updEurPrev();
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try {
      const row = {
        ...nrValues(),
        farbe: document.getElementById('farbe').value.trim() || null,
        beschreibung: document.getElementById('bes').value.trim() || null,
        anzahl: Math.max(0, parseInt(document.getElementById('anz').value, 10) || 0),
        euro: parseDec(document.getElementById('euro').value),
        kiste_id: document.getElementById('kiste').value ? Number(document.getElementById('kiste').value) : null,
        notiz: document.getElementById('notiz').value.trim() || null,
      };
      if (!row.teile_nr && !row.beschreibung && !gal.count()) throw new Error('Bitte Nr., Beschreibung oder Foto angeben.');
      row.bilder = await gal.commit('lego');
      row.bild_url = row.bilder[0] || null;
      const r = isNew ? await sb.from('lego_teile').insert({ ...row, user_id: owner() }).select().single()
        : await sb.from('lego_teile').update(row).eq('id', t.id).select().single();
      if (r.error) { await gal.rollback(); throw r.error; }
      await gal.cleanup();
      await sb.from('lego_teil_sets').delete().eq('teil_id', r.data.id);
      if (chosenSets.length) await sb.from('lego_teil_sets').insert(chosenSets.map(set_id => ({ teil_id: r.data.id, set_id, user_id: owner() })));
      const { data: full } = await sb.from('lego_teile').select('*, lego_teil_sets(set_id)').eq('id', r.data.id).single();
      if (imgList(full).length) await loadImageUrls([full]);
      lstate.teile = isNew ? [full, ...lstate.teile] : lstate.teile.map(x => x.id === full.id ? full : x);
      toast('Gespeichert.'); location.hash = '#l/teil/' + full.id;
    } catch (err) { fail(err); }
  };
}

function lKisten() {
  app.innerHTML = `<h1>📦 LEGO-Kisten</h1>
    <div class="list">${lstate.kisten.map(k => {
      const teile = lstate.teile.filter(t => t.kiste_id === k.id);
      const st = teile.reduce((s, t) => s + (t.anzahl || 0), 0);
      return `<a class="card item" href="#l/kiste/${k.id}"><div class="info"><div class="title">${esc(lkisteLabel(k))}</div>
        <div class="sub">${k.ort ? '📍 ' + esc(k.ort) : ''}</div></div><div class="right"><b>${num(teile.length)}</b><small>${num(st)} St.</small></div></a>`;
    }).join('') || '<div class="card center muted">Noch keine Kisten.</div>'}
    </div><button class="fab" id="nk" style="background:#f9a825;color:#111">＋</button>`;
  document.getElementById('nk').onclick = async () => { const k = await lKisteDialog(); if (k) location.hash = '#l/kiste/' + k.id; };
}
function lKiste(id) {
  const k = lkisteById(id);
  if (!k) { app.innerHTML = '<div class="card">Kiste nicht gefunden. <a href="#l/kisten">Alle</a></div>'; return; }
  const teile = lstate.teile.filter(t => t.kiste_id === k.id);
  app.innerHTML = `<a class="back" href="#l/kisten">‹ Alle Kisten</a>
    <div class="card"><h1>📦 ${esc(lkisteLabel(k))}</h1>
      <p class="muted">${k.ort ? '📍 ' + esc(k.ort) : ''} · ${num(teile.length)} Teile</p>
      <div class="row"><button class="btn small secondary" id="ek">✏️ Bearbeiten</button><button class="btn small danger" id="dk">🗑️ Löschen</button></div></div>
    <div class="list">${teile.map(t => `<a class="card item" href="#l/teil/${t.id}">${thumb(t)}<div class="info"><div class="title">${esc(lteilTitle(t))}</div>
      <div class="sub">${hasNr(t) ? esc(t.teile_nr) : NR_BADGE} ${cleanNr(t.farbe) ? '· ' + esc(t.farbe) : ''}</div>${priceSubHtml(t.euro, t.anzahl)}</div><div class="right"><b>${num(t.anzahl)}×</b></div></a>`).join('') || '<div class="card center muted">Leer.</div>'}</div>
    <a class="fab" href="#l/teil/neu" style="background:#f9a825;color:#111">＋</a>`;
  document.getElementById('ek').onclick = async () => { if (await lKisteDialog(k)) lKiste(id); };
  document.getElementById('dk').onclick = async () => {
    if (!(await deleteKiste('lego_kisten', 'lego_teile', k, teile, lkisteLabel(k)))) return;
    lstate.kisten = lstate.kisten.filter(x => x.id !== k.id); location.hash = '#l/kisten';
  };
}
function lSets(art = 'reserve') {
  const nm = artName(art, true);
  const list = lstate.sets.filter(s => setArt(s) === art);
  app.innerHTML = `<h1>${artIcon(art)} LEGO – ${esc(nm)}</h1>
    <div class="row" style="margin-bottom:.8rem"><button class="btn grow" id="ns" style="background:#f9a825;color:#111">＋ Neu in ${esc(nm)}</button>
      <a class="btn secondary" href="#l/rebrickable?art=${art}">🔎 Bei Rebrickable suchen</a></div>
    ${setSearchHtml(nm, setSearchQ['lego-' + art])}`;
  bindSetSearch('lego-' + art, list, nm, s => {
    const teile = lstate.teile.filter(t => (t.lego_teil_sets || []).some(x => x.set_id === s.id)); const n = teile.length;
    const extra = `${s.jahr ? s.jahr + ' · ' : ''}${s.teile_anzahl ? num(s.teile_anzahl) + ' Teile laut Anleitung · ' : ''}`;
    return setListItem(s, n, null, '#l/set/' + s.id, extra, teile);
  });
  document.getElementById('ns').onclick = async () => { const s = await setDialogX(SETCFG.lego, null, art); if (s) location.hash = '#l/set/' + s.id; };
}
function lSet(id) {
  const s = lsetById(id);
  if (!s) { app.innerHTML = '<div class="card">Nicht gefunden. <a href="#l/reserve">Zur Übersicht</a></div>'; return; }
  const art = setArt(s), back = art === 'set' ? '#l/sets' : '#l/reserve';
  const teile = lstate.teile.filter(t => (t.lego_teil_sets || []).some(x => x.set_id === s.id));
  app.innerHTML = `<a class="back" href="${back}">‹ ${esc(artName(art, true))}</a>
    <div class="card">${setPhotos(s, teile)}<h1>${artIcon(art)} ${esc(lsetLabel(s))}</h1>
      <p class="muted">${s.jahr || ''}${s.teile_anzahl ? ' · ' + num(s.teile_anzahl) + ' Teile laut Anleitung' : ''}</p>
      ${setFactsHtml(s, true)}
      ${s.notiz ? `<p>${esc(s.notiz)}</p>` : ''}
      <div class="row"><button class="btn small secondary" id="es">✏️ Bearbeiten</button><button class="btn small danger" id="ds">🗑️ Löschen</button></div></div>
    <div class="list">${teile.map(t => `<a class="card item" href="#l/teil/${t.id}">${thumb(t)}<div class="info"><div class="title">${esc(lteilTitle(t))}</div>${priceSubHtml(t.euro, t.anzahl)}</div><div class="right"><b>${num(t.anzahl)}×</b></div></a>`).join('') || '<div class="card center muted">Keine Teile verknüpft.</div>'}</div>`;
  bindPhotoStrip(app);
  document.getElementById('es').onclick = async () => { const r = await setDialogX(SETCFG.lego, s); if (r) { if (r.id !== s.id) location.hash = '#l/set/' + r.id; else lSet(r.id); } };
  document.getElementById('ds').onclick = async () => {
    if (!confirm('Wirklich löschen? Die Teile bleiben erhalten.')) return;
    const { error } = await sb.from('lego_sets').delete().eq('id', s.id); if (error) return fail(error);
    if (imgList(s).length) sb.storage.from(BUCKET).remove(imgList(s)).catch(console.warn);
    lstate.sets = lstate.sets.filter(x => x.id !== s.id); location.hash = back;
  };
}
function lStats() {
  const st = lstate.teile.reduce((s, t) => s + (t.anzahl || 0), 0);
  const wert = lstate.teile.reduce((s, t) => s + (Number(t.euro) || 0) * (t.anzahl || 0), 0);
  app.innerHTML = `<h1>📊 LEGO-Übersicht</h1>
    <div class="stats"><div class="stat"><b>${num(lstate.teile.length)}</b>Teile-Arten</div>
      <div class="stat"><b>${num(st)}</b>Stück</div>
      <div class="stat"><b>${num(lstate.kisten.length)}</b>Kisten</div>
      <div class="stat"><b>${num(lstate.sets.filter(x => setArt(x) === 'reserve').length)}</b>${esc(artName('reserve', true))}</div>
      <div class="stat"><b>${num(lstate.sets.filter(x => setArt(x) === 'set').length)}</b>${esc(artName('set', true))}</div>
      <div class="stat"><b>${euro(wert)}</b>Wert</div></div>
    <div class="card"><a class="btn block secondary" href="#l/import">📥 Aus Excel oder Tabelle übernehmen</a>
      <div style="height:.5rem"></div>
      <button class="btn block secondary" id="exp">📤 Als Tabelle speichern</button>
      <div style="height:.5rem"></div>
      <button class="btn block secondary" id="expSets">📤 ${esc(artName('reserve', true))} &amp; ${esc(artName('set', true))} als Tabelle</button>
      <div style="height:.5rem"></div>
      <a class="btn block secondary" href="#l/rebrickable">🔑 Rebrickable-Einstellungen</a></div>
    ${state.viewUid ? '' : `<h2>Einstellungen</h2><div class="card">${renameTabsBtn('lego')}</div>`}`;
  bindRenameTabs();
  document.getElementById('expSets').onclick = () => exportSetsCsv(true);
  document.getElementById('exp').onclick = () => {
    const head = ['teile_nr', 'farbe', 'beschreibung', 'anzahl', 'euro', 'kiste_nummer', 'kiste_art', 'set_nummern', 'notiz'];
    const rows = lstate.teile.map(t => {
      const k = lkisteById(t.kiste_id);
      return [t.teile_nr, t.farbe, t.beschreibung, t.anzahl, t.euro, k?.nummer, k?.art, lteilSets(t).map(s => s.set_nummer).join(','), t.notiz]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';');
    });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head.join(';'), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `lego-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
}

async function lRebrickable(art = 'reserve') {
  const nm = artName(art, true);
  app.innerHTML = `
    <a class="back" href="#l/${art === 'set' ? 'sets' : 'reserve'}">‹ ${esc(nm)}</a>
    <h1>🔎 Rebrickable</h1>
    <p class="muted" style="margin-top:0">Übernommene Sets landen in „${artIcon(art)} ${esc(nm)}“.</p>
    <div class="card">
      <p class="muted" style="margin-top:0">Sets bei Rebrickable suchen. Dafür brauchst du einen <b>eigenen kostenlosen Zugangsschlüssel</b> von
        <a href="https://rebrickable.com/api/" target="_blank" rel="noopener">rebrickable.com</a>. Der Schlüssel bleibt nur auf diesem Gerät – wir speichern keinen für dich.</p>
      <label>Dein Rebrickable-Zugangsschlüssel</label>
      <input id="key" type="password" autocomplete="off" placeholder="Schlüssel eintragen …" value="${esc(rebrickableKey())}">
      <button class="btn secondary block" id="saveKey" style="margin-top:.6rem">Speichern</button>
    </div>
    <div class="card">
      <label>Set-Nummer oder Name</label>
      <div class="row"><input id="q" style="flex:1" placeholder="z.B. 75192 oder Millennium Falcon"><button class="btn" id="go" style="background:#f9a825;color:#111">Suchen</button></div>
      <div id="res" style="margin-top:1rem"></div>
    </div>`;
  document.getElementById('saveKey').onclick = () => { localStorage.setItem('rebrickableKey', document.getElementById('key').value.trim()); toast('Schlüssel gespeichert (nur auf diesem Gerät).'); };
  document.getElementById('go').onclick = async () => {
    const key = document.getElementById('key').value.trim() || rebrickableKey();
    if (!key) return toast('Bitte zuerst den Zugangsschlüssel eintragen.');
    localStorage.setItem('rebrickableKey', key);
    const q = document.getElementById('q').value.trim(); if (!q) return;
    const res = document.getElementById('res'); res.innerHTML = '<p class="muted">Suche …</p>';
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&page_size=20`;
      const r = await fetch(url, { headers: { Authorization: 'key ' + key } });
      if (r.status === 401) throw new Error('Zugangsschlüssel ungültig. Bitte prüfen.');
      if (r.status === 429) throw new Error('Zu viele Anfragen – bitte kurz warten (ca. 1/Sekunde).');
      if (!r.ok) throw new Error('Rebrickable: HTTP ' + r.status);
      const data = await r.json();
      if (!data.results?.length) { res.innerHTML = '<p class="muted">Nichts gefunden. Du kannst Sets auch manuell anlegen.</p>'; return; }
      res.innerHTML = data.results.map(s => `<div class="card" style="margin:0 0 .5rem">
        <b>${esc(s.set_num)}</b> ${esc(s.name)} <span class="muted">${s.year || ''} · ${num(s.num_parts)} Teile</span>
        <button class="btn small" data-num="${esc(s.set_num)}" data-name="${esc(s.name)}" data-year="${s.year || ''}" data-parts="${s.num_parts || ''}">＋ Übernehmen</button>
      </div>`).join('');
      res.querySelectorAll('button[data-num]').forEach(b => b.onclick = async () => {
        const row = { set_nummer: b.dataset.num, name: b.dataset.name || null };
        const cands = await findSetCandidates(SETCFG.lego, art, row.set_nummer);
        if (cands.length) {
          const ans = await askDuplicate(SETCFG.lego, cands, row, { art });
          if (!ans) return;
          if (ans.a === 'open') { location.hash = '#l/set/' + ans.dup.id; return; }
          if (ans.a === 'update') { try { const u = await overwriteSet(SETCFG.lego, ans.dup, row); location.hash = '#l/set/' + u.id; } catch (e) { fail(e); } return; }
        }
        const { data: saved, error } = await sb.from('lego_sets').insert({
          ...row, art, jahr: b.dataset.year ? Number(b.dataset.year) : null,
          teile_anzahl: b.dataset.parts ? Number(b.dataset.parts) : null, user_id: owner(),
        }).select().single();
        if (error) return fail(error);
        lstate.sets = [...lstate.sets, saved].sort((a, c) => sortNat(a.set_nummer, c.set_nummer));
        toast('Set angelegt.'); location.hash = '#l/set/' + saved.id;
      });
    } catch (e) { res.innerHTML = ''; fail(e); }
  };
}
