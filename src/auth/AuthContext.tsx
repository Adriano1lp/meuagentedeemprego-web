import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  ApiError,
  createApiClient,
  type ApiClient,
  type FetchLike,
} from '../api/client';
import { fromOutdatedCode, type OutdatedDetail } from '../api/outdated';
import { requestRefresh, SessionExpiredError, type AccessGrant } from '../api/sessionHttp';
import { createMemoryTokenStore } from '../api/token';
import type { User } from '../api/types';
import { API_BASE_URL } from '../config';
import {
  isCurrentPrivacyVersion,
  isCurrentTermsVersion,
  type LegalDocId,
} from '../legal/versions';
import {
  clearLoggedOutFlag,
  isLoggedOutFlag,
  LOGGED_OUT_KEY,
  LOGGED_OUT_VALUE,
  markLoggedOut,
  retryLoggedOut,
} from './loggedOut';
import {
  buildExpiredLoginPath,
  ENTER_PATH,
  isSafeAppPath,
  returnPathFromLocation,
} from './returnTo';
import {
  clearSessionRefreshMark,
  getSessionCoordinator,
  restoreSessionOnce,
  setRefreshImplementation,
  type SessionEvent,
} from './sessionRefresh';

/** Motivo de logout apos DELETE /users/me com sucesso. Clique em Sair nao usa isto. */
export const LOGOUT_ACCOUNT_DELETED = 'account-deleted';

export const ACCOUNT_DELETED_NOTICE = 'Sua conta foi excluída.';

export type SessionPhase = 'restoring' | 'ready';

type AuthContextValue = {
  token: string | null;
  user: User | null;
  outdated: OutdatedDetail[];
  isAuthenticated: boolean;
  blocksApp: boolean;
  accountDeleted: boolean;
  sessionPhase: SessionPhase;
  /** Refresh do boot ou de um 401 respondeu falha. A rota protegida usa ?next. */
  sessionExpired: boolean;
  /** Logout explícito: a rota protegida não manda para /entrar no meio do caminho. */
  redirectHeld: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    displayName: string;
    email: string;
    password: string;
    termsAccepted: boolean;
    privacyAccepted: boolean;
  }) => Promise<void>;
  logout: (reason?: unknown) => void;
  /** Limpa a memória e vai para /entrar?next= da rota /app atual. */
  expireSession: () => void;
  acceptOutdatedConsent: (docs: LegalDocId[]) => Promise<void>;
  api: ApiClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function outdatedFromUser(user: User | null | undefined): OutdatedDetail[] {
  if (!user) {
    return [];
  }
  const next: OutdatedDetail[] = [];
  if (
    user.terms_version != null &&
    String(user.terms_version).trim() !== '' &&
    !isCurrentTermsVersion(user.terms_version)
  ) {
    const detail = fromOutdatedCode('TERMS_OUTDATED');
    if (detail) next.push(detail);
  }
  if (
    user.privacy_version != null &&
    String(user.privacy_version).trim() !== '' &&
    !isCurrentPrivacyVersion(user.privacy_version)
  ) {
    const detail = fromOutdatedCode('PRIVACY_OUTDATED');
    if (detail) next.push(detail);
  }
  return next;
}

