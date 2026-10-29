import { AlertTriangle, Bell, MapPin, ShieldCheck } from 'lucide-react';
import { alertClock } from '../../../shared/alertLifecycle.js';
import { formatDuration } from './AlertWarning.jsx';
import { FamilyPageTitle } from './FamilyNatureUI.jsx';

export default function FamilyAlerts({ senior, familyAlerts, now, confirmingKey, error, handleAcknowledge, handleDismissAll }) {
  return <div className="nature-secondary nature-alerts">
    <FamilyPageTitle title="Alerts">Health, location, and safety updates.</FamilyPageTitle>
    <div className="nature-alerts__heading"><h2><Bell aria-hidden="true"/>Pending alerts <span>{familyAlerts.length}</span></h2>{familyAlerts.length > 0 && <button type="button" data-confirm-alert disabled={!!confirmingKey} onClick={handleDismissAll}>Confirm all</button>}</div>
    {error && <p role="alert" className="nature-notice nature-notice--error">{error}</p>}
    {!familyAlerts.length ? <div className="nature-glass nature-alerts__empty"><span><ShieldCheck aria-hidden="true"/></span><h2>No pending alerts</h2><p>Safety alerts from your linked watches will appear here.</p></div> : familyAlerts.map(alert => {
      const clock = alertClock(alert, now);
      const sos = alert.alert_type === 'SOS';
      const Icon = sos ? AlertTriangle : MapPin;
      return <article key={alert.key} className={`nature-glass nature-alert${sos ? ' nature-alert--sos' : ''}`}><span className="nature-alert__icon"><Icon aria-hidden="true"/></span><div className="nature-alert__body"><p className="nature-alert__name">{alert.devices?.patient_name || senior.name}</p><h3>{sos ? 'SOS button pressed' : 'Left safe zone'}</h3><p>Unconfirmed for {formatDuration(clock.elapsedSeconds)}</p><strong className="nature-alert__timer">{clock.escalated ? 'Barangay attention required' : `${formatDuration(clock.remainingSeconds)} remaining`}</strong><p className="nature-alert__date">Latest update: {new Date(alert.details.last_seen_at).toLocaleTimeString()}</p><button type="button" data-confirm-alert disabled={!!confirmingKey} onClick={() => handleAcknowledge(alert)}>{confirmingKey === alert.key ? 'Saving confirmation…' : 'Confirm I have checked'}</button><time dateTime={alert.created_at}>{new Date(alert.created_at).toLocaleString()}</time></div></article>;
    })}
  </div>;
}
