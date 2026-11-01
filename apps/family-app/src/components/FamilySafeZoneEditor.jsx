import { useEffect, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { LocateFixed, MapPin, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { SafeWatchTiles } from '../../../shared/components/SafeWatchMap.jsx';
import { isValidGpsPoint } from '../../../shared/gpsStatus.js';
import { DEFAULT_SAFE_ZONE_NAME, familyZoneBounds, MAX_SAFE_ZONE_RADIUS, MIN_SAFE_ZONE_RADIUS, safeZoneErrorMessage, saveFamilySafeZone, validateFamilySafeZone } from '../../../shared/familySafeZone.js';

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
  const zone = senior.safeZone;
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
  const previewRadius = Number.isFinite(radius) ? Math.min(MAX_SAFE_ZONE_RADIUS, Math.max(MIN_SAFE_ZONE_RADIUS, radius)) : 250;
  const change = (key, value) => setEditor(current => ({ ...current, draft: { ...current.draft, [key]: value } }));
  const chooseCenter = position => setEditor(current => ({ ...current, draft: { ...current.draft,
    lat: position.lat.toFixed(6), lng: position.lng.toFixed(6) } }));
  const open = mode => {
    setError(''); setMessage('');
    setEditor({ mode, expected: zone, bounds: familyZoneBounds(zone || (watchPoint ? { ...watchPoint, radius: 250 } : null)), draft: {
      name: zone?.name || 'Home', lat: zone?.lat ?? watchPoint?.lat ?? '',
      lng: zone?.lng ?? watchPoint?.lng ?? '', radius: zone?.radius || 250,
    } });
  };
  const save = async event => {
    event.preventDefault();
    if (busyRef.current) return;
    setError('');
    let config;
    try { config = editor.mode === 'reset' ? null : validateFamilySafeZone(draft); }
    catch (validation) { setError(validation.message); return; }
    busyRef.current = true; setBusy(true);
    try {
      const saved = await saveFamilySafeZone(client, senior.deviceId, config, editor.expected);
      onSaved(senior.deviceId, saved);
      setEditor(null);
      setMessage(saved ? `${saved.name} saved. Monitoring uses this zone with the next GPS update.` : 'Default safe zone restored. Monitoring uses it with the next GPS update.');
    } catch (failure) {
      if (failure?.code === '40001') await onReload?.();
      setError(safeZoneErrorMessage(failure));
    }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <section className="nature-zone nature-glass" aria-label="Family safe zone">
    <div className="nature-zone__heading"><span><ShieldCheck aria-hidden="true"/></span><div><h2>Safe zone</h2><p>Choose where {senior.name} can safely go.</p></div></div>
    {!editor ? <>
      <div className="nature-zone__saved"><MapPin aria-hidden="true"/><div><h3>{zone?.name || DEFAULT_SAFE_ZONE_NAME}</h3><p>{zone ? `${zone.radius.toLocaleString()} m radius · Set by family` : 'Default barangay boundary'}</p></div></div>
      <button type="button" className="nature-zone-primary" onClick={() => open('edit')} disabled={!senior.deviceId}>{zone ? <Pencil aria-hidden="true"/> : <Plus aria-hidden="true"/>}{zone ? 'Edit safe zone' : 'Add safe zone'}</button>
      {zone && <button type="button" className="nature-zone-link" onClick={() => open('reset')}>Use default boundary</button>}
      {message && <p className="nature-zone-success" role="status">{message}</p>}
    </> : <form onSubmit={save}>
      {editor.mode === 'reset' ? <p className="nature-zone__help">Use the {DEFAULT_SAFE_ZONE_NAME} boundary instead of {editor.expected?.name}? This changes the safe zone for everyone linked to {senior.name}.</p> : <>
        <p className="nature-zone__help">Tap the map or drag the center marker. This zone replaces the default boundary for {senior.name} and is shared with their linked family members.</p>
        <fieldset disabled={busy} className="nature-zone-fields">
          <label htmlFor="safe-zone-name">Zone name<input id="safe-zone-name" name="zoneName" value={draft.name} onChange={event => change('name', event.target.value)} maxLength={80} required placeholder="e.g. Home or a relative’s house"/></label>
          <div className="nature-zone__map" aria-label="Choose safe-zone center">
            <MapContainer bounds={editor.bounds} boundsOptions={{ padding: [20, 20], maxZoom: 16 }} style={{ width: '100%', height: '100%' }}>
              <SafeWatchTiles/>
              <ChooseCenter point={point} radius={previewRadius} onChange={chooseCenter}/>
              <ZoneMapControls watchPoint={watchPoint} point={point} radius={previewRadius} onChange={chooseCenter} disabled={busy}/>
            </MapContainer>
            {busy && <div className="nature-zone__map-block"/>}
          </div>
          <p className="nature-zone__hint">{watchPoint ? `Watch location detected ${new Date(senior.positionAt).toLocaleString()}.` : 'No watch GPS yet. Choose a place on the map or enter coordinates.'}</p>
          <div className="nature-zone__coordinates"><label htmlFor="safe-zone-lat">Latitude<input id="safe-zone-lat" type="number" step="any" min="-90" max="90" inputMode="decimal" value={draft.lat} onChange={event => change('lat', event.target.value)} required/></label><label htmlFor="safe-zone-lng">Longitude<input id="safe-zone-lng" type="number" step="any" min="-180" max="180" inputMode="decimal" value={draft.lng} onChange={event => change('lng', event.target.value)} required/></label></div>
          <label htmlFor="safe-zone-radius">Radius (meters)<input id="safe-zone-radius" type="number" min={MIN_SAFE_ZONE_RADIUS} max={MAX_SAFE_ZONE_RADIUS} step="1" inputMode="numeric" value={draft.radius} onChange={event => change('radius', event.target.value)} required/></label>
          <input type="range" aria-label="Adjust safe-zone radius" min={MIN_SAFE_ZONE_RADIUS} max={MAX_SAFE_ZONE_RADIUS} step="1" value={previewRadius} onChange={event => change('radius', event.target.value)}/>
          <p className="nature-zone__hint">50–5,000 m from the center. The shaded circle shows your selection.</p>
        </fieldset>
      </>}
      {error && <p role="alert" className="nature-notice nature-notice--error">{error}</p>}
      <div className="nature-zone__actions"><button type="button" className="nature-zone-secondary" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>Cancel</button><button type="submit" className="nature-zone-primary" disabled={busy}>{busy ? 'Saving…' : editor.mode === 'reset' ? 'Use default boundary' : 'Save safe zone'}</button></div>
    </form>}
  </section>;
}
