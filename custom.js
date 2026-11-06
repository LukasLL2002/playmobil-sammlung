// Eigene Bereiche (custom_bereiche / felder / orte / eintraege)
'use strict';

const cstate = { loaded: false, bereiche: [], felder: [], orte: [], eintraege: [], filter: {} };

async function loadCustom() {
  const [b, f, o, e] = await Promise.all([
    sb.from('custom_bereiche').select('*').eq('user_id', owner()).order('created_at'),
    sb.from('custom_felder').select('*').eq('user_id', owner()).order('sort'),
    sb.from('custom_orte').select('*').eq('user_id', owner()),
    sb.from('custom_eintraege').select('*').eq('user_id', owner()).order('created_at', { ascending: false }),
  ]);
  for (const r of [b, f, o, e]) if (r.error) throw r.error;
  cstate.bereiche = b.data; cstate.felder = f.data; cstate.orte = o.data; cstate.eintraege = e.data;
  cstate.loaded = true;
  await loadImageUrls(cstate.eintraege);
}

async function ensureCustom() {
  if (!cstate.loaded) {
    try { await loadCustom(); } catch (e) { fail(e); throw e; }
  }
}

function refreshModebarCustom() {
  const bar = document.getElementById('modebar');
  bar.querySelectorAll('a[data-mode^="c"]').forEach(a => a.remove());
  const admin = bar.querySelector('a[data-mode="admin"]');
  (cstate.bereiche || []).forEach(b => {
    const a = document.createElement('a');
    a.href = '#c/' + b.id; a.dataset.mode = 'c' + b.id;
    a.innerHTML = `${esc(b.icon)} <span class="lbl">${esc(b.name)}</span>`;
    a.style.setProperty('--c', b.farbe || '#1565c0');
    bar.insertBefore(a, admin);
  });
  // Plus zum Anlegen
  if (!bar.querySelector('#newBereich')) {
    const plus = document.createElement('a');
    plus.href = '#bereiche'; plus.id = 'newBereich'; plus.title = 'Eigenen Bereich anlegen';
    plus.textContent = '＋'; plus.style.minWidth = '2.2rem';
    bar.insertBefore(plus, admin);
  }
}

async function routeCustom(parts) {
  await ensureCustom();
  refreshModebarCustom();
  if (!parts[1] || parts[0] === 'bereiche') return viewBereichVerwaltung();
  const bid = parts[1];
  const b = cstate.bereiche.find(x => x.id === bid);
  if (!b) { app.innerHTML = '<div class="card">Bereich nicht gefunden. <a href="#bereiche">Verwalten</a></div>'; return; }
  const view = parts[2] || 'liste';
  const id = parts[3];
  setMode('c' + bid, 'c/' + bid + (view === 'liste' ? '' : '/' + view));
  document.body.style.setProperty('--accent', b.farbe || '#1565c0');
  document.getElementById('brand').textContent = `${b.icon} ${b.name}`;
  document.getElementById('brand').href = '#c/' + bid;
  const tabs = [
    [`c/${bid}`, '🔍', 'Liste'],
    [`c/${bid}/orte`, '🗄️', 'Orte'],
    [`c/${bid}/felder`, '⚙️', 'Felder'],
    [`c/${bid}/import`, '📥', 'Import'],
    [`c/${bid}/teilen`, '👥', 'Teilen'],
  ];
  const nav = document.getElementById('tabbar');
  const pend = pendingCount();
  nav.innerHTML = tabs.map(([h, i, l]) => {
    const active = (view === 'liste' && h === `c/${bid}`) || h.endsWith('/' + view);
    return `<a href="#${h}" class="${active ? 'active' : ''}"><span>${i}${h.endsWith('teilen') && pend ? `<b class="tabbadge">${pend}</b>` : ''}</span>${l}</a>`;
  }).join('');
  renderChrome('c' + bid);
  if (view === 'orte') return cOrte(b);
  if (view === 'felder') return cFelder(b);
  if (view === 'import') return viewImport('custom', bid);
  if (view === 'teilen') return viewTeilen('c:' + bid);
  if (view === 'eintrag') return cForm(b, id);
  return cListe(b);
}

