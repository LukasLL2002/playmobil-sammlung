
async function ensureXLSX() {
  if (window.XLSX) return;
  if (typeof loadScript === 'function') {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  } else {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = resolve; s.onerror = () => reject(new Error('Tabellen-Datei konnte nicht geladen werden.'));
      document.head.appendChild(s);
    });
  }
  if (!window.XLSX) throw new Error('Tabellen-Funktion ist gerade nicht verfügbar.');
}

// Excel/CSV-Import (SheetJS) – Playmobil, Vorrat, LEGO, Custom
'use strict';

const IMPORT_TEMPLATES = {
  playmobil: {
    title: 'Playmobil-Teile',
    headers: ['teile_nr', 'farbe', 'beschreibung', 'anzahl', 'euro', 'kiste_nummer', 'kiste_art', 'set_nummern', 'notiz'],
    sample: [['30012340', 'rot', 'Ritterhelm', '3', '1,50', '1', 'Kiste', '3666', ''], ['3001', 'blau', 'Schwert', '1', '', '2', 'Tüte', '', '']],
    mapHints: { teile_nr: ['teile_nr', 'teilenummer', 'teil nr', 'part', 'nummer'], farbe: ['farbe', 'color'], beschreibung: ['beschreibung', 'name', 'titel'], anzahl: ['anzahl', 'menge', 'qty', 'stück'], euro: ['euro', 'preis', 'price'], kiste_nummer: ['kiste', 'kiste_nummer', 'box'], kiste_art: ['kiste_art', 'art'], set_nummern: ['set', 'sets', 'set_nummern', 'set_nummer'], notiz: ['notiz', 'note', 'bemerkung'] },
  },
  vorrat: {
    title: 'Vorratsartikel',
    headers: ['name', 'kategorie', 'menge', 'einheit', 'mindestbestand', 'mhd', 'preis', 'ort', 'barcode', 'notiz'],
    sample: [['Tomaten gehackt', 'Konserven', '2', 'Dose', '4', '2027-06-01', '0,89', 'Regal 2', '', ''], ['Spaghetti', 'Nudeln', '5', 'Packung', '2', '', '1,20', 'Regal 2', '', '']],
    mapHints: { name: ['name', 'artikel', 'produkt'], kategorie: ['kategorie', 'kat', 'category'], menge: ['menge', 'anzahl', 'qty'], einheit: ['einheit', 'unit'], mindestbestand: ['mindestbestand', 'min', 'mindest'], mhd: ['mhd', 'haltbar', 'ablauf', 'expiry'], preis: ['preis', 'euro', 'price'], ort: ['ort', 'lagerort', 'location'], barcode: ['barcode', 'ean'], notiz: ['notiz', 'note'] },
  },
  lego: {
    title: 'LEGO-Teile',
    headers: ['teile_nr', 'farbe', 'beschreibung', 'anzahl', 'euro', 'kiste_nummer', 'kiste_art', 'set_nummern', 'notiz'],
    sample: [['3001', 'Red', 'Brick 2x4', '10', '', '1', 'Kiste', '75192', ''], ['3024', 'Blue', 'Plate 1x1', '20', '', '1', 'Kiste', '', '']],
    mapHints: { teile_nr: ['teile_nr', 'part', 'part_num', 'element'], farbe: ['farbe', 'color', 'colour'], beschreibung: ['beschreibung', 'name'], anzahl: ['anzahl', 'qty', 'quantity'], euro: ['euro', 'preis'], kiste_nummer: ['kiste', 'box'], kiste_art: ['kiste_art', 'art'], set_nummern: ['set', 'sets', 'set_num'], notiz: ['notiz', 'note'] },
  },
};

async function downloadTemplate(kind) {
  const t = IMPORT_TEMPLATES[kind]; if (!t) return;
  await ensureXLSX();
  const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.sample]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Vorlage');
  XLSX.writeFile(wb, `vorlage-${kind}.xlsx`);
}

