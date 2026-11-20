import React, { useState, useEffect } from 'react';
import { telemetryTimestamp } from '../../shared/gpsStatus.js';
import { gpsObservation, retainGpsObservation, loadLastGpsObservation } from '../../shared/gpsLocation.js';
import { ALERT_QUERY_FILTER, acknowledgeIncident, alertClock, alertTitle, batteryAlertMessage, confirmationErrorMessage, formatDuration, groupAlertIncidents, incidentSnapshot, planAlertSounds } from '../../shared/alertLifecycle.js';
import { enableAlertSounds, playAlertSound, stopAlertSounds } from '../../shared/alertSound.js';
import { isFamilyActionable, loadSosResponses, mergeSosResponse, respondToSos, sosResponseError, sosResponseState } from '../../shared/sosResponse.js';
import AlertWarning from './components/AlertWarning.jsx';
import LocationView from './components/LocationView.jsx';
import ProfileView from './components/ProfileView.jsx';
import DashboardView from './components/FamilyHome.jsx';
import HealthView from './components/FamilyHealth.jsx';
import AlertsView from './components/FamilyAlerts.jsx';
import ActivityHistory from '../../shared/components/ActivityHistory.jsx';
import { FamilyBrand, FamilyNavigation, SeniorSelector } from './components/FamilyNatureUI.jsx';
import FamilySeniors from './components/FamilySeniors.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import { chooseFamilySenior, loadFamilySeniors, retainLinkedWatchAlerts, seniorManagementError } from '../../shared/familySeniors.js';
import { withRequestTimeout } from '../../shared/requestTimeout.js';
import { getFamilyClient } from './supabaseClient.js';
import useAccountSession from '../../shared/components/useAccountSession.js';
import useTrustedHubs from '../../shared/components/useTrustedHubs.js';
import { safeLocationsForWatch } from '../../shared/trustedHubs.js';
import AccountMfaGate from '../../shared/components/AccountMfaGate.jsx';
import AuthEntry from './components/FamilyAuthEntry.jsx';
import PrivacyTermsGate from '../../shared/components/PrivacyTermsGate.jsx';
import PasswordRecovery from '../../shared/components/PasswordRecovery.jsx';
import RecoveryLinkConfirm from '../../shared/components/RecoveryLinkConfirm.jsx';
import AccountAccessDenied from '../../shared/components/AccountAccessDenied.jsx';
import LogoutConfirmation from '../../shared/components/LogoutConfirmation.jsx';
import { Loader2 } from 'lucide-react';
import { SeniorPhotoContext } from '../../shared/seniorPhotoContext.js';
import useFamilyRequestNotifications from '../../shared/components/useFamilyRequestNotifications.js';
import IncidentDetails from '../../shared/components/IncidentDetails.jsx';
import useFamilyPush from './components/useFamilyPush.js';
import SosNotificationSettings, { SosNotificationSetup } from './components/SosNotificationSettings.jsx';
import { sosIdFromUrl } from './familyPush.js';

const EMPTY_TELEMETRY = { heart_rate: null, spo2: null, battery_percent: null,
  is_sos: false, location: null, created_at: null };
const EMPTY_SENIOR = { name: 'Loading...', age: '--', gender: '--',
  location: 'No GPS location recorded', position: null, positionAt: null,
  latestHasGpsFix: false, isInsideSafeZone: false };

