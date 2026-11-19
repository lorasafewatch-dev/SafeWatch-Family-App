import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.tools/alert-tests/node_modules/@electric-sql/pglite/dist/index.js';
const pg = new PGlite();
const uid = n => `a0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [family, outsider, pending, staff, watch, otherWatch] = [1, 2, 3, 4, 5, 6].map(uid);
const q = async (sql, args = []) => (await pg.query(sql, args)).rows;
async function asUser(user, action, role = 'authenticated') {
  await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: uid(Number(user?.slice(-3)) + 100), aal: 'aal2' })]);
  await pg.exec('SET ROLE ' + role);
  try { return await action(); } finally { await pg.exec('RESET ROLE'); }
}
const save = (user, endpoint, expected = user) => asUser(user, async () => (await q('select save_family_push_subscription($1,$2) id', [
  { endpoint, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'a'.repeat(22) } }, expected]))[0].id);
const token = 'a'.repeat(64);
const service = action => asUser(null, action, 'service_role');
const claim = () => service(async () => (await q('select claim_family_sos_push($1) data', [token]))[0].data);
try {
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA safewatch_private; CREATE SCHEMA vault;
    GRANT USAGE ON SCHEMA auth,safewatch_private TO authenticated;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email_confirmed_at TIMESTAMPTZ DEFAULT now(),banned_until TIMESTAMPTZ,deleted_at TIMESTAMPTZ);
    CREATE TABLE auth.sessions(id UUID PRIMARY KEY,user_id UUID REFERENCES auth.users,aal TEXT DEFAULT 'aal2',not_after TIMESTAMPTZ);
    CREATE TABLE auth.mfa_factors(user_id UUID,status TEXT);
    CREATE TABLE safewatch_account_access(user_id UUID,role TEXT,status TEXT DEFAULT 'approved',requested_app TEXT DEFAULT 'family');
    CREATE TABLE safewatch_privacy_acceptances(user_id UUID,app TEXT DEFAULT 'family',stage TEXT DEFAULT 'first_login',version TEXT DEFAULT '2026-10-29',terms_accepted BOOLEAN DEFAULT true,account_consent BOOLEAN DEFAULT true);
    CREATE TABLE devices(id UUID PRIMARY KEY,patient_name TEXT);
    CREATE TABLE family_seniors(user_id UUID,device_id UUID,PRIMARY KEY(user_id,device_id));
    CREATE TABLE alerts(id BIGSERIAL PRIMARY KEY,device_id UUID REFERENCES devices,alert_type TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE vault.decrypted_secrets(name TEXT PRIMARY KEY,decrypted_secret TEXT);
    CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims',true)::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    CREATE FUNCTION safewatch_has_app_access(app TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM safewatch_account_access WHERE user_id=auth.uid() AND status='approved' AND role=app) $$;`);
  for (const user of [family, outsider, pending, staff]) {
    await q('insert into auth.users(id) values($1)', [user]);
    await q('insert into auth.sessions(id,user_id) values($1,$2)', [uid(Number(user.slice(-3)) + 100), user]);
    await q('insert into safewatch_account_access(user_id,role,status) values($1,$2,$3)', [user, user === staff ? 'barangay' : 'family', user === pending ? 'pending' : 'approved']);
    await q('insert into safewatch_privacy_acceptances(user_id) values($1)', [user]);
  }
  await q("insert into devices values($1,'Same Name'),($2,'Same Name')", [watch, otherWatch]);
  await q('insert into family_seniors values($1,$2),($3,$4)', [family, watch, outsider, otherWatch]);
  const sql = (await readFile(new URL('../migrations/20261119153924_family_sos_background_push.sql', import.meta.url), 'utf8'))
    .replace(/-- BEGIN HOSTED PUSH DISPATCH[\s\S]*?-- END HOSTED PUSH DISPATCH/, '');
  await pg.exec(sql); await pg.exec(sql);
  await q("insert into vault.decrypted_secrets values('safewatch_family_push_dispatch',$1),('safewatch_family_push_vapid',$2)", [token, JSON.stringify({ publicKey: 'test-public', privateKey: 'private-server-only', subject: 'https://example.test' })]);
  await q("update safewatch_private.family_push_config set public_key='test-public'");
  const sub = await save(family, 'https://fcm.googleapis.com/fcm/send/test:token');
  assert.equal(await save(family, 'https://fcm.googleapis.com/fcm/send/test:token'), sub);
  await save(outsider, 'https://fcm.googleapis.com/wp/other');
  await assert.rejects(save(pending, 'https://fcm.googleapis.com/wp/pending'), /Approved family/);
  await assert.rejects(save(staff, 'https://fcm.googleapis.com/wp/staff'), /Approved family/);
  await assert.rejects(save(family, 'https://127.0.0.1/internal'), /Invalid push subscription/);
  await assert.rejects(save(family, 'https://fcm.googleapis.com.evil.test/wp/test'), /Invalid push subscription/);
  await assert.rejects(save(family, 'https://fcm.googleapis.com/wp/new', outsider), /Approved family/);
  await assert.rejects(save(outsider, 'https://fcm.googleapis.com/fcm/send/test:token'), /previous account/);
  await assert.rejects(asUser(family, () => q('select * from safewatch_private.family_push_subscriptions')), /permission denied/);
  await assert.rejects(asUser(family, () => q('select claim_family_sos_push($1)', [token])), /permission denied/);
  await assert.rejects(service(() => q('select claim_family_sos_push($1)', ['wrong'])), /Invalid dispatcher/);
  console.log('PASS migration repeatability, approved account/session checks, private endpoint storage, validation and ownership');
  const insert = async (device = watch) => (await q(`insert into alerts(device_id,alert_type,details) values($1,'SOS','{"sos_family_first":true,"status":"PENDING_FAMILY","incident_open":true}') returning id`, [device]))[0].id;
  const id = await insert();
  await q("update alerts set details=details||'{\"update_count\":2}' where id=$1", [id]);
  assert.equal((await q('select count(*)::int count from safewatch_private.family_push_deliveries'))[0].count, 1);
  let batch = await claim(); assert.equal(batch.deliveries.length, 1); assert.equal(batch.deliveries[0].payload.userId, family);
  assert.equal((await claim()).deliveries.length, 0, 'overlapping workers do not claim the same lease');
  const delivery = batch.deliveries[0];
  await service(() => q('select finish_family_sos_push($1,$2,$3,503)', [delivery.id, uid(999), 'retry']));
  assert.equal((await q('select state from safewatch_private.family_push_deliveries where id=$1', [delivery.id]))[0].state, 'sending');
  await service(() => q('select finish_family_sos_push($1,$2,$3,503)', [delivery.id, delivery.lease, 'retry']));
  await q("update safewatch_private.family_push_deliveries set next_attempt_at=now()-interval '1 second'");
  batch = await claim(); assert.equal(batch.deliveries[0].id, delivery.id, 'retries preserve the notification deduplication identity');
  await q('delete from family_seniors where user_id=$1', [family]);
  assert.equal((await service(() => q('select family_push_delivery_current($1,$2) allowed', [delivery.id, batch.deliveries[0].lease])))[0].allowed, false);
  await service(() => q('select finish_family_sos_push($1,$2,$3,null)', [delivery.id, batch.deliveries[0].lease, 'cancelled']));
  await q('insert into family_seniors values($1,$2)', [family, watch]);
  const acknowledged = await insert();
  await q("update alerts set details=details||'{\"status\":\"ACKNOWLEDGED_FAMILY\"}' where id=$1", [acknowledged]);
  assert.equal((await claim()).deliveries.length, 0);
  console.log('PASS watch-ID routing, one outbox row per incident/device, leases, stable retries and revocation/acknowledgment cancellation');
  const testId = (await asUser(family, () => q('select request_family_push_test($1) id', [sub])))[0].id;
  await assert.rejects(asUser(family, () => q('select request_family_push_test($1)', [sub])), /Wait a minute/);
  assert.equal((await claim()).deliveries.length, 0, 'test delay allows the app to close');
  await q("update safewatch_private.family_push_deliveries set next_attempt_at=now()-interval '1 second' where id=$1", [testId]);
  batch = await claim(); assert.equal(batch.deliveries[0].payload.kind, 'test');
  await service(() => q('select finish_family_sos_push($1,$2,$3,410)', [testId, batch.deliveries[0].lease, 'expired']));
  assert.equal((await q('select enabled from safewatch_private.family_push_subscriptions where id=$1', [sub]))[0].enabled, false);
  await save(family, 'https://fcm.googleapis.com/fcm/send/test:token');
  await insert();
  await q('delete from auth.sessions where user_id=$1', [family]);
  assert.equal((await claim()).deliveries.length, 0);
  console.log('PASS isolated delayed/rate-limited test notifications, expired subscription cleanup and sign-out cancellation');
} finally { await pg.close(); }
