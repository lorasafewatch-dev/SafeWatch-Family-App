import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from '../apps/family-app/node_modules/vite/dist/node/index.js';
const { chromium } = await import(pathToFileURL(path.resolve(path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/verification/background-sos-push');
await mkdir(output, { recursive: true });
const server = await createServer({ root: path.join(root, 'apps/family-app'), configFile: path.join(root, 'apps/family-app/vite.config.js'), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => {
  let subscription = null;
  const fake = { endpoint: 'https://fcm.googleapis.com/wp/synthetic', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/wp/synthetic', keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'a'.repeat(22) } }), unsubscribe: async () => { subscription = null; return true; } };
  const registration = { active: { postMessage: (_message, ports) => ports?.[0]?.postMessage({ saved: true }) },
    pushManager: { getSubscription: async () => subscription, subscribe: async () => { subscription = fake; return fake; } } };
  const worker = Object.assign(new EventTarget(), { ready: Promise.resolve(registration),
    getRegistration: async () => registration, controller: { scriptURL: location.origin + '/sw.js' } });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  globalThis.emitSosPush = (alertId, userId) => {
    const event = new Event('message');
    Object.defineProperties(event, {
      source: { value: worker.controller },
      data: { value: { type: 'SAFEWATCH_SOS_PUSH', alertId, userId } },
    });
    worker.dispatchEvent(event);
  };
  Object.defineProperty(globalThis, 'PushManager', { configurable: true, value: class {} });
  globalThis.permissionRequests = 0;
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'default', requestPermission: async () => {
    globalThis.permissionRequests += 1;
    globalThis.Notification.permission = globalThis.rejectPermission ? 'denied' : 'granted';
    return globalThis.Notification.permission;
  } } });
});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://nominatim.openstreetmap.org/**', route => route.fulfill({ status: 503, body: 'Unavailable' }));
await page.route(/https:\/\/.*(?:tile|arcgisonline|basemaps).*\//, route => route.abort());
const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/monitoring-features-preview.html`;
try {
  await page.goto(base);
  const settings = page.getByRole('region', { name: 'SOS background notifications' });
  const setup = page.getByRole('dialog', { name: 'Set up SOS notifications' });
  const setupEnable = setup.getByRole('button', { name: 'Enable SOS notifications', exact: true });
  await setupEnable.waitFor();
  assert.equal(await page.evaluate(() => globalThis.permissionRequests), 0);
  await page.evaluate(() => { globalThis.monitoringFixture.failPush = true; });
  await setupEnable.tap();
  await setup.getByRole('alert').waitFor();
  await page.evaluate(() => { globalThis.monitoringFixture.failPush = false; });
  await setupEnable.tap();
  await setup.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => globalThis.permissionRequests), 1);
  await settings.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Profile', exact: true }).tap();
  await settings.getByText('Enabled on this device', { exact: true }).waitFor();
  await settings.scrollIntoViewIfNeeded();
  await settings.getByRole('button', { name: 'Send test notification', exact: true }).tap();
  await settings.getByRole('status').waitFor();
  assert.equal(await page.evaluate(() => globalThis.monitoringFixture.pushTests), 1);
  await page.screenshot({ path: path.join(output, 'phone-notification-settings.png'), fullPage: true });
  await settings.getByRole('button', { name: 'Turn off on this device', exact: true }).tap();
  await settings.getByRole('button', { name: 'Enable SOS notifications', exact: true }).waitFor();
  assert.equal(await setup.count(), 0);
  // A cold notification click can target completed history outside the active list.
  await page.goto(base + '?sos=1');
  await page.getByRole('dialog', { name: 'Alert details', exact: true }).waitFor();
  await page.getByText('SOS location', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'notification-opens-sos.png'), fullPage: true });
  assert.equal(await page.evaluate(() => globalThis.monitoringFixture.alerts[0].details.status), 'ACKNOWLEDGED_BHW');
  await page.goto(base + '?sos=2&push_fixture=active');
  const popup = page.getByRole('alertdialog');
  await popup.getByRole('button', { name: 'I can respond', exact: true }).waitFor();
  await popup.getByRole('button', { name: 'Transfer SOS to barangay', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.monitoringFixture.alerts.find(row => row.id === 2).details.status), 'PENDING_FAMILY');
  await page.screenshot({ path: path.join(output, 'notification-opens-active-sos.png'), fullPage: true });
  await page.goto(base + '?sos=999');
  await page.getByRole('alert').filter({ hasText: 'This SOS is unavailable or is no longer linked to your family.' }).waitFor();
  await page.evaluate(() => localStorage.clear());
  await page.goto(base + '?sos=2&push_fixture=active');
  await popup.getByRole('button', {name: 'I can respond', exact: true}).waitFor();
  assert.equal(await setup.count(), 0, 'the setup dialog does not cover an SOS');
  await page.goto(base);
  await setupEnable.waitFor();
  await page.evaluate(() => { globalThis.rejectPermission = true; });
  await setupEnable.tap();
  await setup.getByText(/Notifications are blocked/).waitFor();
  assert.equal(await setupEnable.count(), 0);
  await setup.getByRole('button', { name: 'Set up later' }).tap();
  await page.reload();
  await page.getByRole('button', { name: 'Profile', exact: true }).tap();
  await settings.getByRole('button', { name: 'Enable SOS notifications', exact: true }).waitFor();
  assert.equal(await setup.count(), 0, 'deferring is remembered across sessions');
  await page.evaluate(() => globalThis.emitSosPush('1', globalThis.monitoringFixture.requests[0].user_id));
  await page.getByRole('alert').filter({ hasText: 'Watch SOS received' }).getByRole('button', { name: 'View SOS' }).tap();
  await page.getByRole('dialog', { name: 'Alert details', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close details', exact: true }).tap();
  await page.getByRole('button', { name: 'Profile', exact: true }).tap();
  await page.getByRole('button', { name: 'Sign out', exact: true }).tap();
  const signOut = page.getByRole('dialog', { name: 'Log out on this device?' });
  await signOut.getByRole('button', { name: 'Confirm logout', exact: true }).tap();
  await page.waitForFunction(() => globalThis.monitoringFixture.signOutScope === 'local');
  const apple = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', viewport: { width: 390, height: 844 } });
  const iphone = await apple.newPage();
  await iphone.goto(base);
  const appleSetup = iphone.getByRole('dialog', {name: 'Set up SOS notifications'});
  await appleSetup.getByText('Add to Home Screen', {exact: true}).waitFor();
  assert.equal(await appleSetup.getByRole('button', {name: 'Enable SOS notifications'}).count(), 0);
  await apple.close();
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks: ['enable failure/retry', 'persistent subscription', 'test notification', 'disable', 'cold deep link to acknowledged SOS', 'cold deep link to active SOS with response actions', 'unavailable SOS', 'no automatic acknowledgment'], browserErrors: errors }, null, 2));
  console.log('PASS notification controls, save failure/retry, targeted SOS navigation, preserved history and unavailable access');
} finally { await context.close(); await browser.close(); await server.close(); }
