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
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

type LgpdAccountActionsProps = {
  enabled: boolean;
};

export function LgpdAccountActions({ enabled }: LgpdAccountActionsProps) {
  const { api, logout, expireSession } = useAuth();
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
        expireSession();
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
        expireSession();
        return;
      }
      setDeleteError(cause instanceof ApiError ? cause.message : DELETE_FAILED);
      setDeleting(false);
    }
  }

  return (
    <Card
      data-testid="lgpd-account-section"
      aria-labelledby="lgpd-account-title"
      className="mt-6"
    >
      <CardHeader>
        <CardTitle id="lgpd-account-title" className="text-xl">
          Seus dados
        </CardTitle>
        <CardDescription className="text-foreground">
          Baixe uma cópia dos dados da conta ou exclua a conta de forma
          permanente.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-2">
        <Button
          type="button"
          data-testid="export-data"
          onClick={() => void exportData()}
          disabled={!enabled || exporting || deleting}
          aria-busy={exporting}
          variant="secondary"
          className="w-full"
        >
          Exportar meus dados
        </Button>

        {exporting ? (
          <p
            data-testid="export-data-loading"
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            Exportando seus dados...
          </p>
        ) : null}

        {exportError ? (
          <Alert data-testid="export-data-error" variant="destructive">
            <AlertDescription>{exportError}</AlertDescription>
            <Button
              type="button"
              data-testid="export-data-retry"
              onClick={() => void exportData()}
              disabled={!enabled || exporting || deleting}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              Tentar novamente
            </Button>
          </Alert>
        ) : null}

        {exportSuccess ? (
          <p
            data-testid="export-data-success"
            role="status"
            aria-live="polite"
            className="text-sm"
          >
            Seus dados foram baixados.
          </p>
        ) : null}

        <Button
          type="button"
          data-testid="delete-account-open"
          onClick={openDeleteDialog}
          disabled={!enabled || exporting || deleting}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          variant="destructive"
          className="w-full"
        >
          Solicitar exclusão de conta
        </Button>
      </CardContent>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            data-testid="delete-account-dialog"
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
          >
            <h3 id={titleId} className="font-display text-xl font-semibold">
              Excluir conta
            </h3>
            <p id={descriptionId} className="mt-3 text-sm leading-relaxed">
              Essa ação apaga a conta e encerra a sessão. Não dá para desfazer.
              Digite DELETE para confirmar.
            </p>

            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              <Label htmlFor={confirmInputId} className="block">
                Confirmação
              </Label>
              <Input
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
                className="mt-2"
              />

              {deleting ? (
                <p
                  data-testid="delete-account-loading"
                  role="status"
                  aria-live="polite"
                  className="mt-4 text-sm text-muted-foreground"
                >
                  Excluindo a conta...
                </p>
              ) : null}

              {confirmMismatch ? (
                <p
                  data-testid="delete-account-mismatch"
                  role="alert"
                  className="mt-4 text-sm"
                >
                  {DELETE_CONFIRM_MISMATCH}
                </p>
              ) : null}

              {deleteError ? (
                <p data-testid="delete-account-error" role="alert" className="mt-4 text-sm">
                  {deleteError}
                </p>
              ) : null}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  data-testid="delete-account-cancel"
                  onClick={closeDeleteDialog}
                  disabled={deleting}
                  variant="outline"
                  className="w-full"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  data-testid="delete-account-confirm"
                  disabled={deleting}
                  aria-busy={deleting}
                  variant="destructive"
                  className="w-full"
                >
                  Excluir conta
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