function guessMap(headers, hints) {
  const map = {};
  const lower = headers.map(h => norm(h));
  for (const [field, aliases] of Object.entries(hints)) {
    let idx = -1;
    for (const a of aliases) { idx = lower.findIndex(h => h === norm(a) || h.includes(norm(a))); if (idx >= 0) break; }
    map[field] = idx;
  }
  return map;
}

async function parseImportFile(file) {
  await ensureXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!rows.length) throw new Error('Die Datei enthält keine Zeilen.');
  const headers = rows[0].map(h => String(h ?? '').trim());
  const data = rows.slice(1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  return { headers, data };
}

function cell(row, idx) { return idx >= 0 && idx < row.length ? String(row[idx] ?? '').trim() : ''; }
function cellNum(row, idx) {
  const v = cell(row, idx); if (!v) return null;
  const n = Number(String(v).replace(/\s|€/g, '').replace(',', '.')); return isNaN(n) ? null : n;
}
function cellDate(row, idx) {
  const v = cell(row, idx); if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

async function ensureKiste(nummer, art, cache, table = 'kisten') {
  const key = `${art || 'Kiste'}|${nummer}`;
  if (cache.has(key)) return cache.get(key);
  let list = table === 'kisten' ? state.kisten : lstate.kisten;
  let k = list.find(x => String(x.nummer) === String(nummer) && x.art === (art || 'Kiste'));
  if (!k) {
    const { data, error } = await sb.from(table).insert({ nummer: String(nummer), art: art || 'Kiste', user_id: owner() }).select().single();
    if (error) throw error; k = data;
    if (table === 'kisten') state.kisten = [...state.kisten, k].sort((a, b) => sortNat(a.nummer, b.nummer));
    else lstate.kisten = [...lstate.kisten, k].sort((a, b) => sortNat(a.nummer, b.nummer));
  }
  cache.set(key, k.id); return k.id;
}
async function ensureSet(nummer, cache, table = 'sets') {
  if (!nummer) return null;
  if (cache.has(nummer)) return cache.get(nummer);
  let list = table === 'sets' ? state.sets : lstate.sets;
  // Import ordnet immer der „Reserve“ zu (wie bisher die Sets)
  let s = list.find(x => setArt(x) === 'reserve' && String(x.set_nummer) === String(nummer))
    || list.find(x => setArt(x) === 'reserve' && normNr(x.set_nummer) === normNr(nummer));
  if (!s) {
    const { data, error } = await sb.from(table).insert({ set_nummer: String(nummer), art: 'reserve', user_id: owner() }).select().single();
    if (error) throw error; s = data;
    if (table === 'sets') state.sets = [...state.sets, s].sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
    else lstate.sets = [...lstate.sets, s].sort((a, b) => sortNat(a.set_nummer, b.set_nummer));
  }
  cache.set(nummer, s.id); return s.id;
}
async function ensureOrt(name, cache) {
  if (!name) return null;
  const key = norm(name);
  if (cache.has(key)) return cache.get(key);
  let o = vstate.orte.find(x => norm(x.name) === key);
  if (!o) {
    const { data, error } = await sb.from('vorrat_orte').insert({ name, user_id: owner() }).select().single();
    if (error) throw error; o = data; vstate.orte = [...vstate.orte, o].sort((a, b) => sortNat(a.name, b.name));
  }
  cache.set(key, o.id); return o.id;
}

async function runPlaymobilImport(rows, map, onProg) {
  const kCache = new Map(), sCache = new Map();
  let ok = 0, err = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const teile_nr = cell(r, map.teile_nr) || null;
      const beschreibung = cell(r, map.beschreibung) || null;
      if (!teile_nr && !beschreibung) throw new Error('Teile-Nr. oder Beschreibung fehlt');
      const anzahl = Math.max(0, Math.round(cellNum(r, map.anzahl) ?? 1));
      const euro = cellNum(r, map.euro);
      const farbe = cell(r, map.farbe) || null;
      const notiz = cell(r, map.notiz) || null;
      let kiste_id = null;
      const kn = cell(r, map.kiste_nummer);
      if (kn) kiste_id = await ensureKiste(kn, cell(r, map.kiste_art) || 'Kiste', kCache, 'kisten');
      const row = { teile_nr, farbe, beschreibung, anzahl, euro, kiste_id, notiz, user_id: owner() };
      const { data, error } = await sb.from('teile').insert(row).select('*, teil_sets(set_id)').single();
      if (error) throw error;
      const sets = cell(r, map.set_nummern).split(/[,;/|]+/).map(s => s.trim()).filter(Boolean);
      for (const sn of sets) {
        const sid = await ensureSet(sn, sCache, 'sets');
        await sb.from('teil_sets').insert({ teil_id: data.id, set_id: sid, user_id: owner() });
      }
      if (sets.length) {
        const { data: t2 } = await sb.from('teile').select('*, teil_sets(set_id)').eq('id', data.id).single();
        state.teile = [t2 || data, ...state.teile];
      } else state.teile = [data, ...state.teile];
      ok++;
    } catch (e) { err.push({ zeile: i + 2, msg: e.message || String(e) }); }
    if (onProg) onProg(i + 1, rows.length);
  }
  state.loaded = true; return { ok, err };
}

