
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

/** „---“, „-“ usw. gelten als leer */
const cleanCell = v => { const s = String(v ?? '').replace(/\u00a0/g, ' ').trim(); return /^[-–—_]+$/.test(s) ? '' : s; };
const ALL_HINTS = () => Object.values(IMPORT_TEMPLATES).flatMap(t => Object.values(t.mapHints).flat()).map(a => norm(a));
function headerScore(row) {
  const al = ALL_HINTS();
  return row.reduce((s, c) => { const h = norm(String(c ?? '').trim()); if (!h || /\d{3}/.test(h)) return s;
    return s + (al.some(a => h === a || (a.length >= 4 && h.includes(a))) ? 1 : 0); }, 0);
}
/** Liest ALLE Blätter einer Excel-/ODS-/CSV-Datei */
async function parseImportFile(file) {
  await ensureXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheets = [];
  for (const name of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: true });
    const rows = raw.map((r, i) => { const a = (r || []).map(c => String(c ?? '').trim()); a.line = i + 1; return a; }).filter(r => r.some(c => c !== ''));
    let hi = -1, best = 0;
    rows.slice(0, 10).forEach((r, i) => { const s = headerScore(r); if (s >= 2 && s > best) { best = s; hi = i; } });
    const headers = hi >= 0 ? rows[hi].map(h => String(h ?? '').trim()) : null;
    const data = rows.slice(hi + 1);
    data.forEach(r => { r.src = `${name}, Zeile ${r.line}`; r.sheet = name; });
    const cols = Math.max(0, ...rows.map(r => r.length));
    sheets.push({ name, headers, data, cols, hasHeader: !!headers });
  }
  if (!sheets.some(s => s.data.length)) throw new Error('Die Datei enthält keine Zeilen.');
  const main = sheets.find(s => s.hasHeader && s.data.length) || sheets.find(s => s.data.length);
  const headers = main.headers || Array.from({ length: main.cols }, (_, i) => 'Spalte ' + XLSX.utils.encode_col(i));
  return { sheets, main, headers, data: main.data };
}
/** Spalten-Zuordnung des Haupt-Blatts auf ein anderes Blatt übertragen */
function sheetMap(sheet, parsed, m, hints) {
  if (sheet === parsed.main || !sheet.hasHeader || !parsed.main.hasHeader) return m;
  const g = hints ? guessMap(sheet.headers, hints) : {};
  const out = {};
  for (const [f, idx] of Object.entries(m)) {
    if (idx < 0) { out[f] = -1; continue; }
    const h = norm(parsed.headers[idx] || '');
    const j = sheet.headers.findIndex(x => norm(x) === h);
    out[f] = j >= 0 ? j : (g[f] ?? idx);
  }
  return out;
}
/** Zeilen aller gewählten Blätter in eine Liste mit fester Spaltenreihenfolge bringen */
function collectRows(parsed, chosen, m, hints) {
  const fields = Object.keys(m);
  const fm = Object.fromEntries(fields.map((f, i) => [f, i]));
  const rows = [];
  for (const s of parsed.sheets) {
    if (!chosen.has(s.name)) continue;
    const sm = sheetMap(s, parsed, m, hints);
    for (const r of s.data) { const a = fields.map(f => sm[f] >= 0 ? (r[sm[f]] ?? '') : ''); a.src = r.src; rows.push(a); }
  }
  return { rows, map: fm };
}

async function ensureKiste(nummer, art, cache, table = 'kisten') {
  const key = `${art || 'Kiste'}|${nummer}`;
  if (cache.has(key)) return cache.get(key);
  let list = table === 'kisten' ? state.kisten : lstate.kisten;
  let k = list.find(x => String(x.nummer) === String(nummer) && x.art === (art || 'Kiste')) || list.find(x => normNr(x.nummer) === normNr(nummer) && (x.art || 'Kiste') === (art || 'Kiste'));
  if (!k) {
    const { data, error } = await sb.from(table).insert({ nummer: String(nummer), art: art || 'Kiste', user_id: owner() }).select().single();
    if (error) throw error; k = data;
    if (table === 'kisten') state.kisten = [...state.kisten, k].sort((a, b) => sortNat(a.nummer, b.nummer));
    else lstate.kisten = [...lstate.kisten, k].sort((a, b) => sortNat(a.nummer, b.nummer));
  }
  cache.set(key, k.id); return k.id;
}
function cell(row, idx) { return idx >= 0 && idx < row.length ? cleanCell(row[idx]) : ''; }
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

