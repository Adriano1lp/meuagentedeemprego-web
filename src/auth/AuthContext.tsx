import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  ApiError,
  createApiClient,
  type ApiClient,
  type FetchLike,
} from '../api/client';
import { fromOutdatedCode, type OutdatedDetail } from '../api/outdated';
import { createMemoryTokenStore } from '../api/token';
import type { User } from '../api/types';
import { API_BASE_URL } from '../config';
import {
  isCurrentPrivacyVersion,
  isCurrentTermsVersion,
  type LegalDocId,
} from '../legal/versions';

/** Motivo de logout apos DELETE /users/me com sucesso. Clique em Sair nao usa isto. */
export const LOGOUT_ACCOUNT_DELETED = 'account-deleted';

export const ACCOUNT_DELETED_NOTICE = 'Sua conta foi excluida.';

type AuthContextValue = {
  token: string | null;
  user: User | null;
  outdated: OutdatedDetail[];
  isAuthenticated: boolean;
  blocksApp: boolean;
  accountDeleted: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    displayName: string;
    email: string;
    password: string;
    termsAccepted: boolean;
    privacyAccepted: boolean;
  }) => Promise<void>;
  logout: (reason?: unknown) => void;
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

  const rememberOutdated = useCallback((detail: OutdatedDetail) => {
    setOutdated((prev) => {
      if (prev.some((item) => item.code === detail.code)) {
        return prev;
      }
      return [...prev, detail];
    });
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl,
        fetchImpl,
        getToken: () => tokenStore.get(),
        onOutdated: rememberOutdated,
      }),
    [apiBaseUrl, fetchImpl, rememberOutdated, tokenStore],
  );

  const applySession = useCallback(
    async (accessToken: string, nextUser?: User) => {
      tokenStore.set(accessToken);
      setToken(accessToken);
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
          tokenStore.clear();
          setToken(null);
          setUser(null);
          setOutdated([]);
        }
        throw error;
      }
    },
    [api, tokenStore],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      setAccountDeleted(false);
      const response = await api.login({ email, password });
      await applySession(response.access_token, response.user);
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
      const response = await api.register(input);
      await applySession(response.access_token, response.user);
    },
    [api, applySession],
  );

  const logout = useCallback((reason?: unknown) => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
    setOutdated([]);
    setAccountDeleted(reason === LOGOUT_ACCOUNT_DELETED);
  }, [tokenStore]);

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

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      outdated,
      isAuthenticated: Boolean(token),
      blocksApp: Boolean(token) && outdated.length > 0,
      accountDeleted,
      login,
      register,
      logout,
      acceptOutdatedConsent,
      api,
    }),
    [
      acceptOutdatedConsent,
      accountDeleted,
      api,
      login,
      logout,
      outdated,
      register,
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