async function runVorratImport(rows, map, onProg) {
  const oCache = new Map(); let ok = 0, err = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const name = cell(r, map.name); if (!name) throw new Error('Name fehlt in dieser Zeile.');
      const menge = Math.max(0, cellNum(r, map.menge) ?? 0);
      const mhd = cellDate(r, map.mhd);
      const ort_id = await ensureOrt(cell(r, map.ort), oCache);
      const row = {
        name, kategorie: cell(r, map.kategorie) || null, menge, einheit: cell(r, map.einheit) || 'Stück',
        mindestbestand: cellNum(r, map.mindestbestand), mhd, preis: cellNum(r, map.preis),
        ort_id, barcode: cell(r, map.barcode) || null, notiz: cell(r, map.notiz) || null, user_id: owner(),
      };
      const { data, error } = await sb.from('vorrat').insert(row).select().single();
      if (error) throw error;
      // Charge wird per Trigger angelegt; bei explizitem MHD/Menge schon gesetzt
      vstate.items = [...vstate.items, data].sort(vsort);
      ok++;
    } catch (e) { err.push({ zeile: i + 2, msg: e.message || String(e) }); }
    if (onProg) onProg(i + 1, rows.length);
  }
  vstate.loaded = true; return { ok, err };
}

async function runLegoImport(rows, map, onProg) {
  const kCache = new Map(), sCache = new Map(); let ok = 0, err = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const teile_nr = cell(r, map.teile_nr) || null;
      const beschreibung = cell(r, map.beschreibung) || null;
      if (!teile_nr && !beschreibung) throw new Error('Teile-Nr. oder Beschreibung fehlt');
      let kiste_id = null; const kn = cell(r, map.kiste_nummer);
      if (kn) kiste_id = await ensureKiste(kn, cell(r, map.kiste_art) || 'Kiste', kCache, 'lego_kisten');
      const row = { teile_nr, farbe: cell(r, map.farbe) || null, beschreibung, anzahl: Math.max(0, Math.round(cellNum(r, map.anzahl) ?? 1)),
        euro: cellNum(r, map.euro), kiste_id, notiz: cell(r, map.notiz) || null, user_id: owner() };
      const { data, error } = await sb.from('lego_teile').insert(row).select('*, lego_teil_sets(set_id)').single();
      if (error) throw error;
      for (const sn of cell(r, map.set_nummern).split(/[,;/|]+/).map(s => s.trim()).filter(Boolean)) {
        const sid = await ensureSet(sn, sCache, 'lego_sets');
        await sb.from('lego_teil_sets').insert({ teil_id: data.id, set_id: sid, user_id: owner() });
      }
      lstate.teile = [data, ...lstate.teile]; ok++;
    } catch (e) { err.push({ zeile: i + 2, msg: e.message || String(e) }); }
    if (onProg) onProg(i + 1, rows.length);
  }
  lstate.loaded = true; return { ok, err };
}

