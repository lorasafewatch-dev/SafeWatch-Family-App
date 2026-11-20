// Isolated browser fixture. No real Supabase calls, accounts or stored user data.
import { createAuthFixture } from './authFixture.js';
import { manilaDate } from '../locationHistory.js';
export function monitoringFeatureFixture(app) {
  const auth = createAuthFixture(app);
  if (app === 'family') auth.useFamily(); else {
    auth.useSuper(); auth.state.users.find(user => user.id === auth.state.currentId).factors = [{ id: 'test-mfa', factor_type: 'totp', status: 'verified' }]; auth.state.level = 'aal2';
  }
  const devices = [1, 2, 3].map((n, i) => ({ id: `72000000-0000-0000-0000-${String(n).padStart(12, '0')}`, patient_name: i < 2 ? 'Carmen Santos' : 'Unapproved Senior', device_name: 'Watch', age: 74 + i, gender: 'Female' }));
  const links = new Set(devices.slice(0, 2).map(row => row.id));
  const now = new Date().toISOString();
  const snapshot = { incident_at: now, recorded_at: now, source: 'watch', point: { lat: 14.039, lng: 121.123 } };
  const alerts = [{ id: 1, device_id: devices[0].id, alert_type: 'SOS', created_at: now, details: { status: 'ACKNOWLEDGED_BHW', incident_open: false, first_seen_at: now, last_seen_at: now, sos_location: snapshot } }];
  const requests = [{ id: 1, device_id: devices[2].id, user_id: auth.state.users[0].id, status: app === 'family' ? 'approved' : 'pending', kind: 'link', created_at: now, reviewed_at: now, applicant_name: 'Test Family', applicant_email: 'family@example.test' }];
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const paint = canvas.getContext('2d'); paint.fillStyle = '#236d58'; paint.fillRect(0, 0, 64, 64); paint.fillStyle = 'white'; paint.font = 'bold 24px sans-serif'; paint.fillText('CS', 14, 42);
  const image = new Blob([Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), char => char.charCodeAt(0))], { type: 'image/png' });
  const photos = new Map();
  devices[0].photo_path = `${devices[0].id}/11111111-1111-1111-1111-111111111111.webp`;
  photos.set(devices[0].photo_path, image);
  const listeners = new Set();
  const refresh = () => listeners.forEach(callback => callback({}));
  const allowed = () => app === 'family' ? devices.filter(row => links.has(row.id)) : devices;
  const visibleAlert = row => app === 'family' || row.details?.sos_family_first !== true || !!row.details.sos_transferred_at;
  const state = { devices, requests, alerts, links, photos, telemetryByDevice: {}, failDaily: false, failRequest: false, failAddress: false, refresh };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.maximum = Infinity; this.sort = null; }
    select() { return this; } or() { return this; } not() { return this; }
    eq(key, value) { this.filters.push(row => key === 'id' ? String(row[key]) === String(value) : row[key] === value); return this; }
    maybeSingle() { this.single = true; return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    lt(key, value) { this.filters.push(row => row[key] < value); return this; }
    neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
    gt() { return this; } gte() { return this; } lte() { return this; }
    abortSignal() { return this; }
    order(key, { ascending } = {}) { this.sort = { key, ascending }; return this; }
    limit(value) { this.maximum = value; return this; }
    insert(value) { this.add = value; return this; }
    then(resolve, reject) {
      if (this.add) {
        if (devices.some(row => row.id === this.add.id)) return Promise.resolve({ error: { code: '23505' } }).then(resolve, reject);
        devices.push(this.add); return Promise.resolve({ error: null }).then(resolve, reject);
      }
      let rows = [];
      if (this.table === 'devices') rows = allowed();
      if (this.table === 'family_seniors') rows = allowed().map(device => ({ device_id: device.id, user_id: auth.state.currentId, created_at: now, devices: device }));
      if (this.table === 'safewatch_family_requests') rows = requests;
      if (this.table === 'telemetry') rows = allowed().map((device, index) => ({ id: index + 1, device_id: device.id, heart_rate: index ? 88 : 72, spo2: 98, battery_percent: 85, created_at: new Date().toISOString(), received_at: new Date().toISOString(), location: 'POINT(121.123 14.039)', is_sos: false, ...state.telemetryByDevice[device.id] }));
      if (this.table === 'telemetry' && state.telemetryHistory) rows = [...rows, ...state.telemetryHistory];
      if (this.table === 'telemetry' && state.failLocation && this.maximum > 1) return Promise.resolve({ error: new Error('Location refresh failed') }).then(resolve, reject);
      if (this.table === 'alerts') rows = alerts.filter(row => visibleAlert(row) && allowed().some(device => device.id === row.device_id)).map(row => ({ ...row, devices: devices.find(device => device.id === row.device_id) }));
      rows = rows.filter(row => this.filters.every(filter => filter(row)));
      if (this.sort) rows = [...rows].sort((a, b) => (a[this.sort.key] === b[this.sort.key] ? 0 : a[this.sort.key] > b[this.sort.key] ? 1 : -1) * (this.sort.ascending ? 1 : -1));
      return Promise.resolve({ data: structuredClone(this.single ? rows[0] || null : rows.slice(0, this.maximum)), error: null }).then(resolve, reject);
    }
  }
  const client = { ...auth.client, from: table => new Query(table),
    storage: { from: () => ({ download: async path => ({ data: photos.get(path), error: null }), upload: async (path, blob) => { if (state.failPhotoUpload) return { error: new Error('Photo upload failed. Please retry.') }; photos.set(path, blob); return { error: null }; }, remove: async paths => { paths.forEach(path => photos.delete(path)); return { error: null }; } }) },
    channel: () => { const channel = { on: (_event, _filter, fn) => { listeners.add(fn); return channel; }, subscribe: () => channel }; return channel; }, removeChannel: () => {},
    rpc: async (name, args = {}) => {
      if (name === 'family_push_configuration') return { data: { publicKey: 'B' + 'A'.repeat(86) }, error: null };
      if (name === 'save_family_push_subscription') { state.pushSaves = (state.pushSaves || 0) + 1; return state.failPush ? { error: new Error('Notification connection failed. Please retry.') } : { data: '70000000-0000-0000-0000-000000000001', error: null }; }
      if (name === 'remove_family_push_subscription') return { data: null, error: null };
      if (name === 'request_family_push_test') { state.pushTests = (state.pushTests || 0) + 1; return { data: '70000000-0000-0000-0000-000000000002', error: null }; }
      if (name === 'get_watch_activity_history') return { data: alerts.filter(row => (!args.p_device_id || row.device_id === args.p_device_id) && ['all', 'alerts'].includes(args.p_category) && (!args.p_alert_type || row.alert_type === args.p_alert_type)).map(row => ({ event_id: row.id, device_id: row.device_id, occurred_at: row.created_at, category: 'alerts', event_kind: 'alert_opened', alert_type: row.alert_type, patient_name: devices.find(device => device.id === row.device_id)?.patient_name, status: row.details.status, details: { alert_id: row.id, incident_open: row.details.incident_open } })), error: null };
      if (name === 'get_watch_daily_health') return state.failDaily ? { error: new Error('Synthetic failure') } : { data: [{ pulse_average: args.p_day === manilaDate() ? args.p_device_id === devices[0].id ? 72 : 88 : null, pulse_count: args.p_day === manilaDate() ? 2 : 0, oxygen_average: args.p_day === manilaDate() ? 98 : null, oxygen_count: args.p_day === manilaDate() ? 1 : 0 }], error: null };
      if (name === 'get_watch_location_history') { state.lastLocationHistoryDevice = args.p_device_id; return { data: [], error: null }; }
      if (name === 'list_sos_response_updates') return { data: alerts.filter(row => visibleAlert(row) && (row.details.status.startsWith('ACKNOWLEDGED') || row.details.sos_transferred_at)).map(row => ({ ...row, patient_name: devices.find(device => device.id === row.device_id)?.patient_name })), error: null };
      if (name === 'list_family_senior_requests') return { data: requests, error: null };
      if (name === 'list_family_senior_links') return { data: devices.filter(device => links.has(device.id)).map(device => ({ user_id: auth.state.users[0].id, device_id: device.id, senior_name: device.patient_name, applicant_name: 'Test Family', applicant_email: 'family@example.test' })), error: null };
      if (name === 'review_family_senior_request') { const row = requests.find(row => row.id === args.p_request_id); row.status = args.p_decision === 'approve' ? 'approved' : 'rejected'; row.reviewed_at = new Date().toISOString(); if (row.status === 'approved') links.add(row.device_id); return { data: row, error: null }; }
      if (name === 'request_family_senior_access' || name === 'request_family_senior_registration') {
        if (state.failRequest) return { error: new Error('Request not saved') };
        if (!requests.some(row => row.device_id === args.p_device_id && row.status === 'pending')) requests.push({ id: requests.length + 1, device_id: args.p_device_id, requested_name: args.p_name, status: 'pending', created_at: new Date().toISOString() });
        return { data: args.p_device_id, error: null };
      }
      if (name === 'set_senior_photo') { const device = devices.find(row => row.id === args.p_device_id); const previous_path = device.photo_path; device.photo_path = args.p_path; return { data: { photo_path: args.p_path, previous_path }, error: null }; }
      if (name === 'mark_sos_arrived') {
        const row = alerts.find(item => String(item.id) === String(args.p_alert_id));
        if (state.failSosResponse || app === 'family' || row?.details.status !== 'ACKNOWLEDGED_BHW') {
          return { error: new Error('Arrival was not saved') };
        }
        if (!row.details.sos_arrived_at) {
          const at = new Date().toISOString();
          Object.assign(row.details, { sos_arrived_at: at, sos_arrived_by: auth.state.currentId, sos_response_at: at,
            sos_response_version: (row.details.sos_response_version || 0) + 1 });
          refresh();
        }
        return { data: { saved: true, alert: structuredClone(row) }, error: null };
      }
      if (name === 'respond_to_sos') {
        if (state.failSosResponse) return { error: new Error('Response not saved') };
        const row = alerts.find(row => row.id === args.p_alert_id), at = new Date().toISOString();
        if (args.p_role === 'barangay' && !visibleAlert(row)) return { error: { code: '42501' } };
        if (row.details.sos_responses?.[args.p_role]?.decision === args.p_decision) return { data: { saved:true,alert:structuredClone(row) },error:null };
        row.details.sos_response_version=(row.details.sos_response_version||0)+1;
        row.details.status = args.p_decision === 'confirmed' ? args.p_role === 'barangay' ? 'ACKNOWLEDGED_BHW' : 'ACKNOWLEDGED_FAMILY' : 'ESCALATED_BHW';
        row.details.acknowledged_at = at;
        row.details.sos_responses = { ...row.details.sos_responses, [args.p_role]: { decision: args.p_decision, at, by: auth.state.currentId } };
        if (args.p_role === 'family' && args.p_decision === 'declined') Object.assign(row.details,{status:'ESCALATED_BHW',sos_assigned_to:'barangay',sos_transferred_at:at,sos_transfer_reason:'family_unavailable',sos_transferred_by:auth.state.currentId});
        if (args.p_decision === 'confirmed') row.details.sos_assigned_to='none';
        refresh();
        return { data: { saved: true, alert: structuredClone(row) }, error: null };
      }
      return auth.client.rpc(name, args);
    },
  };
  state.triggerSos = () => { const timestamp = new Date().toISOString(); alerts.unshift({ id: 2, device_id: devices[0].id, alert_type: 'SOS', created_at: timestamp, details: { status: 'ESCALATED_BHW', incident_open: true, first_seen_at: timestamp, last_seen_at: timestamp, sos_location: { ...snapshot, incident_at: timestamp } } }); refresh(); };
  globalThis.monitoringFixture = state;
  return { client, auth, state };
}
