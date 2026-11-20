import { useEffect, useRef, useState } from 'react';
import { readAccountAccess } from '../accountSecurity.js';
import { accountCanUseApp, accountMatchesApp, loadAccountPermission } from '../accountAccess.js';
import { getRecoveryLink, getRecoveryState, installRecoveryListener, recoveryRedirectError, sessionId } from '../authFlow.js';
import { loadPrivacyAcceptance } from '../privacyTerms.js';
import { withRequestTimeout } from '../requestTimeout.js';

const checkTimeout = 'Checking your account took too long. Please check your connection and retry.';
const reconnectWindowMs = 45000;

function sessionKey(session) {
  const id = session?.user?.id;
  const token = sessionId(session) || session?.access_token;
  return id && token ? `${id}:${token}` : null;
}

function canUseSession(result, app) {
  return !!result.access?.allowed && accountCanUseApp(result.permission, app)
    && (app !== 'dashboard' || result.access.factors.length > 0)
    && !result.recovery && !result.linkError && !!result.privacyReceipt;
}

function isTemporaryFailure(error) {
  if (error?.status === 401 || error?.status === 403) return false;
  return error?.message === checkTimeout || error?.name === 'AuthRetryableFetchError'
    || [408, 429, 500, 502, 503, 504].includes(error?.status)
    || ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '57014'].includes(error?.code)
    || /failed to fetch|load failed|network\s?error/i.test(error?.message || '');
}

