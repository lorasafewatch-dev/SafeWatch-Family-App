import { AlertCircle, BatteryLow, MapPin } from 'lucide-react';
import { alertClock, alertTitle, batteryAlertMessage } from '../../../shared/alertLifecycle.js';
import { SosResponseIndicator } from '../../../shared/components/SosResponseStatus.jsx';
import { sosResponseState } from '../../../shared/sosResponse.js';

export const formatDuration = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

export default function AlertWarning({ incident, now, onConfirm, onDecline, onMinimize,
  busy = false, error = '', soundsBlocked = false, onEnableSounds }) {
  if (!incident) return null;
  const clock = alertClock(incident, now);
  const isSos = incident.alert_type === 'SOS';
  const battery = incident.alert_type === 'LOW_BATTERY';
  const response = sosResponseState(incident);
  const handedOff = isSos && !!response.assigned;
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
      <div role="alertdialog" aria-modal="true" aria-labelledby="incident-title"
        aria-describedby="incident-message" className="bg-white rounded-3xl w-full max-w-sm max-h-[calc(100dvh-3rem)] overflow-y-auto shadow-2xl">
        <div className={`p-6 text-center text-white ${isSos ? 'bg-red-500' : 'bg-orange-500'}`}>
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            {isSos ? <AlertCircle className="w-8 h-8" /> : battery ? <BatteryLow className="w-8 h-8" /> : <MapPin className="w-8 h-8" />}
          </div>
          <h2 id="incident-title" className="text-2xl font-black mb-2">
            {alertTitle(incident)}
          </h2>
          <p className="text-sm font-medium">{incident.devices?.patient_name || 'Your family member'}</p>
        </div>
        <div className="p-6 text-center space-y-4">
          <p id="incident-message" className="text-sm font-bold text-slate-800">
            {handedOff ? response.message : battery ? batteryAlertMessage(incident) : clock.escalated ? 'The response window has elapsed. This alert needs Barangay attention.'
              : clock.warning ? 'Time is running out. Please confirm before the response window ends.'
              : 'Please check your family member and confirm this alert.'}
          </p>
          {!battery && !handedOff && <><div className="text-4xl font-black text-red-500 tabular-nums" aria-live="off">
            {formatDuration(clock.remainingSeconds)}
          </div>
          <p className="text-xs text-slate-500">
            {clock.escalated ? 'Response window elapsed' : 'Time remaining before Barangay escalation'}
            <br />Unconfirmed for {formatDuration(clock.elapsedSeconds)}
          </p></>}
          <SosResponseIndicator incident={incident}/>
          <p className="text-xs text-slate-500">Latest update: {new Date(incident.details?.last_seen_at || incident.created_at).toLocaleTimeString()}</p>
          {soundsBlocked && <button onClick={onEnableSounds} className="text-xs font-bold text-orange-700 underline">Enable alert sounds</button>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button data-confirm-alert disabled={busy} onClick={() => onConfirm(incident)}
            className={`w-full py-4 text-white font-black rounded-2xl text-sm disabled:opacity-50 ${isSos ? 'bg-red-500' : 'bg-orange-500'}`}>
            {busy ? 'Saving response…' : isSos ? 'Confirm response' : 'Confirm I have checked'}
          </button>
          {isSos && onDecline && <button data-confirm-alert disabled={busy || response.responses.family?.decision === 'declined'} onClick={() => onDecline(incident)} className="sos-decline-button w-full">Decline — notify barangay secretary</button>}
          <button onClick={onMinimize} className="text-sm font-bold text-slate-600">Keep monitoring</button>
          <p className="text-xs text-slate-400">{isSos ? 'Declining requests help from the barangay secretary. The SOS stays open until someone confirms a response.' : battery ? 'This alert stays active until confirmed or the battery recovers.' : 'Keeping this window closed does not confirm the alert or stop its timer.'}</p>
        </div>
      </div>
    </div>
  );
}
