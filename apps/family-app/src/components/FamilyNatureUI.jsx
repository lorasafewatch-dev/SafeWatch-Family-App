import { useId } from 'react';
import { Bell, ChevronDown, Clock, Droplet, Heart, Home, MapPin, ShieldCheck, User } from 'lucide-react';
import { isLiveFamilyLocation, locationAge } from '../../../shared/gpsLocation.js';
import { isValidGpsPoint } from '../../../shared/gpsStatus.js';
import { isInsidePolygon } from '../../../shared/safeZone.js';
import seniorAvatar from '../assets/senior-nature.svg';
import '../nature-glass.css';

export { seniorAvatar };

export function locationPresentation(senior, now, urgent = false) {
  const known = isValidGpsPoint(senior.position);
  const live = known && isLiveFamilyLocation(senior, now);
  const inside = known && isInsidePolygon(senior.position.lat, senior.position.lng);
  return { known, live, inside,
    tone: urgent ? 'alert' : !live ? 'waiting' : inside ? 'safe' : 'alert',
    label: urgent ? 'Safety alert' : !known ? 'Waiting for GPS' : !live ? 'Last known location' : inside ? 'Inside safe zone' : 'Outside safe zone',
    freshness: known ? `${live ? 'Updated' : 'Last GPS'} ${locationAge(senior.positionAt, now)}` : 'No location recorded',
  };
}

export function FamilyBrand({ onAlerts, alertCount = 0 }) {
  return <header className="nature-brand">
    <div className="nature-brand__identity"><span className="nature-brand__mark"><ShieldCheck aria-hidden="true"/></span><div><span className="nature-brand__name">SafeWatch</span><span className="nature-brand__family">Family</span></div></div>
    <button type="button" className="nature-brand__notifications" onClick={onAlerts} aria-label={`View alerts${alertCount ? ` (${alertCount} active)` : ''}`}><Bell aria-hidden="true"/>{alertCount > 0 && <span className="nature-brand__dot"/>}</button>
  </header>;
}

export function SeniorSelector({ senior, seniors = [], selectedId, onSelect, disabled = false, compact = false, children }) {
  const id = useId();
  const options = seniors.length ? seniors : [{ id: senior.deviceId || 'current', patient_name: senior.name }];
  return <section className={`nature-senior nature-glass${compact ? ' nature-senior--compact' : ''}`} aria-label="Selected senior">
    <img className="nature-senior__avatar" src={seniorAvatar} alt=""/>
    <div className="nature-senior__details">
      <label htmlFor={id} className="sr-only">Senior to monitor</label>
      <div className="nature-senior__select-wrap"><select id={id} value={selectedId || options[0]?.id || ''} disabled={disabled || !onSelect} onChange={event => onSelect?.(event.target.value)}>{options.map(device => <option key={device.id} value={device.id}>{device.patient_name}</option>)}</select><ChevronDown aria-hidden="true"/></div>
      {!compact && <p className="nature-senior__meta">{senior.age && senior.age !== '--' ? `${senior.age} years · ` : ''}{senior.gender || 'Family member'}</p>}
      {children}
    </div>
  </section>;
}

export function LocationBadge({ state }) {
  return <span className={`nature-location-badge nature-location-badge--${state.tone}`}><ShieldCheck aria-hidden="true"/>{state.label}</span>;
}

export function Freshness({ children }) {
  return <span className="nature-freshness"><Clock aria-hidden="true"/>{children}</span>;
}

export function ReadingCard({ type, value }) {
  const oxygen = type === 'oxygen';
  const available = Number.isFinite(value) && value > 0;
  const normal = available && (oxygen ? value >= 95 : value >= 60 && value <= 100);
  const gradient = useId();
  const Icon = oxygen ? Droplet : Heart;
  return <section className={`nature-reading nature-glass nature-reading--${type}${!available ? ' nature-reading--empty' : ''}`} aria-label={oxygen ? 'Blood oxygen reading' : 'Pulse rate reading'}>
    <div className="nature-reading__top"><span className="nature-reading__icon"><Icon aria-hidden="true"/></span><div><h3>{oxygen ? 'Blood oxygen' : 'Pulse rate'}</h3><p className="nature-reading__value">{available ? value : '—'}{available && <span>{oxygen ? '%' : 'bpm'}</span>}</p></div></div>
    <svg className="nature-reading__wave" viewBox="0 0 200 35" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".1"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs><path d="M0 23C12 23 14 13 24 15S39 29 52 24 65 9 77 16 90 30 105 20 119 8 133 15 145 26 159 18 177 16 187 17 195 14 200 12V35H0Z" fill={`url(#${gradient})`}/><path d="M0 23C12 23 14 13 24 15S39 29 52 24 65 9 77 16 90 30 105 20 119 8 133 15 145 26 159 18 177 16 187 17 195 14 200 12" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
    <p className={`nature-reading__status${available && !normal ? ' nature-text-alert' : ''}`}>{!available ? 'No data' : normal ? 'Normal' : 'Warning'}</p>
  </section>;
}

export function FamilyNavigation({ view, setView }) {
  const tabs = [['dashboard', 'Home', Home], ['location', 'Location', MapPin], ['health', 'Health', Heart], ['alerts', 'Alerts', Bell], ['profile', 'Profile', User]];
  return <nav className="nature-nav" aria-label="Family app navigation">{tabs.map(([key, label, Icon]) => <button key={key} type="button" onClick={() => setView(key)} className={`nature-nav__item${key === 'health' ? ' nature-nav__item--health' : ''}${view === key || view === 'seniors' && key === 'profile' ? ' is-active' : ''}`} aria-current={view === key || view === 'seniors' && key === 'profile' ? 'page' : undefined}><span className="nature-nav__icon"><Icon aria-hidden="true"/></span><span>{label}</span></button>)}</nav>;
}

export function FamilyPageTitle({ title, children }) {
  return <div className="nature-page-title"><h1>{title}</h1>{children && <p>{children}</p>}</div>;
}
