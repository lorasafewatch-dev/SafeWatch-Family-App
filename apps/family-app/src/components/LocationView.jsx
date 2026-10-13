import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Battery, Calendar, Clock, MapPin, Maximize2, Shield } from 'lucide-react';
import { isLiveFamilyLocation, locationAge } from '../../../shared/gpsLocation.js';
import { isValidGpsPoint } from '../../../shared/gpsStatus.js';
import { SAN_ISIDRO_EAST_BOUNDARY, isInsidePolygon } from '../../../shared/safeZone.js';

function MapControls({ position }) {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
    <button disabled={!position} onClick={() => {
      map.stop();
      map.setView(position, 17, { animate: false });
    }} className="bg-white px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 text-emerald-700 font-bold text-xs disabled:opacity-50">
      <Maximize2 className="w-4 h-4" /> Center watch
    </button>
    <button onClick={() => {
      map.stop();
      map.fitBounds(SAN_ISIDRO_EAST_BOUNDARY, { padding: [24, 24], animate: false });
    }} className="bg-white px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 text-blue-700 font-bold text-xs">
      <Shield className="w-4 h-4" /> Show boundary
    </button>
  </div>;
}

export default function LocationView({ senior, telemetry, now }) {
  const known = isValidGpsPoint(senior.position);
  const position = known ? [senior.position.lat, senior.position.lng] : null;
  const live = known && isLiveFamilyLocation(senior, now);
  const inside = known && isInsidePolygon(senior.position.lat, senior.position.lng);
  const status = live ? 'Live GPS location' : known ? 'Last known location' : 'No location recorded';
  const zoneStatus = known ? `${inside ? 'Inside' : 'Outside'} safe zone${live ? '' : ' at last detection'}` : 'Waiting for a GPS fix';
  // Fit once on mount. Packet updates and the clock never control the camera.
  const [initialBounds] = useState(() => [...SAN_ISIDRO_EAST_BOUNDARY, ...(position ? [position] : [])]);
  const icon = useMemo(() => L.divIcon({
    html: `<div style="width:48px;height:48px;border:4px solid ${live ? (inside ? '#10b981' : '#ef4444') : '#d97706'};border-radius:50%;background:white;box-shadow:0 4px 12px #0003;overflow:hidden"><img alt="" src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(senior.name || 'Watch')}" style="width:100%;height:100%" /></div>`,
    className: 'family-location-marker', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -24],
  }), [senior.name, live, inside]);
  const date = new Date(now);

  return <div className="flex flex-col px-6 py-8 gap-6 relative">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div>
        <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-2">Live Location</h2>
        <p className="text-xs text-slate-500">Move the map freely. Tap Center watch to return to the marker.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
        <span className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl"><Calendar className="w-3.5 h-3.5" />{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span className="flex items-center gap-2 bg-emerald-50 px-3 py-2 rounded-xl"><Clock className="w-3.5 h-3.5" />{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    </div>

    <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-50 flex items-center gap-4">
      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(senior.name || 'Watch')}`} className="w-14 h-14 rounded-2xl bg-slate-50" alt="Family member" />
      <div>
        <p className="text-lg font-black text-slate-800">{senior.name}</p>
        <p className={`text-xs font-bold mt-1 ${live ? 'text-emerald-700' : 'text-amber-700'}`}>{status}</p>
      </div>
    </div>

    {!live && <div role="status" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
      {known ? 'GPS updates are unavailable. The marker stays at the last detected position.' : 'No GPS position has been recorded for this watch yet. The safe-zone boundary is shown below.'}
    </div>}

    <section aria-label="Family location map" className="h-[420px] sm:h-[500px] shrink-0 relative rounded-[2rem] overflow-hidden shadow-lg border border-white bg-slate-100 z-0">
      <MapContainer bounds={initialBounds} boundsOptions={{ padding: [24, 24], maxZoom: 15 }} className="absolute inset-0" style={{ width: '100%', height: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <Polygon positions={SAN_ISIDRO_EAST_BOUNDARY} pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.10, weight: 3 }}>
          <Popup>San Isidro East safe-zone boundary</Popup>
        </Polygon>
        {known && <Marker position={position} icon={icon} title={`${senior.name}'s detected position`}>
          <Popup autoPan={false}>
            <p className="font-bold">{senior.name}</p>
            <p className={live ? 'text-emerald-700' : 'text-amber-700'}>{status}</p>
            <p>{zoneStatus}</p>
            <p>GPS detected: {new Date(senior.positionAt).toLocaleString()}</p>
          </Popup>
        </Marker>}
        <MapControls position={position} />
      </MapContainer>
      <div className="absolute bottom-6 left-4 right-4 sm:right-auto z-[1000] pointer-events-none bg-white/95 px-4 py-2 rounded-xl shadow-lg text-xs font-bold text-blue-800 flex items-center gap-2">
        <span className="w-5 border-t-[3px] border-blue-600" />San Isidro East boundary
      </div>
    </section>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-white p-6 rounded-3xl shadow-sm space-y-3">
        <div className="flex items-center gap-2 font-bold text-sm"><MapPin className="w-4 h-4 text-emerald-600" />{status}</div>
        <p className="text-xs font-bold text-slate-700">{known ? `Lat: ${senior.position.lat.toFixed(5)}, Lng: ${senior.position.lng.toFixed(5)}` : 'Waiting for the first valid position'}</p>
        <p className={`text-xs font-bold ${live && !inside ? 'text-red-600' : 'text-slate-600'}`}>{zoneStatus}</p>
        <p className="text-xs text-slate-500">GPS detected: {known ? `${locationAge(senior.positionAt, now)} · ${new Date(senior.positionAt).toLocaleString()}` : 'Not available'}</p>
      </div>
      <div className="bg-white p-6 rounded-3xl shadow-sm space-y-3">
        <div className="flex items-center gap-2 font-bold text-sm"><Battery className="w-4 h-4 text-emerald-600" />Battery status</div>
        <p className="text-2xl font-black text-slate-700">{telemetry.battery_percent == null ? '--' : `${telemetry.battery_percent}%`}</p>
        <p className="text-xs text-slate-500">Watch update: {locationAge(telemetry.created_at, now)}</p>
      </div>
    </div>
  </div>;
}
