// LEGO-Sammlung (analog Playmobil) + optionale Rebrickable-Suche
'use strict';

const lstate = { loaded: false, kisten: [], sets: [], teile: [], filter: { q: '', farbe: '', kiste: '', set: '' } };
const lkisteById = id => lstate.kisten.find(k => k.id === Number(id));
const lsetById = id => lstate.sets.find(s => s.id === Number(id));
const lkisteLabel = k => k ? `${k.art} ${k.nummer}${k.name ? ' – ' + k.name : ''}` : '';
const lsetLabel = s => s ? `${s.set_nummer}${s.name ? ' ' + s.name : ''}` : '';
const lteilSets = t => (t.lego_teil_sets || []).map(x => lsetById(x.set_id)).filter(Boolean);
const lteilTitle = t => t.beschreibung || (t.teile_nr ? 'Teil ' + t.teile_nr : 'Ohne Beschreibung');
const rebrickableKey = () => localStorage.getItem('rebrickableKey') || '';

async function loadLego() {
  const [k, s, t] = await Promise.all([
    sb.from('lego_kisten').select('*').eq('user_id', owner()),
    sb.from('lego_sets').select('*').eq('user_id', owner()),
    sb.from('lego_teile').select('*, lego_teil_sets(set_id)').eq('user_id', owner()).order('created_at', { ascending: false }),
  ]);
  for (const r of [k, s, t]) if (r.error) throw r.error;
  lstate.kisten = k.data.sort((a, b) => sortNat(a.nummer, b.nummer));
  lstate.sets = s.data.sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
  lstate.teile = t.data;
  lstate.loaded = true;
  await loadImageUrls(lstate.teile);
}

async function routeLego(view, id) {
  const tab = { teil: 'l/teile', kiste: 'l/kisten', set: 'l/sets', import: 'l/uebersicht', rebrickable: 'l/sets' }[view] || 'l/' + view;
  setMode('lego', tab);
  if (!lstate.loaded) {
    app.innerHTML = '<div class="center muted" style="padding:3rem">Lädt LEGO …</div>';
    try { await loadLego(); } catch (e) { fail(e); app.innerHTML = '<div class="card">Daten konnten nicht geladen werden.</div>'; return; }
  }
  const views = {
    teile: lTeile, teil: lTeil, kisten: lKisten, kiste: lKiste, sets: lSets, set: lSet,
    uebersicht: lStats, teilen: () => viewTeilen('lego'), import: () => viewImport('lego'), rebrickable: lRebrickable,
  };
  (views[view] || lTeile)(id);
}

