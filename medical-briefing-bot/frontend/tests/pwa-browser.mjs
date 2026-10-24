import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';

const origin = process.env.PWA_TEST_ORIGIN || 'http://127.0.0.1:3107';
const evidence = process.env.PWA_EVIDENCE_DIR || join(tmpdir(), 'medical-briefing-pwa-qa');
let browser;
before(async () => {
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

test('production login advertises an installable app while protected data stays private', async () => {
  // Given: a fresh, unauthenticated browser.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // When: opening the app from its manifest start URL.
    await page.goto(origin + '/');
    // Then: login remains required and all installation assets are available.
    await page.getByLabel('사번', { exact: true }).waitFor();
    assert.match(page.url(), /\/login\?next=/);
    const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifestResponse = await context.request.get(origin + manifestPath);
    assert.equal(manifestResponse.status(), 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'), 'yes');
    assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'), '/icons/apple-touch-icon.png');
    for (const icon of manifest.icons) {
      const response = await context.request.get(origin + icon.src);
      assert.equal(response.status(), 200);
      assert.match(response.headers()['content-type'], /image\/png/);
    }
    assert.equal((await context.request.get(origin + '/api/articles')).status(), 401);
    assert.equal((await context.request.get(origin + '/api/customer-auth/session')).status(), 401);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
    const cdp = await context.newCDPSession(page);
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, []);
  } finally { await context.close(); }
});

test('phone and desktop installation help is readable in light and dark system modes', async () => {
  // Given: supported responsive sizes and both system color preferences.
  for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/login');
      await page.screenshot({ path: join(evidence, `login-collapsed-${width}-${colorScheme}.png`), fullPage: true });
      // When: expanding the installation instructions using the keyboard.
      await page.locator('summary').focus();
      await page.locator('summary').press('Enter');
      // Then: both platform instructions are visible with no horizontal overflow.
      assert.equal(await page.getByText(/아이폰: Safari/).isVisible(), true);
      assert.equal(await page.getByText(/안드로이드: Chrome/).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(evidence, `login-${width}-${colorScheme}.png`), fullPage: true });
      await page.goto(origin + '/offline.html');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(evidence, `offline-${width}-${colorScheme}.png`), fullPage: true });
    } finally { await context.close(); }
  }
});

test('offline navigation shows the bear explanation and retry returns to protected login', async () => {
  // Given: the installed service worker controls an unauthenticated visit.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(origin + '/login');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await context.setOffline(true);
    // When: opening a new app navigation with the network unavailable.
    await page.goto(origin + '/?offline-test=1');
    // Then: the offline explanation is rendered instead of private cached data.
    assert.equal(await page.getByRole('heading', { name: '인터넷 연결을 확인해 주세요' }).isVisible(), true);
    assert.equal(await page.getByAltText('곰돌이 브리퍼').evaluate(image => image.complete && image.naturalWidth > 0), true);
    const cachedPaths = await page.evaluate(async () => {
      const result = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) result.push(new URL(request.url).pathname);
      }
      return result.sort();
    });
    assert.deepEqual(cachedPaths, ['/icons/icon-192.png', '/offline.html']);
    await page.screenshot({ path: join(evidence, 'offline-390.png'), fullPage: true });
    await context.setOffline(false);
    await page.getByRole('link', { name: '브리핑 다시 열기' }).click();
    await page.getByLabel('사번', { exact: true }).waitFor();
    assert.match(page.url(), /\/login\?next=/);
  } finally { await context.close(); }
});
