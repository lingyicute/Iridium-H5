const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { chromium } = require('playwright');

let server, browser, base;
const slow = { opened: 0, completed: 0, closed: 0 };
before(async () => {
  const html = await readFile(process.env.IRIDIUM_HTML || join(__dirname, '..', 'index.html'));
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/slow.zip')) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(80 * 512));
      res.setHeader('Access-Control-Allow-Origin', '*');
      slow.opened++;
      let sent = 0;
      const timer = setInterval(() => {
        if (sent >= 80) { clearInterval(timer); slow.completed++; res.end(); return; }
        sent++; res.write(Buffer.alloc(512));
      }, 40);
      res.on('close', () => { clearInterval(timer); slow.closed++; });
      return;
    }
    if (req.url.startsWith('/fixture')) {
      res.end(`<body>probe<script>try { top.document.body.dataset.compromised = 'yes'; top.localStorage.setItem('probe', 'yes'); document.body.dataset.result = 'escaped'; } catch (_) { document.body.dataset.result = 'blocked'; }<\/script>`);
    } else res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function desktop(t, seed = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await context.addInitScript(values => {
    if (window !== top || sessionStorage.getItem('test.seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem('iridium.' + key, JSON.stringify(value));
    sessionStorage.setItem('test.seeded', '1');
  }, seed);
  const page = await context.newPage();
  page.setDefaultTimeout(3500);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.WM && WM.wins.length === 1 && WM.wins[0].ready);
  const frame = page.frames().find(f => f.url().includes('?embed=1'));
  assert.ok(frame, 'browser window must be embedded');
  await frame.waitForFunction(() => typeof tabs !== 'undefined' && tabs.length > 0);
  return { page, frame, context };
}

async function key(frame, options, target = 'body') {
  await frame.evaluate(({ options, target }) => {
    document.querySelector(target).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
  }, { options, target });
}

test('malformed shortcut settings fall back to an independent default list', async t => {
  const { frame } = await desktop(t, { settings: { shortcuts: null, flags: [] } });
  await frame.waitForFunction(() => document.querySelector('.tiles .tile'));
  assert.equal(await frame.evaluate(() => Array.isArray(S.shortcuts) && !Array.isArray(S.flags)), true);
  assert.equal(await frame.evaluate(() => { const a = freshS(); a.shortcuts.pop(); return freshS().shortcuts.length; }), 5);
});

test('invalid saved session containers and entries do not prevent startup', async t => {
  const { frame } = await desktop(t, {
    settings: { startup: 'continue' },
    wins: [{ id: 'saved', b: { x: 0, y: 0, w: 900, h: 650 }, max: true }],
    'session.saved': { length: 1 },
    'groups.saved': null,
  });
  await frame.waitForFunction(() => activeTab && activeTab.url === 'chrome://newtab/');
});

test('malformed window lists do not prevent desktop startup', async t => {
  const { frame } = await desktop(t, { settings: { startup: 'continue' }, wins: { length: 1 } });
  assert.equal(await frame.evaluate(() => tabs.length), 1);
});

test('continuing a session restores the active tab rather than always the first', async t => {
  const { frame } = await desktop(t, {
    settings: { startup: 'continue' },
    wins: [{ id: 'saved', b: { x: 0, y: 0, w: 900, h: 650 }, max: true }],
    'session.saved': [{ url: 'chrome://version/' }, { url: 'chrome://bookmarks/', active: true }],
  });
  await frame.waitForFunction(() => activeTab && activeTab.url === 'chrome://bookmarks/');
});

test('IME confirmation does not navigate from the omnibox', async t => {
  const { frame } = await desktop(t);
  await frame.locator('#url').fill('中文输入');
  await key(frame, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 }, '#url');
  assert.equal(await frame.evaluate(() => activeTab.url), 'chrome://newtab/');
  await key(frame, { key: 'Enter', code: 'Enter' }, '#url');
  assert.match(await frame.evaluate(() => activeTab.url), /^chrome-search:\/\/results/);
});

test('IME confirmation does not submit bookmark dialogs', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => editBookmark(null, { url: 'https://example.com/', title: '测试' }));
  const count = await frame.evaluate(() => allUrls().length);
  await key(frame, { key: 'Enter', isComposing: true, keyCode: 229 }, '#bn');
  assert.equal(await frame.evaluate(() => allUrls().length), count);
  await key(frame, { key: 'Enter' }, '#bn');
  assert.equal(await frame.evaluate(() => allUrls().length), count + 1);
});