async function runCustomImport(bereichId, rows, headers, mapFieldKeys, onProg) {
  // mapFieldKeys: { nameIdx, anzahlIdx, ortIdx, notizIdx, fields: {schluessel: idx} }
  let ok = 0, err = [];
  const ortCache = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const name = cell(r, mapFieldKeys.nameIdx); if (!name) throw new Error('Name fehlt in dieser Zeile.');
      let ort_id = null; const on = cell(r, mapFieldKeys.ortIdx);
      if (on) {
        if (ortCache.has(norm(on))) ort_id = ortCache.get(norm(on));
        else {
          let o = cstate.orte.filter(x => x.bereich_id === bereichId).find(x => norm(x.name) === norm(on));
          if (!o) {
            const { data, error } = await sb.from('custom_orte').insert({ bereich_id: bereichId, name: on, user_id: owner() }).select().single();
            if (error) throw error; o = data; cstate.orte.push(o);
          }
          ortCache.set(norm(on), o.id); ort_id = o.id;
        }
      }
      const data = {};
      for (const [k, idx] of Object.entries(mapFieldKeys.fields || {})) { const v = cell(r, idx); if (v) data[k] = v; }
      const row = { bereich_id: bereichId, name, anzahl: cellNum(r, mapFieldKeys.anzahlIdx) ?? 1, ort_id, data, notiz: cell(r, mapFieldKeys.notizIdx) || null, user_id: owner() };
      const { data: saved, error } = await sb.from('custom_eintraege').insert(row).select().single();
      if (error) throw error; cstate.eintraege.push(saved); ok++;
    } catch (e) { err.push({ zeile: i + 2, msg: e.message || String(e) }); }
    if (onProg) onProg(i + 1, rows.length);
  }
  return { ok, err };
}

