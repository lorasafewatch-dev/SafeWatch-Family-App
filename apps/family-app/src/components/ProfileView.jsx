import { useEffect, useRef, useState } from 'react';
import { Calendar, Check, ChevronRight, Clock, Loader2, LogOut, Mail, Pencil, Phone, User } from 'lucide-react';
import { familyProfileFromUser, saveFamilyProfile } from '../../../shared/familyProfile.js';
import AccountAuthenticator from '../../../shared/components/AccountAuthenticator.jsx';

const fields = [
  { key: 'fullName', label: 'Full name', icon: User },
  { key: 'email', label: 'Email address', icon: Mail },
  { key: 'phoneNumber', label: 'Phone number', icon: Phone },
];

export default function ProfileView({ client, handleLogout, children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ fullName: '', email: '', phoneNumber: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const fullNameInput = useRef(null);
  const emailInput = useRef(null);
  const phoneInput = useRef(null);
  const focusField = useRef('fullName');
  const profileUserId = useRef(null);
  const profile = familyProfileFromUser(user);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    setLoading(true);
    setLoadError('');
    client.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data?.user) {
        setLoadError('Your profile could not be loaded. Please retry or sign in again.');
      } else { setUser(data.user); profileUserId.current = data.user.id; }
    }).catch(() => {
      if (active) setLoadError('Your profile could not be loaded. Please check your connection and retry.');
    }).finally(() => { if (active) setLoading(false); });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (active && ['USER_UPDATED', 'SIGNED_IN'].includes(event) && session?.user) {
        if (profileUserId.current && profileUserId.current !== session.user.id) {
          setEditing(false); setError(''); setMessage('');
        }
        profileUserId.current = session.user.id;
        setUser(session.user);
      }
    });
    return () => { active = false; mounted.current = false; subscription.unsubscribe(); };
  }, [client, retry]);

  useEffect(() => {
    if (!editing) return;
    const input = focusField.current === 'email' ? emailInput
      : focusField.current === 'phoneNumber' ? phoneInput : fullNameInput;
    input.current?.focus();
  }, [editing]);

  const edit = (field = 'fullName') => {
    if (loading || loadError || savingRef.current) return;
    focusField.current = field;
    setDraft({ fullName: profile.fullName, email: profile.pendingEmail || profile.email, phoneNumber: profile.phoneNumber });
    setError('');
    setMessage('');
    setEditing(true);
  };

  const save = async event => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await saveFamilyProfile(client, draft, { emailRedirectTo: window.location.origin, expectedUserId: user.id });
      if (!mounted.current) return;
      setUser(result.user);
      setEditing(false);
      setMessage(result.profile.pendingEmail
        ? 'Profile saved. Check your current and new email inboxes to complete the email change.'
        : result.changed ? 'Your profile has been saved.' : 'Your profile is already up to date.');
    } catch (error) {
      if (mounted.current) setError(error?.message || 'Your profile could not be saved. Please try again.');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <section className="px-6 py-8 space-y-8">
    <div className="flex justify-between items-start gap-4">
      <div>
        <h2 className="text-3xl font-black text-slate-800 tracking-tight leading-none mb-2">My Profile</h2>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">View and manage your profile details.</p>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-[10px] font-bold text-slate-500 uppercase">{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100 shadow-sm">
          <Clock className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[10px] font-black text-emerald-600 uppercase">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>

    {loading ? <div className="mobile-card flex items-center gap-3 text-sm text-slate-500" role="status">
      <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> Loading your profile…
    </div> : loadError ? <div className="mobile-card space-y-3">
      <p role="alert" className="text-sm text-red-700">{loadError}</p>
      <button onClick={() => setRetry(value => value + 1)} className="font-bold text-sm text-emerald-700 underline">Retry loading profile</button>
    </div> : <>
      <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-50 flex flex-wrap items-center gap-5">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center shrink-0">
          <User className="w-8 h-8" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xl font-black text-slate-800 leading-tight break-words">{profile.fullName || 'Family member'}</p>
          <p className="text-xs text-slate-500 mt-2 break-all">{profile.email}</p>
          <p className="text-xs text-slate-500 mt-1">{profile.phoneNumber || 'No phone number added'}</p>
        </div>
        {!editing && <button onClick={() => edit()} className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
          <Pencil className="w-4 h-4" /> Edit profile
        </button>}
      </div>

      {message && <p role="status" className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
        <Check className="w-5 h-5 shrink-0" /> {message}
      </p>}
      {profile.pendingEmail && <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 break-words">
        Email change awaiting confirmation: <strong>{profile.pendingEmail}</strong>. Your current email remains active until verification is complete.
      </p>}

      <div className="space-y-5">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest ml-1">Personal Information</h3>
        {editing ? <form onSubmit={save} className="mobile-card space-y-5">
          <div>
            <label htmlFor="profile-full-name" className="block text-xs font-bold text-slate-600 mb-2">Full name</label>
            <input ref={fullNameInput} id="profile-full-name" name="fullName" autoComplete="name" required maxLength={100}
              value={draft.fullName} disabled={saving} onChange={event => setDraft(value => ({ ...value, fullName: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-500 disabled:opacity-60" />
          </div>
          <div>
            <label htmlFor="profile-email" className="block text-xs font-bold text-slate-600 mb-2">Email address</label>
            <input ref={emailInput} id="profile-email" name="email" type="email" autoComplete="email" required maxLength={254}
              value={draft.email} disabled={saving} onChange={event => setDraft(value => ({ ...value, email: event.target.value }))}
              aria-describedby="profile-email-help"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-500 disabled:opacity-60" />
            <p id="profile-email-help" className="mt-2 text-xs text-slate-500">Changing your email may require confirmation from your current and new inboxes.</p>
          </div>
          <div>
            <label htmlFor="profile-phone" className="block text-xs font-bold text-slate-600 mb-2">Phone number</label>
            <input ref={phoneInput} id="profile-phone" name="phoneNumber" type="tel" autoComplete="tel" maxLength={30}
              placeholder="e.g. +63 917 123 4567" value={draft.phoneNumber} disabled={saving}
              onChange={event => setDraft(value => ({ ...value, phoneNumber: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-500 disabled:opacity-60" />
            <p className="mt-2 text-xs text-slate-500">Optional contact number.</p>
          </div>
          {error && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-3 pt-1">
            <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(''); }} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
          </div>
        </form> : <div className="space-y-3">
          {fields.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => edit(key)}
            aria-label={`Edit ${label.toLowerCase()}`} className="w-full text-left bg-white p-5 rounded-3xl shadow-sm border border-slate-50 flex items-center justify-between gap-3 group hover:bg-slate-50 transition-all">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center shrink-0"><Icon className="w-6 h-6" /></div>
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                <p className="text-sm font-bold text-slate-800 break-words">{profile[key] || (key === 'phoneNumber' ? 'Add a phone number' : 'Add your full name')}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-500 shrink-0" />
          </button>)}
        </div>}
      </div>
    </>}

    {user && !loading && !loadError && <div className="mobile-card space-y-4">
      <h3 className="text-lg font-bold text-slate-800">Account security</h3>
      <AccountAuthenticator client={client} user={user} onUpdated={() => setRetry(value => value + 1)} />
    </div>}
    {children}
    <button onClick={handleLogout} disabled={saving} className="w-full py-5 bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 font-black rounded-3xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-60">
      <LogOut className="w-4 h-4" /> Sign out
    </button>
  </section>;
}