test('same-origin web content cannot access desktop DOM or storage', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(url => go(cur(), url), base + '/fixture');
  await frame.waitForFunction(() => cur().frame && !cur().loading);
  const web = frame.childFrames()[0];
  assert.ok(web);
  await web.waitForFunction(() => document.body.dataset.result);
  assert.equal(await web.evaluate(() => document.body.dataset.result), 'blocked');
  assert.equal(await page.evaluate(() => document.body.dataset.compromised || localStorage.getItem('probe')), null);
});

test('close other tabs preserves pinned tabs', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => {
    newTab('chrome://version/', { pinned: true });
    const keep = newTab('chrome://bookmarks/');
    newTab('chrome://history/');
    activate(keep);
    tabMenu(keep, 100, 100);
  });
  await frame.locator('#layer .mi').filter({ hasText: '关闭其他标签页' }).click();
  assert.deepEqual(await frame.evaluate(() => tabs.map(t => ({ url: t.url, pinned: t.pinned }))), [
    { url: 'chrome://version/', pinned: true }, { url: 'chrome://bookmarks/', pinned: false },
  ]);
});

test('history pages redraw when another window updates history', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => go(cur(), 'chrome://history/'));
  await page.evaluate(() => localStorage.setItem('iridium.hist', JSON.stringify([
    { id: 'remote', url: 'https://example.com/', title: '跨窗口历史记录', time: Date.now() },
  ])));
  await frame.locator('.ht').filter({ hasText: '跨窗口历史记录' }).waitFor();
  await page.evaluate(() => localStorage.setItem('iridium.hist', '[]'));
  await frame.waitForFunction(() => !document.querySelector('.ht'));
});

test('Launcher + L locks the desktop from inside a browser window', async t => {
  const { page, frame } = await desktop(t);
  await key(frame, { key: 'l', code: 'KeyL', metaKey: true });
  await page.locator('#lock').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('locked')), true);
});

test('Alt + Shift + S opens quick settings from browser and desktop', async t => {
  const { page, frame } = await desktop(t);
  await key(frame, { key: 'S', code: 'KeyS', altKey: true, shiftKey: true });
  await page.locator('#qs').waitFor({ state: 'visible' });
  await page.evaluate(() => closeOS());
  await key(page.mainFrame(), { key: 'S', code: 'KeyS', altKey: true, shiftKey: true });
  await page.locator('#qs').waitFor({ state: 'visible' });
});

test('clear browsing data does not offer unsupported cookie/cache clearing', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => clearDataDialog());
  assert.equal(await frame.locator('#c2').isDisabled(), true);
  assert.equal(await frame.locator('#c3').isDisabled(), true);
  assert.equal(await frame.locator('#c2').isChecked(), false);
  await frame.locator('#c1').uncheck();
  await frame.locator('.overlay .btn.pri').click();
  assert.equal(await frame.locator('.overlay').count(), 1);
  assert.match(await frame.locator('#toast').textContent(), /至少选择/);
});

test('CORS download delegation never fabricates bytes or claims completion', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(async () => { await iridiumDownload('https://download.invalid/manual.pdf'); go(cur(), 'chrome://downloads/'); });
  assert.match(await frame.locator('#dlcard').textContent(), /宿主浏览器.*状态未知/);
  assert.doesNotMatch(await frame.locator('#dlcard').textContent(), /\d+(?:\.\d+)? KB/);
});

test('screenshot placeholder does not claim a file was saved', async t => {
  const { page } = await desktop(t);
  await page.locator('#status').click();
  await page.locator('[data-t="shot"]').click();
  assert.match(await page.locator('#toast').textContent(), /暂不支持|暂不可用/);
});

test('os-settings lookalike hosts are not routed to system settings', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => go(cur(), 'chrome://os-settings-evil/'));
  await frame.waitForFunction(() => activeTab.kind === 'error');
  assert.equal(await page.locator('#osset').count(), 0);
});

test('new incognito windows do not persist sessions or history', async t => {
  const { page } = await desktop(t);
  await page.evaluate(() => WM.newWindow(true));
  await page.waitForFunction(() => WM.wins.length === 2 && WM.wins[1].ready);
  const inc = page.frames().find(f => f.url().includes('incognito=1'));
  await inc.waitForFunction(() => tabs.length > 0);
  await inc.evaluate(() => { go(cur(), 'chrome://version/'); addHistory('https://private.invalid/', 'private'); saveSession(); });
  const id = new URL(inc.url()).searchParams.get('wid');
  assert.equal(await page.evaluate(id => localStorage.getItem('iridium.session.' + id), id), null);
  assert.equal(await page.evaluate(() => (localStorage.getItem('iridium.hist') || '').includes('private.invalid')), false);
});


