const { chromium } = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info ? JSON.stringify(info) : ''); };
(async () => {
  await new Promise(r => srv.listen(8767, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route('**/vendor/supabase/supabase.min.js*', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  const go = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(350); };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
  const B = 'http://localhost:8767/index.html';
  await page.goto(B + '#teile');
  await page.evaluate(() => localStorage.removeItem('__mockdb')); await page.reload(); await page.waitForSelector('#list .item');
  // Echte Datenlage nachbauen: >1000 Reserve-Einträge, Nummern mit Namen/Resten, wichtige erst nach Zeile 1000
  await page.evaluate(() => {
    const filler = Array.from({ length: 1200 }, (_, i) => ({ set_nummer: String(10000 + i) }));
    window.__mock.addSets(filler);
    window.__mock.addSets([{ set_nummer: '3112 – Gefängnisfestung' }, { set_nummer: '3112-A -' }, { set_nummer: '2013 (Ausgabe 5)' }, { set_nummer: '5581 -' }, { set_nummer: '3429)' }]);
  });
  await page.reload(); await page.waitForSelector('#list .item'); await page.waitForTimeout(400);
  const newSet = async (tab, nr, name = '') => { await go(tab); await page.click('#ns'); await page.fill('dialog[open] [name=set_nummer]', nr); if (name) await page.fill('dialog[open] [name=name]', name); await page.click('dialog[open] button[type=submit]'); };
  const dupInfo = async () => { await page.waitForSelector('.dupdlg[open]', { timeout: 4000 });
    return page.evaluate(() => ({ title: document.querySelector('.dupdlg h2').textContent, btns: [...document.querySelectorAll('.dupdlg button')].map(b => b.textContent.trim()), tiles: [...document.querySelectorAll('.dupdlg [data-dup] .title')].map(x => x.textContent.trim()), subs: [...document.querySelectorAll('.dupdlg [data-dup] .sub')].map(x => x.textContent.trim()) })); };
  const noDup = async () => { await page.waitForTimeout(600); return !(await page.locator('.dupdlg[open]').count()); };

  // Ursache 1: nur die ersten 1000 Zeilen wurden geladen
  await go('#reserve'); const cnt = (await page.textContent('#sCount')).replace(/\D/g, '');
  ok('all Reserve entries loaded (>1000, paginated)', Number(cnt) === 3 + 1205, cnt);
  await page.fill('#sq', '3112-A'); ok('entry beyond row 1000 visible in list', (await page.locator('#sList .item').count()) === 1);
  await page.click('#sqClear');

  // Ursache 2: Nummer mit Namen/Resten („3112 – Gefängnisfestung“, „3112-A -“) → ähnliche Nummer
  await newSet('#reserve', '3112', 'Gefängnis');
  let di = await dupInfo();
  ok('"3112" finds similar "3112 – Gefängnisfestung" and "3112-A -"', di.title.startsWith('Ähnliche Nummer') && di.tiles.some(x => x.startsWith('3112 – Gefängnisfestung')) && di.tiles.some(x => x.startsWith('3112-A -')), di);
  ok('near match offers Aktualisieren / Vorhandenes öffnen / Mit dieser Nummer anlegen / Abbrechen', JSON.stringify(di.btns) === '["Aktualisieren","Vorhandenes öffnen","Mit dieser Nummer anlegen","Abbrechen"]', di.btns);
  await page.click('.dupdlg [data-create]'); await page.waitForTimeout(600);
  let d = await db();
  ok('"Mit dieser Nummer anlegen" creates exactly "3112", old entries untouched', d.sets.filter(s => s.set_nummer === '3112').length === 1 && d.sets.some(s => s.set_nummer === '3112 – Gefängnisfestung') && d.sets.some(s => s.set_nummer === '3112-A -'));

  // „3112 -“ → gleiche Nummer wie „3112“
  await newSet('#reserve', '3112 -');
  di = await dupInfo();
  ok('"3112 -" recognised as existing 3112 (exact first, no "anlegen")', di.title.startsWith('Schon vorhanden') && di.tiles[0].startsWith('3112') && di.subs[0].includes('gleiche Nummer') && !di.btns.includes('Mit dieser Nummer anlegen') && di.tiles.length === 3, di);
  await page.click('.dupdlg [data-no]'); await page.waitForTimeout(200);
  ok('Abbrechen keeps dialog values', (await page.inputValue('dialog[open] [name=set_nummer]')) === '3112 -'); await page.click('dialog[open] [data-cancel]');

  // Normalisierung: Leerzeichen, Punkte, Unicode-Striche, geschützte Leerzeichen, Vollbreite, führende Null, Groß/klein
  for (const v of ['36 66', '3.666', '3\u2011666', '3\u00a0666', '\uff13\uff16\uff16\uff16', '03666', '5581', '3429']) {
    await newSet('#reserve', v); di = await dupInfo();
    ok(`"${v.replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16))}" = existing`, di.title.startsWith('Schon vorhanden'), di.tiles);
    await page.click('.dupdlg [data-no]'); await page.click('dialog[open] [data-cancel]'); await page.waitForTimeout(150);
  }
  // Klammer-Zusatz
  await newSet('#reserve', '2013'); di = await dupInfo();
  ok('"2013" finds "2013 (Ausgabe 5)"', di.tiles.some(x => x.startsWith('2013 (Ausgabe 5)')) && di.btns.includes('Mit dieser Nummer anlegen'), di);
  await page.click('.dupdlg [data-no]'); await page.click('dialog[open] [data-cancel]');

  // Ursache 3: anderer Reiter (Reserve ↔ Sets) wurde nicht geprüft
  await newSet('#sets', '3666', 'Burg'); di = await dupInfo();
  ok('Sets tab detects number from Reserve, says which tab', di.tiles[0].startsWith('3666') && di.subs[0].includes('„Reserve“') && di.btns.includes('Mit dieser Nummer anlegen'), di);
  await page.click('.dupdlg [data-create]'); await page.waitForTimeout(600); d = await db();
  ok('"anlegen" across kinds creates the Set', d.sets.some(s => s.set_nummer === '3666' && s.art === 'set'));

  // Ursache 4: veraltete Liste (anderes Gerät/Import) – Prüfung direkt in der Datenbank
  await page.evaluate(() => window.__mock.addSets([{ set_nummer: '7777 – von anderem Gerät' }]));
  await newSet('#reserve', '7777'); di = await dupInfo();
  ok('server-side check finds entry not yet in loaded list', di.tiles.some(x => x.startsWith('7777 – von anderem Gerät')), di);
  await page.click('.dupdlg [data-no]'); await page.click('dialog[open] [data-cancel]');

  // Teil-Formular: mehrere Treffer, Auswahl, „Diesem Teil zuordnen“, „anlegen“
  await go('#teil/neu'); await page.fill('#beschr', 'Gitter'); await page.click('#newRes');
  await page.fill('dialog[open] [name=set_nummer]', '3112'); await page.click('dialog[open] button[type=submit]'); di = await dupInfo();
  ok('part form: exact + similar listed with Diesem Teil zuordnen', di.tiles.length === 3 && JSON.stringify(di.btns) === '["Aktualisieren","Diesem Teil zuordnen","Abbrechen"]', di);
  await page.click('.dupdlg [data-dup]:has-text("Gefängnisfestung") input[type=radio]'); await page.click('.dupdlg [data-link]'); await page.waitForTimeout(400);
  ok('chosen candidate linked in chips (not the first one)', (await page.textContent('#chips')).includes('Gefängnisfestung'));
  await page.click('#newRes'); await page.fill('dialog[open] [name=set_nummer]', '2013 Neu'); await page.click('dialog[open] button[type=submit]'); di = await dupInfo();
  ok('part form near match offers "anlegen"', di.btns.includes('Mit dieser Nummer anlegen') && di.btns.includes('Diesem Teil zuordnen'), di.btns);
  await page.click('.dupdlg [data-create]'); await page.waitForTimeout(500);
  ok('"anlegen" from part form adds new entry to chips', (await page.textContent('#chips')).includes('2013 Neu'));
  await page.click('#save'); await page.waitForTimeout(700); d = await db();
  const gitter = d.teile.find(t => t.beschreibung === 'Gitter'); const ids = d.teil_sets.filter(x => x.teil_id === gitter.id).map(x => d.sets.find(s => s.id === x.set_id).set_nummer).sort();
  ok('part saved with both links', JSON.stringify(ids) === JSON.stringify(['2013 Neu', '3112 – Gefängnisfestung']), ids);

  // Bearbeiten auf vorhandene Nummer
  const s3112 = d.sets.find(s => s.set_nummer === '3112' && s.art === 'reserve');
  await go('#set/' + s3112.id); await page.click('#es'); await page.fill('dialog[open] [name=set_nummer]', '36-66'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500);
  ok('edit to existing number is blocked with message', (await page.locator('dialog[open] [name=set_nummer]').count()) === 1 && (await db()).sets.find(s => s.id === s3112.id).set_nummer === '3112');
  await page.click('dialog[open] [data-cancel]');

  // LEGO: „-1“ zählt nicht
  await newSet('#l/reserve', '75192-1'); di = await dupInfo();
  ok('LEGO "75192-1" = existing 75192', di.title.startsWith('Schon vorhanden') && di.tiles[0].startsWith('75192'), di);
  await page.click('.dupdlg [data-no]'); await page.click('dialog[open] [data-cancel]');

  ok('no page errors', errs.length === 0, errs);
  fs.writeFileSync(path.join(__dirname, 'dup-check-result.json'), JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
  await browser.close(); srv.close();
  const failed = results.filter(r => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
