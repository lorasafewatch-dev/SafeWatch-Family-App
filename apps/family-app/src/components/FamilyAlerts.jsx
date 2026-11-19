import { AlertTriangle, BatteryLow, Bell, MapPin, ShieldCheck } from 'lucide-react';
import { alertClock, alertTitle, batteryAlertMessage } from '../../../shared/alertLifecycle.js';
import { formatDuration } from './AlertWarning.jsx';
import { FamilyPageTitle } from './FamilyNatureUI.jsx';
import SosResponseUpdates, { SosResponseIndicator } from '../../../shared/components/SosResponseStatus.jsx';
import { sosResponseState } from '../../../shared/sosResponse.js';
import { useState } from 'react';
import IncidentDetails from '../../../shared/components/IncidentDetails.jsx';
import ActivityHistory from '../../../shared/components/ActivityHistory.jsx';
import SeniorPhoto from '../../../shared/components/SeniorPhoto.jsx';

export default function FamilyAlerts({ client, seniors = [], senior, familyAlerts, now, confirmingKey, error, handleAcknowledge, handleDecline, handleDismissAll, sosResponses, sosResponsesError, onRetryResponses, onOpenHistory }) {
  const [details, setDetails] = useState(null);
  return <div className="nature-secondary nature-alerts">
    <FamilyPageTitle title="Alerts">Health, location, and safety updates.</FamilyPageTitle>
    {onOpenHistory && <button type="button" className="watch-activity__more" onClick={onOpenHistory}>Activity log &amp; alert history</button>}
    <div className="nature-alerts__heading"><h2><Bell aria-hidden="true"/>Pending alerts <span>{familyAlerts.length}</span></h2>{familyAlerts.length > 0 && <button type="button" data-confirm-alert disabled={!!confirmingKey} onClick={handleDismissAll}>Confirm all</button>}</div>
    {error && <p role="alert" className="nature-notice nature-notice--error">{error}</p>}
    {!familyAlerts.length ? <div className="nature-glass nature-alerts__empty"><span><ShieldCheck aria-hidden="true"/></span><h2>No pending alerts</h2><p>Safety alerts from your linked watches will appear here.</p></div> : familyAlerts.map(alert => {
      const clock = alertClock(alert, now);
      const sos = alert.alert_type === 'SOS';
      const battery = alert.alert_type === 'LOW_BATTERY';
      const Icon = sos ? AlertTriangle : battery ? BatteryLow : MapPin;
      const response = sosResponseState(alert);
      return <article key={alert.key} className={`nature-glass nature-alert${sos ? ' nature-alert--sos' : ''}`}>
        <span className="nature-alert__icon"><Icon aria-hidden="true"/></span>
        <div className="nature-alert__body"><div className="senior-feature-person"><SeniorPhoto deviceId={alert.device_id}/><p className="nature-alert__name">{alert.devices?.patient_name || senior.name}</p></div>
          <h3>{alertTitle(alert)}</h3><p>{battery ? batteryAlertMessage(alert) : `Unconfirmed for ${formatDuration(clock.elapsedSeconds)}`}</p>
          <strong className="nature-alert__timer">{sos && response.assigned ? response.message : battery ? 'Charge the watch soon' : clock.escalated ? 'Barangay attention required' : `${formatDuration(clock.remainingSeconds)} remaining`}</strong>
          <SosResponseIndicator incident={alert}/>
          <button type="button" onClick={() => setDetails(alert)}>View details</button>
          <p className="nature-alert__date">Latest update: {new Date(alert.details.last_seen_at).toLocaleTimeString()}</p>
          <button type="button" data-confirm-alert disabled={!!confirmingKey} onClick={() => handleAcknowledge(alert)}>{confirmingKey === alert.key ? 'Saving response…' : sos ? 'Confirm response' : 'Confirm I have checked'}</button>
          {sos && handleDecline && <><p>Cannot reach the senior? Notify the barangay secretary or admin immediately.</p><button type="button" className="sos-decline-button" data-confirm-alert disabled={!!confirmingKey || response.responses.family?.decision === 'declined'} onClick={() => handleDecline(alert)}>{response.responses.family?.decision === 'declined' ? 'Barangay already notified' : 'Can’t respond — notify barangay'}</button></>}
          <time dateTime={alert.created_at}>{new Date(alert.created_at).toLocaleString()}</time>
        </div></article>;
    })}
    <SosResponseUpdates responses={sosResponses} error={sosResponsesError} onRetry={onRetryResponses} onDetails={setDetails}/>
    {client && !onOpenHistory && <ActivityHistory client={client} seniors={seniors} selectedId={senior.deviceId} onDetails={setDetails}/>}
    {details && <IncidentDetails incident={details} onClose={() => setDetails(null)}/>}
  </div>;
}
