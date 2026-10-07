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

type Phase = 'idle' | 'confirming' | 'timeout' | 'confirmed';

type BillingConfirmationProps = {
  enabled: boolean;
  onConfirmed: () => Promise<void>;
};

export function BillingConfirmation({
  enabled,
  onConfirmed,
}: BillingConfirmationProps) {
  const { api, logout } = useAuth();
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
          logout();
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [api, clearIntent, enabled, logout, phase]);

  if (phase === 'confirming') {
    return (
      <p
        data-testid="billing-confirming"
        role="status"
        aria-live="polite"
        className="mt-6 rounded-[18px] border-[3px] border-ink bg-sky px-4 py-3 text-sm leading-[1.45] text-ink"
      >
        {BILLING_CONFIRMING}
      </p>
    );
  }

  if (phase === 'timeout') {
    return (
      <div
        data-testid="billing-timeout"
        role="status"
        aria-live="polite"
        className="mt-6 rounded-[18px] border-[3px] border-ink bg-paper px-4 py-4 text-sm leading-[1.45] text-ink"
      >
        <p>{BILLING_TIMEOUT}</p>
        <button
          type="button"
          data-testid="billing-refresh"
          onClick={() => setPhase('confirming')}
          className="mt-4 rounded-[18px] border-[3px] border-ink bg-yellow px-4 py-2 font-display text-sm font-extrabold"
        >
          {BILLING_REFRESH_LABEL}
        </button>
      </div>
    );
  }

  if (enabled && intent === 'cancel') {
    return (
      <p
        data-testid="billing-cancel"
        role="status"
        className="mt-6 rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 text-sm leading-[1.45] text-ink"
      >
        {BILLING_CANCELLED}
      </p>
    );
  }

  if (phase === 'confirmed') {
    return (
      <p
        data-testid="billing-confirmed"
        role="status"
        className="mt-6 rounded-[18px] border-[3px] border-ink bg-green px-4 py-3 text-sm leading-[1.45] text-ink"
      >
        {BILLING_CONFIRMED}
      </p>
    );
  }

  return null;
}