// ---------- Teile-Import mit Prüfung (kein Löschen, keine Doppelten) ----------
const PART_CFG = {
  playmobil: { teile: 'teile', link: 'teil_sets', rel: 'teil_sets', kisten: 'kisten', sets: 'sets', st: () => state, kisteLabel: k => kisteLabel(k) },
  lego: { teile: 'lego_teile', link: 'lego_teil_sets', rel: 'lego_teil_sets', kisten: 'lego_kisten', sets: 'lego_sets', st: () => lstate, kisteLabel: k => lkisteLabel(k) },
};
const partKey = (nr, name, farbe) => { const n = normNr(cleanCell(nr)); return n ? 'n:' + n + '|' + norm(cleanCell(farbe)) : 'b:' + norm(cleanCell(name)) + '|' + norm(cleanCell(farbe)); };
const splitSets = v => String(v || '').split(/[;,|]+|\s\/\s|(?<=\d)\s*\/\s*(?=\d)/).map(s => s.trim()).filter(Boolean);
const FIELD_LABEL = { beschreibung: 'Beschreibung', anzahl: 'Anzahl', euro: 'Einzelpreis', notiz: 'Notiz', kiste: 'Kiste', sets: 'Sets / Reserve' };

function planPartImport(kind, rows, map) {
  const cfg = PART_CFG[kind], st = cfg.st();
  const err = [], byKey = new Map(), order = [];
  rows.forEach((r, i) => {
    const it = {
      teile_nr: cell(r, map.teile_nr) || null, farbe: cell(r, map.farbe) || null, beschreibung: cell(r, map.beschreibung) || null,
      anzahl: cellNum(r, map.anzahl), euro: cellNum(r, map.euro), notiz: cell(r, map.notiz) || null,
      kiste_nummer: cell(r, map.kiste_nummer) || null, kiste_art: cell(r, map.kiste_art) || 'Kiste',
      sets: splitSets(cell(r, map.set_nummern)), src: [r.src || 'Zeile ' + (i + 2)],
    };
    if (it.anzahl != null) it.anzahl = Math.max(0, Math.round(it.anzahl));
    if (!it.teile_nr && !it.beschreibung) { err.push({ zeile: it.src[0], msg: 'Teile-Nr. oder Beschreibung fehlt' }); return; }
    const key = partKey(it.teile_nr, it.beschreibung, it.farbe);
    const prev = byKey.get(key);
    if (prev) { // gleiche Zeile mehrfach in der Datei → zusammenführen
      for (const f of ['teile_nr', 'farbe', 'beschreibung', 'anzahl', 'euro', 'notiz', 'kiste_nummer']) if (prev[f] == null && it[f] != null) prev[f] = it[f];
      for (const s of it.sets) if (!prev.sets.some(x => normNr(x) === normNr(s))) prev.sets.push(s);
      prev.src.push(...it.src); return;
    }
    it.key = key; byKey.set(key, it); order.push(it);
  });
  const existing = new Map();
  for (const t of st.teile) { const k = partKey(t.teile_nr, t.beschreibung, t.farbe); if (!existing.has(k)) existing.set(k, t); }
  const sById = id => st.sets.find(s => s.id === id);
  const neu = [], gleich = [], geaendert = [];
  for (const it of order) {
    const ex = existing.get(it.key);
    if (!ex) { neu.push(it); continue; }
    const ch = [];
    if (it.beschreibung && norm(it.beschreibung) !== norm(cleanCell(ex.beschreibung))) ch.push({ f: 'beschreibung', alt: ex.beschreibung || '–', neu: it.beschreibung, v: it.beschreibung });
    if (it.anzahl != null && it.anzahl !== Number(ex.anzahl)) ch.push({ f: 'anzahl', alt: ex.anzahl ?? '–', neu: it.anzahl, v: it.anzahl });
    if (it.euro != null && (ex.euro == null || Math.abs(Number(ex.euro) - it.euro) > 0.0001)) ch.push({ f: 'euro', alt: ex.euro != null ? euro(ex.euro) : '–', neu: euro(it.euro), v: it.euro });
    if (it.notiz && norm(it.notiz) !== norm(ex.notiz || '')) ch.push({ f: 'notiz', alt: ex.notiz || '–', neu: it.notiz, v: it.notiz });
    if (it.kiste_nummer) {
      const k = st.kisten.find(x => normNr(x.nummer) === normNr(it.kiste_nummer) && (x.art || 'Kiste') === it.kiste_art);
      if (!k || k.id !== ex.kiste_id) { const old = st.kisten.find(x => x.id === ex.kiste_id); ch.push({ f: 'kiste', alt: old ? cfg.kisteLabel(old) : '–', neu: `${it.kiste_art} ${it.kiste_nummer}` }); }
    }
    const linked = (ex[cfg.rel] || []).map(x => sById(x.set_id)).filter(Boolean);
    const add = it.sets.filter(s => !linked.some(x => setArt(x) === 'reserve' && normNr(x.set_nummer) === normNr(s)));
    if (add.length) ch.push({ f: 'sets', alt: linked.map(x => x.set_nummer).join(', ') || '–', neu: '+ ' + add.join(', '), v: add });
    if (ch.length) geaendert.push({ it, ex, ch, dec: null }); else gleich.push({ it, ex });
  }
  const known = new Set(st.sets.filter(s => setArt(s) === 'reserve').map(s => normNr(s.set_nummer)));
  const neueSets = [...new Set([...neu.flatMap(i => i.sets), ...geaendert.flatMap(x => x.ch.find(c => c.f === 'sets')?.v || [])].filter(s => !known.has(normNr(s))).map(s => s.trim()))];
  return { neu, gleich, geaendert, err, rows: order.length, neueSets };
}

