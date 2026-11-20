import { useEffect, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { LocateFixed, MapPin, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { SafeWatchTiles } from '../../../shared/components/SafeWatchMap.jsx';
import { isValidGpsPoint } from '../../../shared/gpsStatus.js';
import { familyZoneBounds } from '../../../shared/familySafeZone.js';
import { MAX_LOCATION_RADIUS, MIN_LOCATION_RADIUS, safeLocationError, saveSafeLocation } from '../../../shared/trustedHubs.js';
import FamilySafeZoneLayer from './FamilySafeZoneLayer.jsx';

const centerIcon = L.divIcon({ className: 'nature-zone-pin', html: '<span aria-hidden="true">+</span>', iconSize: [32, 32], iconAnchor: [16, 16] });

function ChooseCenter({ point, radius, onChange }) {
  useMapEvents({ click: event => onChange(event.latlng) });
  return <>
    {point && <><Circle center={point} radius={radius} pathOptions={{ color: '#d97706', fillColor: '#fbbf24', fillOpacity: .2, dashArray: '7 5' }}/>
      <Marker position={point} icon={centerIcon} draggable title="Drag safe-zone center" eventHandlers={{ dragend: event => onChange(event.target.getLatLng()) }}/></>}
  </>;
}

function ZoneMapControls({ watchPoint, point, radius, onChange, disabled }) {
  const map = useMap();
  const controls = useRef(null);
  useEffect(() => {
    L.DomEvent.disableClickPropagation(controls.current);
    L.DomEvent.disableScrollPropagation(controls.current);
  }, []);
  return <div ref={controls}>
    <button type="button" className="nature-zone-watch" disabled={disabled || !watchPoint} onClick={() => {
      onChange(watchPoint);
      map.setView(watchPoint, 17, { animate: false });
    }}><LocateFixed aria-hidden="true"/>Use watch location</button>
    <button type="button" className="nature-zone-map-fit" disabled={disabled} onClick={() => {
      map.fitBounds(point ? L.latLng(point).toBounds(radius * 2.5) : familyZoneBounds(null), { padding: [20, 20], maxZoom: 17, animate: false });
    }}>Show zone</button>
  </div>;
}

export default function FamilySafeZoneEditor({ client, senior, onSaved, onReload }) {
  const locations = senior.safeLocations ?? [];
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const watchPoint = isValidGpsPoint(senior.position) ? senior.position : null;
  const draft = editor?.draft;
  const point = draft && draft.lat !== '' && draft.lng !== '' && isValidGpsPoint({ lat: Number(draft.lat), lng: Number(draft.lng) })
    ? { lat: Number(draft.lat), lng: Number(draft.lng) } : null;
  const radius = Number(draft?.radius);
  const previewRadius = Number.isFinite(radius) ? Math.min(MAX_LOCATION_RADIUS, Math.max(MIN_LOCATION_RADIUS, radius)) : 250;
  const change = (key, value) => setEditor(current => ({ ...current, draft: { ...current.draft, [key]: value } }));
  const chooseCenter = position => setEditor(current => ({ ...current, draft: { ...current.draft,
    lat: position.lat.toFixed(6), lng: position.lng.toFixed(6) } }));
  const open = (mode, location) => {
    setError(''); setMessage('');
    setEditor({ mode, bounds: familyZoneBounds(location || (watchPoint ? { ...watchPoint, radius: 250 } : null)), draft: location ?? {
      id: globalThis.crypto.randomUUID(), device_id: senior.deviceId,
      name: '', lat: watchPoint?.lat ?? '', lng: watchPoint?.lng ?? '', radius: 250,
    } });
  };
  const save = async event => {
    event.preventDefault();
    if (busyRef.current) return;
    setError('');
    busyRef.current = true; setBusy(true);
    try {
      const saved = await saveSafeLocation(client, draft, editor.mode === 'remove');
      onSaved(draft.id, saved);
      setEditor(null);
      setMessage(saved ? `${saved.name} saved for ${senior.name}.` : `${draft.name} removed.`);
    } catch (failure) {
      if (failure?.code === '40001') await onReload?.();
      setError(safeLocationError(failure));
    }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <section className="nature-zone nature-glass" aria-label="Family safe locations">
    <div className="nature-zone__heading"><span><ShieldCheck aria-hidden="true"/></span><div><h2>Safe locations</h2><p>Add places for {senior.name} alongside the San Isidro East boundary.</p></div></div>
    {!editor ? <>
      {locations.map(location => <div key={location.id} className="nature-zone__saved"><MapPin aria-hidden="true"/><div className="min-w-0 flex-1"><h3 className="break-words">{location.name}</h3><p>{location.radius.toLocaleString()} m radius · {location.device_id ? 'Assigned to this watch' : 'Shared location'}</p>
        {location.device_id && <div className="nature-zone__actions"><button type="button" aria-label={`Edit ${location.name}`} className="nature-zone-secondary" onClick={() => open('edit', location)}><Pencil aria-hidden="true"/>Edit</button><button type="button" aria-label={`Remove ${location.name}`} className="nature-zone-secondary" onClick={() => open('remove', location)}><Trash2 aria-hidden="true"/>Remove</button></div>}
      </div></div>)}
      <button type="button" className="nature-zone-primary" onClick={() => open('edit')} disabled={!senior.deviceId}><Plus aria-hidden="true"/>Add safe location</button>
      {message && <p className="nature-zone-success" role="status">{message}</p>}
    </> : <form onSubmit={save}>
      {editor.mode === 'remove' ? <p className="nature-zone__help">Remove {draft.name} from the safe locations for {senior.name}?</p> : <>
        <p className="nature-zone__help">Choose any town or city by tapping the map or entering coordinates, then set the radius.</p>
        <fieldset disabled={busy} className="nature-zone-fields">
          <label htmlFor="safe-zone-name">Location name<input id="safe-zone-name" name="zoneName" value={draft.name} onChange={event => change('name', event.target.value)} maxLength={80} required placeholder="e.g. Home or a relative’s house"/></label>
          <div className="nature-zone__map" aria-label="Choose safe-zone center">
            <MapContainer bounds={editor.bounds} boundsOptions={{ padding: [20, 20], maxZoom: 16 }} style={{ width: '100%', height: '100%' }}>
              <SafeWatchTiles/>
              <FamilySafeZoneLayer/>
              <ChooseCenter point={point} radius={previewRadius} onChange={chooseCenter}/>
              <ZoneMapControls watchPoint={watchPoint} point={point} radius={previewRadius} onChange={chooseCenter} disabled={busy}/>
            </MapContainer>
            {busy && <div className="nature-zone__map-block"/>}
          </div>
          <p className="nature-zone__hint">{watchPoint ? `Watch location detected ${new Date(senior.positionAt).toLocaleString()}.` : 'No watch GPS yet. Choose a place on the map or enter coordinates.'}</p>
          <div className="nature-zone__coordinates"><label htmlFor="safe-zone-lat">Latitude<input id="safe-zone-lat" type="number" step="any" min="-90" max="90" inputMode="decimal" value={draft.lat} onChange={event => change('lat', event.target.value)} required/></label><label htmlFor="safe-zone-lng">Longitude<input id="safe-zone-lng" type="number" step="any" min="-180" max="180" inputMode="decimal" value={draft.lng} onChange={event => change('lng', event.target.value)} required/></label></div>
          <label htmlFor="safe-zone-radius">Radius (meters)<input id="safe-zone-radius" type="number" min={MIN_LOCATION_RADIUS} max={MAX_LOCATION_RADIUS} step="1" inputMode="numeric" value={draft.radius} onChange={event => change('radius', event.target.value)} required/></label>
          <input type="range" aria-label="Adjust safe location radius" min={MIN_LOCATION_RADIUS} max={MAX_LOCATION_RADIUS} step="1" value={previewRadius} onChange={event => change('radius', event.target.value)}/>
          <p className="nature-zone__hint">10–5,000 m from the center. The shaded circle shows your selection.</p>
        </fieldset>
      </>}
      {error && <p role="alert" className="nature-notice nature-notice--error">{error}</p>}
      <div className="nature-zone__actions"><button type="button" className="nature-zone-secondary" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>Cancel</button><button type="submit" className="nature-zone-primary" disabled={busy}>{busy ? 'Saving…' : editor.mode === 'remove' ? 'Remove safe location' : 'Save safe location'}</button></div>
    </form>}
  </section>;
}