function App({ client } = {}) {
  const supabase = client || getFamilyClient();
  const [view, setView] = useState(() => new URL(window.location.href).searchParams.get('notification_test') === '1' ? 'profile' : 'dashboard');
  const [logoutRequested, setLogoutRequested] = useState(false);
  const contentRef = React.useRef(null);
  const [startupComplete, setStartupComplete] = useState(false);
  const { isLoggedIn, isLoadingAuth, reconnectingAuth, userId, accountUser, pendingAccess, accessDenied, recoveryAccess, recoveryLink, authLinkError, authNotice, setAuthNotice, authError, retryAuth, privacyRequired, privacyError } = useAccountSession(supabase, 'family');
  const push = useFamilyPush(supabase, isLoadingAuth ? undefined : isLoggedIn ? userId : null);
  const { hubs: safeLocations, error: safeLocationsError, applySavedHub, refresh: refreshSafeLocations } = useTrustedHubs(supabase, isLoggedIn ? userId : null);
  const [pushTargetId, setPushTargetId] = useState(() => sosIdFromUrl(window.location.href));
  const [pushIncident, setPushIncident] = useState(null);
  const [pushTargetError, setPushTargetError] = useState('');
  const [foregroundSosId, setForegroundSosId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [familyAlerts, setFamilyAlerts] = useState([]);
  const [sosResponses, setSosResponses] = useState([]);
  const [sosResponsesError, setSosResponsesError] = useState('');
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState('');
  const [popupKey, setPopupKey] = useState(null);
  const [sosNotice, setSosNotice] = useState(null);
  const [notificationDetails, setNotificationDetails] = useState(null);
  const accessNotifications = useFamilyRequestNotifications(supabase, isLoggedIn ? userId : null, 'family');
  const [confirmingKey, setConfirmingKey] = useState(null);
  const [alertError, setAlertError] = useState('');
  const [soundsBlocked, setSoundsBlocked] = useState(false);
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
  const alertsBusy = React.useRef(false);
  const pendingAlertRefresh = React.useRef(false);
  const sosResponsesRequest = React.useRef(0);
  const sosResponsesBusy = React.useRef(false);
  const pendingTone = React.useRef(null);
  const confirmationBusy = React.useRef(false);
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
    setLogoutRequested(false);
    setNotificationDetails(null);
    setSosNotice(null);
    setForegroundSosId(null);
    alertMemory.current = { incidents: [], ledger: {} };
    lastGpsByDevice.current = new Map();
    telemetryRequest.current += 1;
    telemetryBusy.current = false;
    setSenior(EMPTY_SENIOR);
    setTelemetry(EMPTY_TELEMETRY);
    alertsRequest.current += 1;
    alertsBusy.current = false;
    pendingAlertRefresh.current = false;
    sosResponsesRequest.current += 1;
    sosResponsesBusy.current = false;
    setFamilyAlerts([]);
    setSosResponses([]);
    setSosResponsesError('');
    setNotificationsLoading(true);
    setNotificationsError('');
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
  const [seniorRecord, setSenior] = useState(EMPTY_SENIOR);
  const senior = { ...seniorRecord, safeLocations: safeLocationsForWatch(safeLocations, seniorRecord.deviceId) };

  const selectSenior = (id, devices = linkedSeniors) => {
    const next = chooseFamilySenior(devices, id);
    if (next !== initializedDevice.current || !next) {
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
      const devices = await withRequestTimeout(loadFamilySeniors(supabase, userId), 10000,
        'Loading your watches took too long. Please check your connection and retry.');
      if (request !== seniorListRequest.current) return;
      const allowedIds = new Set(devices.map(device => device.id));
      if (linkedSeniorsRef.current.length !== devices.length || linkedSeniorsRef.current.some(device => !allowedIds.has(device.id))) {
        alertsRequest.current += 1;
        alertsBusy.current = false;
      }
      setLinkedSeniors(devices);
      linkedSeniorsRef.current = devices;
      setSeniorListError('');
      alertMemory.current = retainLinkedWatchAlerts(alertMemory.current, devices);
      saveAlertMemory();
      const allowedKeys = new Set(alertMemory.current.incidents.map(incident => incident.key));
      activeAlertKeys.current = new Set([...activeAlertKeys.current].filter(key => allowedKeys.has(key)));
      setFamilyAlerts(current => current.some(incident => !allowedIds.has(incident.device_id))
        ? current.filter(incident => allowedIds.has(incident.device_id)) : current);
      setSosResponses(current => current.some(incident => !allowedIds.has(incident.device_id))
        ? current.filter(incident => allowedIds.has(incident.device_id)) : current);
      setPopupKey(key => allowedKeys.has(key) ? key : null);
      if (pendingTone.current && !allowedKeys.has(pendingTone.current.key)) {
        pendingTone.current = null;
        setSoundsBlocked(false);
        stopAlertSounds();
      }
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

  const removeLinkedSenior = id => {
    seniorListRequest.current += 1;
    seniorListBusy.current = false;
    const remaining = linkedSeniorsRef.current.filter(device => device.id !== id);
    linkedSeniorsRef.current = remaining;
    setLinkedSeniors(remaining);
    lastGpsByDevice.current.delete(id);
    selectSenior(selectedDevice.current, remaining);
    alertsRequest.current += 1;
    alertsBusy.current = false;
    const removed = alertMemory.current.incidents.filter(incident => incident.device_id === id);
    for (const incident of removed) {
      activeAlertKeys.current.delete(incident.key);
      delete alertMemory.current.ledger[incident.key];
    }
    alertMemory.current.incidents = alertMemory.current.incidents.filter(incident => incident.device_id !== id);
    saveAlertMemory();
    setFamilyAlerts(current => current.filter(incident => incident.device_id !== id));
    setSosResponses(current => current.filter(incident => incident.device_id !== id));
    setPopupKey(key => activeAlertKeys.current.has(key) ? key : null);
    pendingTone.current = null;
    stopAlertSounds();
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

  const fetchSosResponseUpdates = async () => {
    if (!isLoggedIn || confirmationBusy.current || sosResponsesBusy.current) return;
    const allowed = new Set(linkedSeniorsRef.current.map(device => device.id));
    if (!allowed.size) { setSosResponses([]); return; }
    const request = ++sosResponsesRequest.current;
    sosResponsesBusy.current = true;
    try {
      const rows = await withRequestTimeout(loadSosResponses(supabase), 10000, 'SOS response updates took too long.');
      if (request !== sosResponsesRequest.current) return;
      const currentIds = new Set(linkedSeniorsRef.current.map(device => device.id));
      setSosResponses(rows.filter(row => allowed.has(row.device_id) && currentIds.has(row.device_id)));
      setSosResponsesError('');
    } catch (error) {
      if (request !== sosResponsesRequest.current) return;
      setSosResponsesError(['PGRST202','42883'].includes(error.code) ? 'SOS response updates need the SafeWatch database update.' : 'SOS response updates could not be refreshed. Retry to see the latest decisions.');
      setSosResponses(current => ['42501','PGRST301'].includes(error.code) ? [] : current.filter(row => allowed.has(row.device_id)));
    } finally { if (request === sosResponsesRequest.current) sosResponsesBusy.current = false; }
  };

  const fetchFamilyAlerts = async (refreshAfterPending = false) => {
    if (!isLoggedIn) return;
    if (confirmationBusy.current || alertsBusy.current) {
      if (refreshAfterPending) pendingAlertRefresh.current = true;
      return;
    }
    pendingAlertRefresh.current = false;
    alertsBusy.current = true;
    setNotificationsLoading(true);
    fetchSosResponseUpdates();
    const deviceIds = linkedSeniorsRef.current.map(device => device.id);
    if (!deviceIds.length) {
      alertsRequest.current += 1;
      sosResponsesRequest.current += 1;
      sosResponsesBusy.current = false;
      activeAlertKeys.current.clear();
      pendingTone.current = null;
      stopAlertSounds();
      setFamilyAlerts([]);
      setSosResponses([]);
      setSosResponsesError('');
      alertsBusy.current = false;
      setNotificationsLoading(false);
      setNotificationsError('');
      setPopupKey(null);
      return;
    }
    const requestId = ++alertsRequest.current;
    try {
      const { data, error } = await withRequestTimeout(supabase.from('alerts')
        .select('*, devices(device_name, patient_name)')
        .in('device_id', deviceIds)
        .or(ALERT_QUERY_FILTER)
        .order('created_at', { ascending: false }).limit(500), 10000, 'Loading notifications took too long.');
      if (error) throw error;
      if (requestId !== alertsRequest.current) return;
      const incidents = groupAlertIncidents(data || [], alertMemory.current.incidents)
        .filter(incident => isFamilyActionable(incident) && !confirmedKeys.current.has(incident.key));
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
      setSosNotice(current => current && incidents.some(incident => incident.alert_type === 'SOS' && String(incident.id) !== String(current.incidentId)) ? null : current);
      setNotificationsError('');
    } catch (error) {
      console.error('Error fetching family alerts:', error.message);
      if (requestId === alertsRequest.current) setNotificationsError('Pending alerts could not be refreshed. Check your connection and retry.');
    } finally {
      if (requestId === alertsRequest.current) {
        alertsBusy.current = false;
        setNotificationsLoading(false);
        if (pendingAlertRefresh.current) fetchFamilyAlerts();
      }
    }
  };

  const commitConfirmation = incident => {
    setForegroundSosId(id => id === String(incident.id) ? null : id);
    setPushIncident(current => String(current?.id) === String(incident.id) ? null : current);
    setPushTargetId(current => current === String(incident.id) ? null : current);
    confirmedKeys.current.add(incident.key);
    activeAlertKeys.current.delete(incident.key);
    alertMemory.current.incidents = alertMemory.current.incidents.filter(item => item.key !== incident.key);
    saveAlertMemory();
    setFamilyAlerts(items => items.filter(item => item.key !== incident.key));
    setPopupKey(key => key === incident.key ? null : key);
  };

  const handleAcknowledgeAlert = async (incident) => {
    if (incident.alert_type === 'SOS') return handleSosResponse(incident, 'confirmed');
    if (confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingKey(incident.key);
    setAlertError('');
    alertsRequest.current += 1;
    alertsBusy.current = false;
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

  const handleSosResponse = async (incident, decision) => {
    if (confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingKey(incident.key);
    setAlertError('');
    alertsRequest.current += 1;
    alertsBusy.current = false;
    sosResponsesRequest.current += 1;
    sosResponsesBusy.current = false;
    pendingTone.current = null;
    setSoundsBlocked(false);
    stopAlertSounds();
    try {
      const updated = await respondToSos(supabase, incident, decision, 'family');
      setSosResponses(current => mergeSosResponse(current, updated));
      commitConfirmation(incident);
      setSosNotice({ incidentId: incident.id, deviceId: incident.device_id, message: decision === 'declined' ? 'SOS transferred to barangay. Waiting for a response.' : updated.details?.sos_responses?.family?.by === userId ? 'Your response was saved. The unanswered SOS timer has stopped.' : sosResponseState(updated).message });
    } catch (error) { setAlertError(sosResponseError(error)); }
    finally {
      confirmationBusy.current = false;
      setConfirmingKey(null);
      await fetchFamilyAlerts();
    }
  };

  const handleDismissAll = async deviceId => {
    if (!familyAlerts.length || confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingKey('all');
    setAlertError('');
    alertsRequest.current += 1;
    alertsBusy.current = false;
    sosResponsesRequest.current += 1;
    sosResponsesBusy.current = false;
    pendingTone.current = null;
    setSoundsBlocked(false);
    stopAlertSounds();
    try {
      for (const incident of familyAlerts.filter(row => !deviceId || row.device_id === deviceId)) {
        if (incident.alert_type === 'SOS') {
          const updated = await respondToSos(supabase, incident, 'confirmed', 'family');
          setSosResponses(current => mergeSosResponse(current, updated));
        } else await acknowledgeIncident(supabase, incident);
        commitConfirmation(incident);
      }
      setPopupKey(null);
    } catch (error) {
      console.error('Error confirming alerts:', error.message);
      setAlertError(sosResponseError(error));
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

    const refreshVisible = () => { if (!document.hidden) fetchFamilyAlerts(true); };
    const serviceWorker = navigator.serviceWorker;
    const openAppPush = event => {
      const controller = serviceWorker?.controller;
      const payload = event.data;
      if (!controller || event.source?.scriptURL !== controller.scriptURL
          || payload?.type !== 'SAFEWATCH_SOS_PUSH' || payload.userId !== userId
          || typeof payload.alertId !== 'string' || !/^[1-9]\d{0,18}$/.test(payload.alertId) || document.hidden) return;
      setForegroundSosId(payload.alertId);
      fetchFamilyAlerts(true);
    };
    serviceWorker?.addEventListener?.('message', openAppPush);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('online', refreshVisible);

    const subscription = supabase
      .channel('public:telemetry')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, () => {
        fetchLiveTelemetry();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        fetchFamilyAlerts(true);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, () => {
        fetchFamilyAlerts();
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') refreshVisible(); });

    return () => {
      telemetryRequest.current += 1;
      telemetryBusy.current = false;
      alertsRequest.current += 1;
      alertsBusy.current = false;
      pendingAlertRefresh.current = false;
      clearInterval(timer);
      serviceWorker?.removeEventListener?.('message', openAppPush);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('online', refreshVisible);
      supabase.removeChannel(subscription);
    };
  }, [isLoggedIn, userId, selectedDeviceId, linkedIdKey]);

  const openPushIncident = React.useEffectEvent(deviceId => {
    selectSenior(deviceId, linkedSeniorsRef.current); setView('alerts');
  });

  useEffect(() => {
    if (!isLoggedIn || seniorListLoading || !pushTargetId) return;
    let active = true;
    let busy = false;
    let opened = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const { data, error } = await withRequestTimeout(supabase.from('alerts')
          .select('*, devices(device_name, patient_name)').eq('id', pushTargetId).eq('alert_type', 'SOS').maybeSingle(), 10000, 'Loading this SOS took too long.');
        if (!active) return;
        if (error) throw error;
        if (!data || !linkedSeniorsRef.current.some(device => device.id === data.device_id)) {
          setPushIncident(null);
          setPushTargetError('This SOS is unavailable or is no longer linked to your family.');
          return;
        }
        const incident = groupAlertIncidents([data])[0] || data;
        if (!opened) { openPushIncident(data.device_id); opened = true; }
        setPushIncident(incident); setPushTargetError('');
      } catch {
        if (active) setPushTargetError('This SOS could not be refreshed. Check your connection; SafeWatch will retry.');
      } finally { busy = false; }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [supabase, isLoggedIn, userId, seniorListLoading, pushTargetId, linkedIdKey]);

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

  const handleLogout = () => setLogoutRequested(true);

  if (recoveryLink) return <RecoveryLinkConfirm client={supabase} link={recoveryLink} onVerified={retryAuth} />;
  if (privacyRequired) return <PrivacyTermsGate key={userId} client={supabase} user={accountUser} app="family" error={privacyError} onAccepted={retryAuth} onRetry={retryAuth} />;
  if (pendingAccess || authError) return <AccountMfaGate key={pendingAccess?.user.id || 'error'} client={supabase} app="family" access={pendingAccess} error={authError} onVerified={retryAuth} />;
  if (accessDenied) return <AccountAccessDenied client={supabase} access={accessDenied} user={accountUser} app='family' onRetry={retryAuth} />;
  if (recoveryAccess) return <PasswordRecovery key={recoveryAccess.user?.id || 'invalid'} client={supabase} {...recoveryAccess} onNotice={setAuthNotice} onFinished={retryAuth} />;

  if (!isLoggedIn) {
    return (
      <AuthEntry client={supabase} app='family' initialError={authLinkError} notice={authNotice} onRecovered={retryAuth} />
    );
  }

  const renderView = () => {
    if (!selectedDeviceId && !['profile', 'alerts', 'seniors', 'history'].includes(view)) {
      return <div className="px-6 py-10 space-y-5">
        <h2 className="text-2xl font-black text-slate-800">{seniorListLoading ? 'Loading your seniors…' : seniorListError ? 'Your watches could not be loaded' : 'No watches linked'}</h2>
        <p className="text-sm text-slate-500">{seniorListLoading ? 'Checking the watches linked to your account.' : seniorListError ? 'Your account is signed in. Retry loading your watches or open Profile to manage your account.' : 'Your account is ready. Add a senior to request monitoring access. A deleted senior will no longer appear here.'}</p>
        {seniorListError && <button onClick={() => { setSeniorListLoading(true); fetchLinkedSeniors(undefined, true); }} className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white">Retry loading watches</button>}
        {!seniorListLoading && !seniorListError && <button onClick={() => setView('seniors')} className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white">Manage watches</button>}
      </div>;
    }
    switch (view) {
      case 'seniors':
        return <div className="px-6 py-8 space-y-5">
          <h1 className="text-2xl font-black text-slate-800">Manage watches</h1>
          <FamilySeniors client={supabase} seniors={linkedSeniors} selectedDeviceId={selectedDeviceId}
            loading={seniorListLoading} loadError={seniorListError} onReload={() => fetchLinkedSeniors(undefined, true)}
            onSelect={id => selectSenior(id)} onRemoved={removeLinkedSenior} onChanged={id => fetchLinkedSeniors(id, true)}/>
        </div>;
      case 'dashboard':
        return <DashboardView now={now} senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} telemetry={telemetry} familyAlerts={familyAlerts} setView={setView} />;
      case 'location':
        return <LocationView key={senior.deviceId || 'waiting'} client={supabase} senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} telemetry={telemetry} now={now} safeLocationsError={safeLocationsError} onSafeLocationSaved={applySavedHub} onReloadSafeLocations={refreshSafeLocations} />;
      case 'health':
        return <HealthView key={userId} client={supabase} senior={senior} telemetry={telemetry} now={now} />;
      case 'alerts':
        return <AlertsView key={`${userId}:${selectedDeviceId}`} client={supabase} seniors={linkedSeniors} senior={senior} familyAlerts={familyAlerts.filter(row => row.device_id === selectedDeviceId)} now={now} confirmingKey={confirmingKey} error={alertError} handleAcknowledge={handleAcknowledgeAlert} handleDecline={incident => handleSosResponse(incident, 'declined')} handleDismissAll={() => handleDismissAll(selectedDeviceId)} sosResponses={sosResponses.filter(row => row.device_id === selectedDeviceId)} sosResponsesError={sosResponsesError} onRetryResponses={fetchSosResponseUpdates} onOpenHistory={() => setView('history')} />;
      case 'profile':
        return <div className="nature-account"><ProfileView client={supabase} handleLogout={handleLogout}>
          <SosNotificationSettings push={push}/>
          <FamilySeniors client={supabase} seniors={linkedSeniors} selectedDeviceId={selectedDeviceId}
            loading={seniorListLoading} loadError={seniorListError} onReload={() => fetchLinkedSeniors(undefined, true)}
            onSelect={id => selectSenior(id)} onRemoved={removeLinkedSenior} onChanged={id => fetchLinkedSeniors(id, true)} />
        </ProfileView></div>;
      case 'history':
        return <div className="nature-secondary"><button type="button" className="watch-activity__more" onClick={() => setView('alerts')}>Back to alerts</button><ActivityHistory key={userId} client={supabase} seniors={linkedSeniors} initialCategory="alerts"/></div>;
      default:
        return <DashboardView now={now} senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} telemetry={telemetry} familyAlerts={familyAlerts} setView={setView} />;
    }
  };

  const activeAlert = familyAlerts[0] || null;
  const accessiblePushIncident = pushIncident && linkedSeniors.some(item => item.id === pushIncident.device_id) ? pushIncident : null;
  const pushNeedsResponse = accessiblePushIncident && isFamilyActionable(accessiblePushIncident)
    && accessiblePushIncident.details?.incident_open !== false
    && ['PENDING_FAMILY', 'ESCALATED_BHW'].includes(accessiblePushIncident.details?.status || 'PENDING_FAMILY');
  const popupAlert = accessiblePushIncident ? pushNeedsResponse ? accessiblePushIncident : null : familyAlerts.find(incident => incident.key === popupKey) || null;
  const closePushTarget = () => {
    setPushIncident(null); setPushTargetId(null); setPushTargetError('');
    const url = new URL(window.location.href); url.searchParams.delete('sos');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  };
  const clock = alertClock(activeAlert, now);

  return (
    <SeniorPhotoContext.Provider value={{ client: supabase, seniors: linkedSeniors }}><div className="family-nature">
      <div className="nature-background" aria-hidden="true"/>
      {activeAlert && !popupAlert && (
        <div className="relative z-[2001] bg-orange-50 border-b border-orange-200 px-5 py-4">
          <button onClick={() => setPopupKey(activeAlert.key)} className="w-full text-left text-sm font-bold text-orange-900">
            {alertTitle(activeAlert)} · {activeAlert.alert_type === 'SOS' && activeAlert.details?.sos_assigned_to ? sosResponseState(activeAlert).message : activeAlert.alert_type === 'LOW_BATTERY' ? 'Please charge the watch' : clock.escalated ? 'Barangay attention required' : `${formatDuration(clock.remainingSeconds)} remaining`}
          </button>
          <p className="text-xs text-orange-800 mt-1">{activeAlert.alert_type === 'LOW_BATTERY' ? batteryAlertMessage(activeAlert) : `Unconfirmed for ${formatDuration(clock.elapsedSeconds)}. ${clock.warning ? 'Time is running out.' : 'Tap to review and confirm.'}`}</p>
          {alertError && <p role="alert" className="text-xs text-red-700 mt-2">{alertError}</p>}
          {soundsBlocked && <button onClick={unlockSounds} className="text-xs font-bold underline mt-2">Enable alert sounds</button>}
        </div>
      )}
      <main className="nature-content" ref={contentRef}>
        {pushTargetError && <p role="alert" className="nature-notice">{pushTargetError}<button type="button" onClick={closePushTarget} className="ml-3 underline">Dismiss</button></p>}
        {foregroundSosId && !popupAlert && !pushTargetId && <div role="alert" className="sos-response-notice">
          <p>Watch SOS received</p>
          <button type="button" className="mt-2 font-bold underline" onClick={() => { setPushTargetId(foregroundSosId); setForegroundSosId(null); }}>View SOS</button>
          <button type="button" className="ml-4 mt-2 underline" onClick={() => setForegroundSosId(null)}>Dismiss</button>
        </div>}
        {sosNotice && linkedSeniors.some(item => item.id === sosNotice.deviceId) && <div role="status" className="sos-response-notice"><p>{sosNotice.message}</p><button type="button" onClick={() => { setView('alerts'); setSosNotice(null); }} className="mt-2 font-bold underline">View SOS updates</button><button type="button" onClick={() => setSosNotice(null)} className="ml-4 mt-2 underline">Dismiss</button></div>}
        <FamilyBrand onAlerts={() => setView('alerts')} alertCount={familyAlerts.length} notifications={{ app: 'family', userId, alerts: familyAlerts, responses: sosResponses, requests: accessNotifications.requests, loading: notificationsLoading, blocked: !!popupAlert, error: [notificationsError, sosResponsesError, accessNotifications.error].filter(Boolean).join(' '), onRefresh: () => { fetchFamilyAlerts(); accessNotifications.refresh(); }, onOpenNotification: item => { if (item.category === 'access') { setView('seniors'); return; } setView('alerts'); if (item.active) setPopupKey(item.incident.key); else setNotificationDetails(item.incident); } }}/>
        {reconnectingAuth && <p role="status" className="nature-notice">Reconnecting to SafeWatch. Some readings may be delayed.</p>}
        {view === 'dashboard' && <SosNotificationSettings push={push} compact/>}
        {!['profile', 'seniors'].includes(view) && linkedSeniors.length > 0 && <div className="nature-manage-watches"><button type="button" onClick={() => setView('seniors')}>Manage watches</button></div>}
        {view !== 'profile' && seniorListError && <p role="alert" className="nature-notice">{seniorListError}</p>}
        {!['dashboard', 'location', 'profile', 'seniors', 'history'].includes(view) && linkedSeniors.length > 0 && <div className="nature-shared-selection"><SeniorSelector senior={senior} seniors={linkedSeniors} selectedId={selectedDeviceId} onSelect={selectSenior} compact/></div>}
        {renderView()}
      </main>
      <FamilyNavigation view={view} setView={setView}/>
      <SosNotificationSetup key={userId} userId={userId} push={push}
        paused={seniorListLoading || !!(popupAlert || activeAlert?.alert_type === 'SOS' || foregroundSosId || pushTargetId || notificationDetails || logoutRequested)}/>
      {logoutRequested && <LogoutConfirmation client={supabase} app="family" onCancel={() => setLogoutRequested(false)} onLoggedOut={() => { setLogoutRequested(false); setView('dashboard'); }}/>}
      <AlertWarning incident={popupAlert} now={now} onConfirm={handleAcknowledgeAlert} onDecline={incident => handleSosResponse(incident, 'declined')}
        onMinimize={() => { closePushTarget(); setPopupKey(null); }} busy={!!confirmingKey} error={alertError}
        soundsBlocked={soundsBlocked} onEnableSounds={unlockSounds}/>
      {notificationDetails && linkedSeniors.some(senior => senior.id === notificationDetails.device_id) && <IncidentDetails incident={notificationDetails} onClose={() => setNotificationDetails(null)}/>}
      {accessiblePushIncident && !pushNeedsResponse && <IncidentDetails incident={accessiblePushIncident} onClose={closePushTarget}/>}
    </div></SeniorPhotoContext.Provider>
  );
}

export default App;