async function runPartPlan(kind, plan, opts, onProg) {
  const cfg = PART_CFG[kind], st = cfg.st();
  const kCache = new Map(), sCache = new Map();
  const err = [...plan.err]; let neu = 0, upd = 0;
  const todo = plan.geaendert.filter(x => x.dec === 'upd');
  const total = plan.neu.length + todo.length || 1; let done = 0;
  const tick = () => onProg && onProg(++done, total);
  for (let i = 0; i < plan.neu.length; i += 100) {
    const chunk = plan.neu.slice(i, i + 100);
    const rows = [];
    for (const it of chunk) {
      try {
        const kiste_id = it.kiste_nummer ? await ensureKiste(it.kiste_nummer, it.kiste_art, kCache, cfg.kisten) : null;
        it._sets = []; for (const s of it.sets) it._sets.push(await ensureSet(s, sCache, cfg.sets));
        rows.push({ it, row: { teile_nr: it.teile_nr, farbe: it.farbe, beschreibung: it.beschreibung, anzahl: it.anzahl ?? 1, euro: it.euro, kiste_id, notiz: it.notiz,
          nummer_unbekannt: !it.teile_nr && !!opts.markUnknown, user_id: owner() } });
      } catch (e) { err.push({ zeile: it.src[0], msg: e.message || String(e) }); }
    }
    if (!rows.length) continue;
    const r = await sb.from(cfg.teile).insert(rows.map(x => x.row)).select();
    if (r.error) { rows.forEach(x => err.push({ zeile: x.it.src[0], msg: friendlyError(r.error) })); continue; }
    const links = [];
    r.data.forEach((saved, j) => { const it = rows[j].it; const ids = [...new Set(it._sets)]; saved[cfg.rel] = ids.map(set_id => ({ set_id })); for (const set_id of ids) links.push({ teil_id: saved.id, set_id, user_id: owner() }); });
    if (links.length) { const l = await sb.from(cfg.link).insert(links); if (l.error) err.push({ zeile: rows[0].it.src[0], msg: 'Sets konnten nicht zugeordnet werden.' }); }
    st.teile = [...r.data, ...st.teile]; neu += r.data.length;
    for (let k = 0; k < rows.length; k++) tick();
  }
  for (const x of todo) {
    try {
      const u = {};
      for (const c of x.ch) {
        if (c.f === 'kiste') u.kiste_id = await ensureKiste(x.it.kiste_nummer, x.it.kiste_art, kCache, cfg.kisten);
        else if (c.f !== 'sets') u[c.f] = c.v;
      }
      let saved = x.ex;
      if (Object.keys(u).length) { const r = await sb.from(cfg.teile).update(u).eq('id', x.ex.id).select().single(); if (r.error) throw r.error; saved = { ...x.ex, ...r.data }; }
      const sc = x.ch.find(c => c.f === 'sets');
      const rel = [...(x.ex[cfg.rel] || [])];
      if (sc) for (const s of sc.v) { const set_id = await ensureSet(s, sCache, cfg.sets); if (rel.some(y => y.set_id === set_id)) continue;
        const l = await sb.from(cfg.link).insert({ teil_id: x.ex.id, set_id, user_id: owner() }); if (l.error) throw l.error; rel.push({ set_id }); }
      saved[cfg.rel] = rel;
      st.teile = st.teile.map(t => t.id === saved.id ? saved : t); upd++;
    } catch (e) { err.push({ zeile: x.it.src[0], msg: e.message || String(e) }); }
    tick();
  }
  st.loaded = true;
  const skipped = plan.gleich.length + plan.geaendert.filter(x => x.dec !== 'upd').length;
  return { ok: neu + upd, neu, upd, skipped, err };
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
    } catch (e) { err.push({ zeile: r.src || 'Zeile ' + (i + 2), msg: e.message || String(e) }); }
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
    } catch (e) { err.push({ zeile: r.src || 'Zeile ' + (i + 2), msg: e.message || String(e) }); }
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
    } catch (e) { err.push({ zeile: r.src || 'Zeile ' + (i + 2), msg: e.message || String(e) }); }
    if (onProg) onProg(i + 1, rows.length);
  }
  return { ok, err };
}

