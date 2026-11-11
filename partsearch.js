// Sortiva – Teil suchen (Foto, Beschreibung oder Name) in eigener Sammlung, Internet und Teile-Datenbanken.
// Nur Vorschläge – übernommen wird erst nach Antippen, gespeichert erst mit „Speichern“.
'use strict';
(function () {
  const BRICKOGNIZE = 'https://api.brickognize.com/predict/parts/';
  const words = q => norm(q).split(/\s+/).filter(w => w.length > 1);
  const isNrQuery = q => /^[\d\s.\-]+$/.test(q) && q.replace(/\D/g, '').length >= 4;
  /** Eigene Sammlung durchsuchen (Name, Beschreibung, Farbe, Notiz oder Nummer) */
  function ownMatches(kind, q) {
    const list = kind === 'lego' ? (typeof lstate !== 'undefined' ? lstate.teile : []) : state.teile;
    const ws = words(q); if (!ws.length) return [];
    const qn = normNr(q), seen = new Set(), out = [];
    for (const t of list) {
      if (!hasNr(t)) continue;
      const hay = norm([t.beschreibung, t.farbe, t.notiz].join(' '));
      let score = ws.filter(w => hay.includes(w)).length / ws.length;
      if (qn.length >= 3 && normNr(t.teile_nr).includes(qn)) score = 1;
      if (!score) continue;
      const k = normNr(t.teile_nr) + '|' + norm(t.farbe || '');
      if (seen.has(k)) continue; seen.add(k);
      out.push({ nr: t.teile_nr, name: t.beschreibung || '', farbe: t.farbe || '', img: imgUrl(t), quelle: 'Deine Sammlung', own: true, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }
  /** Playmobil: Klickypedia über unsere Server-Funktion (nur angemeldet) */
  async function klickypedia(q) {
    const { data, error } = await sb.functions.invoke('teilsuche', { body: { q } });
    if (error) {
      let msg = ''; try { msg = (await error.context?.json())?.error || ''; } catch { /* egal */ }
      return { hint: msg || 'Klickypedia ist gerade nicht erreichbar. Bitte später nochmal versuchen.' };
    }
    return { items: (data?.items || []).map(i => ({ ...i, quelle: 'Klickypedia' })) };
  }
  async function rebrickableParts(q) {
    const key = typeof rebrickableKey === 'function' ? rebrickableKey() : '';
    if (!key) return { hint: 'Für die LEGO-Suche nach Namen einmal den eigenen Rebrickable-Schlüssel unter LEGO → Übersicht → Rebrickable eintragen. Die Foto-Suche geht auch ohne.' };
    const r = await fetch(`https://rebrickable.com/api/v3/lego/parts/?search=${encodeURIComponent(q)}&page_size=12`, { headers: { Authorization: 'key ' + key } });
    if (r.status === 401) return { hint: 'Der Rebrickable-Schlüssel stimmt nicht. Bitte prüfen.' };
    if (!r.ok) return { hint: 'Rebrickable ist gerade nicht erreichbar.' };
    const d = await r.json();
    return { items: (d.results || []).map(p => ({ nr: p.part_num, name: p.name, img: p.part_img_url, link: p.part_url || `https://rebrickable.com/parts/${encodeURIComponent(p.part_num)}/`, quelle: 'Rebrickable', rb: true })) };
  }
  /** LEGO: Farben und Anzahl Sets eines Teils (Rebrickable, nur mit Schlüssel) */
  async function rebrickableColors(nr) {
    const key = typeof rebrickableKey === 'function' ? rebrickableKey() : '';
    if (!key) return null;
    const r = await fetch(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(nr)}/colors/?page_size=50`, { headers: { Authorization: 'key ' + key } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.results || []).sort((a, b) => (b.num_sets || 0) - (a.num_sets || 0)).map(c => ({ farbe: c.color_name, sets: c.num_sets || 0 }));
  }
  async function brickognize(file) {
    const fd = new FormData(); fd.append('query_image', file, file.name || 'foto.jpg');
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(BRICKOGNIZE, { method: 'POST', body: fd, headers: { accept: 'application/json' }, signal: ctl.signal });
      if (!r.ok) throw new Error('Die Bilderkennung ist gerade nicht erreichbar. Bitte später nochmal versuchen.');
      const d = await r.json();
      return (d.items || []).slice(0, 8).map(i => {
        const site = (i.external_sites || [])[0];
        return { nr: i.id, name: i.name, img: i.img_url, kategorie: i.category || '', link: site?.url || `https://rebrickable.com/parts/${encodeURIComponent(i.id)}/`, quelle: 'Brickognize (Bilderkennung)', score: i.score, rb: true };
      });
    } catch (e) { if (e.name === 'AbortError') throw new Error('Die Bilderkennung hat zu lange gebraucht. Bitte nochmal versuchen.'); throw e; }
    finally { clearTimeout(tm); }
  }
  /** Playmobil: Nummern auf dem Foto lesen (z.B. Tütenaufdruck „30 00 1234“) */
  function numbersFromText(text) {
    const out = new Set();
    const s = String(text || '').replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
    for (const m of s.matchAll(/(?<!\d)(\d{2})[\s.\-]?(\d{2})[\s.\-]?(\d{4})(?!\d)/g)) out.add(`${m[1]} ${m[2]} ${m[3]}`);
    for (const m of s.matchAll(/(?<!\d)(\d{4,6})(?!\d)/g)) out.add(m[1]);
    return [...out].slice(0, 10);
  }
  async function ocrNumbers(file, onProg) {
    if (typeof window.ocrReceipt !== 'function') await ensureReceipt();
    const text = await window.ocrReceipt(file, onProg);
    return numbersFromText(text);
  }
  const webLinks = (kind, q) => {
    const e = encodeURIComponent, qq = q || '';
    return kind === 'lego'
      ? [['Rebrickable', `https://rebrickable.com/search/?show_printed=on&search_type=part&q=${e(qq)}`], ['BrickLink', `https://www.bricklink.com/v2/search.page?q=${e(qq)}`], ['Google Bilder', `https://www.google.com/search?tbm=isch&q=${e('LEGO ' + qq)}`]]
      : [['Klickypedia', `https://www.klickypedia.com/?s=${e(qq)}`], ['Google', `https://www.google.com/search?q=${e('Playmobil Ersatzteil ' + qq)}`], ['Google Bilder', `https://www.google.com/search?tbm=isch&q=${e('Playmobil ' + qq)}`], ['Google Lens (Foto)', 'https://lens.google.com/']];
  };
  const dedupe = items => { const seen = new Set(); return items.filter(i => { const k = normNr(i.nr) + '|' + (i.own ? 'own' : i.quelle); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const firstColour = f => { const s = String(f || '').trim(); return s && !s.includes(',') ? s : ''; };

  window.partSearchNumbersFromText = numbersFromText;
  window.partSearchDialog = function ({ kind = 'playmobil', name = '', onPick } = {}) {
    const lego = kind === 'lego';
    const d = document.createElement('dialog'); d.className = 'psdlg';
    d.innerHTML = `<h2 style="margin-top:0">🔍 Teil suchen</h2>
      <p class="muted" style="margin-top:0;font-size:.88rem">Foto, Beschreibung oder Name eingeben – gesucht wird in deiner Sammlung und ${lego ? 'bei Rebrickable und Brickognize' : 'bei Klickypedia (Playmobil-Teile-Datenbank)'}. Antippen übernimmt Nummer, Name und Farbe ins Formular.</p>
      <label for="psq">Beschreibung, Name oder Nummer</label>
      <div class="row"><input id="psq" style="flex:1" value="${esc(name)}" placeholder="${lego ? 'z.B. Brick 2 x 4 oder Fliese rund' : 'z.B. Topfhelm, Schwert, Pferd Sattel'}" autocomplete="off"><button class="btn" id="psGo" type="button">Suchen</button></div>
      <div class="row" style="margin-top:.5rem">
        <label class="btn secondary grow" style="margin:0">📷 Per Foto suchen<input id="psFile" type="file" accept="image/*" hidden></label>
      </div>
      <p class="muted" style="font-size:.82rem;margin:.35rem 0 0">${lego ? 'Beim Foto-Suchen wird das Bild zum Erkennen an Brickognize (brickognize.com) geschickt.' : 'Beim Foto-Suchen werden aufgedruckte Nummern (z.B. auf der Tüte) auf dem Gerät gelesen und dann bei Klickypedia nachgeschlagen. Das Foto selbst wird nicht hochgeladen. Für reine Bildsuche: „Google Lens“ unten.'}</p>
      <div id="psRes" style="margin-top:.8rem"></div>
      <div id="psWeb" style="margin-top:.6rem"></div>
      <div class="row" style="margin-top:.8rem"><button class="btn secondary grow" type="button" id="psClose">Schließen</button></div>`;
    document.body.appendChild(d); d.showModal();
    const res = d.querySelector('#psRes'), web = d.querySelector('#psWeb');
    let current = [];
    const renderWeb = q => { web.innerHTML = `<div class="muted" style="font-size:.85rem">Im Internet weitersuchen:</div><div class="row" style="flex-wrap:wrap;gap:.4rem;margin-top:.3rem">${webLinks(kind, q).map(([l, u]) => `<a class="btn small secondary" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div>`; };
    const infoLine = s => [s.kategorie, s.preis != null ? 'ca. ' + euro(s.preis) : '', s.score != null && !s.own ? Math.round(s.score * 100) + ' % sicher' : ''].filter(Boolean).map(esc).join(' · ');
    const setsHtml = s => s.sets?.length ? `<details class="pssets"><summary>In ${num(s.sets.length)} Set${s.sets.length === 1 ? '' : 's'}: ${esc(s.sets.slice(0, 3).map(x => x.split(' - ')[0]).join(', '))}${s.sets.length > 3 ? ' …' : ''}</summary><div class="sub">${s.sets.map(esc).join('<br>')}</div></details>` : '';
    const colorsHtml = s => s.farben ? `<div class="sub">Farben: ${esc(s.farben.slice(0, 8).map(c => `${c.farbe} (${c.sets} Sets)`).join(', '))}${s.farben.length > 8 ? ' …' : ''}</div>` : '';
    const card = (s, i) => `<div class="item psitem" data-i="${i}">${s.img ? `<img class="thumb" src="${esc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="thumb">🧩</div>'}
      <div class="info"><div class="title">${esc(s.nr)}</div>
        ${s.name || s.farbe ? `<div class="sub">${esc([s.name, s.farbe].filter(Boolean).join(' · '))}</div>` : ''}
        ${infoLine(s) ? `<div class="sub">${infoLine(s)}</div>` : ''}${setsHtml(s)}${colorsHtml(s)}
        <div class="sub">Quelle: ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.quelle)} ↗</a>` : esc(s.quelle)}${lego && s.rb && !s.farben ? ` · <button type="button" class="linkbtn" data-more="${i}">Farben &amp; Sets</button>` : ''}</div></div>
      <div class="right"><button class="btn small" type="button" data-pick="${i}">Übernehmen</button></div></div>`;
    const render = (items, hints = []) => {
      current = items;
      res.innerHTML = (hints.map(h => `<p class="muted pshint" style="font-size:.85rem">${esc(h)}</p>`).join('')) + (items.length
        ? `<div class="muted" style="font-size:.85rem;margin-bottom:.3rem">${num(items.length)} Vorschläge</div><div class="list">${items.map(card).join('')}</div>`
        : '<p class="muted">Keine Vorschläge gefunden. Andere Wörter probieren (auch englisch), im Internet weitersuchen oder „Keine Nummer gefunden“ wählen.</p>');
    };
    res.onclick = async e => {
      const more = e.target.closest('[data-more]');
      if (more) { more.disabled = true; more.textContent = 'lädt …'; const s = current[Number(more.dataset.more)];
        try { s.farben = (await rebrickableColors(s.nr)) || []; if (!s.farben.length) more.textContent = 'Nur mit Rebrickable-Schlüssel'; else render(current); } catch { more.textContent = 'Nicht erreichbar'; } return; }
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const s = current[Number(b.dataset.pick)]; d.close();
      if (onPick) onPick({ ...s, farbe: firstColour(s.farbe) });
    };
    d.querySelector('#psClose').onclick = () => d.close();
    d.addEventListener('close', () => d.remove());
    const byText = async () => {
      const q = d.querySelector('#psq').value.trim(); renderWeb(q);
      if (q.length < 2) return render([], ['Bitte eine Beschreibung, einen Namen oder eine Nummer eingeben.']);
      res.innerHTML = '<p class="muted">Suche in deiner Sammlung und im Internet …</p>';
      const items = ownMatches(kind, q), hints = [];
      try {
        const r = lego ? await rebrickableParts(isNrQuery(q) ? q.replace(/\s/g, '') : q) : await klickypedia(q);
        if (r.items) items.push(...r.items); if (r.hint) hints.push(r.hint);
      } catch { hints.push((lego ? 'Rebrickable' : 'Klickypedia') + ' ist gerade nicht erreichbar.'); }
      render(dedupe(items), hints);
    };
    d.querySelector('#psGo').onclick = byText;
    d.querySelector('#psq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); byText(); } };
    d.querySelector('#psFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      renderWeb(d.querySelector('#psq').value.trim());
      res.innerHTML = `<p class="muted">${lego ? 'Foto wird erkannt …' : 'Nummern auf dem Foto werden gelesen …'}</p>`;
      try {
        if (lego) return render(await brickognize(f));
        const nums = await ocrNumbers(f);
        if (!nums.length) return render([], ['Auf dem Foto war keine Nummer lesbar. Tipp: Aufdruck gerade und scharf fotografieren – oder das Teil beschreiben (z.B. „Helm silber“) und auf „Suchen“ tippen. Für eine reine Bildsuche „Google Lens“ unten nutzen.']);
        res.innerHTML = `<p class="muted">Gelesen: ${esc(nums.join(', '))} – wird nachgeschlagen …</p>`;
        const items = [], hints = [];
        for (const n of nums.slice(0, 4)) {
          const own = ownMatches(kind, n); items.push(...own.map(o => ({ ...o, quelle: 'Auf dem Foto gelesen · schon in deiner Sammlung' })));
          if (String(n).replace(/\D/g, '').length >= 6) { const r = await klickypedia(n); if (r.items?.length) items.push(...r.items); else if (r.hint && !hints.includes(r.hint)) hints.push(r.hint); }
          if (!items.some(i => normNr(i.nr) === normNr(n))) items.push({ nr: n, name: '', quelle: 'Auf dem Foto gelesen' });
        }
        render(dedupe(items), hints);
      } catch (err) { res.innerHTML = ''; fail(err); }
    };
    renderWeb(name);
    if (name) byText();
    return Promise.resolve(d);
  };
})();
