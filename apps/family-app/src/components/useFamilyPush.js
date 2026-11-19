import { useEffect, useRef, useState } from 'react';
import { disableFamilyPush, enableFamilyPush, PUSH_OWNER_KEY, pushAvailability, pushError, pushRegistration, savePushSubscription } from '../familyPush.js';

export default function useFamilyPush(client, userId) {
  const [status, setStatus] = useState(pushAvailability);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const subscriptionId = useRef(null);
  const currentUser = useRef(userId);
  const operation = useRef(null);

  useEffect(() => {
    let active = true;
    currentUser.current = userId;
    subscriptionId.current = null;
    const availability = pushAvailability();
    if (availability !== 'checking') return;
    // Initial session restoration is not a sign-out.
    if (userId === undefined) return;
    queueMicrotask(() => {
      if (!active) return;
      setBusy(false); setError(''); setNotice('');
      if (!userId) setStatus('off');
    });
    if (!userId) {
      // A signed-out device must not retain a previous family's notification UI.
      navigator.serviceWorker.getRegistration().then(async registration => {
        if (!registration || currentUser.current) return;
        registration.active?.postMessage({ type: 'SAFEWATCH_PUSH_OWNER', userId: null });
        await (await registration.pushManager.getSubscription())?.unsubscribe();
        localStorage.removeItem(PUSH_OWNER_KEY);
      }).catch(() => {});
      return;
    }
    let checking = false;
    const check = async () => {
      if (checking || operation.current) return;
      if (Notification.permission !== 'granted' || localStorage.getItem(PUSH_OWNER_KEY) !== userId) {
        if (active) setStatus(Notification.permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      checking = true;
      try {
        const registration = await pushRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        if (!subscription) { setStatus('off'); return; }
        const id = await savePushSubscription(client, userId, registration, subscription);
        if (active) { subscriptionId.current = id; setStatus('enabled'); setError(''); }
      } catch (err) { if (active) { setError(pushError(err)); setStatus('off'); } }
      finally { checking = false; }
    };
    check();
    const focus = () => { if (!document.hidden) check(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { active = false; window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [client, userId]);

  const perform = async action => {
    if (operation.current || !userId) return;
    const owner = userId;
    operation.current = owner;
    setBusy(true); setError(''); setNotice('');
    try { await action(owner); }
    catch (err) {
      if (currentUser.current !== owner) return;
      if (Notification.permission === 'denied') setStatus('blocked');
      setError(pushError(err));
    } finally {
      operation.current = null;
      if (currentUser.current === owner) setBusy(false);
    }
  };
  return { status, error, notice, busy,
    enable: () => perform(async owner => {
      const id = await enableFamilyPush(client, owner);
      if (currentUser.current === owner) { subscriptionId.current = id; setStatus('enabled'); setNotice('SOS notifications are enabled on this device.'); }
    }),
    disable: () => perform(async owner => {
      await disableFamilyPush(client, owner);
      if (currentUser.current === owner) { subscriptionId.current = null; setStatus('off'); }
    }),
    test: () => perform(async owner => {
      const { error: err } = await client.rpc('request_family_push_test', { p_subscription_id: subscriptionId.current });
      if (err) throw err;
      if (currentUser.current === owner) setNotice('Test scheduled. You can close SafeWatch; a test notification will arrive shortly.');
    }),
  };
}
