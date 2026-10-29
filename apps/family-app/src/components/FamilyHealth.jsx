import { Activity, Clock, ShieldCheck } from 'lucide-react';
import { locationAge } from '../../../shared/gpsLocation.js';
import { FamilyPageTitle, ReadingCard } from './FamilyNatureUI.jsx';

export default function FamilyHealth({ senior, telemetry, now }) {
  const heart = Number.isFinite(telemetry.heart_rate) && telemetry.heart_rate > 0;
  const oxygen = Number.isFinite(telemetry.spo2) && telemetry.spo2 > 0;
  const normal = heart && oxygen && telemetry.heart_rate >= 60 && telemetry.heart_rate <= 100 && telemetry.spo2 >= 95;
  return <div className="nature-secondary nature-health">
    <FamilyPageTitle title="Health">The latest readings for {senior.name}.</FamilyPageTitle>
    <div className="nature-readings"><ReadingCard type="heart" value={telemetry.heart_rate}/><ReadingCard type="oxygen" value={telemetry.spo2}/></div>
    <section className="nature-glass nature-health__summary"><span className="nature-health__icon"><ShieldCheck aria-hidden="true"/></span><div><h2>{!heart && !oxygen ? 'Waiting for readings' : normal ? 'Readings within range' : !heart || !oxygen ? 'Some readings unavailable' : 'Check the latest readings'}</h2><p>{!heart && !oxygen ? 'No health readings have been received from this watch yet.' : normal ? 'The latest pulse rate and blood oxygen readings are within the configured monitoring range.' : !heart || !oxygen ? 'Keep the watch connected to receive both pulse rate and blood oxygen readings.' : 'One or more readings are outside the configured monitoring range. Please check on your family member.'}</p></div></section>
    <section className="nature-glass nature-health__updated"><Clock aria-hidden="true"/><div><h2>Last watch update</h2><p>{telemetry.created_at ? `${locationAge(telemetry.created_at, now)} · ${new Date(telemetry.created_at).toLocaleString()}` : 'No update received'}</p></div></section>
    <p className="nature-health__note"><Activity aria-hidden="true"/>Watch readings support monitoring and do not provide a medical diagnosis.</p>
  </div>;
}
