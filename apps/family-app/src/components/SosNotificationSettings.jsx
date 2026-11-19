import { BellRing, CheckCircle2, Loader2 } from 'lucide-react';
import './SosNotificationSettings.css';

export default function SosNotificationSettings({ push, compact = false }) {
  if (compact && ['enabled', 'unsupported', 'checking'].includes(push.status)) return null;
  return <section className={`sos-notification-settings${compact ? ' sos-notification-settings--compact' : ''}`} aria-label="SOS background notifications">
    <div className="sos-notification-settings__heading"><span><BellRing aria-hidden="true"/></span><div><h3>SOS notifications</h3><p>{push.status === 'enabled' ? 'Enabled on this device' : 'Get alerted even when SafeWatch is closed'}</p></div>{push.status === 'enabled' && <CheckCircle2 className="sos-notification-settings__check" aria-hidden="true"/>}</div>
    <p>{push.status === 'unsupported' ? 'Background notifications are unavailable in this browser. Use the installed SafeWatch app in a supported browser.' : push.status === 'blocked' ? 'Notifications are blocked. Allow them in your phone’s SafeWatch notification settings, then retry.' : 'An SOS notification plays your device’s notification sound and vibrates. Tap it to open that SOS.'}</p>
    {!compact && <p className="sos-notification-settings__help">Keep notifications and their sound enabled in Android settings. Silent mode, Do Not Disturb, battery restrictions, and an offline phone can affect delivery and sound.</p>}
    {push.error && <p role="alert" className="sos-notification-settings__error">{push.error}</p>}
    {push.notice && <p role="status">{push.notice}</p>}
    {push.status !== 'unsupported' && <div className="sos-notification-settings__actions">
      {push.status === 'enabled' ? <><button type="button" disabled={push.busy} onClick={push.test}>Send test notification</button>{!compact && <button type="button" className="sos-notification-settings__secondary" disabled={push.busy} onClick={push.disable}>Turn off on this device</button>}</> : <button type="button" disabled={push.busy || push.status === 'checking'} onClick={push.enable}>{push.busy && <Loader2 aria-hidden="true" className="animate-spin"/>}{push.busy ? 'Enabling…' : 'Enable SOS notifications'}</button>}
    </div>}
  </section>;
}
