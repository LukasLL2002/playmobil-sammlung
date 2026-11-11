// Sortiva – Teilenummer suchen (Name/Beschreibung oder Foto). Nur Vorschläge, nichts wird automatisch gespeichert.
'use strict';
(function () {
  const BRICKOGNIZE = 'https://api.brickognize.com/predict/parts/';
  const words = q => norm(q).split(/\s+/).filter(w => w.length > 1);
  /** Eigene Sammlung durchsuchen (Teile mit Nummer, ähnlicher Name) */
  function ownMatches(kind, q) {
    const list = kind === 'lego' ? (typeof lstate !== 'undefined' ? lstate.teile : []) : state.teile;
    const ws = words(q); if (!ws.length) return [];
    const seen = new Set(), out = [];
    for (const t of list) {
      if (!hasNr(t)) continue;
      const hay = norm([t.beschreibung, t.farbe, t.notiz].join(' '));
      const hits = ws.filter(w => hay.includes(w)).length;
      if (!hits) continue;
      const k = normNr(t.teile_nr) + '|' + norm(t.farbe || '');
      if (seen.has(k)) continue; seen.add(k);
      out.push({ nr: t.teile_nr, name: t.beschreibung || '', farbe: t.farbe || '', img: imgUrl(t), quelle: 'Deine Sammlung', score: hits / ws.length });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  }
  async function rebrickableParts(q) {
    const key = typeof rebrickableKey === 'function' ? rebrickableKey() : '';
    if (!key) return { hint: 'Für die LEGO-Online-Suche einmal den eigenen Rebrickable-Schlüssel unter LEGO → Übersicht → Rebrickable eintragen.' };
    const r = await fetch(`https://rebrickable.com/api/v3/lego/parts/?search=${encodeURIComponent(q)}&page_size=12`, { headers: { Authorization: 'key ' + key } });
    if (r.status === 401) return { hint: 'Der Rebrickable-Schlüssel stimmt nicht. Bitte prüfen.' };
    if (!r.ok) return { hint: 'Rebrickable ist gerade nicht erreichbar.' };
    const d = await r.json();
    return { items: (d.results || []).map(p => ({ nr: p.part_num, name: p.name, img: p.part_img_url, quelle: 'Rebrickable' })) };
  }
  async function brickognize(file) {
    const fd = new FormData(); fd.append('query_image', file, file.name || 'foto.jpg');
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(BRICKOGNIZE, { method: 'POST', body: fd, headers: { accept: 'application/json' }, signal: ctl.signal });
      if (!r.ok) throw new Error('Die Bilderkennung ist gerade nicht erreichbar. Bitte später nochmal versuchen.');
      const d = await r.json();
      return (d.items || []).slice(0, 8).map(i => ({ nr: i.id, name: i.name, img: i.img_url, quelle: 'Brickognize', score: i.score }));
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
    const e = encodeURIComponent;
    const qq = q || '';
    return kind === 'lego'
      ? [['Rebrickable', `https://rebrickable.com/search/?show_printed=on&search_type=part&q=${e(qq)}`], ['BrickLink', `https://www.bricklink.com/v2/search.page?q=${e(qq)}`], ['Google Bilder', `https://www.google.com/search?tbm=isch&q=${e('LEGO ' + qq)}`]]
      : [['Klickypedia', `https://www.klickypedia.com/?s=${e(qq)}`], ['Google', `https://www.google.com/search?q=${e('Playmobil Ersatzteil ' + qq)}`], ['Google Bilder', `https://www.google.com/search?tbm=isch&q=${e('Playmobil ' + qq)}`]];
  };

  window.partSearchNumbersFromText = numbersFromText;
  window.partSearchDialog = function ({ kind = 'playmobil', name = '', onPick } = {}) {
    const lego = kind === 'lego';
    const d = document.createElement('dialog'); d.className = 'psdlg';
    d.innerHTML = `<h2 style="margin-top:0">🔍 Teilenummer suchen</h2>
      <label for="psq">Name oder Beschreibung</label>
      <div class="row"><input id="psq" style="flex:1" value="${esc(name)}" placeholder="${lego ? 'z.B. Brick 2 x 4' : 'z.B. Ritterhelm'}"><button class="btn" id="psGo" type="button">Suchen</button></div>
      <div class="row" style="margin-top:.5rem">
        <label class="btn secondary grow" style="margin:0">📷 Per Foto suchen<input id="psFile" type="file" accept="image/*" hidden></label>
      </div>
      <p class="muted" style="font-size:.82rem;margin:.35rem 0 0">${lego ? 'Beim Foto-Suchen wird das Bild zum Erkennen an Brickognize (brickognize.com) geschickt.' : 'Beim Foto-Suchen werden aufgedruckte Nummern (z.B. auf der Tüte) direkt auf dem Gerät gelesen – das Foto wird nicht hochgeladen.'}</p>
      <div id="psRes" style="margin-top:.8rem"></div>
      <div id="psWeb" style="margin-top:.6rem"></div>
      <div class="row" style="margin-top:.8rem"><button class="btn secondary grow" type="button" id="psClose">Schließen</button></div>`;
    document.body.appendChild(d); d.showModal();
    const res = d.querySelector('#psRes'), web = d.querySelector('#psWeb');
    let current = [];
    const renderWeb = q => { web.innerHTML = `<div class="muted" style="font-size:.85rem">Im Internet weitersuchen:</div><div class="row" style="flex-wrap:wrap;gap:.4rem;margin-top:.3rem">${webLinks(kind, q).map(([l, u]) => `<a class="btn small secondary" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join('')}</div>`; };
    const render = (items, hints = []) => {
      current = items;
      res.innerHTML = (hints.map(h => `<p class="muted" style="font-size:.85rem">${esc(h)}</p>`).join('')) + (items.length
        ? `<div class="list">${items.map((s, i) => `<div class="item psitem">${s.img ? `<img class="thumb" src="${esc(s.img)}" alt="" loading="lazy">` : '<div class="thumb">🧩</div>'}
            <div class="info"><div class="title">${esc(s.nr)}</div><div class="sub">${esc([s.name, s.farbe].filter(Boolean).join(' · '))}</div><div class="sub">${esc(s.quelle)}${s.score != null && s.quelle !== 'Deine Sammlung' ? ' · ' + Math.round(s.score * 100) + ' % sicher' : ''}</div></div>
            <div class="right"><button class="btn small" type="button" data-pick="${i}">Übernehmen</button></div></div>`).join('')}</div>`
        : '<p class="muted">Keine Vorschläge gefunden. Du kannst im Internet weitersuchen oder „Keine Nummer gefunden“ wählen.</p>');
    };
    res.onclick = e => { const b = e.target.closest('[data-pick]'); if (!b) return; const s = current[Number(b.dataset.pick)]; d.close(); if (onPick) onPick(s); };
    d.querySelector('#psClose').onclick = () => d.close();
    d.addEventListener('close', () => d.remove());
    const byName = async () => {
      const q = d.querySelector('#psq').value.trim(); renderWeb(q);
      if (!q) return render([], ['Bitte einen Namen oder eine Beschreibung eingeben.']);
      res.innerHTML = '<p class="muted">Suche …</p>';
      const items = ownMatches(kind, q), hints = [];
      if (lego) { try { const r = await rebrickableParts(q); if (r.items) items.push(...r.items); if (r.hint) hints.push(r.hint); } catch { hints.push('Rebrickable ist gerade nicht erreichbar.'); } }
      else if (!items.length) hints.push('Für Playmobil gibt es keine offizielle Online-Suche. Unten kannst du im Internet weitersuchen.');
      render(items, hints);
    };
    d.querySelector('#psGo').onclick = byName;
    d.querySelector('#psq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); byName(); } };
    d.querySelector('#psFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      renderWeb(d.querySelector('#psq').value.trim());
      res.innerHTML = `<p class="muted">${lego ? 'Foto wird erkannt …' : 'Nummern auf dem Foto werden gelesen …'}</p>`;
      try {
        if (lego) return render(await brickognize(f));
        const nums = await ocrNumbers(f);
        const own = state.teile;
        render(nums.map(n => { const hit = own.find(t => hasNr(t) && normNr(t.teile_nr) === normNr(n)); return { nr: n, name: hit?.beschreibung || '', farbe: hit?.farbe || '', img: hit ? imgUrl(hit) : null, quelle: hit ? 'Auf dem Foto gelesen · schon in deiner Sammlung' : 'Auf dem Foto gelesen' }; }),
          nums.length ? [] : ['Auf dem Foto war keine Nummer lesbar. Tipp: Aufdruck gerade und scharf fotografieren.']);
      } catch (err) { res.innerHTML = ''; fail(err); }
    };
    renderWeb(name);
    if (name) byName();
    return Promise.resolve(d);
  };
})();
