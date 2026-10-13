import { AlertCircle, MapPin } from 'lucide-react';
import { alertClock } from '../../../shared/alertLifecycle.js';

export const formatDuration = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

export default function AlertWarning({ incident, now, onConfirm, onMinimize,
  busy = false, error = '', soundsBlocked = false, onEnableSounds }) {
  if (!incident) return null;
  const clock = alertClock(incident, now);
  const isSos = incident.alert_type === 'SOS';
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
      <div role="alertdialog" aria-modal="true" aria-labelledby="incident-title"
        aria-describedby="incident-message" className="bg-white rounded-3xl w-full max-w-sm max-h-[calc(100dvh-3rem)] overflow-y-auto shadow-2xl">
        <div className={`p-6 text-center text-white ${isSos ? 'bg-red-500' : 'bg-orange-500'}`}>
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            {isSos ? <AlertCircle className="w-8 h-8" /> : <MapPin className="w-8 h-8" />}
          </div>
          <h2 id="incident-title" className="text-2xl font-black mb-2">
            {isSos ? 'SOS alert' : 'Outside the safe zone'}
          </h2>
          <p className="text-sm font-medium">{incident.devices?.patient_name || 'Your family member'}</p>
        </div>
        <div className="p-6 text-center space-y-4">
          <p id="incident-message" className="text-sm font-bold text-slate-800">
            {clock.escalated ? 'The response window has elapsed. This alert needs Barangay attention.'
              : clock.warning ? 'Time is running out. Please confirm before the response window ends.'
              : 'Please check your family member and confirm this alert.'}
          </p>
          <div className="text-4xl font-black text-red-500 tabular-nums" aria-live="off">
            {formatDuration(clock.remainingSeconds)}
          </div>
          <p className="text-xs text-slate-500">
            {clock.escalated ? 'Response window elapsed' : 'Time remaining before Barangay escalation'}
            <br />Unconfirmed for {formatDuration(clock.elapsedSeconds)}
          </p>
          <p className="text-xs text-slate-500">Latest update: {new Date(incident.details?.last_seen_at || incident.created_at).toLocaleTimeString()}</p>
          {soundsBlocked && <button onClick={onEnableSounds} className="text-xs font-bold text-orange-700 underline">Enable alert sounds</button>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button data-confirm-alert disabled={busy} onClick={() => onConfirm(incident)}
            className={`w-full py-4 text-white font-black rounded-2xl text-sm disabled:opacity-50 ${isSos ? 'bg-red-500' : 'bg-orange-500'}`}>
            {busy ? 'Saving confirmation…' : 'Confirm I have checked'}
          </button>
          <button onClick={onMinimize} className="text-sm font-bold text-slate-600">Keep monitoring</button>
          <p className="text-xs text-slate-400">Keeping this window closed does not confirm the alert or stop its timer.</p>
        </div>
      </div>
    </div>
  );
}
