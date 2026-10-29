import React, { useState, useEffect } from 'react';
import { telemetryTimestamp } from '../../shared/gpsStatus.js';
import { gpsObservation, retainGpsObservation, loadLastGpsObservation } from '../../shared/gpsLocation.js';
import { ALERT_QUERY_FILTER, acknowledgeIncident, alertClock, confirmationErrorMessage, groupAlertIncidents, incidentSnapshot, planAlertSounds, requestFamilySos } from '../../shared/alertLifecycle.js';
import { enableAlertSounds, playAlertSound, stopAlertSounds } from '../../shared/alertSound.js';
import { isInsidePolygon } from '../../shared/safeZone.js';
import AlertWarning, { formatDuration } from './components/AlertWarning.jsx';
import LocationView from './components/LocationView.jsx';
import ProfileView from './components/ProfileView.jsx';
import DashboardView from './components/FamilyHome.jsx';
import HealthView from './components/FamilyHealth.jsx';
import AlertsView from './components/FamilyAlerts.jsx';
import { FamilyBrand, FamilyNavigation, SeniorSelector } from './components/FamilyNatureUI.jsx';
import FamilySeniors from './components/FamilySeniors.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import { chooseFamilySenior, loadFamilySeniors, seniorManagementError } from '../../shared/familySeniors.js';
import { getFamilyClient } from './supabaseClient.js';
import useAccountSession from '../../shared/components/useAccountSession.js';
import AccountMfaGate from '../../shared/components/AccountMfaGate.jsx';
import AuthEntry from '../../shared/components/AuthEntry.jsx';
import PrivacyTermsGate from '../../shared/components/PrivacyTermsGate.jsx';
import PasswordRecovery from '../../shared/components/PasswordRecovery.jsx';
import RecoveryLinkConfirm from '../../shared/components/RecoveryLinkConfirm.jsx';
import AccountAccessDenied from '../../shared/components/AccountAccessDenied.jsx';
import { Loader2 } from 'lucide-react';

const EMPTY_TELEMETRY = { heart_rate: null, spo2: null, battery_percent: null,
  is_sos: false, location: null, created_at: null };
const EMPTY_SENIOR = { name: 'Loading...', age: '--', gender: '--',
  location: 'No GPS location recorded', position: null, positionAt: null,
  latestHasGpsFix: false, isInsideSafeZone: false };

function App({ client } = {}) {
  const supabase = client || getFamilyClient();
  const [view, setView] = useState('dashboard');
  const contentRef = React.useRef(null);
  const [startupComplete, setStartupComplete] = useState(false);
  const { isLoggedIn, isLoadingAuth, userId, accountUser, accountPermission, pendingAccess, accessDenied, recoveryAccess, recoveryLink, authLinkError, authNotice, setAuthNotice, authError, retryAuth, privacyRequired, privacyError } = useAccountSession(supabase, 'family');
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
  useEffect(() => { contentRef.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [view, selectedDeviceId]);
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
  if (privacyRequired) return <PrivacyTermsGate key={userId} client={supabase} user={accountUser} app="family" error={privacyError} onAccepted={retryAuth} onRetry={retryAuth} />;
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
        return <DashboardView now={now} senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} telemetry={telemetry} familyAlerts={familyAlerts} setView={setView} handleSendSOS={handleSendSOS} sendingSos={sendingSos} sosError={sosError} />;
      case 'location':
        return <LocationView key={senior.deviceId || 'waiting'} senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} disabled={sendingSos} telemetry={telemetry} now={now} />;
      case 'health':
        return <HealthView senior={senior} telemetry={telemetry} now={now} />;
      case 'alerts':
        return <AlertsView senior={senior} familyAlerts={familyAlerts} now={now} confirmingKey={confirmingKey} error={alertError} handleAcknowledge={handleAcknowledgeAlert} handleDismissAll={handleDismissAll} />;
      case 'profile':
        return <div className="nature-account"><ProfileView client={supabase} handleLogout={handleLogout}>
          <FamilySeniors client={supabase} seniors={linkedSeniors} selectedDeviceId={selectedDeviceId}
            loading={seniorListLoading} loadError={seniorListError} onReload={() => fetchLinkedSeniors(undefined, true)}
            onSelect={id => selectSenior(id)} onChanged={id => fetchLinkedSeniors(id, true)} />
        </ProfileView></div>;
      default:
        return <DashboardView now={now} senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} telemetry={telemetry} familyAlerts={familyAlerts} setView={setView} handleSendSOS={handleSendSOS} sendingSos={sendingSos} sosError={sosError} />;
    }
  };

  const activeAlert = familyAlerts[0] || null;
  const popupAlert = familyAlerts.find(incident => incident.key === popupKey) || null;
  const clock = alertClock(activeAlert, now);

  return (
    <div className="family-nature">
      <div className="nature-background" aria-hidden="true"/>
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
      <main className="nature-content" ref={contentRef}>
        <FamilyBrand onAlerts={() => setView('alerts')} alertCount={familyAlerts.length}/>
        {view !== 'profile' && seniorListError && <p role="alert" className="nature-notice">{seniorListError}</p>}
        {!['dashboard', 'location', 'profile'].includes(view) && linkedSeniors.length > 0 && <div className="nature-shared-selection"><SeniorSelector senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} disabled={sendingSos} compact/></div>}
        {renderView()}
      </main>
      <FamilyNavigation view={view} setView={setView}/>
      <AlertWarning incident={popupAlert} now={now} onConfirm={handleAcknowledgeAlert}
        onMinimize={() => setPopupKey(null)} busy={!!confirmingKey} error={alertError}
        soundsBlocked={soundsBlocked} onEnableSounds={unlockSounds}/>
    </div>
  );
}

export default App;
