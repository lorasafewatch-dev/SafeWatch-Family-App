import { Battery, Bell, ChevronRight, MapPin, ShieldCheck, Sun } from 'lucide-react';
import { DEFAULT_SAFE_ZONE_NAME } from '../../../shared/familySafeZone.js';
import { locationAge } from '../../../shared/gpsLocation.js';
import { Freshness, LocationBadge, ReadingCard, SeniorSelector, locationPresentation } from './FamilyNatureUI.jsx';
import FamilyMapPreview from './FamilyMapPreview.jsx';

export default function FamilyHome({ senior, seniors, selectedId, onSelect, telemetry, familyAlerts, now, setView }) {
  const state = locationPresentation(senior, now, telemetry.is_sos || familyAlerts.length > 0);
  const hour = new Date(now).getHours();
  const battery = telemetry.battery_percent;
  return <div className="nature-home">
    <div className="nature-greeting"><h1>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}! <Sun aria-hidden="true"/></h1><p>Your family, a little closer.</p></div>
    <SeniorSelector senior={senior} seniors={seniors} selectedId={selectedId} onSelect={onSelect}>
      <div className="nature-senior__status"><LocationBadge state={state}/><span>{state.freshness}</span></div>
    </SeniorSelector>
    <div className="nature-readings"><ReadingCard type="heart" value={telemetry.heart_rate}/><ReadingCard type="oxygen" value={telemetry.spo2}/></div>
    <div className="nature-watch nature-glass"><div className={`nature-watch__battery${battery != null && battery < 20 ? ' nature-text-alert' : ''}`}><Battery aria-hidden="true"/><span>Watch battery</span><strong>{battery == null ? '—' : `${battery}%`}</strong></div><button type="button" onClick={() => setView('alerts')} aria-label={`View alerts (${familyAlerts.length} active)`}><Bell aria-hidden="true"/><span><strong>{familyAlerts.length}</strong> active alerts</span><ChevronRight aria-hidden="true"/></button></div>
    <section className="nature-home-map nature-glass" aria-label="Latest location"><div className="nature-home-map__heading"><h2><MapPin aria-hidden="true"/>Latest location</h2><button type="button" onClick={() => setView('location')}>View map <ChevronRight aria-hidden="true"/></button></div><FamilyMapPreview key={senior.deviceId || 'waiting'} senior={senior} now={now}/>{!state.live && <p className="nature-home-map__notice">{state.known ? 'Last known position · GPS updates unavailable' : 'Waiting for a GPS fix · boundary shown'}</p>}</section>
    <button type="button" className="nature-home-zone nature-glass" onClick={() => setView('location')} aria-label="Manage safe zone"><ShieldCheck aria-hidden="true"/><span><strong>Safe zone</strong><span>{senior.safeZone?.name || DEFAULT_SAFE_ZONE_NAME}{senior.safeZone ? ` · ${senior.safeZone.radius.toLocaleString()} m radius` : ' · Default boundary'}</span></span><ChevronRight aria-hidden="true"/></button>
    <p className="nature-update"><Freshness>Watch update: {locationAge(telemetry.created_at, now)}</Freshness></p>
  </div>;
}
