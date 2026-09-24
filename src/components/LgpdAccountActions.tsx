import { useEffect, useId, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  DELETE_FAILED,
  EXPORT_FAILED,
  triggerJsonDownload,
} from '../api/lgpd';
import { useAuth } from '../auth/AuthContext';

type LgpdAccountActionsProps = {
  enabled: boolean;
};

export function LgpdAccountActions({ enabled }: LgpdAccountActionsProps) {
  const { api, logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) {
        setDialogOpen(false);
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
      const payload = await api.exportMyData();
      triggerJsonDownload(payload);
      setExportSuccess(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
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
    setDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (deleting) {
      return;
    }
    setDialogOpen(false);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!enabled || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteMyAccount();
      logout();
    } catch (cause) {
      if (cause instanceof ApiError && cause.outdated) {
        setDialogOpen(false);
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
          <p
            data-testid="export-data-error"
            role="alert"
            className="text-sm text-ink"
          >
            {exportError}
          </p>
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
            </p>

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
                ref={cancelRef}
                type="button"
                data-testid="delete-account-cancel"
                onClick={closeDeleteDialog}
                disabled={deleting}
                className="w-full rounded-[18px] border-[3px] border-ink bg-paper px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="delete-account-confirm"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                aria-busy={deleting}
                className="w-full rounded-[18px] border-[3px] border-ink bg-orange px-4 py-3 font-display text-sm font-extrabold shadow-[4px_4px_0_#111] disabled:opacity-60"
              >
                Excluir conta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