function lMatches(t, f) {
  if (f.farbe && norm(t.farbe) !== norm(f.farbe)) return false;
  if (f.kiste && String(t.kiste_id) !== f.kiste && !(f.kiste === 'none' && !t.kiste_id)) return false;
  if (f.set && !(t.lego_teil_sets || []).some(x => String(x.set_id) === f.set)) return false;
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
      <select id="fSet"><option value="">Alle Sets</option>${lstate.sets.map(s => `<option value="${s.id}" ${String(s.id) === f.set ? 'selected' : ''}>${esc(lsetLabel(s))}</option>`).join('')}</select>
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
        <div class="sub">${t.teile_nr ? esc(t.teile_nr) + ' · ' : ''}${t.farbe ? dot(t.farbe) + ' ' + esc(t.farbe) : ''}${k ? ' · 📦 ' + esc(lkisteLabel(k)) : ''}</div>
        <div class="sub">${lteilSets(t).map(s => '🏰 ' + esc(lsetLabel(s))).join(' · ')}</div></div>
        <div class="right"><b>${num(t.anzahl)}×</b>${t.euro != null ? `<small>${euro(t.euro)}</small>` : ''}</div></a>`;
    }).join('') || (lstate.teile.length ? '<div class="card center muted">Nichts gefunden.</div>'
      : '<div class="card center"><p>Noch keine LEGO-Teile.</p><a class="btn" href="#l/teil/neu" style="background:#f9a825;color:#111">＋ Erstes Teil</a><div style="height:.5rem"></div><a class="btn secondary" href="#l/import">📥 Importieren</a></div>');
  };
  document.getElementById('q').oninput = e => { f.q = e.target.value; render(); };
  document.getElementById('fFarbe').onchange = e => { f.farbe = e.target.value; render(); };
  document.getElementById('fKiste').onchange = e => { f.kiste = e.target.value; render(); };
  document.getElementById('fSet').onchange = e => { f.set = e.target.value; render(); };
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
    const sets = lteilSets(t); const k = lkisteById(t.kiste_id); const u = imgUrl(t);
    app.innerHTML = `
      <a class="back" href="#l/teile">‹ Alle Teile</a>
      <div class="card">${u ? `<img class="photo" src="${esc(u)}" alt="">` : ''}<h1 style="margin-top:.4rem">${esc(lteilTitle(t))}</h1>
        <p>${t.teile_nr ? '<b>Nr.</b> ' + esc(t.teile_nr) + ' · ' : ''}${t.farbe ? dot(t.farbe) + ' ' + esc(t.farbe) : ''}</p>
        <p>${k ? '📦 <a href="#l/kiste/' + k.id + '">' + esc(lkisteLabel(k)) + '</a>' : 'Ohne Kiste'} · <b>${num(t.anzahl)}×</b>${t.euro != null ? ' · ' + euro(t.euro) : ''}</p>
        ${sets.length ? `<p>${sets.map(s => `<a class="badge" href="#l/set/${s.id}">🏰 ${esc(lsetLabel(s))}</a>`).join(' ')}</p>` : ''}
        ${t.notiz ? `<p class="muted">${esc(t.notiz)}</p>` : ''}
        <div class="row"><a class="btn grow" href="#l/teil/${t.id}:bearbeiten">✏️ Bearbeiten</a>
          <button class="btn danger grow" id="del">🗑️ Löschen</button></div></div>`;
    document.getElementById('del').onclick = async () => {
      if (!confirm('Teil löschen?')) return;
      if (t.bild_url) await sb.storage.from(BUCKET).remove([t.bild_url]);
      const { error } = await sb.from('lego_teile').delete().eq('id', t.id); if (error) return fail(error);
      lstate.teile = lstate.teile.filter(x => x.id !== t.id); toast('Gelöscht.'); location.hash = '#l/teile';
    };
    return;
  }
  t = t || { teile_nr: '', farbe: '', beschreibung: '', anzahl: 1, euro: null, kiste_id: null, notiz: '' };
  let file = null, chosenSets = (t.lego_teil_sets || []).map(x => x.set_id);
  const u = imgUrl(t);
  app.innerHTML = `
    <a class="back" href="${isNew ? '#l/teile' : '#l/teil/' + t.id}">‹ Zurück</a>
    <h1>${isNew ? 'Neues LEGO-Teil' : 'LEGO-Teil bearbeiten'}</h1>
    <form id="f" class="card">
      <div class="grid2"><div><label>Teile-Nr.</label><input id="nr" value="${esc(t.teile_nr)}"></div>
        <div><label>Farbe</label><input id="farbe" value="${esc(t.farbe)}"></div></div>
      <label>Beschreibung</label><input id="bes" value="${esc(t.beschreibung)}">
      <div class="grid2"><div><label>Anzahl</label><input id="anz" inputmode="numeric" value="${t.anzahl ?? 1}"></div>
        <div><label>Euro / Stück</label><input id="euro" inputmode="decimal" value="${t.euro ?? ''}"></div></div>
      <label>Kiste</label><div class="row"><select id="kiste" style="flex:1"></select><button type="button" class="btn small secondary" id="nk">＋</button></div>
      <label>Sets</label><div id="setTags" class="row" style="flex-wrap:wrap"></div><select id="addSet"></select>
      <label>Foto</label><img id="prev" class="photo-preview ${u ? '' : 'hidden'}" src="${esc(u || '')}">
      <div class="row"><label class="btn secondary grow">📷<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn secondary grow">🖼️<input id="gal" type="file" accept="image/*" hidden></label></div>
      <label>Notiz</label><textarea id="notiz">${esc(t.notiz)}</textarea>
      <div style="height:1rem"></div><button class="btn block" style="background:#f9a825;color:#111">💾 Speichern</button>
    </form>`;
  const kSel = document.getElementById('kiste'), sSel = document.getElementById('addSet');
  const fillK = sel => { kSel.innerHTML = '<option value="">– keine –</option>' + lstate.kisten.map(k => `<option value="${k.id}">${esc(lkisteLabel(k))}</option>`).join(''); kSel.value = sel ?? ''; };
  const fillS = () => { sSel.innerHTML = '<option value="">Set hinzufügen …</option>' + lstate.sets.filter(s => !chosenSets.includes(s.id)).map(s => `<option value="${s.id}">${esc(lsetLabel(s))}</option>`).join(''); };
  const renderTags = () => {
    document.getElementById('setTags').innerHTML = chosenSets.map(id => { const s = lsetById(id); return `<span class="badge">${esc(lsetLabel(s))} <button type="button" data-x="${id}">×</button></span>`; }).join('');
    document.getElementById('setTags').querySelectorAll('button').forEach(b => b.onclick = () => { chosenSets = chosenSets.filter(x => x !== Number(b.dataset.x)); renderTags(); fillS(); });
  };
  fillK(t.kiste_id); fillS(); renderTags();
  sSel.onchange = () => { if (sSel.value) { chosenSets.push(Number(sSel.value)); renderTags(); fillS(); } };
  document.getElementById('nk').onclick = async () => {
    const nummer = prompt('Kisten-Nummer:'); if (!nummer) return;
    const { data, error } = await sb.from('lego_kisten').insert({ nummer, art: 'Kiste', user_id: owner() }).select().single();
    if (error) return fail(error); lstate.kisten = [...lstate.kisten, data].sort((a, b) => sortNat(a.nummer, b.nummer)); fillK(data.id);
  };
  const onFile = e => { file = e.target.files[0]; if (file) { const p = document.getElementById('prev'); p.src = URL.createObjectURL(file); p.classList.remove('hidden'); } };
  document.getElementById('cam').onchange = onFile; document.getElementById('gal').onchange = onFile;
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try {
      const row = {
        teile_nr: document.getElementById('nr').value.trim() || null,
        farbe: document.getElementById('farbe').value.trim() || null,
        beschreibung: document.getElementById('bes').value.trim() || null,
        anzahl: Math.max(0, parseInt(document.getElementById('anz').value, 10) || 0),
        euro: parseDec(document.getElementById('euro').value),
        kiste_id: document.getElementById('kiste').value ? Number(document.getElementById('kiste').value) : null,
        notiz: document.getElementById('notiz').value.trim() || null,
      };
      if (!row.teile_nr && !row.beschreibung && !file) throw new Error('Bitte Nr., Beschreibung oder Foto angeben.');
      let oldPath = t.bild_url;
      if (file) {
        const blob = file; const path = `${owner()}/lego/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' });
        if (up.error) throw up.error; row.bild_url = path;
      }
      const r = isNew ? await sb.from('lego_teile').insert({ ...row, user_id: owner() }).select().single()
        : await sb.from('lego_teile').update(row).eq('id', t.id).select().single();
      if (r.error) throw r.error;
      if (file && oldPath) await sb.storage.from(BUCKET).remove([oldPath]);
      await sb.from('lego_teil_sets').delete().eq('teil_id', r.data.id);
      if (chosenSets.length) await sb.from('lego_teil_sets').insert(chosenSets.map(set_id => ({ teil_id: r.data.id, set_id, user_id: owner() })));
      const { data: full } = await sb.from('lego_teile').select('*, lego_teil_sets(set_id)').eq('id', r.data.id).single();
      if (full?.bild_url) await loadImageUrls([full]);
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
  document.getElementById('nk').onclick = async () => {
    const nummer = prompt('Nummer der neuen Kiste:'); if (!nummer) return;
    const { data, error } = await sb.from('lego_kisten').insert({ nummer, art: 'Kiste', user_id: owner() }).select().single();
    if (error) return fail(error); lstate.kisten = [...lstate.kisten, data].sort((a, b) => sortNat(a.nummer, b.nummer)); location.hash = '#l/kiste/' + data.id;
  };
}
function lKiste(id) {
  const k = lkisteById(id);
  if (!k) { app.innerHTML = '<div class="card">Kiste nicht gefunden. <a href="#l/kisten">Alle</a></div>'; return; }
  const teile = lstate.teile.filter(t => t.kiste_id === k.id);
  app.innerHTML = `<a class="back" href="#l/kisten">‹ Alle Kisten</a>
    <div class="card"><h1>📦 ${esc(lkisteLabel(k))}</h1>
      <p class="muted">${k.ort ? '📍 ' + esc(k.ort) : ''} · ${num(teile.length)} Teile</p>
      <div class="row"><button class="btn small secondary" id="ek">✏️</button><button class="btn small danger" id="dk">🗑️</button></div></div>
    <div class="list">${teile.map(t => `<a class="card item" href="#l/teil/${t.id}">${thumb(t)}<div class="info"><div class="title">${esc(lteilTitle(t))}</div>
      <div class="sub">${t.teile_nr || ''} ${t.farbe ? '· ' + esc(t.farbe) : ''}</div></div><div class="right"><b>${num(t.anzahl)}×</b></div></a>`).join('') || '<div class="card center muted">Leer.</div>'}</div>
    <a class="fab" href="#l/teil/neu" style="background:#f9a825;color:#111">＋</a>`;
  document.getElementById('ek').onclick = async () => {
    const name = prompt('Name', k.name || ''); if (name == null) return;
    const ort = prompt('Ort', k.ort || ''); if (ort == null) return;
    const { data, error } = await sb.from('lego_kisten').update({ name: name || null, ort: ort || null }).eq('id', k.id).select().single();
    if (error) return fail(error); Object.assign(k, data); lKiste(id);
  };
  document.getElementById('dk').onclick = async () => {
    if (teile.length) return toast('Kiste ist nicht leer.');
    if (!confirm('Leere Kiste löschen?')) return;
    const { error } = await sb.from('lego_kisten').delete().eq('id', k.id); if (error) return fail(error);
    lstate.kisten = lstate.kisten.filter(x => x.id !== k.id); location.hash = '#l/kisten';
  };
}
function lSets() {
  app.innerHTML = `<h1>🏰 LEGO-Sets</h1>
    <p><a class="btn secondary small" href="#l/rebrickable">🔎 Set bei Rebrickable suchen</a></p>
    <div class="list">${lstate.sets.map(s => {
      const n = lstate.teile.filter(t => (t.lego_teil_sets || []).some(x => x.set_id === s.id)).length;
      return `<a class="card item" href="#l/set/${s.id}"><div class="info"><div class="title">${esc(lsetLabel(s))}</div>
        <div class="sub">${s.jahr ? s.jahr + ' · ' : ''}${s.teile_anzahl ? num(s.teile_anzahl) + ' Teile (offiziell)' : ''}</div></div>
        <div class="right"><b>${num(n)}</b><small>bei dir</small></div></a>`;
    }).join('') || '<div class="card center muted">Noch keine Sets. <a href="#l/rebrickable">Via Rebrickable anlegen</a> oder manuell.</div>'}
    </div><button class="fab" id="ns" style="background:#f9a825;color:#111">＋</button>`;
  document.getElementById('ns').onclick = async () => {
    const set_nummer = prompt('Set-Nummer (z.B. 75192):'); if (!set_nummer) return;
    const name = prompt('Name (optional):') || null;
    const { data, error } = await sb.from('lego_sets').insert({ set_nummer, name, user_id: owner() }).select().single();
    if (error) return fail(error); lstate.sets = [...lstate.sets, data].sort((a, b) => sortNat(a.set_nummer, b.set_nummer)); location.hash = '#l/set/' + data.id;
  };
}
function lSet(id) {
  const s = lsetById(id);
  if (!s) { app.innerHTML = '<div class="card">Set nicht gefunden.</div>'; return; }
  const teile = lstate.teile.filter(t => (t.lego_teil_sets || []).some(x => x.set_id === s.id));
  app.innerHTML = `<a class="back" href="#l/sets">‹ Alle Sets</a>
    <div class="card"><h1>🏰 ${esc(lsetLabel(s))}</h1>
      <p class="muted">${s.jahr || ''}${s.teile_anzahl ? ' · ' + num(s.teile_anzahl) + ' Teile offiziell' : ''}</p>
      <div class="row"><button class="btn small secondary" id="es">✏️</button><button class="btn small danger" id="ds">🗑️</button></div></div>
    <div class="list">${teile.map(t => `<a class="card item" href="#l/teil/${t.id}">${thumb(t)}<div class="info"><div class="title">${esc(lteilTitle(t))}</div></div><div class="right"><b>${num(t.anzahl)}×</b></div></a>`).join('') || '<div class="card center muted">Keine Teile verknüpft.</div>'}</div>`;
  document.getElementById('es').onclick = async () => {
    const name = prompt('Name', s.name || ''); if (name == null) return;
    const { data, error } = await sb.from('lego_sets').update({ name: name || null }).eq('id', s.id).select().single();
    if (error) return fail(error); Object.assign(s, data); lSet(id);
  };
  document.getElementById('ds').onclick = async () => {
    if (!confirm('Set löschen (Teile bleiben)?')) return;
    const { error } = await sb.from('lego_sets').delete().eq('id', s.id); if (error) return fail(error);
    lstate.sets = lstate.sets.filter(x => x.id !== s.id); location.hash = '#l/sets';
  };
}
function lStats() {
  const st = lstate.teile.reduce((s, t) => s + (t.anzahl || 0), 0);
  const wert = lstate.teile.reduce((s, t) => s + (Number(t.euro) || 0) * (t.anzahl || 0), 0);
  app.innerHTML = `<h1>📊 LEGO-Übersicht</h1>
    <div class="stats"><div class="stat"><b>${num(lstate.teile.length)}</b>Teile-Arten</div>
      <div class="stat"><b>${num(st)}</b>Stück</div>
      <div class="stat"><b>${num(lstate.kisten.length)}</b>Kisten</div>
      <div class="stat"><b>${num(lstate.sets.length)}</b>Sets</div>
      <div class="stat"><b>${euro(wert)}</b>Wert</div></div>
    <div class="card"><a class="btn block secondary" href="#l/import">📥 Excel/CSV importieren</a>
      <div style="height:.5rem"></div>
      <button class="btn block secondary" id="exp">📤 CSV exportieren</button>
      <div style="height:.5rem"></div>
      <a class="btn block secondary" href="#l/rebrickable">🔑 Rebrickable-Einstellungen</a></div>`;
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

async function lRebrickable() {
  app.innerHTML = `
    <a class="back" href="#l/sets">‹ Sets</a>
    <h1>🔎 Rebrickable</h1>
    <div class="card">
      <p class="muted" style="margin-top:0">Set-Suche über die öffentliche Rebrickable-API. Du brauchst einen <b>eigenen API-Key</b> (kostenlos unter
        <a href="https://rebrickable.com/api/" target="_blank" rel="noopener">rebrickable.com/api</a>). Der Key wird nur in diesem Browser gespeichert – wir legen keinen Key für dich an.</p>
      <label>Dein Rebrickable API-Key</label>
      <input id="key" type="password" autocomplete="off" placeholder="key …" value="${esc(rebrickableKey())}">
      <button class="btn secondary block" id="saveKey" style="margin-top:.6rem">Speichern</button>
    </div>
    <div class="card">
      <label>Set-Nummer oder Name</label>
      <div class="row"><input id="q" style="flex:1" placeholder="z.B. 75192 oder Millennium Falcon"><button class="btn" id="go" style="background:#f9a825;color:#111">Suchen</button></div>
      <div id="res" style="margin-top:1rem"></div>
    </div>`;
  document.getElementById('saveKey').onclick = () => { localStorage.setItem('rebrickableKey', document.getElementById('key').value.trim()); toast('Key gespeichert (nur lokal).'); };
  document.getElementById('go').onclick = async () => {
    const key = document.getElementById('key').value.trim() || rebrickableKey();
    if (!key) return toast('Bitte zuerst einen API-Key eintragen.');
    localStorage.setItem('rebrickableKey', key);
    const q = document.getElementById('q').value.trim(); if (!q) return;
    const res = document.getElementById('res'); res.innerHTML = '<p class="muted">Suche …</p>';
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&page_size=20`;
      const r = await fetch(url, { headers: { Authorization: 'key ' + key } });
      if (r.status === 401) throw new Error('API-Key ungültig.');
      if (r.status === 429) throw new Error('Zu viele Anfragen – bitte kurz warten (ca. 1/Sekunde).');
      if (!r.ok) throw new Error('Rebrickable: HTTP ' + r.status);
      const data = await r.json();
      if (!data.results?.length) { res.innerHTML = '<p class="muted">Nichts gefunden. Du kannst Sets auch manuell anlegen.</p>'; return; }
      res.innerHTML = data.results.map(s => `<div class="card" style="margin:0 0 .5rem">
        <b>${esc(s.set_num)}</b> ${esc(s.name)} <span class="muted">${s.year || ''} · ${num(s.num_parts)} Teile</span>
        <button class="btn small" data-num="${esc(s.set_num)}" data-name="${esc(s.name)}" data-year="${s.year || ''}" data-parts="${s.num_parts || ''}">＋ Übernehmen</button>
      </div>`).join('');
      res.querySelectorAll('button[data-num]').forEach(b => b.onclick = async () => {
        const existing = lstate.sets.find(x => String(x.set_nummer) === b.dataset.num);
        if (existing) { toast('Set gibt es schon.'); location.hash = '#l/set/' + existing.id; return; }
        const { data: saved, error } = await sb.from('lego_sets').insert({
          set_nummer: b.dataset.num, name: b.dataset.name, jahr: b.dataset.year ? Number(b.dataset.year) : null,
          teile_anzahl: b.dataset.parts ? Number(b.dataset.parts) : null, user_id: owner(),
        }).select().single();
        if (error) return fail(error);
        lstate.sets = [...lstate.sets, saved].sort((a, c) => sortNat(a.set_nummer, c.set_nummer));
        toast('Set angelegt.'); location.hash = '#l/set/' + saved.id;
      });
    } catch (e) { res.innerHTML = ''; fail(e); }
  };
}
