import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import { SafeWatchTiles } from '../../../shared/components/SafeWatchMap.jsx';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Battery, LocateFixed, Shield } from 'lucide-react';
import { locationAge } from '../../../shared/gpsLocation.js';
import { SAN_ISIDRO_EAST_BOUNDARY } from '../../../shared/safeZone.js';
import { FamilyPageTitle, Freshness, SeniorSelector, locationPresentation } from './FamilyNatureUI.jsx';
import { createFamilyMarker } from './FamilyMapPreview.jsx';

function MapControls({ position }) {
  const map = useMap();
  const controls = useRef(null);
  useEffect(() => {
    L.DomEvent.disableClickPropagation(controls.current);
    L.DomEvent.disableScrollPropagation(controls.current);
  }, []);
  return <div className="nature-map-controls" ref={controls}>
    <button type="button" disabled={!position} onClick={() => {
      map.stop();
      map.setView(position, 17, { animate: false });
    }}><LocateFixed aria-hidden="true"/>Center watch</button>
    <button type="button" onClick={() => {
      map.stop();
      map.fitBounds(SAN_ISIDRO_EAST_BOUNDARY, { padding: [24, 24], animate: false });
    }}><Shield aria-hidden="true"/>Show boundary</button>
  </div>;
}

export default function LocationView({ senior, seniors, selectedId, onSelect, disabled, telemetry, now }) {
  const state = locationPresentation(senior, now);
  const position = state.known ? [senior.position.lat, senior.position.lng] : null;
  // Only explicit map controls move the camera after this initial fit.
  const [initialBounds] = useState(() => [...SAN_ISIDRO_EAST_BOUNDARY, ...(position ? [position] : [])]);
  const icon = useMemo(() => L.divIcon({
    html: createFamilyMarker(state),
    className: 'family-location-marker', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -24],
  }), [state.live, state.inside]);
  const status = state.live ? 'Live GPS location' : state.known ? 'Last known location' : 'No location recorded';
  const zoneStatus = state.known ? `${state.inside ? 'Inside' : 'Outside'} safe zone${state.live ? '' : ' at last detection'}` : 'Waiting for a GPS fix';

  return <div className="nature-location">
    <FamilyPageTitle title="Location">{state.live ? `See where ${senior.name} is now.` : state.known ? `Last recorded position for ${senior.name}.` : `Waiting for ${senior.name}'s first GPS fix.`}</FamilyPageTitle>
    <div className="nature-location__toolbar">
      <SeniorSelector senior={senior} seniors={seniors} selectedId={selectedId} onSelect={onSelect} disabled={disabled} compact/>
      <Freshness>{state.freshness}</Freshness>
    </div>
    {!state.live && <p role="status" className="nature-notice">{state.known ? 'GPS updates are unavailable. The marker stays at the last detected position.' : 'No GPS position has been recorded for this watch yet. The safe-zone boundary is shown below.'}</p>}
    <section aria-label="Family location map" className="nature-location__map">
      <MapContainer bounds={initialBounds} boundsOptions={{ padding: [24, 24], maxZoom: 15 }} style={{ width: '100%', height: '100%' }}>
        <SafeWatchTiles/>
        <Polygon positions={SAN_ISIDRO_EAST_BOUNDARY} pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: .18, weight: 3 }}><Popup>San Isidro East safe-zone boundary</Popup></Polygon>
        {state.known && <Marker position={position} icon={icon} title={`${senior.name}'s detected position`}>
          <Popup autoPan={false}><p className="font-bold">{senior.name}</p><p>{status}</p><p>{zoneStatus}</p><p>GPS detected: {new Date(senior.positionAt).toLocaleString()}</p></Popup>
        </Marker>}
        <MapControls position={position}/>
      </MapContainer>
    </section>
    <section className="nature-map-status nature-glass" aria-label="Location and watch status">
      <div className="nature-map-status__location"><span className="nature-map-status__shield"><Shield aria-hidden="true"/></span><div><p className={`nature-map-status__label${!state.live ? ' nature-text-waiting' : !state.inside ? ' nature-text-alert' : ''}`}>{zoneStatus}</p><p className="nature-map-status__place">{state.known && !state.inside ? 'Outside San Isidro East' : 'San Isidro East'}</p><Freshness>{state.freshness}</Freshness></div></div>
      <div className="nature-map-status__battery"><Battery aria-hidden="true"/><div><span>Watch battery</span><strong>{telemetry.battery_percent == null ? '—' : `${telemetry.battery_percent}%`}</strong></div></div>
    </section>
    <details className="nature-location__details nature-glass"><summary>GPS and watch details</summary><p>{status}</p><p>{state.known ? `Lat: ${senior.position.lat.toFixed(5)}, Lng: ${senior.position.lng.toFixed(5)}` : 'Waiting for the first valid position'}</p><p>GPS detected: {state.known ? new Date(senior.positionAt).toLocaleString() : 'Not available'}</p><p>Watch update: {locationAge(telemetry.created_at, now)}</p></details>
  </div>;
}
