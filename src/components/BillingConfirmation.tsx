import { useEffect, useRef, useState } from 'react';

import {
  BILLING_CANCELLED,
  BILLING_CONFIRMED,
  BILLING_CONFIRMING,
  BILLING_REFRESH_LABEL,
  BILLING_TIMEOUT,
  isAbortError,
  pollBillingUntilEssencial,
} from '../api/billing';
import { ApiError } from '../api/client';
import { useBillingReturn } from '../billing/BillingReturn';
import { useAuth } from '../auth/AuthContext';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';

type Phase = 'idle' | 'confirming' | 'timeout' | 'confirmed';

type BillingConfirmationProps = {
  enabled: boolean;
  onConfirmed: () => Promise<void>;
};

export function BillingConfirmation({
  enabled,
  onConfirmed,
}: BillingConfirmationProps) {
  const { api, expireSession } = useAuth();
  const { intent, clearIntent } = useBillingReturn();
  const [phase, setPhase] = useState<Phase>('idle');
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  useEffect(() => {
    if (!enabled || intent !== 'success') {
      return;
    }
    setPhase((current) => (current === 'idle' ? 'confirming' : current));
  }, [enabled, intent]);

  useEffect(() => {
    if (!enabled || phase !== 'confirming') {
      return;
    }
    const controller = new AbortController();
    let active = true;

    pollBillingUntilEssencial(
      (signal) => api.getBillingMe(signal),
      controller.signal,
    )
      .then(async (result) => {
        if (!active) {
          return;
        }
        if (result === 'timeout') {
          setPhase('timeout');
          return;
        }
        try {
          await onConfirmedRef.current();
        } catch {
          // Falha ao recarregar o status não inventa limite nem plano.
        }
        if (!active) {
          return;
        }
        clearIntent();
        setPhase('confirmed');
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          expireSession();
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [api, clearIntent, enabled, expireSession, phase]);

  if (phase === 'confirming') {
    return (
      <Alert
        data-testid="billing-confirming"
        role="status"
        aria-live="polite"
        className="mt-6"
      >
        <AlertDescription>{BILLING_CONFIRMING}</AlertDescription>
      </Alert>
    );
  }

  if (phase === 'timeout') {
    return (
      <Alert
        data-testid="billing-timeout"
        role="status"
        aria-live="polite"
        variant="warning"
        className="mt-6"
      >
        <AlertDescription>
          <p>{BILLING_TIMEOUT}</p>
          <Button
            type="button"
            data-testid="billing-refresh"
            onClick={() => setPhase('confirming')}
            variant="outline"
            size="sm"
            className="mt-4"
          >
            {BILLING_REFRESH_LABEL}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (enabled && intent === 'cancel') {
    return (
      <Alert data-testid="billing-cancel" role="status" className="mt-6">
        <AlertDescription>{BILLING_CANCELLED}</AlertDescription>
      </Alert>
    );
  }

  if (phase === 'confirmed') {
    return (
      <Alert
        data-testid="billing-confirmed"
        role="status"
        variant="success"
        className="mt-6"
      >
        <AlertDescription>{BILLING_CONFIRMED}</AlertDescription>
      </Alert>
    );
  }

  return null;
}
