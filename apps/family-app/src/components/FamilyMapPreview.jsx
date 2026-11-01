import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { SafeWatchTiles } from '../../../shared/components/SafeWatchMap.jsx';
import { familyZoneBounds } from '../../../shared/familySafeZone.js';
import FamilySafeZoneLayer from './FamilySafeZoneLayer.jsx';
import { createFamilyMarker } from '../familyMapMarker.js';
import { locationPresentation } from './FamilyNatureUI.jsx';
import 'leaflet/dist/leaflet.css';

function PreviewBounds({ lat, lng, zone }) {
  const map = useMap();
  useEffect(() => {
    // This preview is not draggable; keep an outside watch visible here.
    // The full Location screen retains its independent, user-controlled camera.
    const point = lat == null || lng == null ? [] : [[lat, lng]];
    map.fitBounds([...familyZoneBounds(zone), ...point], { padding: [25, 25], maxZoom: 17, animate: false });
  }, [map, lat, lng, zone]);
  return null;
}

export default function FamilyMapPreview({ senior, now }) {
  const state = locationPresentation(senior, now);
  const [bounds] = useState(() => [...familyZoneBounds(senior.safeZone), ...(state.known ? [[senior.position.lat, senior.position.lng]] : [])]);
  const { live, inside } = state;
  const icon = useMemo(() => L.divIcon({ html: createFamilyMarker({ live, inside }), className: 'family-location-marker', iconSize: [48, 48], iconAnchor: [24, 24] }), [live, inside]);
  return <div className="nature-map-preview" aria-label={state.live ? 'Current GPS map preview' : state.known ? 'Last known GPS map preview' : 'Safe-zone boundary map preview'}>
    <MapContainer bounds={bounds} boundsOptions={{ padding: [12, 12], maxZoom: 14 }} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false} boxZoom={false} keyboard={false} style={{ width: '100%', height: '100%' }}>
      <SafeWatchTiles/>
      <PreviewBounds lat={state.known ? senior.position.lat : null} lng={state.known ? senior.position.lng : null} zone={senior.safeZone}/>
      <FamilySafeZoneLayer zone={senior.safeZone}/>
      {state.known && <Marker position={[senior.position.lat, senior.position.lng]} icon={icon} interactive={false} keyboard={false}/>}
    </MapContainer>
  </div>;
}
