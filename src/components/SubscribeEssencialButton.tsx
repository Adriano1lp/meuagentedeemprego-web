import { useRef, useState } from 'react';

import {
  assignCheckoutUrl,
  CHECKOUT_START_FAILED,
  SUBSCRIBE_ESSENCIAL_LABEL,
} from '../api/billing';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';

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
      <Button
        type="button"
        data-testid="subscribe-essencial"
        onClick={() => void handleClick()}
        disabled={pending}
        aria-busy={pending}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/80"
        size="lg"
      >
        {SUBSCRIBE_ESSENCIAL_LABEL}
      </Button>
      {error ? (
        <Alert data-testid="subscribe-error" variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
