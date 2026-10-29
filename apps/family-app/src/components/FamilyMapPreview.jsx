import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import { SafeWatchTiles } from '../../../shared/components/SafeWatchMap.jsx';
import { SAN_ISIDRO_EAST_BOUNDARY } from '../../../shared/safeZone.js';
import { createSeniorMarker } from '../../../shared/mapMarker.js';
import { locationPresentation, seniorAvatar } from './FamilyNatureUI.jsx';
import 'leaflet/dist/leaflet.css';

export function createFamilyMarker({ live, inside }) {
  const element = createSeniorMarker({ live, inside });
  element.querySelector('img').src = seniorAvatar;
  const dot = document.createElement('span');
  dot.style.cssText = `position:absolute;bottom:-5px;left:27px;width:17px;height:17px;border:3px solid white;border-radius:50%;background:${!live ? '#d97706' : inside ? '#00b785' : '#ef4444'};box-shadow:0 2px 5px #0002`;
  element.append(dot);
  return element;
}

function PreviewBounds({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    // This preview is not draggable; keep an outside watch visible here.
    // The full Location screen retains its independent, user-controlled camera.
    const point = lat == null || lng == null ? [] : [[lat, lng]];
    map.fitBounds([...SAN_ISIDRO_EAST_BOUNDARY, ...point], { padding: [25, 25], maxZoom: 14, animate: false });
  }, [map, lat, lng]);
  return null;
}

export default function FamilyMapPreview({ senior, now }) {
  const state = locationPresentation(senior, now);
  const [bounds] = useState(() => [...SAN_ISIDRO_EAST_BOUNDARY, ...(state.known ? [[senior.position.lat, senior.position.lng]] : [])]);
  const icon = useMemo(() => L.divIcon({ html: createFamilyMarker(state), className: 'family-location-marker', iconSize: [48, 48], iconAnchor: [24, 24] }), [state.live, state.inside]);
  return <div className="nature-map-preview" aria-label={state.live ? 'Current GPS map preview' : state.known ? 'Last known GPS map preview' : 'Safe-zone boundary map preview'}>
    <MapContainer bounds={bounds} boundsOptions={{ padding: [12, 12], maxZoom: 14 }} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false} boxZoom={false} keyboard={false} style={{ width: '100%', height: '100%' }}>
      <SafeWatchTiles/>
      <PreviewBounds lat={state.known ? senior.position.lat : null} lng={state.known ? senior.position.lng : null}/>
      <Polygon positions={SAN_ISIDRO_EAST_BOUNDARY} pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: .18, weight: 2 }}/>
      {state.known && <Marker position={[senior.position.lat, senior.position.lng]} icon={icon} interactive={false} keyboard={false}/>}
    </MapContainer>
  </div>;
}
