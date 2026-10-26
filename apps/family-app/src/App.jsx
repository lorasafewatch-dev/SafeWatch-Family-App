import React, { useState, useEffect } from 'react';
import { SENIOR_AVATAR } from '../../shared/avatar.js';
import { telemetryTimestamp } from '../../shared/gpsStatus.js';
import { gpsObservation, retainGpsObservation, loadLastGpsObservation, isLiveFamilyLocation } from '../../shared/gpsLocation.js';
import { ALERT_QUERY_FILTER, acknowledgeIncident, alertClock, confirmationErrorMessage, groupAlertIncidents, incidentSnapshot, planAlertSounds, requestFamilySos } from '../../shared/alertLifecycle.js';
import { enableAlertSounds, playAlertSound, stopAlertSounds } from '../../shared/alertSound.js';
import { isInsidePolygon } from '../../shared/safeZone.js';
import AlertWarning, { formatDuration } from './components/AlertWarning.jsx';
import LocationView from './components/LocationView.jsx';
import ProfileView from './components/ProfileView.jsx';
import FamilySeniors from './components/FamilySeniors.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import { chooseFamilySenior, loadFamilySeniors, seniorManagementError } from '../../shared/familySeniors.js';
import { getFamilyClient } from './supabaseClient.js';
import useAccountSession from '../../shared/components/useAccountSession.js';
import AccountMfaGate from '../../shared/components/AccountMfaGate.jsx';
import AuthEntry from '../../shared/components/AuthEntry.jsx';
import PasswordRecovery from '../../shared/components/PasswordRecovery.jsx';
import RecoveryLinkConfirm from '../../shared/components/RecoveryLinkConfirm.jsx';
import AccountAccessDenied from '../../shared/components/AccountAccessDenied.jsx';
import { 
  Heart, 
  Activity, 
  Battery, 
  MapPin, 
  AlertCircle, 
  ChevronRight, 
  Settings, 
  Bell,
  Home,
  Shield,
  Search,
  Eye,
  EyeOff,
  User,
  Lock,
  Mail,
  Calendar,
  Clock,
  MoreHorizontal,
  Sun,
  ShieldCheck,
  Send,
  Loader2,
  ChevronLeft,
  LogOut
} from 'lucide-react';

const EMPTY_TELEMETRY = { heart_rate: null, spo2: null, battery_percent: null,
  is_sos: false, location: null, created_at: null };
const EMPTY_SENIOR = { name: 'Loading...', age: '--', gender: '--',
  location: 'No GPS location recorded', position: null, positionAt: null,
  latestHasGpsFix: false, isInsideSafeZone: false };

const BottomNavItem = ({ icon: Icon, label, active, onClick }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1 flex-1 transition-all ${active ? 'text-emerald-500' : 'text-slate-400'}`}
  >
    <Icon className={`w-6 h-6 ${active ? 'fill-emerald-50' : ''}`} />
    <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
  </button>
);

const HealthCard = ({ icon: Icon, label, value, unit, status, color }) => (
  <div className="mobile-card flex flex-col items-center text-center flex-1 !p-8">
    <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-4 ${color.bg} shadow-sm`}>
      <Icon className={`w-8 h-8 ${color.text}`} />
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">{label}</p>
    <div className="flex items-baseline gap-1">
      <span className="text-3xl font-black text-slate-800">{value}</span>
      <span className="text-sm font-bold text-slate-400">{unit}</span>
    </div>
    <span className={`text-[10px] font-black px-4 py-1.5 rounded-full uppercase mt-4 ${color.badgeBg} ${color.text} border border-white/50 shadow-sm`}>{status}</span>
  </div>
);