export default function useAccountSession(client, app) {
  const [state, setState] = useState({ loading: true, access: null, error: '' });
  const [notice,setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const accountId = useRef(null);
  const currentSession = useRef(null);
  const lastAuthToken = useRef(null);
  const sequence = useRef(0);
  const checking = useRef(false);
  const verified = useRef(null);

  useEffect(() => {
    installRecoveryListener(client);
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') setNotice('');
      const id = session?.user?.id || null;
      const token = session?.access_token || null;
      const key = sessionKey(session);
      // Restoring/focusing the same session must not cancel its in-flight
      // verification. A new token, account, MFA or recovery event is rechecked.
      if (id && token && id === accountId.current && token === lastAuthToken.current
          && ['SIGNED_IN', 'INITIAL_SESSION'].includes(event)) return;
      lastAuthToken.current = token;
      const sameFamilySession = app === 'family' && key && key === currentSession.current;
      const familySessionChanged = app === 'family' && currentSession.current && !sameFamilySession;
      if (!sameFamilySession || !['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) {
        verified.current = null;
      }
      currentSession.current = key;
      // Auth calls run in the effect, outside Supabase's callback/session lock.
      sequence.current += 1;
      if (!id || id !== accountId.current || familySessionChanged || event === 'PASSWORD_RECOVERY'
          || (event === 'SIGNED_IN' && !sameFamilySession)) {
        setState({ loading: !!id, access: null, error: '' });
      }
      accountId.current = id;
      setRevision(value => value + 1);
    });
    return () => {
      sequence.current += 1;
      checking.current = false;
      verified.current = null;
      currentSession.current = null;
      accountId.current = null;
      lastAuthToken.current = null;
      subscription.unsubscribe();
    };
  }, [client, app]);

  useEffect(() => {
    if (!state.access?.user && !state.retrying) return;
    const refresh = () => {
      if (!checking.current && (app !== 'family' || document.visibilityState === 'visible')) {
        setRevision(value => value + 1);
      }
    };
    const timer = setInterval(refresh, state.reconnecting || state.retrying ? 5000 : 15000);
    if (app === 'family') {
      window.addEventListener('online', refresh);
      document.addEventListener('visibilitychange', refresh);
    }
    return () => {
      clearInterval(timer);
      if (app === 'family') {
        window.removeEventListener('online', refresh);
        document.removeEventListener('visibilitychange', refresh);
      }
    };
  }, [app, state.access?.user.id, state.reconnecting, state.retrying]);

  useEffect(() => {
    if (!state.reconnecting) return;
    const previous = verified.current;
    if (!previous) return;
    const timer = setTimeout(() => {
      if (verified.current !== previous) return;
      verified.current = null;
      setState({ loading: false, access: null, error: checkTimeout, retrying: true });
    }, Math.max(0, previous.reconnectUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [state.reconnecting]);

  useEffect(() => {
    let active = true;
    const request = ++sequence.current;
    checking.current = true;
    let observedSession = currentSession.current;
    let mayReconnect = true;
    withRequestTimeout((async () => {
      const recoveryLink=getRecoveryLink(client);
      if(recoveryLink)return{access:null,recoveryLink,recovery:null,linkError:''};
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data?.session) return {access:null,recovery:getRecoveryState(client,null),linkError:recoveryRedirectError(client)};
      observedSession = sessionKey(data.session);
      const recovery = getRecoveryState(client,data.session);
      const linkError = recoveryRedirectError(client);
      mayReconnect = !recovery && !linkError;
      const access = await readAccountAccess(client, data.session.user.id);
      if (!access.allowed) mayReconnect = false;
      const permission = await loadAccountPermission(client,access.user.id);
      if (!accountCanUseApp(permission, app)) mayReconnect = false;
      let privacyReceipt = null; let privacyError = '';
      if (accountMatchesApp(permission,app) && !recovery && !linkError) {
        try { privacyReceipt = await loadPrivacyAcceptance(client,access.user.id,app); }
        catch (failure) {
          if (app === 'family' && mayReconnect && verified.current && isTemporaryFailure(failure)) throw failure;
          privacyError = failure.message || 'Unable to check privacy acceptance. Please retry.';
        }
      }
      return {access,permission,recovery,linkError,privacyReceipt,privacyError};
    })(), 12000, checkTimeout).then(result => {
      if (active && request === sequence.current) {
        accountId.current = result.access?.user.id || null;
        currentSession.current = result.access ? observedSession : null;
        verified.current = app === 'family' && observedSession && canUseSession(result, app)
          ? { key: observedSession, result, reconnectUntil: 0 } : null;
        setState({ loading: false, ...result, error: '' });
      }
    }).catch(error => {
      if (!active || request !== sequence.current) return;
      const previous = verified.current;
      const retrying = app === 'family' && isTemporaryFailure(error);
      if (previous && mayReconnect && previous.key === currentSession.current && previous.key === observedSession
          && !getRecoveryLink(client) && !recoveryRedirectError(client) && retrying) {
        previous.reconnectUntil ||= Date.now() + reconnectWindowMs;
        if (Date.now() < previous.reconnectUntil) {
          setState({ loading: false, ...previous.result, error: '', reconnecting: true });
          return;
        }
      }
      verified.current = null;
      setState({ loading: false, access: null, error: error?.message || 'Unable to check your account. Please retry.', retrying });
    }).finally(() => {
      if (active && request === sequence.current) checking.current = false;
    });
    return () => { active = false; };
  }, [client, revision, app]);

  const roleAllowed = accountCanUseApp(state.permission,app);
  const matches = accountMatchesApp(state.permission,app);
  const recoveryAccess = state.recovery && (!state.access || matches) ? {user:state.access?.user,recovery:state.recovery} : null;
  const enrollmentRequired = !!state.access && matches && state.permission?.requested_app === 'dashboard' && !state.access.factors.length;
  const needsMfa = state.access && (!state.access.allowed || enrollmentRequired) && (roleAllowed || matches && state.recovery?.valid);
  const privacyRequired = !!state.access && matches && !state.recovery && !state.linkError && !state.privacyReceipt;
  return { isLoadingAuth: state.loading, isLoggedIn: canUseSession(state, app), reconnectingAuth: !!state.reconnecting,
    userId: state.access?.user.id || null, accountUser: state.access?.user,
    accountPermission:state.permission, recoveryAccess,recoveryLink:state.recoveryLink,
    accessDenied:state.access && !roleAllowed && !(matches && state.recovery) ? state.permission : null,
    pendingAccess:needsMfa ? { ...state.access, enrollmentRequired } : null,
    privacyRequired, privacyError:state.privacyError,
    authLinkError:state.linkError, authNotice:notice, setAuthNotice:setNotice,
    authError: state.error, retryAuth: () => setRevision(value => value + 1) };
}
