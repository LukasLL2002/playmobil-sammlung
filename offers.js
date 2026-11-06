// Angebote – PLZ lokal, Märkte Open-Data, manuell erfasste Angebote, Prospekt-Deep-Links
'use strict';

const PLZ_KEY = 'vorratPlz';
const CITY_CACHE_KEY = 'vorratCityCache';

function getPlz() { return (localStorage.getItem(PLZ_KEY) || '').replace(/\D/g, '').slice(0, 5); }
function setPlz(plz) { localStorage.setItem(PLZ_KEY, String(plz || '').replace(/\D/g, '').slice(0, 5)); }

function citySlug(name) {
  return String(name || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function cityTitle(name) {
  return String(name || '').split(/[\s-]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('-');
}
function productSlug(term) {
  return String(term || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function readCityCache() {
  try { return JSON.parse(localStorage.getItem(CITY_CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCityCache(cache) { localStorage.setItem(CITY_CACHE_KEY, JSON.stringify(cache)); }

async function resolvePlz(plz) {
  plz = String(plz || '').replace(/\D/g, '').slice(0, 5);
  if (plz.length !== 5) throw new Error('Bitte eine 5-stellige PLZ eingeben.');
  const cache = readCityCache();
  if (cache[plz] && cache[plz].city && Date.now() - (cache[plz].ts || 0) < 30 * 864e5) return cache[plz];
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(plz)}&country=de&format=json&addressdetails=1&limit=1`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json', 'Accept-Language': 'de' } });
  if (!r.ok) throw new Error('Ortsauflösung fehlgeschlagen (Nominatim).');
  const data = await r.json();
  if (!data?.length) throw new Error('PLZ nicht gefunden.');
  const a = data[0].address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || data[0].display_name.split(',')[0];
  const info = { city, lat: data[0].lat, lon: data[0].lon, slug: citySlug(city), title: cityTitle(city), ts: Date.now() };
  cache[plz] = info; writeCityCache(cache); return info;
}

function viewPlzSettings() {
  const plz = getPlz();
  const cache = readCityCache()[plz];
  app.innerHTML = `
    <a class="back" href="#v/liste">‹ Vorrat</a>
    <h1>📍 PLZ & Angebote</h1>
    <div class="card">
      <p class="muted" style="margin-top:0">PLZ bleibt auf dem Gerät. Die App öffnet die Anbietersuche – Preise und Gültigkeit stehen auf der Anbieter-Seite.</p>
      <label>Postleitzahl</label>
      <input id="plz" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" value="${esc(plz)}" placeholder="z.B. 80331">
      <button class="btn block" id="save" style="margin-top:.8rem;background:#2e7d32">Speichern</button>
      <div id="info" style="margin-top:.8rem">${cache ? `<span class="badge green">${esc(cache.city)}</span>` : ''}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Bevorzugte Angebotsseite</h2>
      <select id="src" style="margin:0">
        <option value="meinprospekt" ${getOfferSource()==='meinprospekt'?'selected':''}>MeinProspekt (Standard)</option>
        <option value="kaufda" ${getOfferSource()==='kaufda'?'selected':''}>kaufDA</option>
        <option value="marktguru" ${getOfferSource()==='marktguru'?'selected':''}>Marktguru</option>
      </select>
      <p class="muted" style="font-size:.85rem">Öffnet die gefilterte Liste beim Anbieter – keine Preise in der App.</p>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Märkte in der Nähe</h2>
      <button class="btn secondary block" id="maerkte">🏪 Märkte laden</button>
      <div id="ml" style="margin-top:.8rem"></div>
    </div>`;
  document.getElementById('src').onchange = e => { setOfferSource(e.target.value); toast('Quelle: ' + e.target.selectedOptions[0].text); };
  document.getElementById('save').onclick = async () => {
    const v = document.getElementById('plz').value.trim();
    try {
      const info = await resolvePlz(v); setPlz(v);
      document.getElementById('info').innerHTML = `<span class="badge green">${esc(info.city)}</span>`;
      toast('PLZ gespeichert: ' + info.city);
    } catch (e) { fail(e); }
  };
  document.getElementById('maerkte').onclick = () => loadMaerkte(document.getElementById('ml'));
}

/** Bekannte Händler-Slugs auf MeinProspekt (curl-verifiziert, Stand 2026-11). */
const MP_RETAILERS = [
  { keys: ['rewe'], slug: 'rewe-de' },
  { keys: ['lidl'], slug: 'lidl' },
  { keys: ['edeka', 'edeka center', 'edeka markt'], slug: 'edeka' },
  { keys: ['penny'], slug: 'penny-de' },
  { keys: ['kaufland'], slug: 'kaufland' },
  { keys: ['netto marken', 'netto city', 'netto'], slug: 'netto-de' },
  { keys: ['dm-drogerie', 'dm drogerie', ' dm '], slug: 'dm-de', exact: ['dm'] },
  { keys: ['rossmann'], slug: 'rossmann-de' },
  { keys: ['tegut'], slug: 'tegut-de' },
  { keys: ['norma'], slug: 'norma-de' },
  { keys: ['hit '], slug: 'hit-de', exact: ['hit'] },
  { keys: ['budni'], slug: 'budni-de' },
  { keys: ['action'], slug: 'action' },
  // Aldi: kein stabiler Städte-Händler-Slug gefunden → Stadtseite + Marktguru-Fallback unten
];

function matchRetailer(m) {
  const hay = norm([m.operator, m.name, m.title, m.store, m.trade_label, m.brand, m.osm_brand].filter(Boolean).join(' | '));
  for (const r of MP_RETAILERS) {
    if (r.exact && r.exact.some(e => hay.split(/[^a-z0-9äöüß]+/).includes(e))) return r;
    if (r.keys.some(k => hay.includes(norm(k)))) return r;
  }
  if (/\baldi\b/.test(hay)) return { keys: ['aldi'], slug: null, label: 'Aldi' };
  return null;
}

function prospektUrl(m, cityInfo) {
  const city = cityInfo?.slug;
  if (!city) return null;
  const hit = matchRetailer(m);
  if (hit?.slug) return { url: `https://www.meinprospekt.de/${city}/${hit.slug}`, label: 'Prospekte öffnen' };
  // Unbekannter / Aldi: Stadt-Übersicht (verifiziert) – keine Website des Händlers
  return { url: `https://www.meinprospekt.de/${city}`, label: 'Prospekte in ' + (cityInfo.city || city) };
}

async function loadMaerkte(el) {
  const plz = getPlz();
  if (plz.length !== 5) { toast('Bitte zuerst eine PLZ speichern.'); return viewPlzSettings(); }
  el.innerHTML = '<p class="muted">Lädt …</p>';
  try {
    let info = null;
    try { info = await resolvePlz(plz); } catch { /* Ort optional */ }
    const url = `https://supermarkt-in-meiner-naehe.de/api/search?plz=${encodeURIComponent(plz)}&limit=20`
      + (info?.city ? `&city=${encodeURIComponent(info.city)}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.records || data.results || data.stores || data.data || []);
    if (!list.length) { el.innerHTML = '<p class="muted">Keine Märkte gefunden.</p>'; return; }
    const cityLabel = info?.city || plz;
    el.innerHTML = `<p><span class="badge green">Prospekte in ${esc(cityLabel)}</span></p>
      <div class="list">${list.slice(0, 20).map(m => {
      const name = m.name || m.title || m.store || m.trade_label || 'Markt';
      const street = [m.street || m.adresse || m.address, m.housenumber || m.house_number || m.hausnummer].filter(Boolean).join(' ');
      const addr = [street, m.postcode || m.plz || m.zip, m.city || m.ort].filter(Boolean).join(', ');
      const hours = m.opening_hours || m.oeffnungszeiten || m.hours || '';
      const prosp = prospektUrl(m, info);
      // Keine Händler-Website – nur MeinProspekt-Prospekte
      return `<div class="card" style="margin:0"><b>${esc(name)}</b>
        ${addr ? `<div class="sub muted">${esc(addr)}</div>` : ''}
        ${hours ? `<div class="sub muted">🕒 ${esc(typeof hours === 'string' ? hours : JSON.stringify(hours))}</div>` : ''}
        ${prosp ? `<a class="btn small" style="background:#2e7d32;margin-top:.4rem" href="${esc(prosp.url)}" target="_blank" rel="noopener">${esc(prosp.label)} ↗</a>` : '<span class="muted">PLZ/Ort fehlt für Prospekt-Link</span>'}
      </div>`;
    }).join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted">Märkte nicht geladen (${esc(e.message)}).</p>`;
  }
}

const OFFER_SRC_KEY = 'vorratOfferSource'; // meinprospekt | kaufda | marktguru
function getOfferSource() {
  const v = localStorage.getItem(OFFER_SRC_KEY);
  return ['meinprospekt', 'kaufda', 'marktguru'].includes(v) ? v : 'meinprospekt';
}
function setOfferSource(v) {
  if (['meinprospekt', 'kaufda', 'marktguru'].includes(v)) localStorage.setItem(OFFER_SRC_KEY, v);
}

/** Öffentlicher Listen-/Such-Link (kein Angebot-ID, kein Scraping). */
function offerSearchTerm(it) {
  const custom = String(it.angebotsname || '').trim();
  if (custom) return custom.slice(0, 40);
  // Kein EAN in Prospekt-Slugs – generischer Produktname/Kategorie
  const raw = (it.name || it.kategorie || '').trim();
  const stop = new Set(['und', 'oder', 'der', 'die', 'das', 'mit', 'ohne', 'bio', 'von', 'für', 'gehackt', 'frische', 'frisch']);
  const words = raw.split(/[\s,/|()-]+/).filter(w => w && !stop.has(w.toLowerCase()) && !/^\d/.test(w) && w.length > 1);
  return (words.slice(0, 2).join(' ') || raw).slice(0, 40);
}

function offerLinks(it, cityInfo) {
  const term = offerSearchTerm(it);
  const pslug = productSlug(term);
  const q = encodeURIComponent(term);
  const city = cityInfo.slug;
  const cityTc = cityInfo.title || cityTitle(cityInfo.city);
  // Nur bekannte öffentliche Listen-/Such-URLs – keine erfundenen Angebots-IDs
  // Produktlisten: national /angebote/{slug} (Stadt-Produkt-Pfade wie /northeim/angebote/milch → 404)
  const all = {
    meinprospekt: { id: 'meinprospekt', name: 'MeinProspekt', url: `https://www.meinprospekt.de/angebote/${pslug}` },
    kaufda: { id: 'kaufda', name: 'kaufDA', url: `https://www.kaufda.de/${encodeURIComponent(cityTc)}/Angebote/${encodeURIComponent(String(term).replace(/\s+/g, '-'))}` },
    marktguru: { id: 'marktguru', name: 'Marktguru', url: `https://www.marktguru.de/search/${q}` },
  };
  const pref = getOfferSource();
  const primary = all[pref] || all.meinprospekt;
  return { term, primary, others: Object.values(all).filter(l => l.id !== primary.id) };
}

const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0, 10); };
const isActiveOffer = o => o.gueltig_ab <= todayISO() && o.gueltig_bis >= todayISO();
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE') : '–';

async function loadAngebote(vorratId) {
  const { data, error } = await sb.from('vorrat_angebote').select('*').eq('vorrat_id', vorratId).order('preis');
  if (error) throw error;
  return data || [];
}

function bestAngebot(list) {
  const aktiv = list.filter(isActiveOffer).sort((a, b) => Number(a.preis) - Number(b.preis) || a.gueltig_bis.localeCompare(b.gueltig_bis));
  return aktiv[0] || null;
}

/** Dialog: bestes gespeichertes Angebot + erfassen + Prospekt-Links */
async function openAngebote(it) {
  if (!it?.id) return toast('Bitte Artikel zuerst speichern.');
  let plz = getPlz();
  let info = null;
  if (plz.length === 5) {
    try { info = await resolvePlz(plz); } catch { info = null; }
  }
  let list = [];
  try { list = await loadAngebote(it.id); } catch (e) { fail(e); }

  const render = () => {
    const best = bestAngebot(list);
    const aktiv = list.filter(isActiveOffer);
    const alt = list.filter(o => !isActiveOffer(o));
    const pack = info ? offerLinks(it, info) : null;
    const primary = pack?.primary;
    const d = dialog.current;
    if (!d) return;
    d.querySelector('#aoBody').innerHTML = `
      ${best ? `<div class="best-offer">
        <div style="font-size:.8rem;font-weight:700;color:#1b5e20">⭐ Bestes gespeichertes Angebot</div>
        <div style="font-size:1.15rem;font-weight:700;margin:.2rem 0">${euro(best.preis)} <span class="muted" style="font-size:.85rem;font-weight:500">bei ${esc(best.markt)}</span></div>
        <div class="muted" style="font-size:.85rem">gültig ${esc(fmtDate(best.gueltig_ab))} – ${esc(fmtDate(best.gueltig_bis))} · Von dir erfasst</div>
        ${best.notiz ? `<div class="muted" style="font-size:.85rem">${esc(best.notiz)}</div>` : ''}
        ${best.quelle_url ? `<a class="btn small secondary" href="${esc(best.quelle_url)}" target="_blank" rel="noopener">Quelle / Beleg ↗</a>` : ''}
      </div>` : `<p class="muted">Kein selbst erfasstes Angebot. Extern die Anbieter-Liste öffnen (keine Live-Preise in der App).</p>`}

      ${primary ? `<a class="btn block" id="aoOpen" style="background:#2e7d32;margin:.4rem 0" href="${esc(primary.url)}" target="_blank" rel="noopener">Beste Angebote bei ${esc(primary.name)} öffnen ↗</a>
        <p class="muted" style="font-size:.85rem;margin:.2rem 0 .5rem">„${esc(pack.term)}“ · Katalog beim Anbieter${info?.city ? ' (Ort: ' + esc(info.city) + ')' : ''}.</p>
        <div class="row" style="flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:.6rem">
          <label class="muted" style="font-size:.85rem;margin:0">Quelle:</label>
          <select id="aoSrc" style="flex:1;min-width:8rem;margin:0">
            <option value="meinprospekt" ${getOfferSource()==='meinprospekt'?'selected':''}>MeinProspekt</option>
            <option value="kaufda" ${getOfferSource()==='kaufda'?'selected':''}>kaufDA</option>
            <option value="marktguru" ${getOfferSource()==='marktguru'?'selected':''}>Marktguru</option>
          </select>
          ${pack.others.map(l => `<a class="btn small secondary" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join('')}
        </div>`
        : `<p class="muted"><a href="#v/plz">PLZ setzen</a>, dann Anbieter-Liste öffnen.</p>`}

      <details ${!best ? 'open' : ''}><summary><b>＋ Angebot erfassen</b> <span class="muted">(von dir, kein Live-Preis)</span></summary>
        <div style="margin-top:.6rem">
          <label>Markt / Laden</label><input id="aoMarkt" required placeholder="z.B. REWE, Aldi">
          <div class="grid2"><div><label>Preis (€)</label><input id="aoPreis" inputmode="decimal" required placeholder="1,29"></div>
            <div><label>Gültig bis</label><input id="aoBis" type="date" required value="${esc(todayISO())}"></div></div>
          <div class="grid2"><div><label>Gültig ab</label><input id="aoAb" type="date" value="${esc(todayISO())}"></div>
            <div><label>Link (optional)</label><input id="aoUrl" type="url" placeholder="https://…"></div></div>
          <label>Notiz (optional)</label><input id="aoNotiz" placeholder="z.B. 500g Packung">
          <button type="button" class="btn block" id="aoSave" style="margin-top:.6rem;background:#2e7d32">Speichern</button>
        </div></details>

      ${aktiv.length || alt.length ? `<h3 style="margin:1rem 0 .4rem">Gespeicherte Angebote</h3>
        <div class="list">${[...aktiv, ...alt].map(o => `<div class="card" style="margin:0" data-oid="${o.id}">
          <b>${euro(o.preis)}</b> · ${esc(o.markt)} ${isActiveOffer(o) ? '<span class="badge green">gültig</span>' : '<span class="badge orange">abgelaufen</span>'}
          <div class="sub muted">${esc(fmtDate(o.gueltig_ab))} – ${esc(fmtDate(o.gueltig_bis))} · Von dir erfasst</div>
          <button type="button" class="btn small danger" data-del-o="${o.id}">🗑️</button>
        </div>`).join('')}</div>` : ''}`;

    d.querySelector('#aoSave')?.addEventListener('click', async () => {
      try {
        const markt = d.querySelector('#aoMarkt').value.trim();
        const preis = parseDec(d.querySelector('#aoPreis').value);
        const gueltig_bis = d.querySelector('#aoBis').value;
        const gueltig_ab = d.querySelector('#aoAb').value || todayISO();
        if (!markt || preis == null || !gueltig_bis) throw new Error('Markt, Preis und Gültig-bis sind nötig.');
        if (gueltig_bis < gueltig_ab) throw new Error('„Gültig bis“ liegt vor „Gültig ab“.');
        const row = {
          vorrat_id: it.id, user_id: owner(), markt, preis,
          gueltig_ab, gueltig_bis,
          quelle_url: d.querySelector('#aoUrl').value.trim() || null,
          notiz: d.querySelector('#aoNotiz').value.trim() || null,
        };
        const { data, error } = await sb.from('vorrat_angebote').insert(row).select().single();
        if (error) throw error;
        list = [...list, data];
        toast('Angebot gespeichert.');
        render();
      } catch (e) { fail(e); }
    });
    d.querySelectorAll('[data-del-o]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Angebot löschen?')) return;
      const id = Number(btn.dataset.delO);
      const { error } = await sb.from('vorrat_angebote').delete().eq('id', id);
      if (error) return fail(error);
      list = list.filter(x => x.id !== id);
      toast('Gelöscht.'); render();
    });
    const srcSel = d.querySelector('#aoSrc');
    if (srcSel) srcSel.onchange = () => { setOfferSource(srcSel.value); render(); };
  };

  const html = `<form><h2 style="margin-top:0">🛒 ${esc(it.name)}</h2>
    <div id="aoBody"></div>
    <div class="row" style="margin-top:1rem"><button type="button" class="btn secondary grow" data-cancel>Schließen</button></div></form>`;
  const p = dialog(html);
  dialog.current._save = async () => true;
  render();
  return p;
}
