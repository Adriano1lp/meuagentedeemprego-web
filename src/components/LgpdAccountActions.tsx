import { useEffect, useId, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  DELETE_CONFIRM_MISMATCH,
  DELETE_FAILED,
  EXPORT_FAILED,
  isExactDeleteConfirm,
  omitSensitiveExportKeys,
  triggerJsonDownload,
} from '../api/lgpd';
import type { UserDataExport } from '../api/types';
import { LOGOUT_ACCOUNT_DELETED, useAuth } from '../auth/AuthContext';

type LgpdAccountActionsProps = {
  enabled: boolean;
};

export function LgpdAccountActions({ enabled }: LgpdAccountActionsProps) {
  const { api, logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirmInputId = useId();
  const confirmInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    confirmInputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) {
        setDialogOpen(false);
        setConfirmText('');
        setConfirmMismatch(false);
        setDeleteError(null);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [deleting, dialogOpen]);

  async function exportData() {
    if (!enabled || exporting || deleting) {
      return;
    }
    setExporting(true);
    setExportError(null);
    setExportSuccess(false);
    try {
      const payload = omitSensitiveExportKeys(await api.exportMyData());
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        setExportError(EXPORT_FAILED);
        return;
      }
      triggerJsonDownload(payload as UserDataExport);
      setExportSuccess(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        logout();
        return;
      }
      setExportError(cause instanceof ApiError ? cause.message : EXPORT_FAILED);
    } finally {
      setExporting(false);
    }
  }

  function openDeleteDialog() {
    if (!enabled || exporting || deleting) {
      return;
    }
    setDeleteError(null);
    setConfirmMismatch(false);
    setConfirmText('');
    setDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (deleting) {
      return;
    }
    setDialogOpen(false);
    setConfirmText('');
    setConfirmMismatch(false);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!enabled || deleting) {
      return;
    }
    if (!isExactDeleteConfirm(confirmText)) {
      setConfirmMismatch(true);
      setDeleteError(null);
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    setConfirmMismatch(false);
    try {
      await api.deleteMyAccount();
      logout(LOGOUT_ACCOUNT_DELETED);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        setDialogOpen(false);
        setDeleting(false);
        return;
      }
      if (cause instanceof ApiError && cause.status === 401) {
        logout();
        return;
      }
      setDeleteError(cause instanceof ApiError ? cause.message : DELETE_FAILED);
      setDeleting(false);
    }
  }

  return (
    <section
      data-testid="lgpd-account-section"
      aria-labelledby="lgpd-account-title"
      className="mt-6 rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[8px_8px_0_#111]"
    >
      <h2
        id="lgpd-account-title"
        className="font-display text-[22px] font-extrabold text-ink"
      >
        Seus dados
      </h2>
      <p className="mt-3 text-sm leading-[1.45] text-ink">
        Baixe uma copia dos dados da conta ou exclua a conta de forma
        permanente.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <button
          type="button"
          data-testid="export-data"
          onClick={() => void exportData()}
          disabled={!enabled || exporting || deleting}
          aria-busy={exporting}
          className="w-full rounded-[18px] border-[3px] border-ink bg-yellow px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] disabled:opacity-60"
        >
          Exportar meus dados
        </button>

        {exporting ? (
          <p
            data-testid="export-data-loading"
            role="status"
            aria-live="polite"
            className="text-sm text-ink"
          >
            Exportando seus dados...
          </p>
        ) : null}

        {exportError ? (
          <div
            data-testid="export-data-error"
            role="alert"
            className="rounded-[18px] border-[3px] border-ink bg-cream p-4"
          >
            <p className="text-sm text-ink">{exportError}</p>
            <button
              type="button"
              data-testid="export-data-retry"
              onClick={() => void exportData()}
              disabled={!enabled || exporting || deleting}
              className="mt-3 rounded-[18px] border-[3px] border-ink bg-yellow px-4 py-2 font-display text-sm font-extrabold"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}

        {exportSuccess ? (
          <p
            data-testid="export-data-success"
            role="status"
            aria-live="polite"
            className="text-sm text-ink"
          >
            Seus dados foram baixados.
          </p>
        ) : null}

        <button
          type="button"
          data-testid="delete-account-open"
          onClick={openDeleteDialog}
          disabled={!enabled || exporting || deleting}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          className="w-full rounded-[18px] border-[3px] border-ink bg-pink px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] disabled:opacity-60"
        >
          Solicitar exclusao de conta
        </button>
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            data-testid="delete-account-dialog"
            className="w-full max-w-md rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[8px_8px_0_#111]"
          >
            <h3
              id={titleId}
              className="font-display text-[22px] font-extrabold text-ink"
            >
              Excluir conta
            </h3>
            <p
              id={descriptionId}
              className="mt-3 text-sm leading-[1.45] text-ink"
            >
              Essa acao apaga a conta e encerra a sessao. Nao da para desfazer.
              Digite DELETE para confirmar.
            </p>

            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              <label
                htmlFor={confirmInputId}
                className="block text-sm font-bold text-ink"
              >
                Confirmacao
              </label>
              <input
                ref={confirmInputRef}
                id={confirmInputId}
                data-testid="delete-account-confirm-input"
                value={confirmText}
                onChange={(event) => {
                  setConfirmText(event.target.value);
                  setConfirmMismatch(false);
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={deleting}
                aria-invalid={confirmMismatch}
                className="mt-2 w-full rounded-[18px] border-[3px] border-ink bg-cream px-4 py-3 text-base text-ink"
              />

            {deleting ? (
              <p
                data-testid="delete-account-loading"
                role="status"
                aria-live="polite"
                className="mt-4 text-sm text-ink"
              >
                Excluindo a conta...
              </p>
            ) : null}

            {confirmMismatch ? (
              <p
                data-testid="delete-account-mismatch"
                role="alert"
                className="mt-4 text-sm text-ink"
              >
                {DELETE_CONFIRM_MISMATCH}
              </p>
            ) : null}

            {deleteError ? (
              <p
                data-testid="delete-account-error"
                role="alert"
                className="mt-4 text-sm text-ink"
              >
                {deleteError}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                data-testid="delete-account-cancel"
                onClick={closeDeleteDialog}
                disabled={deleting}
                className="w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-testid="delete-account-confirm"
                disabled={deleting}
                aria-busy={deleting}
                className="w-full rounded-[18px] border-[3px] border-ink bg-orange px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] disabled:opacity-60"
              >
                Excluir conta
              </button>
            </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