test('invalid session entries are skipped while valid pinned tabs are restored', async t => {
  const { frame } = await desktop(t, {
    settings: { startup: 'continue' },
    wins: [{ id: 'saved', b: { x: 0, y: 0, w: 900, h: 650 }, max: true, rb: {} }],
    'session.saved': [null, 7, { url: 123 }, { url: 'chrome://version/', pinned: true }],
    'groups.saved': null,
  });
  assert.deepEqual(await frame.evaluate(() => tabs.map(t => [t.url, t.pinned])), [['chrome://version/', true]]);
});

test('malformed nested bookmarks and history entries do not crash rendering', async t => {
  const { frame } = await desktop(t, {
    bm: { bar: [null, { type: 'folder', children: null }], other: [] },
    hist: [null, { title: 42 }, { id: 'good', url: 'https://example.com/', title: 'valid', time: 123 }],
  });
  assert.equal(await frame.evaluate(() => allUrls().length > 0 && HIST.length === 1), true);
});

test('new-tab background settings cannot inject HTML attributes', async t => {
  const { page, frame } = await desktop(t, {
    settings: { ntpBg: 'red"><img src=x onerror="top.document.body.dataset.injected=1"><div style="' },
  });
  assert.equal(await frame.locator('.ntp img[src="x"]').count(), 0);
  assert.equal(await page.evaluate(() => document.body.dataset.injected), undefined);
});

test('IME confirmation in the new-tab search box does not navigate', async t => {
  const { frame } = await desktop(t);
  await frame.locator('.ntpsearch input').fill('候选确认');
  await key(frame, { key: 'Enter', isComposing: true, keyCode: 229 }, '.ntpsearch input');
  assert.equal(await frame.evaluate(() => activeTab.url), 'chrome://newtab/');
});

test('Launcher is not treated as Ctrl for browser tab shortcuts', async t => {
  const { frame } = await desktop(t);
  await key(frame, { key: 't', code: 'KeyT', metaKey: true });
  assert.equal(await frame.evaluate(() => tabs.length), 1);
  await key(frame, { key: 't', code: 'KeyT', ctrlKey: true });
  assert.equal(await frame.evaluate(() => tabs.length), 2);
});

test('active-tab selection is persisted and survives an actual desktop reload', async t => {
  const { page, frame } = await desktop(t, { settings: { startup: 'continue' } });
  await frame.evaluate(() => {
    const chosen = newTab('chrome://version/');
    newTab('chrome://bookmarks/');
    activate(chosen);
  });
  assert.deepEqual(await frame.evaluate(() => store.get(SK, []).filter(t => t.active).map(t => t.url)), ['chrome://version/']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => WM.wins.length === 1 && WM.wins[0].ready);
  const restored = page.frames().find(f => f.url().includes('?embed=1'));
  await restored.waitForFunction(() => activeTab && activeTab.url === 'chrome://version/');
});

test('Escape cancels an in-strip tab drag and keeps the original tab order', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => { newTab('chrome://version/'); newTab('chrome://bookmarks/'); });
  const before = await frame.evaluate(() => tabs.map(x => x.id));
  const first = await frame.locator('.tab').first().boundingBox();
  const last = await frame.locator('.tab').last().boundingBox();
  const y = first.y + first.height / 2;
  await page.mouse.move(first.x + first.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(first.x + first.width / 2 + (last.x - first.x) * i / 12, y);
  assert.equal(await frame.locator('.tab.drag').count(), 1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await frame.evaluate(() => tabs.map(x => x.id)), before);
  assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(x => x.dataset.id)), before);
  assert.equal(await frame.locator('.tab.drag').count(), 0);
  assert.equal(await frame.evaluate(() => document.getElementById('content').style.pointerEvents), '');
});

test('Escape cancels a window drag and restores the maximized window', async t => {
  const { page, frame } = await desktop(t);
  assert.equal(await page.evaluate(() => WM.wins[0].max), true);
  const spacer = await frame.locator('#spacer').boundingBox();
  const x = spacer.x + spacer.width / 2, y = spacer.y + spacer.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x - 12 * i, y + 20 * i);
  assert.equal(await page.evaluate(() => WM.wins[0].max), false, 'drag should have started');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForFunction(() => WM.wins[0].max === true);
  assert.deepEqual(await page.evaluate(() => ({ max: WM.wins[0].max, snap: WM.wins[0].snap || null })), { max: true, snap: null });
  assert.equal(await page.evaluate(() => document.body.classList.contains('wdrag')), false);
});

test('an uncancelled window drag still moves the window', async t => {
  const { page, frame } = await desktop(t);
  const spacer = await frame.locator('#spacer').boundingBox();
  const x = spacer.x + spacer.width / 2, y = spacer.y + spacer.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x - 12 * i, y + 20 * i);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => WM.wins[0].max), false);
});

