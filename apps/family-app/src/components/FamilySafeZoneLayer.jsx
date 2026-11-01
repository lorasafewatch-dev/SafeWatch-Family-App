import { Circle, Polygon, Popup } from 'react-leaflet';
import { SAN_ISIDRO_EAST_BOUNDARY } from '../../../shared/safeZone.js';

export default function FamilySafeZoneLayer({ zone, draft = false }) {
  const pathOptions = { color: draft ? '#d97706' : '#009a70', fillColor: draft ? '#fbbf24' : '#34d399', fillOpacity: .16, weight: 3,
    ...(draft ? { dashArray: '7 5' } : {}) };
  return zone ? <Circle center={[zone.lat, zone.lng]} radius={zone.radius} pathOptions={pathOptions}>
    <Popup>{zone.name} · {zone.radius.toLocaleString()} m radius{draft ? ' · Preview' : ''}</Popup>
  </Circle> : <Polygon positions={SAN_ISIDRO_EAST_BOUNDARY} pathOptions={pathOptions}>
    <Popup>San Isidro East · Default safe zone</Popup>
  </Polygon>;
}
