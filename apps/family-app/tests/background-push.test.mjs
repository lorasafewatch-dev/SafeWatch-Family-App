import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applicationServerKey, sosIdFromUrl } from '../src/familyPush.js';
import { createPushHandler } from '../../../supabase/functions/_shared/pushDelivery.js';

assert.equal(sosIdFromUrl('https://example.test/?sos=123'), '123');
for (const value of ['0', '-1', 'NaN', 'javascript:alert(1)', '1&next=https://evil.test']) {
  assert.equal(sosIdFromUrl('https://example.test/?sos=' + encodeURIComponent(value)), null);
}
assert.equal(applicationServerKey('B' + 'A'.repeat(86)).length, 65);
assert.throws(() => applicationServerKey('private-key'));

const origin = 'https://family.example.test', user = '10000000-0000-0000-0000-000000000001';
const handlers = {}, stores = new Map(), shown = [], opened = [];
let windows = [];
const caches = { open: async name => {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name);
  return { match: async key => store.get(String(key))?.clone(), put: async (key, value) => { store.set(String(key), value); },
    delete: async key => store.delete(String(key)), keys: async () => [...store.keys()] };
} };
const self = { location: { origin }, addEventListener: (type, handler) => { handlers[type] = handler; },
  registration: { showNotification: async (title, options) => shown.push({ title, options }), getNotifications: async () => [] },
  clients: { matchAll: async () => windows, openWindow: async url => opened.push(url) } };
vm.runInNewContext(await readFile(new URL('../public/sos-push-worker.js', import.meta.url), 'utf8'), { self, caches, Response, URL, Date, console });
async function event(type, values) { let pending; handlers[type]({ ...values, waitUntil: promise => { pending = promise; } }); await pending; }
await event('message', { data: { type: 'SAFEWATCH_PUSH_OWNER', userId: user }, source: { url: origin + '/' } });
const payload = { kind: 'sos', alertId: '42', userId: user, deliveryId: 'delivery-42', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 180000).toISOString() };
await event('push', { data: { json: () => payload } });
await event('push', { data: { json: () => payload } });
assert.equal(shown.length, 1, 'persistent receipts suppress retry duplicates without an open app');
assert.equal(shown[0].options.silent, false);
assert.ok(shown[0].options.vibrate.length);
assert.equal(shown[0].options.tag, 'safewatch-sos-42');
assert.equal(shown[0].options.data.target, '/?sos=42');
assert.ok(!shown[0].options.body.includes(user), 'lock screen body contains no private identity');
await event('notificationclick', { notification: { close() {}, data: shown[0].options.data } });
assert.deepEqual(opened, [origin + '/?sos=42']);
const navigated = [], focused = [];
windows = [{ url: 'https://unrelated.test/', navigate() { throw new Error('must not touch another origin'); } },
  { url: origin + '/', navigate: async url => { navigated.push(url); return { focus: async () => focused.push(true) }; } }];
await event('notificationclick', { notification: { close() {}, data: shown[0].options.data } });
assert.deepEqual(navigated, [origin + '/?sos=42']); assert.equal(focused.length, 1); assert.equal(opened.length, 1);
await event('notificationclick', { notification: { close() {}, data: { target: 'https://evil.test/' } } });
assert.equal(opened.length, 1);
await event('push', { data: { json: () => ({ ...payload, deliveryId: 'wrong-user', userId: 'other' }) } });
await event('push', { data: { json: () => ({ ...payload, deliveryId: 'old', expiresAt: '2000-01-01' }) } });
assert.equal(shown.length, 1);
const reactivated = { ...payload, reactivated: true, deliveryId: 'delivery-42-reactivated' };
const foregroundMessages = [];
windows = [{ url: origin + '/', visibilityState: 'visible', postMessage: message => foregroundMessages.push(message) }];
await event('push', { data: { json: () => reactivated } });
await event('push', { data: { json: () => reactivated } });
assert.equal(shown.length, 2, 'a new activation gets one fresh notification and duplicate retries stay suppressed');
assert.notEqual(shown[1].options.tag, shown[0].options.tag, 'the OS can alert again for the same incident');
assert.equal(shown[1].options.silent, false);
assert.equal(shown[1].options.data.target, '/?sos=42');
assert.equal(foregroundMessages.length, 1);
assert.equal(foregroundMessages[0].type, 'SAFEWATCH_SOS_PUSH');
assert.equal(foregroundMessages[0].alertId, '42');
await event('message', { data: { type: 'SAFEWATCH_PUSH_OWNER', userId: null }, source: { url: origin + '/' } });
await event('push', { data: { json: () => ({ ...payload, deliveryId: 'after-logout' }) } });
assert.equal(shown.length, 2);
console.log('PASS closed-app notification, sound request, persistent deduplication, account binding and safe SOS navigation');

const token = 'a'.repeat(64), receipts = [], sends = [];
let allowed = true, status = 201;
const delivery = { id: '20000000-0000-0000-0000-000000000001', lease: 'lease', payload, subscription: { endpoint: 'https://fcm.googleapis.com/wp/test' } };
const rpc = async (name, args) => {
  if (name === 'claim_family_sos_push') { if (args.p_token !== token) throw new Error('unauthorized'); return { vapid: {}, deliveries: [delivery] }; }
  if (name === 'family_push_delivery_current') return allowed;
  if (name === 'finish_family_sos_push') receipts.push(args);
};
const handler = createPushHandler({ rpc, createRequest: (subscription, body, options) => { sends.push(options); return { endpoint: subscription.endpoint, headers: {}, body }; },
  fetchPush: async () => new Response(null, { status }) });
const request = (key = token) => new Request(origin, { method: 'POST', headers: { 'x-safewatch-push-token': key } });
assert.equal((await handler(request('wrong'))).status, 401);
assert.equal((await handler(request('b'.repeat(64)))).status, 403);
assert.equal(sends.length, 0);
await handler(request()); assert.equal(receipts.at(-1).p_result, 'sent'); assert.equal(sends.at(-1).urgency, 'high');
status = 503; await handler(request()); assert.equal(receipts.at(-1).p_result, 'retry');
status = 410; await handler(request()); assert.equal(receipts.at(-1).p_result, 'expired');
status = 400; await handler(request()); assert.equal(receipts.at(-1).p_result, 'failed');
status = 201;
for (const endpoint of [
  'https://push-region.push.apple.com/token',
  'https://updates.push.services.mozilla.com/wpush/v2/token',
  'https://wns2-am3p.notify.windows.com/w/?token=encoded%3d%2b%2f',
]) {
  delivery.subscription.endpoint = endpoint;
  await handler(request());
  assert.equal(receipts.at(-1).p_result, 'sent');
}
delivery.subscription.endpoint = 'https://wns2-am3p.notify.windows.com.evil.test/w/?token=fake';
const beforeInvalid = sends.length;
await handler(request());
assert.equal(receipts.at(-1).p_result, 'failed');
assert.equal(sends.length, beforeInvalid);
allowed = false; const before = sends.length;
await handler(request()); assert.equal(receipts.at(-1).p_result, 'cancelled'); assert.equal(sends.length, before);
console.log('PASS authenticated sender, urgent bounded delivery, transient retries, expired endpoints and revocation recheck');