test('bookmark bar items are keyboard reachable and operable', async t => {
  const { page, frame } = await desktop(t);
  const info = await frame.evaluate(() => ({ n: BM.bar.length, first: BM.bar[1] && BM.bar[1].url, focusable: [...document.querySelectorAll('#bmitems .bm, #bmother')].every(x => x.tabIndex === 0 && x.getAttribute('role') === 'button') }));
  assert.ok(info.n >= 2 && info.focusable);
  await key(frame, { key: 'B', code: 'KeyB', altKey: true, shiftKey: true });
  const focused = () => frame.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id);
  const firstId = await focused();
  assert.equal(firstId, await frame.evaluate(() => BM.bar[0].id));
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(), await frame.evaluate(() => BM.bar[1].id));
  await page.keyboard.press('ArrowLeft');
  assert.equal(await focused(), firstId);
  await page.keyboard.press('End');
  assert.notEqual(await focused(), firstId);
  await page.keyboard.press('Home');
  assert.equal(await focused(), firstId);
  if (info.first) {
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await frame.evaluate(() => activeTab.url.replace(/\/$/, '') === BM.bar[1].url.replace(/\/$/, '')), true);
  }
});

test('the lock screen clock follows the real time', async t => {
  const { page } = await desktop(t);
  await page.evaluate(() => lockScreen());
  await page.evaluate(() => { document.querySelector('#lock .tm').textContent = '99:99'; document.querySelector('#lock .lt>div:not(.tm)').textContent = 'stale'; renderStatus(); });
  const out = await page.evaluate(() => ({ tm: document.querySelector('#lock .tm').textContent, d: document.querySelector('#lock .lt>div:not(.tm)').textContent, now: hhmm() }));
  assert.equal(out.tm, out.now);
  assert.notEqual(out.d, 'stale');
});

test('removing an in-progress download aborts it instead of saving it later', async t => {
  const { page, frame } = await desktop(t);
  const downloads = [];
  page.on('download', d => downloads.push(d));
  const o0 = slow.opened, c0 = slow.closed, f0 = slow.completed;
  await frame.evaluate(u => { iridiumDownload(u); }, base + '/slow.zip');
  await frame.evaluate(() => openInternal('chrome://downloads/'));
  const rm = frame.locator('.dlrow [data-a="remove"]');
  await rm.waitFor();
  await page.waitForTimeout(250);
  await rm.click();
  await page.waitForTimeout(500);
  assert.equal(slow.opened - o0, 1);
  assert.equal(slow.completed - f0, 0, 'server must not finish streaming to an abandoned download');
  assert.equal(slow.closed - c0, 1);
  assert.equal(downloads.length, 0);
  assert.equal(await frame.evaluate(() => document.querySelectorAll('.dlrow').length), 0);
});

test('minimizing a fullscreen window leaves host fullscreen and the window fullscreen flag', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => IWM.post('fs', { on: true }));
  await page.waitForFunction(() => WM.wins[0].fs === true);
  await frame.evaluate(() => IWM.post('min'));
  await page.waitForFunction(() => WM.wins[0].min === true);
  assert.equal(await page.evaluate(() => WM.wins[0].fs), false);
  await page.waitForFunction(() => !document.fullscreenElement);
});

test('protocol-only omnibox input is searched instead of loading an empty URL', async t => {
  const { frame } = await desktop(t);
  const out = await frame.evaluate(() => {
    const bad = ['https://', 'http://', 'ftp://', 'data:', 'javascript:', 'view-source:'].map(resolve);
    const good = ['https://example.com/', 'file:///tmp/a.html', 'data:,hi', 'javascript:void(0)', 'view-source:chrome://version'].map(resolve);
    return { bad, good, like: [looksLikeUrl('https://'), looksLikeUrl('data:'), looksLikeUrl('https://a.b')] };
  });
  for (const u of out.bad) assert.match(u, /^chrome-search:\/\/results\?q=/);
  assert.deepEqual(out.good, ['https://example.com/', 'file:///tmp/a.html', 'data:,hi', 'javascript:void(0)', 'view-source:chrome://version']);
  assert.deepEqual(out.like, [false, false, true]);
});

test('unsupported schemes show ERR_UNKNOWN_URL_SCHEME and malformed URLs keep ERR_INVALID_URL', async t => {
  const { frame } = await desktop(t);
  const read = () => frame.evaluate(() => ({ kind: activeTab.kind, code: (activeTab.view.querySelector('.ecode') || {}).textContent, text: activeTab.view.textContent }));
  await frame.evaluate(() => go(activeTab, 'foo://bar'));
  let r = await read();
  assert.equal(r.kind, 'error');
  assert.equal(r.code, 'ERR_UNKNOWN_URL_SCHEME');
  assert.match(r.text, /foo:/);
  await frame.evaluate(() => go(activeTab, 'javascript:void(0)'));
  assert.equal((await read()).code, 'ERR_UNKNOWN_URL_SCHEME');
  await frame.evaluate(() => load(activeTab, 'not a url'));
  r = await read();
  assert.equal(r.code, 'ERR_INVALID_URL');
});

