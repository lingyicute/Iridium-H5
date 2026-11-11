const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { chromium } = require('playwright');

let server, browser, base;
before(async () => {
  const html = await readFile(process.env.IRIDIUM_HTML || join(__dirname, '..', 'index.html'));
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
