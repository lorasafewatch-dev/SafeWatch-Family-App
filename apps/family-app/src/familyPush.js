export const PUSH_OWNER_KEY = 'safewatch.family.push-owner.v1';

export function sosIdFromUrl(url) {
  const value = new URL(url).searchParams.get('sos');
  return value && /^[1-9]\d{0,18}$/.test(value) ? value : null;
}

export function pushSupported() {
  return !!(globalThis.isSecureContext && globalThis.navigator?.serviceWorker
    && globalThis.PushManager && globalThis.Notification);
}

export function applicationServerKey(value) {
  if (typeof value !== 'string' || !/^[\w-]{87}$/.test(value)) throw new Error('SOS notifications are not configured yet.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), char => char.charCodeAt(0));
}

export async function pushRegistration() {
  let timer;
  try {
    return await Promise.race([navigator.serviceWorker.ready,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SafeWatch is still updating. Reopen the app and try again.')), 10000); })]);
  } finally { clearTimeout(timer); }
}

async function setOwner(registration, userId) {
  const worker = registration.active;
  if (!worker) throw new Error('SafeWatch is still updating. Reopen the app and try again.');
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Reopen SafeWatch to finish its notification update.')); }, 5000);
    channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
    worker.postMessage({ type: 'SAFEWATCH_PUSH_OWNER', userId }, [channel.port2]);
  });
}

export async function savePushSubscription(client, userId, registration, subscription) {
  const { data, error } = await client.rpc('save_family_push_subscription', {
    p_subscription: subscription.toJSON(), p_expected_user_id: userId,
  });
  if (error) throw error;
  await setOwner(registration, userId);
  localStorage.setItem(PUSH_OWNER_KEY, userId);
  return data;
}

export async function enableFamilyPush(client, userId) {
  // Ask while the button's user activation is still available.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications in your phone’s SafeWatch notification settings, then retry.');
  const registration = await pushRegistration();
  const { data, error } = await client.rpc('family_push_configuration');
  if (error) throw error;
  const key = applicationServerKey(data?.publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && localStorage.getItem(PUSH_OWNER_KEY) !== userId) {
    await setOwner(registration, null);
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return savePushSubscription(client, userId, registration, subscription);
}

export async function disableFamilyPush(client, userId) {
  const registration = await pushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const { error } = await client.rpc('remove_family_push_subscription', { p_endpoint: subscription.endpoint });
    if (error) throw error;
  }
  await setOwner(registration, null);
  if (subscription) await subscription.unsubscribe();
  if (localStorage.getItem(PUSH_OWNER_KEY) === userId) localStorage.removeItem(PUSH_OWNER_KEY);
}

export function pushError(error) {
  if (error?.code === '42501') return 'Sign in with your approved family account to enable SOS notifications.';
  if (['PGRST202', '42883'].includes(error?.code)) return 'SOS notifications are still being set up. Please retry shortly.';
  return error?.message && !error?.code ? error.message : 'SOS notifications could not be updated. Check your connection and retry.';
}
