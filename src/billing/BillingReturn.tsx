import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  readBillingReturnIntent,
  replaceBrowserUrlWithoutBillingReturn,
  searchWithoutBillingReturn,
  type BillingReturnIntent,
} from '../api/billing';

type BillingReturnValue = {
  intent: BillingReturnIntent | null;
  clearIntent: () => void;
};

const EMPTY_BILLING_RETURN: BillingReturnValue = {
  intent: null,
  clearIntent: () => {},
};

const BillingReturnContext = createContext<BillingReturnValue | null>(null);

/**
 * Sobrevive ao remount do StrictMode e ao intervalo entre limpar a URL e o login.
 * Não é storage: some no reload completo, junto com o JWT.
 * Nunca guarda session_id — só success ou cancel.
 */
let pendingIntent: BillingReturnIntent | null = null;

/** Só para testes. A sessão real perde isto no reload, com o JWT. */
export function resetBillingReturnMemory(): void {
  pendingIntent = null;
}

export function BillingReturnProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const fromUrl = readBillingReturnIntent(location.search);
  if (fromUrl) {
    pendingIntent = fromUrl;
  }

  const [intent, setIntent] = useState<BillingReturnIntent | null>(
    () => pendingIntent,
  );

  if (pendingIntent && intent !== pendingIntent) {
    setIntent(pendingIntent);
  }

  useEffect(() => {
    if (!fromUrl) {
      return;
    }
    replaceBrowserUrlWithoutBillingReturn();
    const cleaned = searchWithoutBillingReturn(location.search);
    if (cleaned !== location.search) {
      navigate(
        {
          pathname: location.pathname,
          search: cleaned,
          hash: location.hash,
        },
        { replace: true },
      );
    }
  }, [fromUrl, location.hash, location.pathname, location.search, navigate]);

  const clearIntent = useCallback(() => {
    pendingIntent = null;
    setIntent(null);
  }, []);

  const value = useMemo(
    () => ({ intent, clearIntent }),
    [clearIntent, intent],
  );

  return (
    <BillingReturnContext.Provider value={value}>
      {children}
    </BillingReturnContext.Provider>
  );
}

export function useBillingReturn(): BillingReturnValue {
  return useContext(BillingReturnContext) ?? EMPTY_BILLING_RETURN;
}