test('downloads unfinished in a previous session are shown as interrupted, not canceled', async t => {
  const ts = Date.now();
  const mk = (id, state) => ({ id, name: id + '.zip', url: 'https://example.com/' + id + '.zip', size: 1000, got: 400, state, ts });
  const { frame } = await desktop(t, { downloads: [mk('a', 'prog'), mk('b', 'pause'), mk('c', 'done'), mk('d', 'canc')] });
  await frame.evaluate(() => openInternal('chrome://downloads/'));
  await frame.waitForFunction(() => document.querySelector('.dlrow'));
  const rows = await frame.evaluate(() => [...document.querySelectorAll('.dlrow')].map(r => ({ text: [...r.querySelectorAll('.dls')].pop().textContent, err: !!r.querySelector('.dlerr'), retry: !!r.querySelector('[data-a="retry"]'), bar: !!r.querySelector('.dlbar') })));
  assert.deepEqual(rows[0], { text: '已中断', err: true, retry: true, bar: false });
  assert.equal(rows[1].text, '已中断');
  assert.equal(rows[3].text, '已取消');
  assert.equal(rows[3].err, false);
  assert.equal(await frame.evaluate(() => document.querySelector('#dlBtn').classList.contains('busy')), false);
});

test('chrome://about uses the Iridium product name for its title and heading', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => go(activeTab, 'chrome://about/'));
  const out = await frame.evaluate(() => ({ title: activeTab.title, h1: activeTab.view.querySelector('h1').textContent }));
  assert.deepEqual(out, { title: 'Iridium 网址列表', h1: 'Iridium 网址列表' });
});

test('the All Bookmarks entry is hidden while Other Bookmarks is empty', async t => {
  const { frame } = await desktop(t);
  const state = () => frame.evaluate(() => ({ hidden: document.querySelector('#bmother').offsetParent === null, label: document.querySelector('#bmother').textContent }));
  assert.equal((await state()).hidden, true);
  await frame.evaluate(() => { BM.other.push({ id: uid(), type: 'url', title: '其他', url: 'https://example.com/' }); saveBM(); });
  assert.deepEqual(await state(), { hidden: false, label: '所有书签' });
  await frame.evaluate(() => { BM.other.length = 0; saveBM(); });
  assert.equal((await state()).hidden, true);
});

test('find bar shows the current match position and total like Chrome', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => go(activeTab, 'chrome://about/'));
  const total = await frame.evaluate(() => (activeTab.view.innerText.toLowerCase().match(/chrome:\/\//g) || []).length);
  assert.ok(total > 10);
  const cnt = () => frame.evaluate(() => document.querySelector('#findcnt').textContent);
  await frame.evaluate(() => { openFind(); document.querySelector('#findin').value = 'CHROME://'; doFind(false); });
  assert.equal(await cnt(), `1/${total}`);
  const index = async () => { const m = (await cnt()).match(/^(\d+)\/(\d+)$/); assert.ok(m && +m[2] === total, 'count format'); return +m[1]; };
  // 输入框保持焦点时，Enter 是否立刻前进取决于宿主选区实现；最多按 4 次，必须前进，且 Shift+Enter 回退一项。
  const seen = [await index()];
  for (let i = 0; i < 4 && seen[seen.length - 1] < 2; i++) {
    await key(frame, { key: 'Enter', code: 'Enter' }, '#findin');
    seen.push(await index());
  }
  const forward = seen[seen.length - 1];
  assert.ok(forward >= 2, 'indices=' + seen.join(','));
  await key(frame, { key: 'Enter', code: 'Enter', shiftKey: true }, '#findin');
  assert.equal(await index(), forward - 1, 'indices=' + seen.join(','));
  await frame.evaluate(() => { document.querySelector('#findin').value = 'no-such-text-xyz'; doFind(false); });
  assert.equal(await cnt(), '0/0');
});

test('find bar ignores hidden text and does not claim 0/0 for sandboxed web pages', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<p>needle</p><p hidden>needle needle</p><p style="display:none">needle</p><script>needle</script>';
    activeTab.view.append(d);
    openFind(); document.querySelector('#findin').value = 'needle'; doFind(false);
  });
  assert.equal(await frame.evaluate(() => document.querySelector('#findcnt').textContent), '1/1');
  await frame.evaluate(() => { activeTab.view.lastChild.innerHTML = '<p>needle</p><p>x needle</p><p hidden>needle</p>'; doFind(false); });
  assert.equal(await frame.evaluate(() => document.querySelector('#findcnt').textContent), '1/2');
  await frame.evaluate(base => { go(activeTab, base + '/fixture'); }, base);
  await frame.waitForFunction(() => activeTab.kind === 'web' && !activeTab.loading);
  await frame.evaluate(() => { document.querySelector('#findin').value = 'probe'; doFind(false); });
  assert.equal(await frame.evaluate(() => document.querySelector('#findcnt').textContent), '不可用');
});

