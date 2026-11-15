// Actual UI and client helpers with synthetic RPC responses. No production writes.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import FamilyAlerts from '../src/components/FamilyAlerts.jsx';
import AlertWarning from '../src/components/AlertWarning.jsx';
import FamilySafeZoneEditor from '../src/components/FamilySafeZoneEditor.jsx';
import { SosResponseIndicator } from '../../shared/components/SosResponseStatus.jsx';
import { needsBarangayAttention } from '../../shared/alertLifecycle.js';
import { respondToSos, sosResponseError } from '../../shared/sosResponse.js';

const deviceId = '70000000-0000-0000-0000-000000000001';
const initialZone = { name: 'Family visit outside San Isidro', lat: 14.6, lng: 121.04, radius: 595, revision: 'preview-zone' };
const makeIncident = () => {
  const at = new Date().toISOString();
  return { id: 1, key: 'preview-sos', device_id: deviceId, alert_type: 'SOS',
    devices: { patient_name: 'Preview Senior' }, created_at: at,
    details: { status: 'PENDING_FAMILY', incident_open: true, first_seen_at: at, last_seen_at: at } };
};

function Preview() {
  const [incident, setIncident] = useState(makeIncident);
  const [zone, setZone] = useState(initialZone);
  const storedZone = useRef(initialZone);
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [popup, setPopup] = useState(false);
  const client = { rpc: async (name, args) => {
    if (fail) return { error: new Error('Synthetic connection failure. Please retry.') };
    if (name === 'respond_to_sos') {
      const at = new Date().toISOString();
      return { data: { saved: true, alert: { ...incident, details: { ...incident.details,
        status: args.p_decision === 'confirmed' ? 'ACKNOWLEDGED_FAMILY' : 'ESCALATED_BHW',
        sos_assigned_to: args.p_decision === 'confirmed' ? 'none' : 'barangay',
        sos_response_version: 1, sos_response_at: at,
        sos_responses: { family: { decision: args.p_decision, at, by: 'preview-family' } },
      } } } };
    }
    if (name === 'save_family_safe_zone') {
      if (JSON.stringify(args.p_expected_zone) !== JSON.stringify(storedZone.current)) return { error: { code: '40001' } };
      storedZone.current = args.p_zone ? { ...args.p_zone, revision: crypto.randomUUID() } : null;
      return { data: { device_id: args.p_device_id, zone: storedZone.current } };
    }
    throw new Error(`Unexpected preview RPC: ${name}`);
  } };
  const respond = async (alert, decision) => {
    setBusy(true); setError('');
    try { setIncident(await respondToSos(client, alert, decision)); setPopup(false); }
    catch (failure) { setError(sosResponseError(failure)); }
    finally { setBusy(false); }
  };
  const hasResponse = !!incident.details.sos_responses;
  const pending = !hasResponse;
  return <main className="family-nature" style={{ width: 'min(100%, 480px)', margin: '24px auto', padding: 16, minHeight: '100vh' }}>
    <h1 className="text-xl font-bold">Feature review preview</h1>
    <p className="text-sm my-3">Synthetic data only. No real accounts or alerts.</p>
    <div className="flex flex-wrap gap-4 text-sm underline mb-5">
      <button type="button" onClick={() => setFail(value => !value)}>{fail ? 'Restore connection' : 'Simulate failed saves'}</button>
      <button type="button" onClick={() => { setIncident(makeIncident()); setError(''); }}>New test SOS</button>
      <button type="button" onClick={() => setPopup(true)}>Show SOS popup</button>
      <button type="button" onClick={() => { storedZone.current = { ...initialZone }; setZone(storedZone.current); }}>Load outside safe zone</button>
    </div>
    <FamilyAlerts senior={{ name: 'Preview Senior' }} familyAlerts={pending ? [incident] : []} now={Date.now()}
      confirmingKey={busy ? incident.key : ''} error={error}
      handleAcknowledge={alert => respond(alert, 'confirmed')} handleDecline={alert => respond(alert, 'declined')}
      handleDismissAll={() => respond(incident, 'confirmed')} sosResponses={hasResponse ? [incident] : []}/>
    {hasResponse && <section aria-label="Barangay handoff" className="nature-glass p-4 mb-5"><h2 className="font-bold">Barangay desk</h2>
      <p>{needsBarangayAttention(incident) ? 'SOS needs barangay attention immediately.' : 'Response confirmed.'}</p><SosResponseIndicator incident={incident}/></section>}
    <FamilySafeZoneEditor client={client} senior={{ name: 'Preview Senior', deviceId, safeZone: zone }} onSaved={(_id, saved) => setZone(saved)}/>
    <AlertWarning incident={popup && pending ? incident : null} now={Date.now()} busy={busy} error={error}
      onConfirm={alert => respond(alert, 'confirmed')} onDecline={alert => respond(alert, 'declined')} onMinimize={() => setPopup(false)}/>
  </main>;
}

createRoot(document.getElementById('root')).render(<Preview/>);