export function AuthProvider({
  children,
  apiBaseUrl = API_BASE_URL,
  fetchImpl,
}: {
  children: ReactNode;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}) {
  const tokenStore = useMemo(() => createMemoryTokenStore(), []);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [outdated, setOutdated] = useState<OutdatedDetail[]>([]);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('restoring');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [redirectHeld, setRedirectHeld] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggingOut = useRef(false);
  /** Logout desta aba ou de outra: um refresh que ainda resolve não manda para /entrar. */
  const suppressExpire = useRef(false);
  /** O POST /auth/refresh desta aba respondeu 401. */
  const refreshConfirmed = useRef(false);
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;

  const rememberOutdated = useCallback((detail: OutdatedDetail) => {
    setOutdated((prev) => {
      if (prev.some((item) => item.code === detail.code)) {
        return prev;
      }
      return [...prev, detail];
    });
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimer.current != null) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const rememberGrant = useCallback(
    (grant: AccessGrant) => {
      if (isLoggedOutFlag()) {
        return;
      }
      refreshConfirmed.current = false;
      tokenStore.set(grant.accessToken);
      setToken(grant.accessToken);
      setSessionExpired(false);
      clearRefreshTimer();
      if (grant.expiresIn == null || grant.expiresIn < 30) {
        return;
      }
      const skewSeconds = Math.min(60, Math.floor(grant.expiresIn / 2));
      const delayMs = Math.max((grant.expiresIn - skewSeconds) * 1000, 30_000);
      refreshTimer.current = setTimeout(() => {
        void getSessionCoordinator()
          .refresh()
          .then((next) => {
            rememberGrant(next);
          })
          .catch((error: unknown) => {
            refreshConfirmed.current =
              error instanceof SessionExpiredError && error.confirmed;
            expireRef.current();
          });
      }, delayMs);
    },
    [clearRefreshTimer, tokenStore],
  );

  const clearMemory = useCallback(() => {
    clearRefreshTimer();
    tokenStore.clear();
    setToken(null);
    setUser(null);
    setOutdated([]);
  }, [clearRefreshTimer, tokenStore]);

  const expireRef = useRef<() => void>(() => {});
  const expireSession = useCallback(() => {
    if (suppressExpire.current) {
      return;
    }
    const wasLoggedIn = tokenStore.get() != null;
    const confirmed = refreshConfirmed.current;
    refreshConfirmed.current = false;
    clearMemory();
    setAccountDeleted(false);
    setSessionExpired(true);
    getSessionCoordinator().reset();
    if (wasLoggedIn && confirmed) {
      getSessionCoordinator().notifySessionExpired();
    }
    const current = locationRef.current;
    const next = returnPathFromLocation(current.pathname, current.search);
    if (isSafeAppPath(next)) {
      navigate(buildExpiredLoginPath(next), { replace: true });
      return;
    }
    navigate(buildExpiredLoginPath('/app'), { replace: true });
  }, [clearMemory, navigate]);
  expireRef.current = expireSession;

  setRefreshImplementation(() =>
    requestRefresh(apiBaseUrl, fetchRef.current ?? fetch),
  );

  const refreshSession = useCallback(async () => {
    if (isLoggedOutFlag()) {
      refreshConfirmed.current = false;
      return false;
    }
    try {
      const grant = await getSessionCoordinator().refresh();
      if (isLoggedOutFlag()) {
        refreshConfirmed.current = false;
        return false;
      }
      rememberGrant(grant);
      return true;
    } catch (error) {
      refreshConfirmed.current = error instanceof SessionExpiredError && error.confirmed;
      return false;
    }
  }, [rememberGrant]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl,
        fetchImpl,
        getToken: () => tokenStore.get(),
        onOutdated: rememberOutdated,
        refreshSession,
        onSessionExpired: () => expireRef.current(),
      }),
    [apiBaseUrl, fetchImpl, rememberOutdated, refreshSession, tokenStore],
  );

  const applySession = useCallback(
    async (accessToken: string, nextUser?: User, expiresIn?: number) => {
      rememberGrant({ accessToken, expiresIn: expiresIn ?? null });
      if (nextUser) {
        setUser(nextUser);
        const fromUser = outdatedFromUser(nextUser);
        if (fromUser.length > 0) {
          setOutdated(fromUser);
        }
      }
      try {
        const me = await api.me();
        setUser(me);
        setOutdated(outdatedFromUser(me));
      } catch (error) {
        if (error instanceof ApiError && error.outdated) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          clearMemory();
          setSessionExpired(true);
        }
        throw error;
      }
    },
    [api, clearMemory, rememberGrant],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      setAccountDeleted(false);
      suppressExpire.current = false;
      getSessionCoordinator().reset();
      clearSessionRefreshMark();
      const response = await api.login({ email, password });
      clearLoggedOutFlag();
      await applySession(response.access_token, response.user, response.expires_in);
    },
    [api, applySession],
  );

  const register = useCallback(
    async (input: {
      displayName: string;
      email: string;
      password: string;
      termsAccepted: boolean;
      privacyAccepted: boolean;
    }) => {
      setAccountDeleted(false);
      suppressExpire.current = false;
      getSessionCoordinator().reset();
      const response = await api.register(input);
      clearLoggedOutFlag();
      await applySession(response.access_token, response.user, response.expires_in);
    },
    [api, applySession],
  );

  const logout = useCallback(
    (reason?: unknown) => {
      if (loggingOut.current) {
        return;
      }
      loggingOut.current = true;
      suppressExpire.current = true;
      markLoggedOut();
      clearSessionRefreshMark();
      const deleted = reason === LOGOUT_ACCOUNT_DELETED;
      setRedirectHeld(true);
      void retryLoggedOut(apiBaseUrl, fetchRef.current ?? fetch, true).finally(() => {
        clearMemory();
        setSessionExpired(false);
        setAccountDeleted(deleted);
        getSessionCoordinator().reset();
        getSessionCoordinator().notifyLogout();
        navigate(deleted ? ENTER_PATH : '/', { replace: true });
        loggingOut.current = false;
      });
    },
    [apiBaseUrl, clearMemory, navigate],
  );

  const acceptOutdatedConsent = useCallback(
    async (docs: LegalDocId[]) => {
      for (const doc of docs) {
        await api.acceptConsent(doc);
      }
      setOutdated([]);
      const me = await api.me();
      setUser(me);
      setOutdated(outdatedFromUser(me));
    },
    [api],
  );

  useEffect(() => {
    let active = true;
    if (isLoggedOutFlag()) {
      void retryLoggedOut(apiBaseUrl, fetchRef.current ?? fetch);
    }
    void restoreSessionOnce().then(async (grant) => {
      if (!active) {
        return;
      }
      if (!grant) {
        const path = locationRef.current.pathname;
        const protectedEntry =
          path === '/app' ||
          path.startsWith('/app/') ||
          path === '/historico' ||
          path === '/perfil';
        if (protectedEntry && !suppressExpire.current) {
          // Falha de boot fica nesta aba. Quem já estava logado não é avisado.
          setSessionExpired(true);
        }
        setSessionPhase('ready');
        return;
      }
      rememberGrant(grant);
      try {
        const me = await api.me();
        if (!active) {
          return;
        }
        setUser(me);
        setOutdated(outdatedFromUser(me));
      } catch {
        // 401 já passou pelo refresh do client. Sem token, a rota protegida sai.
      }
      if (active) {
        setSessionPhase('ready');
      }
    });
    return () => {
      active = false;
    };
  }, [api, apiBaseUrl, rememberGrant]);

  useEffect(() => {
    return getSessionCoordinator().subscribe((event: SessionEvent) => {
      if (event.type === 'logout') {
        suppressExpire.current = true;
        setRedirectHeld(true);
        clearMemory();
        setSessionExpired(false);
        setAccountDeleted(false);
        getSessionCoordinator().reset();
        navigate('/', { replace: true });
        return;
      }
      clearMemory();
      setAccountDeleted(false);
      setSessionExpired(true);
      getSessionCoordinator().reset();
      const current = locationRef.current;
      const next = returnPathFromLocation(current.pathname, current.search);
      if (isSafeAppPath(next)) {
        navigate(buildExpiredLoginPath(next), { replace: true });
      }
    });
  }, [clearMemory, navigate]);

  useEffect(() => () => clearRefreshTimer(), [clearRefreshTimer]);

  useEffect(() => {
    const onOnline = () => {
      if (!isLoggedOutFlag()) {
        return;
      }
      void retryLoggedOut(apiBaseUrl, fetchRef.current ?? fetch);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [apiBaseUrl]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOGGED_OUT_KEY || event.newValue !== LOGGED_OUT_VALUE) {
        return;
      }
      suppressExpire.current = true;
      setRedirectHeld(true);
      clearMemory();
      setSessionExpired(false);
      setAccountDeleted(false);
      getSessionCoordinator().reset();
      navigate('/', { replace: true });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [clearMemory, navigate]);

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === ENTER_PATH) {
      setRedirectHeld(false);
    }
  }, [location.pathname]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      outdated,
      isAuthenticated: Boolean(token),
      blocksApp: Boolean(token) && outdated.length > 0,
      accountDeleted,
      sessionPhase,
      sessionExpired,
      redirectHeld,
      login,
      register,
      logout,
      expireSession,
      acceptOutdatedConsent,
      api,
    }),
    [
      acceptOutdatedConsent,
      accountDeleted,
      api,
      expireSession,
      login,
      logout,
      outdated,
      redirectHeld,
      register,
      sessionExpired,
      sessionPhase,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth precisa estar dentro de AuthProvider');
  }
  return context;
}