test('tab hover cards still use the thumbnail and memory implementation', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => { newTab('chrome://version/'); });
  const first = frame.locator('.tab').first();
  await first.hover();
  await frame.waitForFunction(() => { const c = document.querySelector('#hcard'); return c && !c.hidden && c.querySelector('.hcm'); });
  assert.match(await frame.evaluate(() => document.querySelector('#hcard .hcm').textContent), /内存用量/);
  assert.equal(await frame.evaluate(() => typeof showHC), 'function');
});

test('the main menu disables Add bookmark on the new tab and error pages', async t => {
  const { frame } = await desktop(t);
  const item = () => frame.evaluate(() => {
    mainMenu();
    const mi = [...document.querySelectorAll('.menu .mi')].find(x => x._it && x._it.label === '书签和列表');
    const sub = mi._it.sub().find(x => x.label === '为此标签页添加书签…');
    closePopups();
    return !!sub.disabled;
  });
  assert.equal(await item(), true);
  await frame.evaluate(() => go(activeTab, 'foo://bar'));
  assert.equal(await item(), true);
  await frame.evaluate(() => go(activeTab, 'chrome://version/'));
  assert.equal(await item(), false);
  await frame.evaluate(() => go(activeTab, 'chrome://newtab/'));
  assert.equal(await item(), true);
});

/* ---- 最近关闭的标签页/窗口、会话历史与分屏恢复 ---- */
async function windowFrame(page, index) {
  await page.waitForFunction(i => window.WM && WM.wins[i] && WM.wins[i].ready, index);
  const id = await page.evaluate(i => WM.wins[i].id, index);
  let frame;
  for (let i = 0; i < 150; i++) {
    frame = page.frames().find(f => f.url().includes('wid=' + encodeURIComponent(id)));
    if (frame && await frame.evaluate(() => typeof tabs !== 'undefined' && tabs.length > 0).catch(() => false)) break;
    await page.waitForTimeout(20);
  }
  assert.ok(frame, 'embedded window should exist');
  return frame;
}

test('closed tabs restore history, position, zoom, groups, and new tabs', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => {
    go(cur(), 'chrome://about/');
    go(cur(), 'chrome://version/');
    cur().zoom = 1.25; applyZoom(cur());
    const tab = cur();
    groups.gtest = { id: 'gtest', name: 'work', color: 'blue', collapsed: false };
    tab.group = 'gtest'; renderTabs();
    newTab('chrome://flags/'); closeTab(tab);
    reopenClosed();
  });
  await frame.waitForFunction(() => cur().url === 'chrome://version/');
  const restored = await frame.evaluate(() => ({
    urls: cur().hist.map(h => h.url), index: cur().idx, zoom: cur().zoom,
    group: groups[cur().group] && groups[cur().group].name, position: tabs.indexOf(cur())
  }));
  assert.deepEqual(restored.urls, ['chrome://newtab/', 'chrome://about/', 'chrome://version/']);
  assert.equal(restored.index, 2);
  assert.equal(restored.zoom, 1.25);
  assert.equal(restored.group, 'work');
  assert.equal(restored.position, 0);
  await frame.evaluate(() => { newTab(); closeTab(cur()); reopenClosed(); });
  await frame.waitForFunction(() => tabs.length === 3);
  assert.equal(await frame.evaluate(() => cur().url), 'chrome://newtab/');
});

test('a closed window restores its tabs, pinned state and active tab from another window', async t => {
  const { page, frame: first } = await desktop(t);
  await page.evaluate(() => WM.newWindow(false));
  const second = await windowFrame(page, 1);
  await second.evaluate(() => {
    go(cur(), 'chrome://about/'); go(cur(), 'chrome://version/');
    const firstTab = cur(); firstTab.pinned = true;
    newTab('chrome://flags/'); activate(firstTab); saveSession();
    closeWindow();
  });
  await page.waitForFunction(() => WM.wins.length === 1);
  await key(first, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, '#url');
  await page.waitForFunction(() => WM.wins.length === 2, null, { timeout: 3000 });
  const restored = await windowFrame(page, 1);
  assert.deepEqual(await restored.evaluate(() => ({
    urls: tabs.map(x => x.url), pinned: tabs[0].pinned, active: cur().url, history: tabs[0].hist.map(h => h.url)
  })), {
    urls: ['chrome://version/', 'chrome://flags/'], pinned: true, active: 'chrome://version/',
    history: ['chrome://newtab/', 'chrome://about/', 'chrome://version/']
  });
});

