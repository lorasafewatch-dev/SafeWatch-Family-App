import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/index.css';
import { monitoringFeatureFixture } from '../../shared/tests/monitoringFeatureFixture.js';
const { client, state } = monitoringFeatureFixture('family');
if (new URL(window.location.href).searchParams.get('push_fixture') === 'active') {
  const at = new Date().toISOString();
  state.alerts.push({ id: 2, device_id: state.devices[1].id, alert_type: 'SOS', created_at: at,
    details: { status: 'PENDING_FAMILY', incident_open: true, first_seen_at: at,
      sos_family_first: true, sos_assigned_to: 'family', sos_family_deadline_at: new Date(Date.now()+180000).toISOString() } });
}
createRoot(document.getElementById('root')).render(<App client={client}/>);
