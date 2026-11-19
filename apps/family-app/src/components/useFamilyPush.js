import { useEffect, useRef, useState } from 'react';
import { canConnectPushAutomatically, clearSignedOutPush, connectFamilyPush, disableFamilyPush, enableFamilyPush, pushAvailability, pushError } from '../familyPush.js';

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
      clearSignedOutPush(() => currentUser.current === null).catch(() => {});
      return;
    }
    let checking = false;
    const check = async () => {
      if (checking || operation.current) return;
      if (Notification.permission !== 'granted' || !canConnectPushAutomatically(userId)) {
        if (active) setStatus(Notification.permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      checking = true;
      try {
        const id = await connectFamilyPush(client, userId, () => active && currentUser.current === userId);
        if (active) { subscriptionId.current = id; setStatus('enabled'); setError(''); }
      } catch (err) { if (active) { setError(pushError(err)); setStatus('off'); } }
      finally { checking = false; }
    };
    check();
    const focus = () => { if (!document.hidden) check(); };
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      active = false;
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
      document.removeEventListener('visibilitychange', focus);
    };
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
      const id = await enableFamilyPush(client, owner, () => currentUser.current === owner);
      if (currentUser.current === owner) { subscriptionId.current = id; setStatus('enabled'); setNotice('SOS notifications are enabled on this device.'); }
    }),
    disable: () => perform(async owner => {
      await disableFamilyPush(client, owner, () => currentUser.current === owner);
      if (currentUser.current === owner) { subscriptionId.current = null; setStatus('off'); }
    }),
    test: () => perform(async owner => {
      const { error: err } = await client.rpc('request_family_push_test', { p_subscription_id: subscriptionId.current });
      if (err) throw err;
      if (currentUser.current === owner) setNotice('Test requested. Check your device’s notification center.');
    }),
  };
}