function viewBereichVerwaltung() {
  setMode('pm', '');
  document.getElementById('brand').textContent = '📁 Eigene Bereiche';
  app.innerHTML = `<h1>📁 Eigene Bereiche</h1>
    <p class="muted">Lege weitere Sammlungen oder Inventare an (z.B. Briefmarken, Werkzeug, Bücher).</p>
    <div class="list">${cstate.bereiche.map(b => `<div class="card" style="margin:0;border-left:4px solid ${esc(b.farbe)}">
      <b>${esc(b.icon)} ${esc(b.name)}</b> <span class="badge">${b.vorlage === 'inventar' ? 'Inventar' : 'Sammlung'}</span>
      <div class="row" style="margin-top:.5rem">
        <a class="btn small" href="#c/${b.id}">Öffnen</a>
        <button class="btn small secondary" data-e="${b.id}">✏️</button>
        <button class="btn small danger" data-d="${b.id}">🗑️</button>
      </div></div>`).join('') || '<div class="card center muted">Noch keine eigenen Bereiche.</div>'}
    </div>
    <div class="card"><h2>Neu anlegen</h2>
      <form id="nb">
        <label>Name</label><input name="name" required placeholder="z.B. Briefmarken">
        <div class="grid2"><div><label>Icon (Emoji)</label><input name="icon" value="📁" maxlength="4"></div>
          <div><label>Farbe</label><input name="farbe" type="color" value="#1565c0"></div></div>
        <label>Vorlage</label><select name="vorlage"><option value="sammlung">Sammlung (Teile/Objekte)</option><option value="inventar">Inventar (mit Beständen)</option></select>
        <div style="height:.8rem"></div><button class="btn block">＋ Anlegen</button>
      </form></div>`;
  document.getElementById('nb').onsubmit = async e => {
    e.preventDefault();
    const v = formVals(e.target, ['name', 'icon', 'farbe', 'vorlage']);
    const { data, error } = await sb.from('custom_bereiche').insert({ ...v, icon: v.icon || '📁', user_id: owner() }).select().single();
    if (error) return fail(error);
    // Standardfelder
    const defs = v.vorlage === 'inventar'
      ? [['menge', 'Menge', 'number'], ['einheit', 'Einheit', 'text'], ['preis', 'Preis', 'euro']]
      : [['nummer', 'Nummer', 'text'], ['farbe', 'Farbe', 'text'], ['wert', 'Wert', 'euro']];
    await sb.from('custom_felder').insert(defs.map(([schluessel, label, typ], i) => ({ bereich_id: data.id, user_id: owner(), schluessel, label, typ, sort: i })));
    cstate.bereiche.push(data); cstate.loaded = false; await loadCustom(); refreshModebarCustom();
    toast('Bereich angelegt.'); location.hash = '#c/' + data.id;
  };
  app.querySelectorAll('[data-e]').forEach(btn => btn.onclick = async () => {
    const b = cstate.bereiche.find(x => x.id === btn.dataset.e);
    const name = prompt('Name', b.name); if (name == null) return;
    const icon = prompt('Icon', b.icon); if (icon == null) return;
    const { data, error } = await sb.from('custom_bereiche').update({ name, icon }).eq('id', b.id).select().single();
    if (error) return fail(error); Object.assign(b, data); viewBereichVerwaltung();
  });
  app.querySelectorAll('[data-d]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Bereich inkl. aller Einträge unwiderruflich löschen?')) return;
    const { error } = await sb.from('custom_bereiche').delete().eq('id', btn.dataset.d);
    if (error) return fail(error);
    cstate.bereiche = cstate.bereiche.filter(x => x.id !== btn.dataset.d);
    cstate.eintraege = cstate.eintraege.filter(x => x.bereich_id !== btn.dataset.d);
    refreshModebarCustom(); viewBereichVerwaltung();
  });
}

