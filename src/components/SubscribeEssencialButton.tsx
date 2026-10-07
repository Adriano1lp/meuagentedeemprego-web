import { useRef, useState } from 'react';

import {
  assignCheckoutUrl,
  CHECKOUT_START_FAILED,
  SUBSCRIBE_ESSENCIAL_LABEL,
} from '../api/billing';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type SubscribeEssencialButtonProps = {
  blocked?: boolean;
};

export function SubscribeEssencialButton({
  blocked = false,
}: SubscribeEssencialButtonProps) {
  const { api, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  if (blocked) {
    return null;
  }

  async function handleClick() {
    if (pendingRef.current || blocked) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const { checkoutUrl } = await api.startCheckout();
      assignCheckoutUrl(checkoutUrl);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        logout();
        return;
      }
      setError(CHECKOUT_START_FAILED);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        data-testid="subscribe-essencial"
        onClick={() => void handleClick()}
        disabled={pending}
        aria-busy={pending}
        className="w-full rounded-[18px] border-[3px] border-ink bg-yellow px-4 py-3 font-display text-[15px] font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {SUBSCRIBE_ESSENCIAL_LABEL}
      </button>
      {error ? (
        <p
          data-testid="subscribe-error"
          role="alert"
          className="mt-3 text-sm leading-[1.45] text-ink"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
