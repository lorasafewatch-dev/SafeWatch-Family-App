import { useEffect, useId, useRef, useState } from 'react';
import { BellRing, CheckCircle2, Loader2 } from 'lucide-react';
import { notificationSetupKey, rememberNotificationSetup } from '../familyPush.js';
import './SosNotificationSettings.css';

export default function SosNotificationSettings({ push, compact = false, onLater }) {
  const titleId = useId();
  const { status, busy, error, notice, enable, disable, test } = push;
  const enabled = status === 'enabled';
  const needsInstall = status === 'install';
  const unsupported = status === 'unsupported';
  if (compact && ['enabled', 'unsupported', 'checking'].includes(status)) return null;
  return <section className={`sos-notification-settings${compact ? ' sos-notification-settings--compact' : ''}`} aria-label="SOS background notifications">
    <div className="sos-notification-settings__heading">
      <span><BellRing aria-hidden="true"/></span>
      <div>
        <h3 id={titleId}>{onLater ? 'Set up SOS notifications' : 'SOS notifications'}</h3>
        <p>{enabled ? 'Enabled on this device' : 'Get alerted even when SafeWatch is closed'}</p>
      </div>
      {enabled && <CheckCircle2 className="sos-notification-settings__check" aria-hidden="true"/>}
    </div>
    {needsInstall ? <ol className="sos-notification-settings__steps">
      <li>Open SafeWatch in Safari and tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
      <li>If shown, turn on <strong>Open as Web App</strong> and tap <strong>Add</strong>.</li>
      <li>Open SafeWatch from your Home Screen, sign in, and tap <strong>Enable SOS notifications</strong>.</li>
    </ol> : unsupported ? <p>Background notifications are unavailable in this browser. Open SafeWatch in a current browser that supports Web Push.</p>
      : status === 'blocked' ? <p>Notifications are blocked. Allow SafeWatch in your browser’s site permissions or your device’s notification settings.</p>
      : <p>When a linked senior sends an SOS, tap the notification to open that alert. Sound and vibration follow this device’s settings.</p>}
    {!compact && !onLater && !needsInstall && !unsupported && <p className="sos-notification-settings__help">If notifications are quiet, check the device’s notification volume and Do Not Disturb settings.</p>}
    {error && status !== 'blocked' && <p role="alert" className="sos-notification-settings__error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {(!unsupported && !needsInstall || onLater) && <div className="sos-notification-settings__actions">
      {enabled ? <>
        <button type="button" disabled={busy} onClick={test}>Send test notification</button>
        {!compact && <button type="button" className="sos-notification-settings__secondary" disabled={busy} onClick={disable}>Turn off on this device</button>}
      </> : !needsInstall && !unsupported && status !== 'blocked' && <button type="button" disabled={busy || status === 'checking'} onClick={enable}>
        {busy && <Loader2 aria-hidden="true" className="animate-spin"/>}{busy ? 'Enabling…' : 'Enable SOS notifications'}
      </button>}
      {onLater && <button type="button" className="sos-notification-settings__secondary" onClick={onLater}>Set up later</button>}
    </div>}
  </section>;
}

export function SosNotificationSetup({ push, userId, paused }) {
  const dialog = useRef(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(notificationSetupKey(userId)) === 'done'; }
    catch { return false; }
  });
  const open = !paused && !dismissed && ['off', 'blocked', 'install'].includes(push.status);
  useEffect(() => {
    if (push.status === 'enabled') queueMicrotask(() => setDismissed(true));
  }, [push.status]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); };
  }, [open]);
  const later = () => {
    rememberNotificationSetup(userId);
    setDismissed(true);
  };
  if (!open) return null;
  return <dialog ref={dialog} className="sos-notification-setup" aria-label="Set up SOS notifications"
    onCancel={event => { event.preventDefault(); later(); }}>
    <SosNotificationSettings push={push} onLater={later}/>
    <p className="sos-notification-setup__hint">You can change this any time under Profile.</p>
  </dialog>;
}