function viewImport(kind, customBereichId) {
  const tpl = IMPORT_TEMPLATES[kind];
  const title = kind === 'custom' ? 'Eigener Bereich' : tpl.title;
  let parsed = null, map = null;
  app.innerHTML = `
    <a class="back" href="${kind === 'vorrat' ? '#v/liste' : kind === 'lego' ? '#l/teile' : kind === 'custom' ? '#c/' + customBereichId : '#teile'}">‹ Zurück</a>
    <h1>📥 Übernehmen: ${esc(title)}</h1>
    <div class="card">
      <p class="muted" style="margin-top:0">Excel- oder Tabellen-Datei wählen. Spalten zuordnen, prüfen und übernehmen. Fehlende Kisten, Sets oder Orte werden automatisch angelegt.</p>
      ${tpl ? `<button class="btn secondary small" id="tpl">📄 Deutsche Vorlage herunterladen</button>` : ''}
      <label class="btn block" style="margin-top:.8rem">📁 Datei wählen<input id="file" type="file" accept=".xlsx,.xls,.csv,text/csv" hidden></label>
    </div>
    <div id="wiz"></div>`;
  if (tpl) document.getElementById('tpl').onclick = () => downloadTemplate(kind).catch(fail);
  document.getElementById('file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await ensureXLSX();
      parsed = await parseImportFile(f);
      map = kind === 'custom' ? null : guessMap(parsed.headers, tpl.mapHints);
      renderMap();
    } catch (err) { fail(err); }
  };

  function renderMap() {
    const wiz = document.getElementById('wiz');
    if (kind === 'custom') {
      const fields = cstate.felder.filter(f => f.bereich_id === customBereichId);
      const opts = parsed.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('') + '<option value="-1">– ignorieren –</option>';
      wiz.innerHTML = `<div class="card"><h2>Spalten zuordnen</h2>
        <label>Name *</label><select id="m_name">${opts}</select>
        <label>Anzahl</label><select id="m_anz">${opts}</select>
        <label>Ort</label><select id="m_ort">${opts}</select>
        <label>Notiz</label><select id="m_notiz">${opts}</select>
        ${fields.map(f => `<label>${esc(f.label)}</label><select data-fk="${esc(f.schluessel)}">${opts}</select>`).join('')}
        <p class="muted">${num(parsed.data.length)} Zeilen erkannt. Vorschau der ersten 5:</p>
        <div class="tablewrap"><table class="mini"><tr>${parsed.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
          ${parsed.data.slice(0, 5).map(r => `<tr>${parsed.headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>
        <button class="btn block" id="go" style="margin-top:1rem">▶ Übernehmen</button></div>`;
      // guess name
      const ni = parsed.headers.findIndex(h => /name|titel|bezeichnung/i.test(h));
      if (ni >= 0) document.getElementById('m_name').value = ni;
      document.getElementById('go').onclick = async () => {
        const mapFieldKeys = {
          nameIdx: Number(document.getElementById('m_name').value),
          anzahlIdx: Number(document.getElementById('m_anz').value),
          ortIdx: Number(document.getElementById('m_ort').value),
          notizIdx: Number(document.getElementById('m_notiz').value),
          fields: Object.fromEntries([...wiz.querySelectorAll('[data-fk]')].map(el => [el.dataset.fk, Number(el.value)])),
        };
        await doImport(() => runCustomImport(customBereichId, parsed.data, parsed.headers, mapFieldKeys, prog));
      };
      return;
    }
    const fields = Object.keys(tpl.mapHints);
    wiz.innerHTML = `<div class="card"><h2>Spalten zuordnen</h2>
      ${fields.map(f => `<label>${esc(f)}</label><select data-f="${f}"><option value="-1">– ignorieren –</option>${parsed.headers.map((h, i) => `<option value="${i}" ${map[f] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('')}
      <p class="muted">${num(parsed.data.length)} Zeilen · Vorschau:</p>
      <div class="tablewrap"><table class="mini"><tr>${parsed.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
        ${parsed.data.slice(0, 5).map(r => `<tr>${parsed.headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>
      <button class="btn block" id="go" style="margin-top:1rem">▶ Übernehmen</button></div>`;
    document.getElementById('go').onclick = async () => {
      const m = {}; wiz.querySelectorAll('[data-f]').forEach(el => { m[el.dataset.f] = Number(el.value); });
      const runner = kind === 'playmobil' ? runPlaymobilImport : kind === 'vorrat' ? runVorratImport : runLegoImport;
      await doImport(() => runner(parsed.data, m, prog));
    };
  }

  let prog = () => {};
  async function doImport(fn) {
    const wiz = document.getElementById('wiz');
    wiz.innerHTML = `<div class="card"><p>Wird übernommen …</p><progress id="pg" max="100" value="0" style="width:100%"></progress><p id="pgTxt" class="muted"></p></div>`;
    prog = (i, n) => { document.getElementById('pg').value = Math.round(100 * i / n); document.getElementById('pgTxt').textContent = `${i} / ${n}`; };
    try {
      const { ok, err } = await fn();
      wiz.innerHTML = `<div class="card"><h2>Ergebnis</h2>
        <p><span class="badge green">${num(ok)} übernommen</span> ${err.length ? `<span class="badge red">${num(err.length)} Fehler</span>` : ''}</p>
        ${err.length ? `<details><summary>Fehlerdetails</summary><ul>${err.slice(0, 50).map(e => `<li>Zeile ${e.zeile}: ${esc(e.msg)}</li>`).join('')}${err.length > 50 ? '<li>…</li>' : ''}</ul></details>` : ''}
        <a class="btn block" href="${kind === 'vorrat' ? '#v/liste' : kind === 'lego' ? '#l/teile' : kind === 'custom' ? '#c/' + customBereichId : '#teile'}">Zur Liste</a></div>`;
      toast(`${ok} Einträge übernommen.`, 4000);
    } catch (e) { fail(e); }
  }
}