test('closing the last tab can be undone from the desktop', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => { go(cur(), 'chrome://about/'); go(cur(), 'chrome://version/'); });
  await key(frame, { key: 'w', code: 'KeyW', ctrlKey: true }, '#url');
  await page.waitForFunction(() => WM.wins.length === 0);
  await page.locator('#desktop').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Shift+T');
  const restored = await windowFrame(page, 0);
  assert.deepEqual(await restored.evaluate(() => cur().hist.map(h => h.url)),
    ['chrome://newtab/', 'chrome://about/', 'chrome://version/']);
});

test('recently closed entries are restored newest-first and never include incognito windows', async t => {
  const { page, frame: first } = await desktop(t);
  await first.evaluate(() => { go(cur(), 'chrome://about/'); const tab = cur(); newTab('chrome://flags/'); closeTab(tab); });
  await page.evaluate(() => WM.newWindow(false));
  const second = await windowFrame(page, 1);
  await second.evaluate(() => { go(cur(), 'chrome://version/'); closeWindow(); });
  await page.waitForFunction(() => WM.wins.length === 1);
  await page.evaluate(() => WM.newWindow(true));
  const priv = await windowFrame(page, 1);
  await key(priv, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, '#url');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => WM.wins.length), 2, 'incognito windows must not reopen normal history');
  assert.equal(await priv.evaluate(() => cur().url), 'chrome://newtab/');
  await priv.evaluate(() => { newTab('chrome://about/'); closeTab(cur()); closeWindow(); });
  await page.waitForFunction(() => WM.wins.length === 1);
  await key(first, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, '#url');
  const restoredWindow = await windowFrame(page, 1);
  assert.equal(await restoredWindow.evaluate(() => cur().url), 'chrome://version/');
  await key(first, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, '#url');
  await first.waitForFunction(() => cur().url === 'chrome://about/');
  assert.equal(await first.evaluate(() => tabs.length), 2);
});

test('tab search restoration keeps history and consumes the same queue entry', async t => {
  const { frame } = await desktop(t);
  await frame.evaluate(() => { go(cur(), 'chrome://about/'); go(cur(), 'chrome://version/'); const tab = cur(); newTab('chrome://flags/'); closeTab(tab); });
  await frame.locator('#tabsearch').click();
  await frame.locator('.tsr[data-c]').click();
  assert.deepEqual(await frame.evaluate(() => cur().hist.map(h => h.url)),
    ['chrome://newtab/', 'chrome://about/', 'chrome://version/']);
  await frame.waitForFunction(() => !IWM.canReopen);
  await key(frame, { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }, '#url');
  await frame.waitForTimeout(150);
  assert.equal(await frame.evaluate(() => tabs.length), 2);
});

test('continue startup preserves navigation history, zoom and the selected tab', async t => {
  const { page, frame } = await desktop(t);
  await frame.evaluate(() => {
    S.startup = 'continue'; saveS();
    go(cur(), 'chrome://about/'); go(cur(), 'chrome://version/');
    zoomStep(cur(), 3, true);
    newTab('chrome://flags/');
  });
  await page.reload();
  const restored = await windowFrame(page, 0);
  assert.deepEqual(await restored.evaluate(() => ({
    urls: tabs.map(x => x.url), active: cur().url, history: tabs[0].hist.map(h => h.url), index: tabs[0].idx, zoom: tabs[0].zoom
  })), {
    urls: ['chrome://version/', 'chrome://flags/'], active: 'chrome://flags/',
    history: ['chrome://newtab/', 'chrome://about/', 'chrome://version/'], index: 2, zoom: 1.5
  });
});