function App({ client } = {}) {
  const supabase = client || getFamilyClient();
  const [view, setView] = useState('dashboard');
  const [startupComplete, setStartupComplete] = useState(false);
  const { isLoggedIn, isLoadingAuth, userId, accountUser, accountPermission, pendingAccess, accessDenied, recoveryAccess, recoveryLink, authLinkError, authNotice, setAuthNotice, authError, retryAuth } = useAccountSession(supabase, 'family');
  const [now, setNow] = useState(Date.now());
  const [familyAlerts, setFamilyAlerts] = useState([]);
  const [popupKey, setPopupKey] = useState(null);
  const [confirmingKey, setConfirmingKey] = useState(null);
  const [alertError, setAlertError] = useState('');
  const [soundsBlocked, setSoundsBlocked] = useState(false);
  const [sendingSos, setSendingSos] = useState(false);
  const [sosError, setSosError] = useState('');
  const [linkedSeniors, setLinkedSeniors] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [seniorListLoading, setSeniorListLoading] = useState(true);
  const [seniorListError, setSeniorListError] = useState('');
  const seniorListRequest = React.useRef(0);
  const seniorListBusy = React.useRef(false);
  const selectedDevice = React.useRef(null);
  const initializedDevice = React.useRef(null);
  const linkedSeniorsRef = React.useRef([]);
  const alertMemory = React.useRef({ incidents: [], ledger: {} });
  const alertsRequest = React.useRef(0);
  const pendingTone = React.useRef(null);
  const confirmationBusy = React.useRef(false);
  const sosBusy = React.useRef(false);
  const confirmedKeys = React.useRef(new Set());
  const activeAlertKeys = React.useRef(new Set());
  const lastGpsByDevice = React.useRef(new Map());
  const telemetryRequest = React.useRef(0);
  const telemetryBusy = React.useRef(false);
  const storageKey = userId ? `safewatch.family.alerts.v1:${userId}` : null;
  const selectionStorageKey = userId ? `safewatch.family.selected-senior.v1:${userId}` : null;
  const linkedIdKey = linkedSeniors.map(device => device.id).sort().join(',');

  const saveAlertMemory = () => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(alertMemory.current)); }
    catch { /* Alerts still work when browser storage is unavailable. */ }
  };

  useEffect(() => {
    alertMemory.current = { incidents: [], ledger: {} };
    lastGpsByDevice.current = new Map();
    telemetryRequest.current += 1;
    telemetryBusy.current = false;
    setSenior(EMPTY_SENIOR);
    setTelemetry(EMPTY_TELEMETRY);
    alertsRequest.current += 1;
    setFamilyAlerts([]);
    setPopupKey(null);
    pendingTone.current = null;
    confirmedKeys.current.clear();
    activeAlertKeys.current.clear();
    stopAlertSounds();
    setAlertError('');
    setSoundsBlocked(false);
    seniorListRequest.current += 1;
    seniorListBusy.current = false;
    setLinkedSeniors([]);
    linkedSeniorsRef.current = [];
    initializedDevice.current = null;
    setSelectedDeviceId(null);
    setSeniorListLoading(true);
    setSeniorListError('');
    selectedDevice.current = null;
    if (selectionStorageKey) {
      try { selectedDevice.current = localStorage.getItem(selectionStorageKey); } catch { /* A selection can still be made without storage. */ }
    }
    if (storageKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (Array.isArray(saved?.incidents) && saved?.ledger && typeof saved.ledger === 'object') {
          alertMemory.current = saved;
        }
      } catch { /* Ignore an invalid cache. */ }
    }
  }, [storageKey]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const unlockSounds = async (playPending = true) => {
    if (await enableAlertSounds()) {
      setSoundsBlocked(false);
      if (playPending && pendingTone.current && !confirmationBusy.current
          && activeAlertKeys.current.has(pendingTone.current.key)) {
        playAlertSound(pendingTone.current.tone);
        pendingTone.current = null;
      }
    }
  };

  useEffect(() => {
    const unlock = event => { unlockSounds(!event.target?.closest?.('[data-confirm-alert]')); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !familyAlerts.length) {
      pendingTone.current = null;
      setSoundsBlocked(false);
      stopAlertSounds();
      return;
    }
    const planned = planAlertSounds(familyAlerts, alertMemory.current.ledger, now);
    if (!planned.events.length) return;
    alertMemory.current.ledger = planned.ledger;
    saveAlertMemory();
    // Play one sound for a refresh, with SOS taking priority over other alerts.
    const event = planned.events.find(item => item.tone === 'sos') || planned.events[0];
    if (!playAlertSound(event.tone)) {
      pendingTone.current = event;
      setSoundsBlocked(true);
    }
    const highestPriority = familyAlerts[0];
    if (event.key === highestPriority.key) setPopupKey(highestPriority.key);
  }, [familyAlerts, isLoggedIn, now]);
  
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [senior, setSenior] = useState(EMPTY_SENIOR);

  const selectSenior = (id, devices = linkedSeniors) => {
    const next = chooseFamilySenior(devices, id);
    if (next !== initializedDevice.current) {
      telemetryRequest.current += 1;
      telemetryBusy.current = false;
      setTelemetry(EMPTY_TELEMETRY);
      const device = devices.find(item => item.id === next);
      setSenior(device ? { ...EMPTY_SENIOR, name: device.patient_name, age: device.age ?? '--',
        gender: device.gender, deviceId: device.id } : { ...EMPTY_SENIOR, name: 'No senior selected' });
    }
    selectedDevice.current = next;
    initializedDevice.current = next;
    setSelectedDeviceId(next);
    if (selectionStorageKey) {
      try {
        if (next) localStorage.setItem(selectionStorageKey, next);
        else localStorage.removeItem(selectionStorageKey);
      } catch { /* Selection still works when browser storage is unavailable. */ }
    }
  };

  const fetchLinkedSeniors = async (preferredId, force = false) => {
    if (!isLoggedIn || !userId || seniorListBusy.current && !force) return;
    seniorListBusy.current = true;
    const request = ++seniorListRequest.current;
    try {
      const devices = await loadFamilySeniors(supabase, userId);
      if (request !== seniorListRequest.current) return;
      setLinkedSeniors(devices);
      linkedSeniorsRef.current = devices;
      setSeniorListError('');
      for (const id of lastGpsByDevice.current.keys()) {
        if (!devices.some(device => device.id === id)) lastGpsByDevice.current.delete(id);
      }
      selectSenior(preferredId || selectedDevice.current, devices);
    } catch (error) {
      if (request === seniorListRequest.current) setSeniorListError(seniorManagementError(error));
    } finally {
      if (request === seniorListRequest.current) { seniorListBusy.current = false; setSeniorListLoading(false); }
    }
  };

  useEffect(() => {
    if (!isLoggedIn || !userId) return;
    fetchLinkedSeniors(undefined, true);
    const timer = setInterval(() => fetchLinkedSeniors(), 5000);
    return () => { clearInterval(timer); seniorListRequest.current += 1; seniorListBusy.current = false; };
  }, [isLoggedIn, userId]);

  const fetchLiveTelemetry = async () => {
    if (!isLoggedIn || !userId || telemetryBusy.current) return;
    const device = linkedSeniorsRef.current.find(item => item.id === selectedDevice.current);
    if (!device) return;
    telemetryBusy.current = true;
    const request = ++telemetryRequest.current;
    try {
      {
        
        const { data: telList, error: telError } = await supabase
          .from('telemetry')
          .select('*')
          .eq('device_id', device.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (telError) throw telError;

        const latest = telList && telList[0] ? telList[0] : null;
        const packetTime = telemetryTimestamp(latest);

        const observation = gpsObservation(latest);
        let retained = retainGpsObservation(lastGpsByDevice.current.get(device.id), observation);
        // Reloads can restore the last fix even after hours of zero/no-fix packets.
        if (!retained && !lastGpsByDevice.current.has(device.id)) {
          retained = await loadLastGpsObservation(supabase, device.id);
        }
        if (request !== telemetryRequest.current) return;
        lastGpsByDevice.current.set(device.id, retained);
        const point = retained?.point || null;
        const latestHasGpsFix = !!observation && observation.observedAt === retained?.observedAt;

        // Clean device_name by stripping [MUTED] tag before parsing
        const cleanedName = (device.device_name || '').replace(/\s*\[MUTED\]/g, '').trim();
        // Parse gender and age from device_name format: "Name (Gender)" or "Name (Gender) (Age)"
        const nameParts = cleanedName.split(' (');
        const gender = device.gender || (nameParts.length > 1 ? nameParts[1].replace(')', '').trim() : 'Not specified');
        const age = device.age ?? (nameParts.length > 2 ? nameParts[2].replace(')', '').trim() : '--');

        setSenior({
          name: device.patient_name,
          age: age,
          gender: gender,
          deviceId: device.id,
          location: point ? `Lat: ${point.lat.toFixed(4)}, Lng: ${point.lng.toFixed(4)}` : 'No GPS location recorded',
          latestHasGpsFix,
          position: point,
          positionAt: retained?.observedAt || null,
          isInsideSafeZone: !!point && isInsidePolygon(point.lat, point.lng),
        });

          setTelemetry(latest ? {
            heart_rate: latest.heart_rate || null,
            spo2: latest.spo2 || null,
            battery_percent: latest.battery_percent,
            is_sos: latest.is_sos,
            location: observation ? `POINT(${observation.point.lng} ${observation.point.lat})` : null,
            created_at: packetTime
          } : EMPTY_TELEMETRY);
      }
    } catch (e) {
      console.error("Error loading family app telemetry:", e);
    } finally {
      if (request === telemetryRequest.current) telemetryBusy.current = false;
    }
  };

  const fetchFamilyAlerts = async () => {
    if (!isLoggedIn || confirmationBusy.current) return;
    const deviceIds = linkedSeniorsRef.current.map(device => device.id);
    if (!deviceIds.length) {
      alertsRequest.current += 1;
      activeAlertKeys.current.clear();
      pendingTone.current = null;
      stopAlertSounds();
      setFamilyAlerts([]);
      setPopupKey(null);
      return;
    }
    const requestId = ++alertsRequest.current;
    try {
      const { data, error } = await supabase.from('alerts')
        .select('*, devices(device_name, patient_name)')
        .in('device_id', deviceIds)
        .or(ALERT_QUERY_FILTER)
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      if (requestId !== alertsRequest.current) return;
      const incidents = groupAlertIncidents(data || [], alertMemory.current.incidents)
        .filter(incident => !confirmedKeys.current.has(incident.key));
      activeAlertKeys.current = new Set(incidents.map(incident => incident.key));
      if (pendingTone.current && !activeAlertKeys.current.has(pendingTone.current.key)) {
        pendingTone.current = null;
        setSoundsBlocked(false);
        stopAlertSounds();
      }
      setPopupKey(key => activeAlertKeys.current.has(key) ? key : null);
      alertMemory.current.incidents = incidentSnapshot(incidents);
      saveAlertMemory();
      setFamilyAlerts(incidents);
    } catch (error) {
      console.error('Error fetching family alerts:', error.message);
    }
  };

  const commitConfirmation = incident => {
    confirmedKeys.current.add(incident.key);
    activeAlertKeys.current.delete(incident.key);
    alertMemory.current.incidents = alertMemory.current.incidents.filter(item => item.key !== incident.key);
    saveAlertMemory();
    setFamilyAlerts(items => items.filter(item => item.key !== incident.key));
    setPopupKey(key => key === incident.key ? null : key);
  };

  const handleAcknowledgeAlert = async (incident) => {
    if (confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingKey(incident.key);
    setAlertError('');
    alertsRequest.current += 1;
    pendingTone.current = null;
    setSoundsBlocked(false);
    stopAlertSounds();
    try {
      await acknowledgeIncident(supabase, incident);
      commitConfirmation(incident);
    } catch (error) {
      console.error('Error confirming alert:', error.message);
      setAlertError(confirmationErrorMessage(error));
    } finally {
      confirmationBusy.current = false;
      setConfirmingKey(null);
      await fetchFamilyAlerts();
    }
  };

  const handleDismissAll = async () => {
    if (!familyAlerts.length || confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingKey('all');
    setAlertError('');
    alertsRequest.current += 1;
    pendingTone.current = null;
    setSoundsBlocked(false);
    stopAlertSounds();
    try {
      for (const incident of familyAlerts) {
        await acknowledgeIncident(supabase, incident);
        commitConfirmation(incident);
      }
      setPopupKey(null);
    } catch (error) {
      console.error('Error confirming alerts:', error.message);
      setAlertError(confirmationErrorMessage(error));
    } finally {
      confirmationBusy.current = false;
      setConfirmingKey(null);
      await fetchFamilyAlerts();
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchLiveTelemetry();
    fetchFamilyAlerts();

    const timer = setInterval(() => {
      fetchLiveTelemetry();
      fetchFamilyAlerts();
    }, 5000);

    // Subscribe to new telemetry and alerts
    const subscription = supabase
      .channel('public:telemetry')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, () => {
        fetchLiveTelemetry();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        fetchFamilyAlerts();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, () => {
        fetchFamilyAlerts();
      })
      .subscribe();

    return () => {
      telemetryRequest.current += 1;
      telemetryBusy.current = false;
      alertsRequest.current += 1;
      clearInterval(timer);
      supabase.removeChannel(subscription);
    };
  }, [isLoggedIn, userId, selectedDeviceId, linkedIdKey]);

  if (!startupComplete) {
    return <SplashScreen ready={!isLoadingAuth} onComplete={setStartupComplete} />;
  }

  if (isLoadingAuth) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#f8fafc]">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Sign out error:", e);
    }
  };

  if (recoveryLink) return <RecoveryLinkConfirm client={supabase} link={recoveryLink} onVerified={retryAuth} />;
  if (pendingAccess || authError) return <AccountMfaGate key={pendingAccess?.user.id || 'error'} client={supabase} access={pendingAccess} error={authError} onVerified={retryAuth} />;
  if (accessDenied) return <AccountAccessDenied client={supabase} access={accessDenied} user={accountUser} app='family' onRetry={retryAuth} />;
  if (recoveryAccess) return <PasswordRecovery key={recoveryAccess.user?.id || 'invalid'} client={supabase} {...recoveryAccess} onNotice={setAuthNotice} onFinished={retryAuth} />;

  if (!isLoggedIn) {
    return (
      <AuthEntry client={supabase} app='family' initialError={authLinkError} notice={authNotice} onRecovered={retryAuth} />
    );
  }

  const handleSendSOS = async () => {
    if (sosBusy.current) return;
    sosBusy.current = true;
    setSendingSos(true);
    setSosError('');
    try {
      if (!senior.deviceId) throw new Error('No watch connected');
      await requestFamilySos(supabase, senior.deviceId);
      await fetchFamilyAlerts();
    } catch (e) {
      console.error("Error sending SOS:", e);
      setSosError('The SOS alert could not be saved. Please try again.');
    } finally { sosBusy.current = false; setSendingSos(false); }
  };

  const renderView = () => {
    if (!selectedDeviceId && view !== 'profile' && view !== 'alerts') {
      return <div className="px-6 py-10 space-y-5">
        <h2 className="text-2xl font-black text-slate-800">{seniorListLoading ? 'Loading your seniors…' : 'Choose a senior to monitor'}</h2>
        <p className="text-sm text-slate-500">Add a senior to your account, then choose whose health and location to view.</p>
        <button onClick={() => setView('profile')} className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white">Manage my seniors</button>
      </div>;
    }
    switch (view) {
      case 'dashboard':
        return <DashboardView now={now} senior={senior} telemetry={telemetry} familyAlerts={familyAlerts} setView={setView} handleSendSOS={handleSendSOS} sendingSos={sendingSos} sosError={sosError} />;
      case 'location':
        return <LocationView key={senior.deviceId || 'waiting'} senior={senior} telemetry={telemetry} now={now} />;
      case 'health':
        return <HealthView senior={senior} telemetry={telemetry} />;
      case 'alerts':
        return <AlertsView senior={senior} familyAlerts={familyAlerts} now={now} confirmingKey={confirmingKey} error={alertError} handleAcknowledge={handleAcknowledgeAlert} handleDismissAll={handleDismissAll} />;
      case 'profile':
        return <ProfileView client={supabase} handleLogout={handleLogout}>
          <FamilySeniors client={supabase} seniors={linkedSeniors} selectedDeviceId={selectedDeviceId}
            loading={seniorListLoading} loadError={seniorListError} onReload={() => fetchLinkedSeniors(undefined, true)}
            onSelect={id => selectSenior(id)} onChanged={id => fetchLinkedSeniors(id, true)} />
        </ProfileView>;
      default:
        return <DashboardView now={now} senior={senior} telemetry={telemetry} familyAlerts={familyAlerts} setView={setView} handleSendSOS={handleSendSOS} sendingSos={sendingSos} sosError={sosError} />;
    }
  };

  const activeAlert = familyAlerts[0] || null;
  const popupAlert = familyAlerts.find(incident => incident.key === popupKey) || null;
  const clock = alertClock(activeAlert, now);

  return (
    <div className="h-screen w-full bg-[#f8fafc] flex flex-col overflow-hidden font-sans text-slate-800 relative">
      {/* Background Mesh Gradient */}
      <div className="absolute inset-0 z-0 opacity-50 pointer-events-none">
        <div className="absolute top-[-5%] right-[-10%] w-[60%] h-[40%] rounded-full bg-emerald-100 blur-[120px]"></div>
        <div className="absolute bottom-[20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-50 blur-[100px]"></div>
      </div>

      {activeAlert && !popupAlert && (
        <div className="relative z-[2001] bg-orange-50 border-b border-orange-200 px-5 py-4">
          <button onClick={() => setPopupKey(activeAlert.key)} className="w-full text-left text-sm font-bold text-orange-900">
            {activeAlert.alert_type === 'SOS' ? 'SOS alert' : 'Outside the safe zone'} · {clock.escalated ? 'Barangay attention required' : `${formatDuration(clock.remainingSeconds)} remaining`}
          </button>
          <p className="text-xs text-orange-800 mt-1">Unconfirmed for {formatDuration(clock.elapsedSeconds)}. {clock.warning ? 'Time is running out.' : 'Tap to review and confirm.'}</p>
          {alertError && <p role="alert" className="text-xs text-red-700 mt-2">{alertError}</p>}
          {soundsBlocked && <button onClick={unlockSounds} className="text-xs font-bold underline mt-2">Enable alert sounds</button>}
        </div>
      )}

      {/* Mobile Frame Container */}
      <div className="flex-1 overflow-y-auto pb-28 relative z-10">
        {view !== 'profile' && seniorListError && <p role="alert" className="mx-6 mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{seniorListError}</p>}
        {view !== 'profile' && linkedSeniors.length > 0 && <div className="mx-6 mt-6 rounded-2xl bg-white p-4 border border-emerald-100 flex flex-wrap items-center gap-3">
          <label htmlFor="active-family-senior" className="text-xs font-bold text-slate-600">Senior to monitor</label>
          <select id="active-family-senior" value={selectedDeviceId || ''} disabled={sendingSos}
            onChange={event => selectSenior(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
            {linkedSeniors.map(device => <option key={device.id} value={device.id}>{device.patient_name}</option>)}
          </select>
          <button onClick={() => setView('profile')} className="text-xs font-bold text-emerald-700 underline">Manage seniors</button>
        </div>}
        {renderView()}
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-24 bg-white/80 backdrop-blur-2xl border-t border-white/50 px-6 flex items-center justify-between z-[2000] pb-2 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
        <BottomNavItem icon={Home} label="Home" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
        <BottomNavItem icon={MapPin} label="Location" active={view === 'location'} onClick={() => setView('location')} />
        <div className="relative -top-6">
          <button onClick={() => setView('health')} className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-500/30 border-4 border-white hover:bg-emerald-600 transition-colors animate-status-glow">
            <Heart className="w-7 h-7 fill-current" />
          </button>
        </div>
        <BottomNavItem icon={Bell} label="Alerts" active={view === 'alerts'} onClick={() => setView('alerts')} />
        <BottomNavItem icon={User} label="Profile" active={view === 'profile'} onClick={() => setView('profile')} />
      </nav>

      <AlertWarning incident={popupAlert} now={now} onConfirm={handleAcknowledgeAlert}
        onMinimize={() => setPopupKey(null)} busy={!!confirmingKey} error={alertError}
        soundsBlocked={soundsBlocked} onEnableSounds={unlockSounds} />
    </div>
  );
}

// --- Views ---

const AlertsView = ({ senior, familyAlerts, now, confirmingKey, error, handleAcknowledge, handleDismissAll }) => {
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
  return (
  <div className="px-6 py-8 space-y-8">
    <div className="flex justify-between items-start">
      <div>
        <h2 className="text-3xl font-black text-slate-800 tracking-tight leading-none mb-2">Alerts</h2>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">Stay informed about your loved one's health and device status.</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{dateStr}</span>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100 shadow-sm">
          <Clock className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[10px] font-black text-emerald-600 uppercase whitespace-nowrap">{timeStr}</span>
        </div>
      </div>
    </div>

    <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-50 flex items-center gap-4">
      <img src={SENIOR_AVATAR} className="w-14 h-14 rounded-2xl bg-slate-50" alt="Senior" />
      <div>
        <p className="text-lg font-black text-slate-800 leading-none">{senior.name}</p>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Family Member</p>
      </div>
    </div>

    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest">Pending Alerts</h3>
        {familyAlerts.length > 0 && (
          <button data-confirm-alert disabled={!!confirmingKey} onClick={handleDismissAll} className="px-4 py-2 bg-slate-800 text-white text-[10px] font-black uppercase rounded-xl hover:bg-slate-900 transition-all">Confirm All</button>
        )}
      </div>
      
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {familyAlerts.length === 0 ? (
        <div className="text-center p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 flex flex-col items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
          <p className="text-slate-400 font-bold text-sm uppercase tracking-wider">No Pending Alerts</p>
        </div>
      ) : (
        familyAlerts.map(alert => (
          <div key={alert.key} className="bg-red-50/30 p-6 rounded-[2.5rem] border border-red-50 flex items-center justify-between group transition-all mb-4">
            <div className="flex items-center gap-6">
              <div className="w-14 h-14 bg-white text-red-500 rounded-2xl flex items-center justify-center shadow-sm">
                {alert.alert_type === 'SOS' ? <AlertCircle className="w-6 h-6 fill-current" /> : <MapPin className="w-6 h-6" />}
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{alert.alert_type} Alert</p>
                <p className="text-base font-black text-slate-800 leading-none mb-2">{alert.alert_type === 'SOS' ? 'SOS Button Pressed' : 'Left Safe Zone'}</p>
                <p className="text-[10px] text-slate-500 font-medium mb-2">Unconfirmed for {formatDuration(alertClock(alert, now).elapsedSeconds)} · {alertClock(alert, now).escalated ? 'Barangay attention required' : `${formatDuration(alertClock(alert, now).remainingSeconds)} remaining`}</p>
                <p className="text-[10px] text-slate-500 mb-2">Latest update: {new Date(alert.details.last_seen_at).toLocaleTimeString()}</p>
                <button data-confirm-alert disabled={!!confirmingKey} onClick={() => handleAcknowledge(alert)} className="text-xs font-bold text-orange-700 underline disabled:opacity-50">Confirm I have checked</button>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">
                  {new Date(alert.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse"></div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-red-500 transition-all" />
            </div>
          </div>
        ))
      )}
    </div>
  </div>
  );
};

const DashboardView = ({ senior, telemetry, familyAlerts, now, setView, handleSendSOS, sendingSos, sosError }) => {
  const hasFreshGps = isLiveFamilyLocation(senior, now);
  const isSafe = hasFreshGps && senior.isInsideSafeZone && !telemetry.is_sos && familyAlerts.length === 0;
  const zoneLabel = telemetry.is_sos ? 'SOS emergency' : hasFreshGps ? (senior.isInsideSafeZone ? 'Inside Safe Zone' : 'Outside Safe Zone') : 'No current GPS fix';
  const statusLabel = telemetry.is_sos || familyAlerts.length ? 'Alert' : hasFreshGps ? (isSafe ? 'Safe' : 'Outside') : 'Waiting';
  const activeAlertsCount = familyAlerts.length;
  const hasVitals = telemetry.heart_rate !== null && telemetry.heart_rate > 0;
  const healthStatusStr = hasVitals && telemetry.heart_rate >= 60 && telemetry.heart_rate <= 100 && telemetry.spo2 >= 95 ? 'Good' : hasVitals ? 'Warning' : 'No Data';
  const healthStatusColor = healthStatusStr === 'Good' ? 'text-emerald-500' : healthStatusStr === 'Warning' ? 'text-orange-500' : 'text-slate-400';
  
  const pulseStatus = !hasVitals ? 'No Data' : telemetry.heart_rate >= 60 && telemetry.heart_rate <= 100 ? 'Normal' : 'Warning';
  const pulseStatusColor = pulseStatus === 'Normal' ? 'text-emerald-500' : pulseStatus === 'Warning' ? 'text-orange-500' : 'text-slate-400';
  
  const hasSpo2 = telemetry.spo2 !== null && telemetry.spo2 > 0;
  const spo2Status = !hasSpo2 ? 'No Data' : telemetry.spo2 >= 95 ? 'Normal' : 'Warning';
  const spo2StatusColor = spo2Status === 'Normal' ? 'text-emerald-500' : spo2Status === 'Warning' ? 'text-orange-500' : 'text-slate-400';

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="px-6 py-8 space-y-8">
      {/* App Header */}
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-emerald-600 tracking-tight leading-none uppercase">SAFEWATCH</h1>
            <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">Family Monitoring for Seniors</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{dateStr}</span>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100 shadow-sm">
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-black text-emerald-600 uppercase whitespace-nowrap">{timeStr}</span>
          </div>
        </div>
      </div>

      {/* Greeting */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-none">
            {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}!
          </h2>
          <Sun className="w-6 h-6 text-yellow-400" />
        </div>
        <p className="text-xs text-slate-400 font-medium mt-1">Here's the latest update on <strong>{senior.name}</strong>.</p>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
          <div className={`w-10 h-10 ${isSafe ? 'bg-blue-50 text-blue-500' : 'bg-red-50 text-red-500'} rounded-2xl flex items-center justify-center mb-3`}>
            <Shield className="w-5 h-5 fill-current" />
          </div>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-tight">{zoneLabel}</p>
          <p className={`text-[10px] font-black uppercase mt-1 ${isSafe ? 'text-emerald-500' : 'text-red-500'}`}>{statusLabel}</p>
          <button onClick={() => setView('location')} className="text-[8px] font-black text-blue-500 uppercase mt-2 flex items-center gap-0.5">View Location <ChevronRight className="w-2.5 h-2.5" /></button>
        </div>

        <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-3">
            <Bell className="w-5 h-5" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-black text-slate-800">{activeAlertsCount}</span>
          </div>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-tight">Active Alerts</p>
          <button onClick={() => setView('alerts')} className="text-[8px] font-black text-red-500 uppercase mt-2 flex items-center gap-0.5">View Alerts <ChevronRight className="w-2.5 h-2.5" /></button>
        </div>

        <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center mb-3">
            <Heart className="w-5 h-5" />
          </div>
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-tight">Health Status</p>
          <p className={`text-[10px] font-black uppercase mt-1 ${healthStatusColor}`}>{healthStatusStr}</p>
          <button onClick={() => setView('health')} className="text-[8px] font-black text-purple-500 uppercase mt-2 flex items-center gap-0.5">View Health <ChevronRight className="w-2.5 h-2.5" /></button>
        </div>
      </div>

      {/* Senior Profile Card */}
      <div className="mobile-card relative overflow-hidden !p-8">
        <div className="flex items-center gap-5 mb-8">
          <div className="relative">
            <img src={SENIOR_AVATAR} className="w-20 h-20 rounded-[2.5rem] bg-slate-50 shadow-xl border-4 border-white" alt="Senior" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 border-4 border-white rounded-full animate-status-glow"></div>
          </div>
          <div className="flex-1">
            <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-none">{senior.name}</h3>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-2">Age: {senior.age} • {senior.gender}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <MapPin className="w-3.5 h-3.5 text-emerald-500" />
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-tight">{!hasFreshGps && senior.position ? 'Last known: ' : ''}{senior.location}</p>
            </div>
          </div>
          <div className={`px-4 py-2 ${isSafe ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'} rounded-2xl flex items-center gap-1.5 shrink-0 border shadow-sm animate-status-glow`}>
            {isSafe ? <Shield className="w-3.5 h-3.5 fill-current" /> : <AlertCircle className="w-3.5 h-3.5 fill-current" />}
            <span className="text-[9px] font-black uppercase tracking-wider">{statusLabel}</span>
          </div>
        </div>

        {/* Vital Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Heart className="w-3 h-3 text-red-500" />
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Pulse Rate</span>
            </div>
            <p className="text-lg font-black text-slate-800 tracking-tight leading-none">{telemetry.heart_rate || '--'} <span className="text-[8px] text-slate-400 uppercase font-bold">{telemetry.heart_rate ? 'bpm' : ''}</span></p>
            <span className={`text-[8px] font-black uppercase ${pulseStatusColor}`}>{pulseStatus}</span>
          </div>

          <div className="space-y-1 border-l border-slate-50 pl-3">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-blue-500" />
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Blood Oxygen</span>
            </div>
            <p className="text-lg font-black text-slate-800 tracking-tight leading-none">{telemetry.spo2 || '--'} <span className="text-[8px] text-slate-400 uppercase font-bold">{telemetry.spo2 ? '%' : ''}</span></p>
            <span className={`text-[8px] font-black uppercase ${spo2StatusColor}`}>{spo2Status}</span>
          </div>

          <div className="space-y-1 border-l border-slate-50 pl-3">
            <div className="flex items-center gap-1.5">
              <Battery className="w-3 h-3 text-orange-400" />
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Battery Status</span>
            </div>
            <p className="text-lg font-black text-slate-800 tracking-tight leading-none">{telemetry.battery_percent ?? '--'} <span className="text-[8px] text-slate-400 uppercase font-bold">{telemetry.battery_percent !== null ? '%' : ''}</span></p>
            <span className={`text-[8px] font-black uppercase ${telemetry.battery_percent === null ? 'text-slate-400' : telemetry.battery_percent >= 20 ? 'text-emerald-500' : 'text-red-500'}`}>{telemetry.battery_percent === null ? 'No Data' : telemetry.battery_percent >= 20 ? 'Good' : 'Low'}</span>
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="space-y-3">
        <button onClick={() => setView('location')} className="w-full bg-white p-5 rounded-3xl shadow-sm border border-slate-50 flex items-center justify-between group hover:bg-slate-50 transition-all">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <span className="text-sm font-black text-slate-800 uppercase tracking-widest">View Live Location</span>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-500 transition-all" />
        </button>

        <div className="bg-red-50 p-6 rounded-[2.5rem] border border-red-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white text-red-500 rounded-2xl flex items-center justify-center shadow-sm">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-black text-red-600 uppercase tracking-widest leading-none">Emergency</p>
              <p className="text-[8px] text-red-400 font-bold mt-1 max-w-[150px]">In case of emergency, you can send an SOS alert that will notify your BHW.</p>
            </div>
          </div>
          <button onClick={handleSendSOS} disabled={sendingSos} className="px-4 py-3 bg-red-500 text-white font-black text-[10px] rounded-xl uppercase tracking-widest shadow-lg shadow-red-500/20 flex items-center gap-2 disabled:opacity-50">
            <Send className="w-3 h-3" /> {sendingSos ? 'Sending…' : 'Send SOS Alert'}
          </button>
        </div>
        {sosError && <p role="alert" className="text-sm text-red-700">{sosError}</p>}

        <div className="bg-emerald-50 p-6 rounded-[2.5rem] border border-emerald-100 flex items-center gap-4">
          <div className="w-12 h-12 bg-white text-emerald-500 rounded-2xl flex items-center justify-center shadow-sm shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-black text-emerald-600 uppercase tracking-widest leading-none">Peace of Mind, Always</p>
            <p className="text-[8px] text-emerald-400 font-bold mt-1">We're here to help you keep your loved one safe and healthy. Our BHW team is ready to assist.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const HealthView = ({ senior, telemetry }) => {
  const hasVitals = telemetry.heart_rate !== null && telemetry.heart_rate > 0;
  const hasSpo2 = telemetry.spo2 !== null && telemetry.spo2 > 0;
  const pulseStatus = !hasVitals ? 'No Data' : telemetry.heart_rate >= 60 && telemetry.heart_rate <= 100 ? 'Normal' : 'Warning';
  const pulseColor = !hasVitals
    ? { bg: 'bg-slate-50', text: 'text-slate-400', badgeBg: 'bg-slate-50/50' }
    : pulseStatus === 'Normal'
      ? { bg: 'bg-emerald-50', text: 'text-emerald-500', badgeBg: 'bg-emerald-50/50' }
      : { bg: 'bg-red-50', text: 'text-red-500', badgeBg: 'bg-red-50/50' };
  
  const spo2Status = !hasSpo2 ? 'No Data' : telemetry.spo2 >= 95 ? 'Normal' : 'Warning';
  const spo2Color = !hasSpo2
    ? { bg: 'bg-slate-50', text: 'text-slate-400', badgeBg: 'bg-slate-50/50' }
    : spo2Status === 'Normal'
      ? { bg: 'bg-purple-50', text: 'text-purple-500', badgeBg: 'bg-purple-50/50' }
      : { bg: 'bg-orange-50', text: 'text-orange-500', badgeBg: 'bg-orange-50/50' };
  
  const healthStatusStr = !hasVitals && !hasSpo2 ? 'No Data' : hasVitals && hasSpo2 && telemetry.heart_rate >= 60 && telemetry.heart_rate <= 100 && telemetry.spo2 >= 95 ? 'Good' : 'Warning';
  
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="px-6 py-8 space-y-8 flex flex-col h-full">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight leading-none mb-2">Health</h2>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">View your family member's health overview.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-100 shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{dateStr}</span>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100 shadow-sm">
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-black text-emerald-600 uppercase whitespace-nowrap">{timeStr}</span>
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-50 flex items-center gap-4">
        <img src={SENIOR_AVATAR} className="w-14 h-14 rounded-2xl bg-slate-50" alt="Senior" />
        <div>
          <p className="text-lg font-black text-slate-800 leading-none">{senior.name}</p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Family Member</p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-50 flex flex-col gap-8">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest text-center">Health Overview</h3>
        
        <div className="flex gap-6">
          <HealthCard 
            icon={Heart} 
            label="Pulse Rate" 
            value={telemetry.heart_rate} 
            unit="bpm" 
            status={pulseStatus} 
            color={pulseColor} 
          />
          <HealthCard 
            icon={Activity} 
            label="Blood Oxygen" 
            value={telemetry.spo2} 
            unit="%" 
            status={spo2Status} 
            color={spo2Color} 
          />
        </div>
      </div>

      <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-50 space-y-6 flex-1">
        <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest">Health Insights</h3>
        <div className="flex items-start gap-6">
          <div className="w-16 h-16 bg-emerald-500 rounded-[2rem] flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700 leading-relaxed mb-4">
              {healthStatusStr === 'Good' 
                ? `Great job! ${senior.name}'s health indicators are within the normal range. Keep it up!` 
                : `Attention needed! ${senior.name}'s health indicators are outside the normal range. Please check their vitals.`}
            </p>
            <div className="h-px bg-slate-50 w-full mb-4"></div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">System Status: <span className={healthStatusStr === 'Good' ? 'text-emerald-500' : 'text-orange-500'}>{healthStatusStr === 'Good' ? 'All Good' : 'Warning'}</span></p>
          </div>
        </div>
      </div>
    </div>
  );
};



export default App;