function cListe(b) {
  const felder = cstate.felder.filter(f => f.bereich_id === b.id);
  const orte = cstate.orte.filter(o => o.bereich_id === b.id);
  const items = cstate.eintraege.filter(e => e.bereich_id === b.id);
  const f = cstate.filter[b.id] || (cstate.filter[b.id] = { q: '', ort: '' });
  app.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="${esc(b.name)} durchsuchen …" value="${esc(f.q)}"></div>
    <div class="filters"><select id="fOrt"><option value="">Alle Orte</option><option value="none" ${f.ort === 'none' ? 'selected' : ''}>Ohne Ort</option>
      ${orte.map(o => `<option value="${o.id}" ${String(o.id) === f.ort ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>
    <div id="count" class="muted" style="margin-bottom:.5rem"></div>
    <div id="list" class="list"></div>
    <a class="fab" href="#c/${b.id}/eintrag/neu" title="Neu" style="background:${esc(b.farbe)}">＋</a>`;
  const list = document.getElementById('list');
  const render = () => {
    const res = items.filter(it => {
      if (f.ort && String(it.ort_id) !== f.ort && !(f.ort === 'none' && !it.ort_id)) return false;
      if (!f.q) return true;
      const o = orte.find(x => x.id === it.ort_id);
      const hay = norm([it.name, it.notiz, o?.name, ...Object.values(it.data || {})].join(' '));
      return norm(f.q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
    });
    document.getElementById('count').textContent = `${num(res.length)} von ${num(items.length)}`;
    list.innerHTML = res.map(it => {
      const o = orte.find(x => x.id === it.ort_id);
      const euroF = felder.find(fd => fd.typ === 'euro');
      const unit = euroF ? parseFloat(String((it.data || {})[euroF.schluessel] ?? '').replace(',', '.')) : null;
      const unitOk = unit != null && !isNaN(unit);
      const sub = felder.filter(fd => fd.typ !== 'euro').slice(0, 3).map(fd => { const v = (it.data || {})[fd.schluessel]; return v ? esc(fd.label) + ': ' + esc(v) : ''; }).filter(Boolean).join(' · ');
      return `<a class="card item" href="#c/${b.id}/eintrag/${it.id}">${imgUrl(it) ? thumb(it) : `<div class="thumb">${esc(b.icon)}</div>`}
        <div class="info"><div class="title">${esc(it.name)}</div>
        <div class="sub">${o ? '📍 ' + esc(o.name) + (sub ? ' · ' : '') : ''}${sub}</div>
        ${unitOk ? `<div class="sub price">${esc(priceLine(unit, it.anzahl))}</div>` : ''}</div>
        <div class="right"><b>${dec(it.anzahl)}</b></div></a>`;
    }).join('') || (items.length ? '<div class="card center muted">Nichts gefunden.</div>'
      : `<div class="card center"><p>Noch keine Einträge.</p><a class="btn" href="#c/${b.id}/eintrag/neu" style="background:${esc(b.farbe)}">＋ Ersten anlegen</a></div>`);
  };
  document.getElementById('q').oninput = e => { f.q = e.target.value; render(); };
  document.getElementById('fOrt').onchange = e => { f.ort = e.target.value; render(); };
  render();
}

function cForm(b, id) {
  const isNew = !id || id.startsWith('neu');
  const felder = cstate.felder.filter(f => f.bereich_id === b.id);
  const orte = cstate.orte.filter(o => o.bereich_id === b.id);
  let it = isNew ? null : cstate.eintraege.find(x => x.id === Number(id));
  if (!isNew && !it) { app.innerHTML = `<div class="card">Nicht gefunden. <a href="#c/${b.id}">Zurück</a></div>`; return; }
  it = it || { name: '', anzahl: 1, ort_id: null, data: {}, notiz: '' };
  let file = null; const u = imgUrl(it);
  app.innerHTML = `
    <a class="back" href="#c/${b.id}">‹ Zurück</a>
    <h1>${isNew ? 'Neu' : 'Bearbeiten'}</h1>
    <form id="f" class="card">
      <label>Name</label><input id="name" required value="${esc(it.name)}">
      <div class="grid2"><div><label>Anzahl</label><input id="anz" inputmode="decimal" value="${String(it.anzahl).replace('.', ',')}"></div>
        <div><label>Ort</label><select id="ort"><option value="">– keiner –</option>${orte.map(o => `<option value="${o.id}" ${o.id === it.ort_id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div></div>
      ${felder.map(fd => {
        const v = (it.data || {})[fd.schluessel] ?? '';
        if (fd.typ === 'select') {
          const opts = (fd.optionen || []);
          return `<label>${esc(fd.label)}${fd.pflicht ? ' *' : ''}</label><select data-fk="${esc(fd.schluessel)}"><option value="">–</option>${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        }
        const type = fd.typ === 'date' ? 'date' : fd.typ === 'number' || fd.typ === 'euro' ? 'text' : 'text';
        const mode = fd.typ === 'number' || fd.typ === 'euro' ? ' inputmode="decimal"' : '';
        return `<label>${esc(fd.label)}${fd.pflicht ? ' *' : ''}</label><input data-fk="${esc(fd.schluessel)}" type="${type}"${mode} value="${esc(v)}">`;
      }).join('')}
      <label>Foto</label><img id="prev" class="photo-preview ${u ? '' : 'hidden'}" src="${esc(u || '')}">
      <div class="row"><label class="btn secondary grow">📷<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn secondary grow">🖼️<input id="gal" type="file" accept="image/*" hidden></label></div>
      <label>Notiz</label><textarea id="notiz">${esc(it.notiz)}</textarea>
      <div style="height:1rem"></div><button class="btn block" style="background:${esc(b.farbe)}">💾 Speichern</button>
      ${isNew ? '' : '<div style="height:.5rem"></div><button class="btn danger block" type="button" id="del">🗑️ Löschen</button>'}
    </form>`;
  const onFile = e => { file = e.target.files[0]; if (file) { const p = document.getElementById('prev'); p.src = URL.createObjectURL(file); p.classList.remove('hidden'); } };
  document.getElementById('cam').onchange = onFile; document.getElementById('gal').onchange = onFile;
  const euroFields = [...app.querySelectorAll('[data-fk]')].filter(el => {
    const fd = felder.find(f => f.schluessel === el.dataset.fk); return fd && fd.typ === 'euro';
  });
  if (euroFields.length) {
    let prev = document.getElementById('cPreisPrev');
    if (!prev) { prev = document.createElement('div'); prev.id = 'cPreisPrev'; prev.className = 'muted'; prev.style.cssText = 'font-size:.85rem;margin:.4rem 0'; document.getElementById('anz').after(prev); }
    const upd = () => {
      const fd = felder.find(f => f.typ === 'euro');
      const el = app.querySelector(`[data-fk="${fd.schluessel}"]`);
      const u = el ? parseFloat(String(el.value).replace(',', '.')) : null;
      const q = parseDec(document.getElementById('anz').value) ?? 0;
      prev.textContent = u != null && !isNaN(u) ? priceLine(u, q) : '';
    };
    euroFields.forEach(el => el.oninput = upd);
    document.getElementById('anz').oninput = upd; upd();
  }
  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    if (!confirm('Löschen?')) return;
    if (it.bild_url) await sb.storage.from(BUCKET).remove([it.bild_url]);
    const { error } = await sb.from('custom_eintraege').delete().eq('id', it.id); if (error) return fail(error);
    cstate.eintraege = cstate.eintraege.filter(x => x.id !== it.id); location.hash = '#c/' + b.id;
  };
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault();
    try {
      const data = {};
      app.querySelectorAll('[data-fk]').forEach(el => { const v = el.value.trim(); if (v) data[el.dataset.fk] = v; });
      const row = {
        name: document.getElementById('name').value.trim(),
        anzahl: parseDec(document.getElementById('anz').value) ?? 1,
        ort_id: document.getElementById('ort').value ? Number(document.getElementById('ort').value) : null,
        data, notiz: document.getElementById('notiz').value.trim() || null,
      };
      if (file) {
        const path = `${owner()}/custom/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' });
        if (up.error) throw up.error; row.bild_url = path;
        if (it.bild_url) await sb.storage.from(BUCKET).remove([it.bild_url]);
      }
      const r = isNew
        ? await sb.from('custom_eintraege').insert({ ...row, bereich_id: b.id, user_id: owner() }).select().single()
        : await sb.from('custom_eintraege').update(row).eq('id', it.id).select().single();
      if (r.error) throw r.error;
      if (r.data.bild_url) await loadImageUrls([r.data]);
      cstate.eintraege = isNew ? [r.data, ...cstate.eintraege] : cstate.eintraege.map(x => x.id === r.data.id ? r.data : x);
      toast('Gespeichert.'); location.hash = '#c/' + b.id;
    } catch (err) { fail(err); }
  };
}

function cOrte(b) {
  const orte = cstate.orte.filter(o => o.bereich_id === b.id);
  app.innerHTML = `<h1>🗄️ Orte</h1>
    <div class="list">${orte.map(o => {
      const n = cstate.eintraege.filter(e => e.ort_id === o.id).length;
      return `<div class="card" style="margin:0"><b>${esc(o.name)}</b> <span class="badge">${num(n)}</span>
        <button class="btn small danger" data-d="${o.id}" ${n ? 'disabled' : ''}>🗑️</button></div>`;
    }).join('') || '<div class="card center muted">Keine Orte.</div>'}
    </div><button class="fab" id="no" style="background:${esc(b.farbe)}">＋</button>`;
  document.getElementById('no').onclick = async () => {
    const name = prompt('Ort-Name:'); if (!name) return;
    const { data, error } = await sb.from('custom_orte').insert({ bereich_id: b.id, name, user_id: owner() }).select().single();
    if (error) return fail(error); cstate.orte.push(data); cOrte(b);
  };
  app.querySelectorAll('[data-d]').forEach(btn => btn.onclick = async () => {
    const { error } = await sb.from('custom_orte').delete().eq('id', btn.dataset.d); if (error) return fail(error);
    cstate.orte = cstate.orte.filter(x => x.id !== Number(btn.dataset.d)); cOrte(b);
  });
}

function cFelder(b) {
  const felder = cstate.felder.filter(f => f.bereich_id === b.id).sort((a, c) => a.sort - c.sort);
  app.innerHTML = `<h1>⚙️ Felder</h1>
    <p class="muted">Eigene Spalten für Einträge in „${esc(b.name)}“.</p>
    <div class="list">${felder.map(f => `<div class="card" style="margin:0">
      <b>${esc(f.label)}</b> <span class="badge">${esc(f.typ)}</span> <code>${esc(f.schluessel)}</code>
      <button class="btn small danger" data-d="${f.id}">🗑️</button></div>`).join('') || '<div class="card center muted">Keine Felder.</div>'}
    </div>
    <form class="card" id="nf"><h2>Feld hinzufügen</h2>
      <label>Beschriftung</label><input name="label" required>
      <label>Schlüssel (technisch)</label><input name="schluessel" required pattern="[a-z0-9_]+" placeholder="z.b. groesse">
      <label>Typ</label><select name="typ"><option value="text">Text</option><option value="number">Zahl</option><option value="euro">Euro</option><option value="date">Datum</option><option value="select">Auswahl</option></select>
      <label>Optionen (bei Auswahl, komma-getrennt)</label><input name="optionen" placeholder="A, B, C">
      <div style="height:.6rem"></div><button class="btn block">＋ Feld</button></form>`;
  document.getElementById('nf').onsubmit = async e => {
    e.preventDefault();
    const v = formVals(e.target, ['label', 'schluessel', 'typ', 'optionen']);
    const optionen = v.typ === 'select' ? (v.optionen || '').split(',').map(s => s.trim()).filter(Boolean) : [];
    const { data, error } = await sb.from('custom_felder').insert({
      bereich_id: b.id, user_id: owner(), label: v.label, schluessel: v.schluessel, typ: v.typ, optionen, sort: felder.length,
    }).select().single();
    if (error) return fail(error); cstate.felder.push(data); cFelder(b);
  };
  app.querySelectorAll('[data-d]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Feld entfernen? Bestehende Werte in Einträgen bleiben im JSON, werden aber nicht mehr angezeigt.')) return;
    const { error } = await sb.from('custom_felder').delete().eq('id', btn.dataset.d); if (error) return fail(error);
    cstate.felder = cstate.felder.filter(x => x.id !== Number(btn.dataset.d)); cFelder(b);
  });
}
