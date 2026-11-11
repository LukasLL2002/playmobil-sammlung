const { chromium } = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const XLSXJS = fs.readFileSync('/tmp/xl/xlsx.full.min.js', 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); };
(async () => {
  await new Promise(r => srv.listen(8766, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route('**/vendor/supabase/supabase.min.js*', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await ctx.route('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/**', r => r.fulfill({ contentType: 'text/javascript', body: XLSXJS }));
  const net = [];
  await ctx.route('https://rebrickable.com/api/v3/lego/parts/**', r => { net.push(r.request().url()); r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [{ part_num: '3001', name: 'Brick 2 x 4', part_img_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }] }) }); });
  await ctx.route('https://api.brickognize.com/**', r => { net.push(r.request().url()); r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ items: [{ id: '3003', name: 'Brick 2 x 2', img_url: '', score: 0.93 }] }) }); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const go = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(400); };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
  await page.goto('http://localhost:8766/index.html#teile');
  await page.evaluate(() => localStorage.removeItem('__mockdb')); await page.reload();
  await page.waitForSelector('#list .item');

  // --- Teile-Reiter: keine Vorrat-Knöpfe, richtiger „＋ Teil“ ---
  const vorratLinks = await page.locator('main a[href^="#v/"]').count();
  ok('Teile tab has no Vorrat/Kassenbon buttons', vorratLinks === 0 && !(await page.textContent('main')).includes('Kassenbon'), { vorratLinks });
  await page.click('#addTeil'); await page.waitForTimeout(400);
  ok('„＋ Teil“ opens Playmobil part form', page.url().endsWith('#teil/neu') && (await page.textContent('h1')) === 'Neues Teil', page.url());
  await go('#teile'); ok('Teile tab offers Excel import', (await page.getAttribute('#impTeile', 'href')) === '#import');
  await go('#l/teile'); ok('LEGO has no Kassenbon', !(await page.textContent('main')).includes('Kassenbon') && (await page.locator('main a[href^="#v/"]').count()) === 0);

  // --- Import: alle 5 Blätter ---
  const doImport = async (hash, file) => {
    await go('#kisten'); await go(hash); await page.setInputFiles('#file', file); await page.waitForSelector('[data-sheet]', { timeout: 15000 });
  };
  await doImport('#import', '/tmp/xl/teile-5blaetter.xlsx');
  const sheetInfo = await page.$$eval('[data-sheet]', a => a.map(c => ({ n: c.dataset.sheet, on: c.checked, t: c.parentElement.textContent.replace(/\s+/g, ' ').trim() })));
  ok('all 5 sheets listed, checked, with row counts', sheetInfo.length === 5 && sheetInfo.every(s => s.on) && sheetInfo[1].t.includes('4 Zeilen'), sheetInfo);
  await page.click('#go'); await page.waitForSelector('#revSum');
  let sum = await page.textContent('#revSum');
  ok('review: 9 new (file duplicate across sheets merged)', /9 neu/.test(sum) && /0 schon vorhanden/.test(sum), sum);
  await page.click('#run'); await page.waitForSelector('#importSummary', { timeout: 15000 });
  sum = await page.textContent('#importSummary');
  let d = await db();
  const imported = d.teile.filter(t => !['11', '12'].includes(String(t.id)));
  const ritter = imported.find(t => t.beschreibung === 'Ritter');
  const ritterSets = d.teil_sets.filter(x => x.teil_id === ritter.id).map(x => d.sets.find(s => s.id === x.set_id).set_nummer);
  const bart = imported.find(t => t.beschreibung === 'Bart');
  ok('first import: all sheets imported (9 new)', /9 neu/.test(sum) && imported.length === 9 && ['Ritterhelm', 'Zaun', 'Helm', 'Schild'].every(n => imported.some(t => (t.beschreibung || '').includes(n))), { sum, n: imported.length });
  ok('"---" treated as empty; empty number marked unknown', imported.every(t => t.farbe !== '---' && t.teile_nr !== '---') && bart.teile_nr == null && bart.nummer_unbekannt === true, bart);
  ok('file duplicate merged (Ritter once, sets from both sheets)', imported.filter(t => t.beschreibung === 'Ritter').length === 1 && ritterSets.includes('4000'), ritterSets);
  const guertel = imported.find(t => t.beschreibung === 'Gürtel');
  const gSets = d.teil_sets.filter(x => x.teil_id === guertel.id).map(x => d.sets.find(s => s.id === x.set_id).set_nummer).sort();
  ok('cell "3347; 3348" links both Reserve entries', JSON.stringify(gSets) === '["3347","3348"]', gSets);
  const before = { teile: d.teile.length, links: d.teil_sets.length, sets: d.sets.length, kisten: d.kisten.length };

  // --- erneut hochladen (gleiche Datei) ---
  await doImport('#import', '/tmp/xl/teile-5blaetter.xlsx'); await page.click('#go'); await page.waitForSelector('#revSum');
  sum = await page.textContent('#revSum');
  ok('reimport review: 0 new, 9 unchanged', /0 neu/.test(sum) && /9 schon vorhanden/.test(sum) && /0 vorhanden mit Änderungen/.test(sum), sum);
  await page.click('#run'); await page.waitForSelector('#importSummary');
  d = await db();
  const deletes = d.log.filter(l => l.op === 'delete' && ['teile', 'teil_sets', 'sets', 'kisten'].includes(l.t)).length;
  ok('reimport: no new rows, nothing deleted', d.teile.length === before.teile && d.teil_sets.length === before.links && d.sets.length === before.sets && deletes === 0, { after: d.teile.length, before, deletes, sum: await page.textContent('#importSummary') });

  // --- ODS mit Änderungen? zuerst ODS gleich → 0 neu
  await doImport('#import', '/tmp/xl/teile-5blaetter.ods'); const odsSheets = await page.locator('[data-sheet]').count();
  await page.click('#go'); await page.waitForSelector('#revSum');
  ok('ODS file read (all sheets, 0 new on reimport)', /0 neu/.test(await page.textContent('#revSum')) && odsSheets === 5, odsSheets);

  // --- geänderte Datei: Abfrage pro Teil ---
  await doImport('#import', '/tmp/xl/teile-5blaetter-geaendert.xlsx'); await page.click('#go'); await page.waitForSelector('#revSum');
  sum = await page.textContent('#revSum');
  const chg = await page.locator('.chg').count();
  ok('changed values listed for decision', /2 vorhanden mit Änderungen/.test(sum) && chg === 2, { sum, chg });
  await page.screenshot({ path: path.join(__dirname, 'import-review-390.png'), fullPage: true });
  await page.click('#run'); await page.waitForTimeout(300);
  ok('must decide before import', (await page.locator('.chg.need').count()) === 2 && !(await page.locator('#importSummary').count()));
  const idxHelm = await page.$$eval('.chg', els => els.findIndex(e => e.textContent.includes('Ritterhelm')));
  const idxZaun = 1 - idxHelm;
  await page.check(`input[name="dec${idxHelm}"][value="upd"]`); await page.check(`input[name="dec${idxZaun}"][value="skip"]`);
  await page.click('#run'); await page.waitForSelector('#importSummary');
  sum = await page.textContent('#importSummary'); d = await db();
  const helm = d.teile.find(t => t.beschreibung === '1. Ritterhelm'), zaun = d.teile.find(t => t.teile_nr === '20 30 3000');
  ok('only chosen item updated; summary', helm.anzahl === 5 && zaun.beschreibung === 'Zaun' && /0 neu/.test(sum) && /1 aktualisiert/.test(sum) && /8 übersprungen/.test(sum) && d.teile.length === before.teile, { sum, helm: helm.anzahl, zaun: zaun.beschreibung });
  // Bulk-Knöpfe
  await doImport('#import', '/tmp/xl/teile-5blaetter-geaendert.xlsx'); await page.click('#go'); await page.waitForSelector('#revSum');
  await page.click('#allUpd'); ok('"Alle aktualisieren" selects all', (await page.locator('input[value="upd"]:checked').count()) === (await page.locator('.chg').count()));
  await page.click('#allSkip'); ok('"Alle überspringen" selects all', (await page.locator('input[value="skip"]:checked').count()) === (await page.locator('.chg').count()));
  // Blatt abwählen
  await doImport('#import', '/tmp/xl/teile-5blaetter.xlsx'); await page.uncheck('[data-sheet="T-Z"]'); ok('sheet can be unchecked', (await page.textContent('#rowCount')).trim() === '9');

  // LEGO-Import der ODS
  await doImport('#l/import', '/tmp/xl/teile-5blaetter.ods'); await page.click('#go'); await page.waitForSelector('#revSum');
  await page.click('#run'); await page.waitForSelector('#importSummary');
  d = await db(); ok('LEGO import reads all sheets', d.lego_teile.length === 1 + 9, d.lego_teile.length);

  // --- Keine Nummer gefunden ---
  await go('#teil/neu');
  await page.check('#nrUnk'); ok('number field disabled when "Keine Nummer gefunden"', await page.isDisabled('#nr'));
  await page.fill('#beschr', 'Unbekanntes Teil'); await page.click('#save'); await page.waitForTimeout(600);
  d = await db(); const unk = d.teile.find(t => t.beschreibung === 'Unbekanntes Teil');
  ok('unknown flag saved', unk && unk.nummer_unbekannt === true && unk.teile_nr == null, unk);
  await go('#teile'); await page.selectOption('#fNr', 'ohne'); await page.waitForTimeout(200);
  const ohne = await page.$$eval('#list .item', a => a.map(x => x.textContent));
  ok('"Ohne Nummer" filter + badge', ohne.length === 2 && ohne.every(t => t.includes('ohne Nr.')), ohne.map(t => t.slice(0, 40)));
  await page.selectOption('#fNr', '');

  // --- Nummer suchen (Playmobil) ---
  await go('#teil/neu'); await page.fill('#beschr', 'Schwert'); await page.click('#nrSearch'); await page.waitForSelector('.psdlg [data-pick]', { timeout: 8000 });
  const pmSug = await page.$$eval('.psdlg .psitem', a => a.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  const links = await page.$$eval('#psWeb a', a => a.map(x => x.href));
  ok('PM name search: own collection suggestion + web links', pmSug.some(s => s.includes('30 22 1110')) && links.some(l => l.includes('klickypedia.com/?s=Schwert')), { pmSug, links });
  await page.click('.psdlg [data-pick="0"]'); await page.waitForTimeout(200);
  ok('pick fills number, nothing saved', (await page.inputValue('#nr')) === '30 22 1110' && !(await page.isChecked('#nrUnk')) && page.url().endsWith('#teil/neu'));
  await page.evaluate(() => { window.viewBon = () => {}; window.ocrReceipt = async () => 'Beutel Nr. 30 00 1234\nrot'; });
  await page.click('#nrSearch'); await page.waitForSelector('.psdlg');
  await page.setInputFiles('.psdlg #psFile', '/tmp/img-red.png'); await page.waitForSelector('.psdlg [data-pick]');
  const ocrSug = await page.$$eval('.psdlg .psitem .title', a => a.map(x => x.textContent));
  ok('PM photo search reads printed number (OCR)', ocrSug.includes('30 00 1234'), ocrSug);
  await page.click('.psdlg #psClose');
  // LEGO
  await page.evaluate(() => localStorage.setItem('rebrickableKey', 'test-key'));
  await go('#l/teil/neu'); await page.fill('#bes', 'Brick'); await page.click('#nrSearch'); await page.waitForSelector('.psdlg [data-pick]');
  const lSug = await page.$$eval('.psdlg .psitem', a => a.map(x => x.textContent.replace(/\s+/g, ' ')));
  ok('LEGO name search: Rebrickable suggestion (mocked)', lSug.some(s => s.includes('3001') && s.includes('Rebrickable')), lSug);
  await page.setInputFiles('.psdlg #psFile', '/tmp/img-red.png'); await page.waitForFunction(() => document.querySelector('.psdlg')?.textContent.includes('3003'));
  ok('LEGO photo search: Brickognize suggestion (mocked)', (await page.textContent('.psdlg')).includes('93 % sicher') && net.some(u => u.includes('brickognize')));
  await page.click('.psdlg [data-pick="0"]'); ok('LEGO pick fills number', (await page.inputValue('#nr')) === '3003');

  // --- Kisten: freie/leere Nummer, löschen ---
  await go('#kisten'); await page.click('#nk');
  ok('Kiste number not required', (await page.getAttribute('dialog[open] input[name=nummer]', 'required')) === null);
  await page.fill('dialog[open] input[name=name]', 'Ohne Nummer Kiste'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500);
  d = await db(); const k0 = d.kisten.find(k => k.name === 'Ohne Nummer Kiste');
  ok('Kiste with empty number saved', k0 && k0.nummer == null, k0);
  await go('#kisten'); await page.click('#nk'); await page.fill('dialog[open] input[name=nummer]', 'A-G 2b'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500);
  d = await db(); ok('Kiste with free-text number saved', d.kisten.some(k => k.nummer === 'A-G 2b'));
  await go('#kisten'); const kl = await page.$$eval('.list .item .title', a => a.map(x => x.textContent));
  ok('list shows names for empty numbers', kl.some(x => x.includes('Kiste – Ohne Nummer Kiste')) && !kl.some(x => x.includes('null')), kl);
  // LEGO Kiste ohne Nummer
  await go('#l/kisten'); await page.click('#nk'); await page.fill('dialog[open] input[name=name]', 'LEGO leer'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500);
  d = await db(); ok('LEGO Kiste with empty number saved', d.lego_kisten.some(k => k.name === 'LEGO leer' && k.nummer == null));
  // Löschen mit Teilen
  d = await db(); const inK = d.teile.filter(t => t.kiste_id === 21).map(t => t.id);
  await go('#kiste/21'); dialogs.length = 0; await page.click('#dk'); await page.waitForTimeout(600);
  d = await db();
  ok('delete Kiste: confirm says parts stay', dialogs[0] && dialogs[0].includes('NICHT gelöscht'), dialogs[0]);
  ok('delete Kiste: parts kept, unassigned', !d.kisten.some(k => k.id === 21) && inK.length > 0 && inK.every(id => d.teile.find(t => t.id === id)?.kiste_id === null), { inK });
  await go('#l/kiste/51'); dialogs.length = 0; await page.click('#dk'); await page.waitForTimeout(600);
  d = await db(); ok('delete LEGO Kiste: parts kept, unassigned', !d.lego_kisten.some(k => k.id === 51) && d.lego_teile.find(t => t.id === 41)?.kiste_id === null);

  // --- Reserve mit Teile-Angaben ---
  await go('#kisten'); await page.click('#nk'); await page.fill('dialog[open] input[name=nummer]', '7'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(400);
  d = await db(); const k7 = d.kisten.find(k => k.nummer === '7');
  await go('#reserve'); await page.click('#ns');
  const fields = await page.$$eval('dialog[open] [name]', a => a.map(x => x.name));
  ok('Reserve form has part fields', ['set_nummer', 'name', 'farbe', 'anzahl', 'beschreibung', 'euro', 'kiste_id', 'notiz'].every(f => fields.includes(f)), fields);
  await page.fill('dialog[open] [name=set_nummer]', '9999'); await page.fill('dialog[open] [name=name]', 'Feuerwehr'); await page.fill('dialog[open] [name=farbe]', 'rot');
  await page.fill('dialog[open] [name=anzahl]', '2'); await page.fill('dialog[open] [name=euro]', '4,50'); await page.selectOption('dialog[open] [name=kiste_id]', String(k7.id));
  await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(700);
  d = await db(); const s9 = d.sets.find(s => s.set_nummer === '9999');
  const p9 = d.teile.filter(t => t.teile_nr === '9999');
  ok('Reserve saved with part fields', s9 && s9.anzahl === 2 && Number(s9.euro) === 4.5 && s9.kiste_id === k7.id && s9.farbe === 'rot', s9);
  ok('matching part created in Teile, linked, in Kiste', p9.length === 1 && p9[0].kiste_id === k7.id && p9[0].anzahl === 2 && d.teil_sets.some(x => x.teil_id === p9[0].id && x.set_id === s9.id), p9);
  await go('#reserve'); const tile = (await page.textContent(`a[href="#set/${s9.id}"]`)).replace(/\s+/g, ' ');
  ok('Reserve tile shows Kiste + price line', tile.includes('Kiste 7') && tile.includes('4,50 € je Stück · 9,00 € gesamt'), tile.replace(/\s+/g, ' '));
  await go('#set/' + s9.id); ok('Reserve detail shows Kiste', (await page.textContent('#setFacts')).includes('Kiste 7'));
  await page.click('#es'); await page.fill('dialog[open] [name=anzahl]', '3'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(600);
  d = await db(); ok('editing Reserve updates the same part (no duplicate)', d.teile.filter(t => t.teile_nr === '9999').length === 1 && d.teile.find(t => t.teile_nr === '9999').anzahl === 3);
  await go('#kiste/' + k7.id); ok('part appears in Kiste', (await page.textContent('main')).includes('Feuerwehr'));
  // aus dem Teil-Formular heraus
  await go('#teil/neu'); await page.fill('#nr', '55 55 5555'); await page.fill('#beschr', 'Leiter'); await page.fill('#anz', '4'); await page.selectOption('#kiste', String(k7.id));
  await page.click('#newRes'); await page.waitForSelector('dialog[open] [name=set_nummer]');
  const fromPartFields = await page.$$eval('dialog[open] [name]', a => a.map(x => x.name));
  ok('from part form: dialog only creates group entry', !fromPartFields.includes('anzahl') && (await page.textContent('dialog[open]')).includes('bitte danach wie gewohnt speichern'));
  await page.fill('dialog[open] [name=set_nummer]', '8888'); await page.fill('dialog[open] [name=name]', 'Leiterwagen'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500);
  ok('part form values survive', (await page.inputValue('#nr')) === '55 55 5555' && (await page.inputValue('#anz')) === '4' && (await page.inputValue('#kiste')) === String(k7.id) && page.url().includes('#teil/neu') && (await page.textContent('#chips')).includes('8888'));
  await page.click('#save'); await page.waitForTimeout(700);
  d = await db(); const leiter = d.teile.find(t => t.beschreibung === 'Leiter'); const s8 = d.sets.find(s => s.set_nummer === '8888');
  ok('part saved in Teile with Kiste, linked to new Reserve; Reserve has Kiste', leiter && leiter.kiste_id === k7.id && leiter.anzahl === 4 && d.teil_sets.some(x => x.teil_id === leiter.id && x.set_id === s8.id) && s8.kiste_id === k7.id && !d.teile.some(t => t.teile_nr === '8888'), { leiter, s8 });
  // Duplikatprüfung bleibt
  await go('#reserve'); await page.click('#ns'); await page.fill('dialog[open] [name=set_nummer]', '99-99'); await page.fill('dialog[open] [name=name]', 'Neu'); await page.fill('dialog[open] [name=anzahl]', '7');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]'); await page.click('.dupdlg [data-yes]'); await page.waitForTimeout(500);
  d = await db(); const s9b = d.sets.find(s => s.id === s9.id);
  ok('duplicate overwrite still only number+name', s9b.set_nummer === '99-99' && s9b.name === 'Neu' && s9b.anzahl === 3 && d.sets.filter(s => normNr(s.set_nummer) === '9999').length === 1, s9b);
  // --- Duplikat: drei Wege (t61u) ---
  const linksOf = (dd, sid) => dd.teil_sets.filter(x => x.set_id === sid).map(x => x.teil_id).sort();
  const linksBefore = linksOf(d, s9.id);
  // (3) Abbrechen aus dem Teil-Formular
  await go('#teil/neu'); await page.fill('#nr', '66 66 6666'); await page.fill('#beschr', 'Schlauch'); await page.fill('#anz', '2');
  await page.click('#newRes'); await page.fill('dialog[open] [name=set_nummer]', '9999'); await page.fill('dialog[open] [name=name]', 'Feuerwehr XL');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]');
  const btns = await page.$$eval('.dupdlg button', a => a.map(x => x.textContent.trim()));
  ok('part form: prompt offers Aktualisieren / Diesem Teil zuordnen / Abbrechen', JSON.stringify(btns) === '["Aktualisieren","Diesem Teil zuordnen","Abbrechen"]' && (await page.textContent('.dupdlg')).includes('99-99'), btns);
  await page.click('.dupdlg [data-no]'); await page.waitForTimeout(250);
  d = await db();
  ok('Abbrechen: nothing changed, set dialog + part form values kept', (await page.inputValue('dialog[open] [name=set_nummer]')) === '9999' && (await page.inputValue('dialog[open] [name=name]')) === 'Feuerwehr XL'
    && d.sets.find(s => s.id === s9.id).name === 'Neu' && JSON.stringify(linksOf(d, s9.id)) === JSON.stringify(linksBefore) && (await page.inputValue('#nr')) === '66 66 6666' && !(await page.textContent('#chips')).includes('99-99'));
  // (2) Diesem Teil zuordnen
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]'); await page.click('.dupdlg [data-link]'); await page.waitForTimeout(400);
  d = await db();
  ok('Diesem Teil zuordnen: existing entry unchanged, shown in chips', d.sets.find(s => s.id === s9.id).name === 'Neu' && (await page.textContent('#chips')).includes('99-99') && (await page.inputValue('#anz')) === '2' && !(await page.locator('dialog[open] [name=set_nummer]').count()));
  await page.click('#save'); await page.waitForTimeout(700);
  d = await db(); const schlauch = d.teile.find(t => t.beschreibung === 'Schlauch');
  ok('Diesem Teil zuordnen: part saved + linked, old links kept', schlauch && linksBefore.every(id => linksOf(d, s9.id).includes(id)) && linksOf(d, s9.id).includes(schlauch.id) && d.sets.filter(s => normNr(s.set_nummer) === '9999').length === 1, linksOf(d, s9.id));
  // (1) Aktualisieren aus dem Teil-Formular
  const links2 = linksOf(d, s9.id);
  await go('#teil/neu'); await page.fill('#nr', '77 77 7777'); await page.fill('#beschr', 'Axt');
  await page.click('#newRes'); await page.fill('dialog[open] [name=set_nummer]', '9999'); await page.fill('dialog[open] [name=name]', 'Feuerwehr XL');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]'); await page.click('.dupdlg [data-yes]'); await page.waitForTimeout(500);
  ok('Aktualisieren: current part gets entry in chips', (await page.textContent('#chips')).includes('9999 Feuerwehr XL'));
  await page.click('#save'); await page.waitForTimeout(700);
  d = await db(); const axt = d.teile.find(t => t.beschreibung === 'Axt'); const s9c = d.sets.find(s => s.id === s9.id);
  ok('Aktualisieren: number+name updated, all existing links survive, part linked', s9c.set_nummer === '9999' && s9c.name === 'Feuerwehr XL' && s9c.anzahl === 3
    && links2.every(id => linksOf(d, s9.id).includes(id)) && linksOf(d, s9.id).includes(axt.id) && !d.log.some(l => l.op === 'delete' && l.t === 'teil_sets'), { links2, now: linksOf(d, s9.id) });
  // Reserve-Reiter: Aktualisieren / Vorhandenes öffnen / Abbrechen
  await go('#reserve'); await page.click('#ns'); await page.fill('dialog[open] [name=set_nummer]', '9999');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]');
  const tabBtns = await page.$$eval('.dupdlg button', a => a.map(x => x.textContent.trim()));
  ok('Reserve tab: prompt offers Aktualisieren / Vorhandenes öffnen / Abbrechen (no part option)', JSON.stringify(tabBtns) === '["Aktualisieren","Vorhandenes öffnen","Abbrechen"]', tabBtns);
  await page.click('.dupdlg [data-open]'); await page.waitForTimeout(500);
  d = await db();
  ok('Vorhandenes öffnen: shows existing entry, nothing changed', page.url().endsWith('#set/' + s9.id) && !(await page.locator('dialog[open]').count()) && d.sets.find(s => s.id === s9.id).name === 'Feuerwehr XL');
  // LEGO aus dem Teil-Formular: zuordnen
  await go('#l/teil/neu'); await page.click('#newRes'); await page.fill('dialog[open] [name=set_nummer]', '75192');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]'); await page.click('.dupdlg [data-link]'); await page.waitForTimeout(400);
  d = await db();
  ok('LEGO part form: Diesem Teil zuordnen adds chip, entry unchanged', (await page.textContent('#setTags')).includes('75192') && d.lego_sets.find(s => s.id === 31).name.startsWith('Millennium'));

  // Export
  await go('#uebersicht');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvSets')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('Reserve/Sets export includes new fields', csv.includes('Einzelpreis') && csv.includes('In Kiste') && csv.includes('Kiste 7') && csv.includes('4,50'), csv.split('\n')[0]);

  ok('no page errors', errs.length === 0, errs);
  fs.writeFileSync(path.join(__dirname, 'import-kisten-result.json'), JSON.stringify({ when: new Date().toISOString(), viewport: '390x844', results }, null, 2));
  await browser.close(); srv.close();
  const failed = results.filter(r => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
function normNr(s) { return String(s ?? '').toLowerCase().replace(/[\s\-‐‑–—]+/g, ''); }