function viewImport(kind, customBereichId) {
  const tpl = IMPORT_TEMPLATES[kind];
  const title = kind === 'custom' ? 'Eigener Bereich' : tpl.title;
  let parsed = null, map = null, chosen = new Set();
  app.innerHTML = `
    <a class="back" href="${kind === 'vorrat' ? '#v/liste' : kind === 'lego' ? '#l/teile' : kind === 'custom' ? '#c/' + customBereichId : '#teile'}">‹ Zurück</a>
    <h1>📥 Übernehmen: ${esc(title)}</h1>
    <div class="card">
      <p class="muted" style="margin-top:0">Excel-, LibreOffice- oder Tabellen-Datei wählen. Alle Blätter der Datei werden gelesen. Spalten zuordnen, prüfen und übernehmen. Fehlende Kisten, Sets oder Orte werden automatisch angelegt.${kind === 'playmobil' || kind === 'lego' ? ' Schon vorhandene Teile werden nicht doppelt angelegt und nichts wird gelöscht.' : ''}</p>
      ${tpl ? `<button class="btn secondary small" id="tpl">📄 Deutsche Vorlage herunterladen</button>` : ''}
      <label class="btn block" style="margin-top:.8rem">📁 Datei wählen<input id="file" type="file" accept=".xlsx,.xls,.ods,.csv,text/csv,application/vnd.oasis.opendocument.spreadsheet" hidden></label>
    </div>
    <div id="wiz"></div>`;
  if (tpl) document.getElementById('tpl').onclick = () => downloadTemplate(kind).catch(fail);
  document.getElementById('file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await ensureXLSX();
      parsed = await parseImportFile(f);
      chosen = new Set(parsed.sheets.filter(s => s.data.length).map(s => s.name));
      map = kind === 'custom' ? null : guessMap(parsed.headers, tpl.mapHints);
      renderMap();
    } catch (err) { fail(err); }
  };

  const sheetsHtml = () => parsed.sheets.length > 1 || !parsed.main.hasHeader ? `<h2>Blätter in der Datei</h2>
    <div id="sheets">${parsed.sheets.map(s => `<label class="sheetrow"><input type="checkbox" data-sheet="${esc(s.name)}" ${chosen.has(s.name) ? 'checked' : ''} ${s.data.length ? '' : 'disabled'}>
      <b>${esc(s.name)}</b> <span class="muted">– ${num(s.data.length)} Zeilen${s.data.length && !s.hasHeader && s !== parsed.main ? ' · ohne Überschriften, Spalten wie im ersten Blatt' : ''}</span></label>`).join('')}</div>` : '';
  const bindSheets = onChange => document.querySelectorAll('[data-sheet]').forEach(cb => cb.onchange = () => { cb.checked ? chosen.add(cb.dataset.sheet) : chosen.delete(cb.dataset.sheet); onChange(); });
  const chosenCount = () => parsed.sheets.filter(s => chosen.has(s.name)).reduce((n, s) => n + s.data.length, 0);
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
        ${sheetsHtml()}
        <p class="muted"><span id="rowCount">${num(chosenCount())}</span> Zeilen gewählt. Vorschau der ersten 5:</p>
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
        const rows = parsed.sheets.filter(s => chosen.has(s.name)).flatMap(s => s.data);
        await doImport(() => runCustomImport(customBereichId, rows, parsed.headers, mapFieldKeys, prog));
      };
      bindSheets(() => { document.getElementById('rowCount').textContent = num(chosenCount()); });
      return;
    }
    const fields = Object.keys(tpl.mapHints);
    wiz.innerHTML = `<div class="card"><h2>Spalten zuordnen</h2>
      ${fields.map(f => `<label>${esc(f)}</label><select data-f="${f}"><option value="-1">– ignorieren –</option>${parsed.headers.map((h, i) => `<option value="${i}" ${map[f] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('')}
      ${sheetsHtml()}
      <p class="muted"><span id="rowCount">${num(chosenCount())}</span> Zeilen gewählt · Vorschau „${esc(parsed.main.name)}“:</p>
      <div class="tablewrap"><table class="mini"><tr>${parsed.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
        ${parsed.data.slice(0, 5).map(r => `<tr>${parsed.headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>
      ${kind === 'playmobil' || kind === 'lego' ? `<label class="sheetrow" style="margin-top:.8rem"><input type="checkbox" id="markUnknown" checked> Zeilen ohne Teile-Nr. als „Keine Nummer gefunden“ markieren</label>` : ''}
      <button class="btn block" id="go" style="margin-top:1rem">${kind === 'playmobil' || kind === 'lego' ? '🔎 Prüfen' : '▶ Übernehmen'}</button></div>`;
    bindSheets(() => { document.getElementById('rowCount').textContent = num(chosenCount()); });
    document.getElementById('go').onclick = async () => {
      if (!chosen.size) return toast('Bitte mindestens ein Blatt auswählen.');
      const m = {}; wiz.querySelectorAll('[data-f]').forEach(el => { m[el.dataset.f] = Number(el.value); });
      const { rows, map: fm } = collectRows(parsed, chosen, m, tpl.mapHints);
      if (kind === 'playmobil' || kind === 'lego') {
        const opts = { markUnknown: !!document.getElementById('markUnknown')?.checked };
        return renderReview(planPartImport(kind, rows, fm), opts);
      }
      await doImport(() => runVorratImport(rows, fm, prog));
    };
  }

  function renderReview(plan, opts) {
    const wiz = document.getElementById('wiz');
    const itTitle = it => [it.teile_nr || 'ohne Nr.', it.farbe, it.beschreibung].filter(Boolean).join(' · ');
    wiz.innerHTML = `<div class="card"><h2>Prüfen vor dem Übernehmen</h2>
      <p id="revSum"><span class="badge green">${num(plan.neu.length)} neu</span><span class="badge">${num(plan.gleich.length)} schon vorhanden (gleich)</span><span class="badge orange">${num(plan.geaendert.length)} vorhanden mit Änderungen</span>${plan.err.length ? `<span class="badge red">${num(plan.err.length)} Zeilen unvollständig</span>` : ''}${plan.neueSets.length ? `<span class="badge" id="revNewSets">${num(plan.neueSets.length)} neue Reserve-Einträge</span>` : ''}</p>
      ${plan.neueSets.length ? `<p class="muted" style="font-size:.85rem;margin-top:0">Diese Set-Nummern gibt es noch nicht und werden beim Übernehmen in „${esc(artName('reserve', kind === 'lego'))}“ angelegt: ${esc(plan.neueSets.slice(0, 30).join(', '))}${plan.neueSets.length > 30 ? ' …' : ''}</p>` : ''}
      <p class="muted" style="margin-top:0">Es wird nichts gelöscht. Gleiche Teile werden übersprungen. Bei geänderten Teilen entscheidest du, ob sie aktualisiert werden – dabei werden nur Felder mit neuem Wert übernommen, Fotos und andere Angaben bleiben erhalten.</p>
      ${plan.neu.length ? `<details><summary>Neue Teile anzeigen (${num(plan.neu.length)})</summary><ul class="revlist">${plan.neu.slice(0, 200).map(it => `<li>${esc(itTitle(it))} <span class="muted">(${esc(it.src[0])})</span></li>`).join('')}${plan.neu.length > 200 ? '<li>…</li>' : ''}</ul></details>` : ''}
      ${plan.gleich.length ? `<details><summary>Schon vorhanden, unverändert (${num(plan.gleich.length)})</summary><ul class="revlist">${plan.gleich.slice(0, 200).map(x => `<li>${esc(itTitle(x.it))}</li>`).join('')}${plan.gleich.length > 200 ? '<li>…</li>' : ''}</ul></details>` : ''}
      ${plan.err.length ? `<details><summary>Unvollständige Zeilen (${num(plan.err.length)})</summary><ul class="revlist">${plan.err.slice(0, 100).map(e => `<li>${esc(e.zeile)}: ${esc(e.msg)}</li>`).join('')}</ul></details>` : ''}
      </div>
      ${plan.geaendert.length ? `<div class="card"><h2>Schon vorhanden – aktualisieren?</h2>
        <div class="row" style="margin-bottom:.6rem"><button class="btn small grow" id="allUpd">Alle aktualisieren</button><button class="btn small secondary grow" id="allSkip">Alle überspringen</button></div>
        <div id="chg">${plan.geaendert.map((x, i) => `<div class="chg" data-i="${i}"><b>${esc(itTitle(x.it))}</b> <span class="muted" style="font-size:.85rem">(${esc(x.it.src.join(', '))})</span>
          <div class="tablewrap"><table class="mini"><tr><th></th><th>Bisher</th><th>Neu aus Datei</th></tr>${x.ch.map(c => `<tr><td>${esc(FIELD_LABEL[c.f])}</td><td>${esc(c.alt)}</td><td><b>${esc(c.neu)}</b></td></tr>`).join('')}</table></div>
          <div class="row"><label class="sheetrow"><input type="radio" name="dec${i}" value="upd" data-dec="${i}"> Aktualisieren</label><label class="sheetrow"><input type="radio" name="dec${i}" value="skip" data-dec="${i}"> Überspringen</label></div></div>`).join('')}</div></div>` : ''}
      <button class="btn block" id="run">▶ Übernehmen</button>`;
    const setDec = (i, v) => { plan.geaendert[i].dec = v; const el = wiz.querySelector(`input[name="dec${i}"][value="${v}"]`); if (el) el.checked = true; wiz.querySelector(`.chg[data-i="${i}"]`)?.classList.remove('need'); };
    wiz.querySelectorAll('[data-dec]').forEach(r => r.onchange = () => setDec(Number(r.dataset.dec), r.value));
    const au = document.getElementById('allUpd'), as = document.getElementById('allSkip');
    if (au) au.onclick = () => plan.geaendert.forEach((_, i) => setDec(i, 'upd'));
    if (as) as.onclick = () => plan.geaendert.forEach((_, i) => setDec(i, 'skip'));
    document.getElementById('run').onclick = async () => {
      const open = plan.geaendert.map((x, i) => x.dec ? -1 : i).filter(i => i >= 0);
      if (open.length) {
        open.forEach(i => wiz.querySelector(`.chg[data-i="${i}"]`)?.classList.add('need'));
        wiz.querySelector(`.chg[data-i="${open[0]}"]`)?.scrollIntoView({ block: 'center' });
        return toast(`Bitte bei ${open.length} Teil${open.length > 1 ? 'en' : ''} „Aktualisieren“ oder „Überspringen“ wählen.`, 4000);
      }
      await doImport(() => runPartPlan(kind, plan, opts, prog));
    };
  }

  let prog = () => {};
  async function doImport(fn) {
    const wiz = document.getElementById('wiz');
    wiz.innerHTML = `<div class="card"><p>Wird übernommen …</p><progress id="pg" max="100" value="0" style="width:100%"></progress><p id="pgTxt" class="muted"></p></div>`;
    prog = (i, n) => { document.getElementById('pg').value = Math.round(100 * i / n); document.getElementById('pgTxt').textContent = `${i} / ${n}`; };
    try {
      const res = await fn(); const { ok, err } = res;
      wiz.innerHTML = `<div class="card"><h2>Ergebnis</h2>
        <p id="importSummary">${res.neu != null ? `<span class="badge green">${num(res.neu)} neu</span><span class="badge">${num(res.upd)} aktualisiert</span><span class="badge">${num(res.skipped)} übersprungen</span>` : `<span class="badge green">${num(ok)} übernommen</span>`} ${err.length ? `<span class="badge red">${num(err.length)} Fehler</span>` : ''}</p>
        ${err.length ? `<details><summary>Fehlerdetails</summary><ul>${err.slice(0, 50).map(e => `<li>${esc(e.zeile)}: ${esc(e.msg)}</li>`).join('')}${err.length > 50 ? '<li>…</li>' : ''}</ul></details>` : ''}
        <a class="btn block" href="${kind === 'vorrat' ? '#v/liste' : kind === 'lego' ? '#l/teile' : kind === 'custom' ? '#c/' + customBereichId : '#teile'}">Zur Liste</a></div>`;
      toast(res.neu != null ? `${res.neu} neu, ${res.upd} aktualisiert, ${res.skipped} übersprungen.` : `${ok} Einträge übernommen.`, 5000);
    } catch (e) { fail(e); }
  }
}
