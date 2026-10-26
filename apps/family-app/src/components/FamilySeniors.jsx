import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { cancelFamilyRequest, linkFamilySenior, loadFamilyRequests, registerFamilySenior, seniorManagementError, unlinkFamilySenior } from '../../../shared/familySeniors.js';

const emptyRegistration = { name: '', watchId: '', age: '', gender: 'Not specified' };
const inputClass = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-500 disabled:opacity-60';
const Field = ({ label, id, children }) => <div><label htmlFor={id} className="block text-xs font-bold text-slate-600 mb-2">{label}</label>{children}</div>;

export default function FamilySeniors({ client, seniors, selectedDeviceId, loading, loadError, onReload, onSelect, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState('existing');
  const [requests, setRequests] = useState([]);
  const [requestRevision, setRequestRevision] = useState(0);
  const [requestError, setRequestError] = useState('');
  const [watchId, setWatchId] = useState('');
  const [draft, setDraft] = useState(emptyRegistration);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const load = () => loadFamilyRequests(client).then(rows => { if (active) { setRequests(rows); setRequestError(''); } })
      .catch(error => { if (active) setRequestError(seniorManagementError(error)); });
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [client, requestRevision]);

  const add = async event => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'existing') await linkFamilySenior(client, watchId);
      else await registerFamilySenior(client, draft);
      await onChanged();
      if (!mounted.current) return;
      setExpanded(false); setDraft(emptyRegistration); setWatchId('');
      setRequestRevision(value => value + 1);
      setMessage('Request sent to barangay staff. The senior will appear here after access is approved.');
    } catch (error) { if (mounted.current) setError(seniorManagementError(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const remove = async () => {
    if (!removing || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      await unlinkFamilySenior(client, removing.id);
      await onChanged();
      if (!mounted.current) return;
      setRemoving(null); setMessage('Senior removed from your list.');
    } catch (error) { if (mounted.current) setError(seniorManagementError(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const changeMode = next => { setMode(next); setError(''); };
  const cancelRequest = async request => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await cancelFamilyRequest(client, request.id); if (mounted.current) setRequestRevision(value => value + 1); }
    catch (error) { if (mounted.current) setError(seniorManagementError(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="space-y-4" aria-labelledby="my-seniors-title">
    <div className="flex items-center justify-between gap-3">
      <h3 id="my-seniors-title" className="text-lg font-black text-slate-800 uppercase tracking-widest">My seniors</h3>
      {!expanded && <button disabled={busy || loading || !!loadError} onClick={() => { setExpanded(true); setError(''); setMessage(''); }}
        className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
        <Plus className="w-4 h-4" /> Add senior
      </button>}
    </div>
    <p className="text-sm text-slate-500">You can monitor multiple seniors. Barangay staff verify each new watch-access request before health and location data become available.</p>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading your seniors…</p>}
    {loadError && <div className="rounded-2xl bg-amber-50 p-4 space-y-2">
      <p role="alert" className="text-sm text-amber-900">{loadError}</p>
      <button onClick={onReload} className="text-sm font-bold text-amber-900 underline">Retry loading seniors</button>
    </div>}
    {message && <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><Check className="w-5 h-5 shrink-0" />{message}</p>}
    {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {!loading && !loadError && seniors.length === 0 && <div className="mobile-card text-center space-y-3">
      <Users className="w-9 h-9 mx-auto text-emerald-500" />
      <p className="font-bold text-slate-700">No seniors added yet</p>
      <p className="text-sm text-slate-500">Request access to a registered watch or submit a new senior for barangay approval.</p>
    </div>}
    {seniors.map(senior => <article key={senior.id} className="bg-white rounded-3xl border border-slate-100 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-bold text-slate-800 break-words">{senior.patient_name}</h4>
          <p className="text-sm text-slate-500 mt-1">{senior.age == null ? 'Age not provided' : `Age ${senior.age}`} · {senior.gender}</p>
          <p className="text-[11px] text-slate-400 break-all mt-2">Watch ID: {senior.id}</p>
        </div>
        {selectedDeviceId === senior.id && <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Monitoring</span>}
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <button disabled={busy || selectedDeviceId === senior.id} onClick={() => onSelect(senior.id)}
          className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
          {selectedDeviceId === senior.id ? 'Selected senior' : 'Monitor this senior'}
        </button>
        <button disabled={busy} aria-label={`Remove ${senior.patient_name} from my seniors`} onClick={() => { setRemoving(senior); setError(''); setMessage(''); }}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4" /> Remove</button>
      </div>
      {removing?.id === senior.id && <div className="rounded-2xl bg-red-50 border border-red-100 p-4 space-y-3">
        <p className="text-sm font-bold text-red-800">Remove {senior.patient_name} from your list?</p>
        <p className="text-sm text-red-700">Their watch, health history, and barangay record will stay available. Adding them again requires a new approval.</p>
        <div className="flex gap-3">
          <button disabled={busy} onClick={remove} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Removing…' : 'Remove from my list'}</button>
          <button disabled={busy} onClick={() => setRemoving(null)} className="text-sm font-bold text-slate-600">Cancel removal</button>
        </div>
      </div>}
    </article>)}

    {requestError && <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{requestError}</p>}
    {requests.some(request => request.status !== 'canceled') && <div className="space-y-3">
      <h4 className="font-bold text-slate-700">Access requests</h4>
      {requests.filter(request => request.status !== 'canceled').map(request => <div key={request.id} className="rounded-2xl bg-white border border-slate-100 p-4 space-y-2">
        <p className="font-semibold text-sm text-slate-700">{request.requested_name || 'Registered watch'} <span className="font-normal">· {request.status === 'pending' ? 'Awaiting barangay approval' : request.status}</span></p>
        <p className="text-xs text-slate-500 break-all">Watch ID: {request.device_id}</p>
        {request.status === 'pending' && <button type="button" disabled={busy} onClick={() => cancelRequest(request)} className="text-sm font-semibold text-slate-600 underline disabled:opacity-50">Cancel request</button>}
      </div>)}
    </div>}

    {expanded && <form onSubmit={add} className="mobile-card space-y-5">
      <h4 className="font-bold text-slate-800">Add a senior</h4>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} aria-pressed={mode === 'existing'} onClick={() => changeMode('existing')}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === 'existing' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Link existing senior</button>
        <button type="button" disabled={busy} aria-pressed={mode === 'new'} onClick={() => changeMode('new')}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === 'new' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Register new senior</button>
      </div>
      {mode === 'existing' ? <>
        <Field label="Watch ID" id="existing-watch-id">
          <input id="existing-watch-id" value={watchId} disabled={busy} required onChange={event => setWatchId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputClass} />
        </Field>
        <p className="text-xs text-slate-500">Copy the ID from the physical watch. Barangay staff will verify your relationship before granting access.</p>
      </> : <>
        <Field label="Senior’s full name" id="senior-name">
          <input id="senior-name" value={draft.name} required maxLength={100} disabled={busy} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} className={inputClass} />
        </Field>
        <Field label="New senior’s Watch ID" id="new-watch-id">
          <input id="new-watch-id" value={draft.watchId} required disabled={busy} onChange={event => setDraft(value => ({ ...value, watchId: event.target.value }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={inputClass} />
          <p className="text-xs text-slate-500 mt-2">Copy the complete Watch ID from the physical watch. An existing Watch ID cannot be reassigned here.</p>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Age (optional)" id="senior-age">
            <input id="senior-age" type="number" min={0} max={130} step={1} value={draft.age} disabled={busy} onChange={event => setDraft(value => ({ ...value, age: event.target.value }))} className={inputClass} />
          </Field>
          <Field label="Gender" id="senior-gender">
            <select id="senior-gender" value={draft.gender} disabled={busy} onChange={event => setDraft(value => ({ ...value, gender: event.target.value }))} className={inputClass}>
              {['Not specified','Male','Female','Other'].map(value => <option key={value}>{value}</option>)}
            </select>
          </Field>
        </div>
      </>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? 'Sending…' : 'Request barangay approval'}
        </button>
        <button type="button" disabled={busy} onClick={() => { setExpanded(false); setError(''); }} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600">Cancel adding senior</button>
      </div>
    </form>}
  </section>;
}