test('session restore ignores malformed history and caps it at 50 entries', async t => {
  const hist = Array.from({ length: 80 }, (_, i) => ({ url: 'chrome://about/?n=' + i, title: 'n' + i }));
  const { frame } = await desktop(t, {
    settings: { startup: 'continue' },
    wins: [{ id: 'saved', b: { x: 0, y: 0, w: 900, h: 650 }, max: true }],
    'session.saved': [
      { url: 'chrome://about/?n=79', hist, idx: 79, zoom: 99, active: true },
      { url: 'chrome://version/', hist: [null, 3, { url: 5 }], idx: 'x', zoom: 'bad' }
    ]
  });
  const state = await frame.evaluate(() => ({
    n: tabs.length, h0: tabs[0].hist.length, i0: tabs[0].idx, last: tabs[0].hist[tabs[0].idx].url,
    z0: tabs[0].zoom, h1: tabs[1].hist.map(h => h.url), z1: tabs[1].zoom
  }));
  assert.equal(state.n, 2);
  assert.equal(state.h0, 50);
  assert.equal(state.i0, 49);
  assert.equal(state.last, 'chrome://about/?n=79');
  assert.equal(state.z0, 1, 'out-of-range zoom is ignored');
  assert.deepEqual(state.h1, ['chrome://version/']);
  assert.equal(state.z1, 1);
});

test('restored windows keep their snapped layout through a viewport resize', async t => {
  const { page, frame: first } = await desktop(t);
  await first.evaluate(() => { S.startup = 'continue'; saveS(); go(cur(), 'chrome://about/'); });
  await page.evaluate(() => WM.newWindow(false));
  const second = await windowFrame(page, 1);
  await second.evaluate(() => { go(cur(), 'chrome://version/'); IWM.post('snapl'); });
  await page.waitForFunction(() => WM.wins[1].snap === 'l');
  await page.reload();
  const restoredFirst = await windowFrame(page, 0);
  const restoredSecond = await windowFrame(page, 1);
  assert.equal(await restoredFirst.evaluate(() => cur().url), 'chrome://about/');
  assert.equal(await restoredSecond.evaluate(() => cur().url), 'chrome://version/');
  assert.equal(await page.evaluate(() => WM.wins[1].snap), 'l');
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction(() => WM.wins[1].b.w === 500);
  assert.deepEqual(await page.evaluate(() => ({ x: WM.wins[1].b.x, w: WM.wins[1].b.w })), { x: 0, w: 500 });
});

test('simulated incognito states its limits, skips favicon requests and is not restorable', async t => {
  const { page } = await desktop(t);
  await page.evaluate(() => WM.newWindow(true, 'chrome://version/'));
  const frame = await windowFrame(page, 1);
  assert.equal(await frame.evaluate(() => cur().url), 'chrome://version/');
  assert.match(await frame.locator('#incchip').getAttribute('data-tt'), /不是真正的无痕/);
  assert.match(await frame.locator('#incchip').getAttribute('aria-label'), /模拟/);
  await frame.evaluate(() => go(cur(), 'chrome://newtab/'));
  const box = await frame.locator('.incbox').innerText();
  assert.match(box, /不是真正的无痕/);
  assert.match(box, /宿主浏览器/);
  await frame.evaluate(() => document.querySelector('#profile').click());
  await frame.waitForSelector('.prof', { state: 'attached' });
  assert.match(await frame.evaluate(() => document.querySelector('.prof').textContent), /宿主浏览器仍可能保存/);
  await frame.evaluate(() => { newTab('chrome://about/'); closeTab(cur()); reopenClosed(); });
  await page.waitForTimeout(150);
  assert.equal(await frame.evaluate(() => tabs.length), 1);
  assert.equal(await frame.evaluate(() => closedStack.length), 0);
  assert.equal(await frame.evaluate(() => fav('https://private.example/', 16).includes('google.com')), false);
  const normal = await windowFrame(page, 0);
  assert.equal(await normal.evaluate(() => fav('https://example.com/', 16).includes('google.com')), true);
});

test('shelf centers hotseat apps, rounds corners when unmaximized, and splits date and status pods', async t => {
  const { page, frame } = await desktop(t);
  const maxState = await page.evaluate(() => {
    const hs = document.querySelector('#hotseat').getBoundingClientRect();
    const sh = getComputedStyle(document.querySelector('#shelf'));
    return {
      centerDelta: Math.abs((hs.left + hs.width / 2) - innerWidth / 2),
      maxRadius: sh.borderTopLeftRadius,
      hasDateTray: !!document.querySelector('#datetray #date') && document.querySelector('#datetray').textContent.length > 0,
      hasLauncherDot: !!document.querySelector('#launcher .ldot'),
      noHardWhiteBolt: !batIcon(80, true).includes('fill="#fff"') || batIcon(80, true).includes('<mask'),
    };
  });
  assert.ok(maxState.centerDelta < 4, 'hotseat must be centered on display');
  assert.equal(maxState.maxRadius, '0px');
  assert.equal(maxState.hasDateTray, true);
  assert.equal(maxState.hasLauncherDot, true);
  assert.equal(maxState.noHardWhiteBolt, true);
  await frame.locator('#wmax').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#shelf')).borderTopLeftRadius === '24px');
});
