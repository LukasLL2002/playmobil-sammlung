const { chromium } = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FX = require('./make-fixtures')();
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info ? JSON.stringify(info) : ''); };
(async () => {
  await new Promise(r => srv.listen(8765, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route('**/vendor/supabase/supabase.min.js*', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => d.accept());
  const go = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(350); };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
  await page.goto('http://localhost:8765/index.html#teile');
  await page.evaluate(() => localStorage.removeItem('__mockdb')); await page.reload();
  await page.waitForSelector('#list .item');

  // 1) Keine abgeschnittenen Texte (390 px)
  const overflow = async () => page.evaluate(() => [...document.querySelectorAll('.item .title, .item .sub, .item .right, .item .info')].filter(e => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').map(e => e.className + ': ' + e.textContent.slice(0, 40)));
  const checks = { teile: '#teile', kiste: '#kiste/21', reserve: '#reserve', reserveDetail: '#set/2', legoTeile: '#l/teile', legoKiste: '#l/kiste/51', legoReserve: '#l/reserve' };
  for (const [n, h] of Object.entries(checks)) { await go(h); await page.waitForTimeout(250); const bad = await overflow(); const items = await page.locator('.item').count(); ok('no truncation @390px: ' + n, items > 0 && bad.length === 0, { items, bad }); }
  // Reserve-Fotos (Bug t53u): Reserve ohne eigenes Foto zeigt Foto eines zugeordneten Teils
  await page.goto('http://localhost:8765/index.html#set/2'); await page.reload(); await page.waitForSelector('h1'); await page.waitForTimeout(900);
  const detailImgs = await page.locator('.pstrip img[data-pbig]').count();
  ok('Reserve detail (direct open) shows part photos', detailImgs === 1 && (await page.textContent('main')).includes('Fotos der Teile'), { detailImgs });
  const partThumbs = await page.locator('.list .item img.thumb').count();
  ok('Reserve detail part tiles show photos', partThumbs >= 1, { partThumbs });
  await go('#reserve'); await page.waitForTimeout(500);
  const tiles = await page.$$eval('.list .item', as => as.map(a => ({ href: a.getAttribute('href'), img: !!a.querySelector('img.thumb') })));
  ok('Reserve list tiles show cover from parts', tiles.find(x => x.href === '#set/2')?.img === true && tiles.find(x => x.href === '#set/1')?.img === false, tiles);
  await page.screenshot({ path: path.join(__dirname, 'reserve-photos-390.png') });
  await go('#teile');
  const priceTxt = await page.locator('#list .item .sub.price').first().textContent();
  ok('compact price line', /je Stück · .*gesamt/.test(priceTxt), priceTxt);
  const pricePos = await page.evaluate(() => { const it = document.querySelector('#list .item'); return { priceInInfo: !!it.querySelector('.info .price'), rightText: it.querySelector('.right').textContent.trim() }; });
  ok('price in own line, quantity right', pricePos.priceInInfo && /^\d+×$/.test(pricePos.rightText), pricePos);
  await page.screenshot({ path: path.join(__dirname, 'sets-teile-390.png'), fullPage: true });

  // 2) Reserve = alte Daten, neue Sets leer
  await go('#reserve');
  const resN = await page.locator('.list .item').count();
  const tabs = await page.$$eval('#tabbar a', as => as.map(a => a.textContent.trim()));
  ok('Reserve shows old sets', resN === 3, { resN, tabs });
  // Suche in Reserve
  const sCnt = async () => (await page.textContent('#sCount')).trim();
  ok('Reserve search field + count visible', await page.isVisible('#sq') && (await sCnt()) === '3 Einträge' && !(await page.isVisible('#sqClear')), await sCnt());
  await page.fill('#sq', '36 6-6'); ok('search by number ignores spaces/dashes', (await page.locator('#sList .item').count()) === 1 && (await page.textContent('#sList')).includes('Ritterburg') && (await sCnt()) === '1 von 3 Einträgen', await sCnt());
  await page.fill('#sq', 'piraten'); ok('search by name', (await page.locator('#sList .item').count()) === 1 && (await page.textContent('#sList')).includes('4000'));
  await page.fill('#sq', 'alte notiz'); ok('search by notes', (await page.locator('#sList .item').count()) === 1 && (await page.textContent('#sList')).includes('3666'));
  await page.fill('#sq', 'xyz'); ok('no match message', (await page.textContent('#sList')).includes('Nichts gefunden') && (await sCnt()) === '0 von 3 Einträgen');
  await page.click('#sqClear'); ok('clear button resets', (await page.inputValue('#sq')) === '' && (await page.locator('#sList .item').count()) === 3 && !(await page.isVisible('#sqClear')));
  await page.fill('#sq', 'zoo'); await go('#teile'); await go('#reserve');
  ok('search kept when coming back', (await page.inputValue('#sq')) === 'zoo' && (await page.locator('#sList .item').count()) === 1);
  await page.click('#sqClear');
  await go('#sets'); ok('Sets tab has search too', await page.isVisible('#sq'));
  await go('#sets');
  const setsEmpty = await page.locator('.list .item').count();
  ok('new Sets tab is empty', setsEmpty === 0 && (await page.textContent('main')).includes('noch nichts angelegt'), { setsEmpty });
  await page.screenshot({ path: path.join(__dirname, 'sets-empty-390.png') });

  // 3) Duplikat-Abfrage
  const fillSet = async (nr, name) => { await page.fill('dialog[open] input[name=set_nummer]', nr); await page.fill('dialog[open] input[name=name]', name); };
  await page.click('#ns'); await fillSet('100', 'Erstes'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(400);
  let d = await db(); const first = d.sets.find(s => s.art === 'set' && s.set_nummer === '100');
  ok('create set in Sets (art=set)', !!first, first);
  // gleiche Nummer wie eine Reserve → Hinweis (anderer Reiter), anlegen trotzdem möglich
  await go('#sets'); await page.click('#ns'); await fillSet('4000', 'Neu in Sets'); await page.click('dialog[open] button[type=submit]');
  await page.waitForSelector('.dupdlg[open]'); const otherKind = await page.textContent('.dupdlg');
  await page.click('.dupdlg [data-create]'); await page.waitForTimeout(400);
  d = await db(); ok('same number in other kind: shown with tab name, can still be created', otherKind.includes('„Reserve“') && d.sets.filter(s => s.set_nummer === '4000').length === 2 && !(await page.locator('.dupdlg').count()));
  // Bild an erstes Set hängen + Notiz, damit wir sehen, dass nur Nummer/Name ersetzt werden
  const firstId = first.id;
  await go('#set/' + firstId); await page.click('#es'); await page.setInputFiles('dialog[open] [data-ggal]', [FX + '/img-red.png']);
  await page.fill('dialog[open] textarea[name=notiz]', 'Bleibt'); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(600);
  d = await db(); const before = JSON.parse(JSON.stringify(d.sets.find(s => s.id === firstId)));
  await go('#sets'); await page.click('#ns'); await fillSet(' 1-0 0 ', 'Überschrieben');
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]');
  const dupTxt = await page.textContent('.dupdlg');
  ok('duplicate prompt shows existing tile', dupTxt.includes('Schon vorhanden – was tun?') && dupTxt.includes('Erstes') && (await page.locator('.dupdlg [data-dup] img.thumb').count()) === 1, dupTxt.slice(0, 160));
  await page.screenshot({ path: path.join(__dirname, 'sets-duplicate-390.png') });
  await page.click('.dupdlg [data-no]'); await page.waitForTimeout(250);
  const stillOpen = await page.locator('dialog[open] input[name=set_nummer]').inputValue();
  d = await db();
  ok('"Nein" returns to editing, nothing saved', stillOpen.trim() === '1-0 0' && d.sets.filter(s => s.art === 'set').length === 2, { stillOpen });
  await page.click('dialog[open] button[type=submit]'); await page.waitForSelector('.dupdlg[open]'); await page.click('.dupdlg [data-yes]'); await page.waitForTimeout(500);
  d = await db(); const after = d.sets.find(s => s.id === firstId);
  ok('"Ja" overwrites only number + name', d.sets.filter(s => s.art === 'set').length === 2 && after.set_nummer === '1-0 0' && after.name === 'Überschrieben' && after.notiz === 'Bleibt' && JSON.stringify(after.bilder) === JSON.stringify(before.bilder) && after.art === 'set',
    { before: { n: before.set_nummer, name: before.name, notiz: before.notiz, bilder: before.bilder }, after: { n: after.set_nummer, name: after.name, notiz: after.notiz, bilder: after.bilder } });
  const lastUpd = d.log.filter(l => l.t === 'sets' && l.op === 'update').pop();
  ok('overwrite update payload = {set_nummer, name}', JSON.stringify(Object.keys(lastUpd.payload).sort()) === '["name","set_nummer"]', lastUpd.payload);
  // Reserve-Duplikat
  await go('#reserve'); await page.click('#ns'); await fillSet('36-66', 'Burg neu'); await page.click('dialog[open] button[type=submit]');
  ok('duplicate check also in Reserve', await page.waitForSelector('.dupdlg[open]', { timeout: 3000 }).then(() => true).catch(() => false));
  await page.click('.dupdlg [data-no]'); await page.click('dialog[open] [data-cancel]'); await page.waitForTimeout(200);

  // 4) Mehrere Bilder an einem Teil
  await go('#teil/12:bearbeiten');
  await page.setInputFiles('[data-ggal]', [FX + '/img-red.png', FX + '/img-green.png', FX + '/img-blue.png']);
  ok('gallery shows 4 thumbs (1 old + 3 new)', (await page.locator('#tgal .gthumb').count()) === 4);
  await page.click('#tgal [data-cover="3"]');   // blau wird Titelbild
  await page.click('#tgal [data-del="1"]');      // altes Bild (jetzt Position 1) entfernen
  ok('cover/delete in editor', (await page.locator('#tgal .gthumb').count()) === 3 && (await page.locator('#tgal .gthumb.cover').count()) === 1);
  await page.screenshot({ path: path.join(__dirname, 'gallery-editor-390.png') });
  await page.click('#save'); await page.waitForTimeout(900);
  d = await db(); const t12 = d.teile.find(t => t.id === 12);
  ok('multi-image saved; first = cover; removed image deleted from storage', t12.bilder.length === 3 && t12.bild_url === t12.bilder[0] && !t12.bilder.includes('11111111-1111-1111-1111-111111111111/teile/0b1e5c2a-old.jpg') && d.removed.includes('11111111-1111-1111-1111-111111111111/teile/0b1e5c2a-old.jpg') && t12.bilder.every(p => p.startsWith(window_U = d.sets[0].user_id)),
    { bilder: t12.bilder, removed: d.removed });
  const detailThumbs = await page.locator('.pstrip .pthumbs img').count();
  ok('detail shows all images', detailThumbs === 3, { detailThumbs });
  await go('#teile');
  const cnt = await page.locator('#list a[href="#teil/12"] .thumbcount').textContent().catch(() => null);
  ok('list uses cover + count badge', cnt === '3', { cnt });
  // ein Bild entfernen
  await go('#teil/12:bearbeiten'); await page.click('#tgal [data-del="2"]'); await page.click('#save'); await page.waitForTimeout(600);
  d = await db(); ok('remove one image', d.teile.find(t => t.id === 12).bilder.length === 2);

  // LEGO: mehrere Bilder + Duplikat
  await go('#l/teil/41:bearbeiten'); await page.setInputFiles('[data-ggal]', [FX + '/img-red.png', FX + '/img-green.png']);
  await page.click('#f button:not([type=button])'); await page.waitForTimeout(1500);
  d = await db(); const l41 = d.lego_teile.find(t => t.id === 41);
  ok('LEGO multi-image', l41.bilder.length === 2 && l41.bild_url === l41.bilder[0] && l41.bilder[0].includes('/lego/'), l41.bilder);
  await go('#l/sets'); ok('LEGO Sets empty', (await page.locator('.list .item').count()) === 0);
  await go('#l/reserve'); ok('LEGO Reserve shows old', (await page.locator('.list .item').count()) === 1);
  await page.fill('#sq', '75-192'); ok('LEGO Reserve search by number', (await page.locator('#sList .item').count()) === 1 && (await page.textContent('#sCount')).includes('1 von 1'));
  await page.fill('#sq', 'falcon xyz'); ok('LEGO Reserve search no match', (await page.locator('#sList .item').count()) === 0);
  await page.click('#sqClear'); await go('#l/sets'); ok('LEGO Sets tab has search', await page.isVisible('#sq'));
  await go('#l/reserve');
  await page.click('#ns'); await fillSet('75 192', 'Falke'); await page.click('dialog[open] button[type=submit]');
  await page.waitForSelector('.dupdlg[open]'); await page.click('.dupdlg [data-yes]'); await page.waitForTimeout(500);
  d = await db(); const ls = d.lego_sets.find(s => s.id === 31);
  ok('LEGO duplicate overwrite number+name only', d.lego_sets.length === 1 && ls.set_nummer === '75 192' && ls.name === 'Falke' && ls.jahr === 2017 && ls.teile_anzahl === 7541, ls);

  // Set-Auswahl im Teil-Formular gruppiert
  await go('#teil/neu');
  const groups = await page.$$eval('#setSel optgroup', g => g.map(x => x.label));
  ok('set picker grouped Reserve/Sets', groups.length === 2 && groups[0].includes('Reserve') && groups[1].includes('Sets'), groups);

  // 5) Reiter umbenennen
  await go('#uebersicht'); await page.click('#renTabs');
  await page.fill('dialog[open] input[name=reserve]', 'Lager'); await page.fill('dialog[open] input[name=sets]', 'Neue Sets');
  await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(500);
  let tabTxt = await page.$$eval('#tabbar a', as => as.map(a => a.textContent.trim()));
  d = await db();
  ok('tab rename applied + stored', tabTxt.some(x => x.includes('Lager')) && d.tab_namen[0]?.namen?.reserve === 'Lager', { tabTxt, row: d.tab_namen[0] });
  await page.reload(); await page.waitForSelector('#tabbar a'); await page.waitForTimeout(400);
  tabTxt = await page.$$eval('#tabbar a', as => as.map(a => a.textContent.trim()));
  const icons = tabTxt.join(' ');
  ok('tab rename persists after reload; icons stay', tabTxt.some(x => x.includes('Lager')) && tabTxt.some(x => x.includes('Neue Sets')) && icons.includes('🏰') && icons.includes('🎁'), tabTxt);
  await go('#reserve'); ok('heading uses new name', (await page.textContent('h1')).includes('Lager'));
  await page.screenshot({ path: path.join(__dirname, 'tabs-renamed-390.png') });
  // zurücksetzen auf Standard
  await go('#uebersicht'); await page.click('#renTabs'); await page.fill('dialog[open] input[name=reserve]', ''); await page.click('dialog[open] button[type=submit]'); await page.waitForTimeout(400);
  tabTxt = await page.$$eval('#tabbar a', as => as.map(a => a.textContent.trim()));
  ok('empty name falls back to default', tabTxt.some(x => x.includes('Reserve')), tabTxt);
  await go('#l/uebersicht'); ok('LEGO overview has rename button', (await page.locator('#renTabs').count()) === 1);

  ok('no page errors', errs.length === 0, errs);
  fs.writeFileSync(path.join(__dirname, 'sets-reserve-result.json'), JSON.stringify({ when: new Date().toISOString(), viewport: '390x844', results }, null, 2));
  await browser.close(); srv.close();
  const failed = results.filter(r => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
