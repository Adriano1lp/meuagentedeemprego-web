import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  CV_FORM_EMBEDDINGS_FAILED,
  CV_FORM_LEAVE,
  CV_FORM_NOT_CURRENT,
  CV_FORM_OFFLINE,
  CV_FORM_PREPARING,
  CV_FORM_READY,
  CV_FORM_REPLACE,
  CV_FORM_SAVED_LABEL,
  CV_FORM_STEP_LABELS,
  CV_FORM_STEPS,
  CV_FORM_TOO_LARGE,
  CV_FORM_UNAVAILABLE,
  CV_LIMITS,
  MODALIDADE_OPTIONS,
  NIVEL_FORMACAO_OPTIONS,
  NIVEL_IDIOMA_OPTIONS,
  SENIORIDADE_OPTIONS,
  UF_OPTIONS,
  buildCvPayload,
  createEmptyDraft,
  cvTextLength,
  currentCvMonth,
  emptyCurso,
  emptyExperiencia,
  emptyFormacao,
  emptyIdioma,
  emptyLink,
  fieldDomId,
  fieldErrorFrom422,
  firstFieldError,
  labelOf,
  payloadExceedsLimit,
  pollCvEmbeddings,
  rateLimitMessage,
  validateCvDraft,
  validateCvStep,
  type CvFormDraft,
  type CvFormStep,
  type ExperienciaDraft,
  type FieldError,
  type FormacaoDraft,
} from '../api/structuredCv';
import type {
  CvModalidade,
  CvNivelFormacao,
  CvNivelIdioma,
  CvSenioridade,
  UfCode,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useCvDraftGuard } from './cvForm/useCvDraftGuard';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
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
import { Skeleton } from './ui/skeleton';
import { Textarea } from './ui/textarea';

const controlClass =
  'mt-1.5 flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

type Phase = 'edit' | 'confirm' | 'submitting' | 'preparing' | 'ready' | 'error' | 'embeddings-failed';

export type CvFormWizardProps = {
  mode: 'create' | 'update';
  email: string;
  initialDraft?: CvFormDraft | null;
  replaceOnSave: boolean;
  replacedByFile?: boolean;
  onCancel: () => void;
  onSaved?: () => void;
  onAnalysisReady?: () => void;
  onStatusRefresh?: () => Promise<void>;
};

function errorText(errors: FieldError[], field: string): string | undefined {
  return errors.find((error) => error.field === field)?.message;
}

function FieldErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
      {message}
    </p>
  );
}

function SelectControl({
  id,
  label,
  value,
  disabled,
  error,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  error?: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        data-testid={id}
        className={controlClass}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Selecione</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldErrorText id={id} message={error} />
    </div>
  );
}

function ChoiceDialog({
  testId,
  title,
  message,
  confirmLabel,
  confirmTestId,
  cancelLabel,
  cancelTestId,
  onConfirm,
  onCancel,
}: {
  testId: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmTestId: string;
  cancelLabel: string;
  cancelTestId: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        className="w-full min-w-0 max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <h3 id={`${testId}-title`} className="font-display text-lg font-semibold">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed">{message}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            data-testid={cancelTestId}
            className="w-full"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            data-testid={confirmTestId}
            className="w-full"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CvFormWizard({
  mode,
  email,
  initialDraft,
  replaceOnSave,
  replacedByFile = false,
  onCancel,
  onSaved,
  onAnalysisReady,
  onStatusRefresh,
}: CvFormWizardProps) {
  const { api, expireSession } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<CvFormDraft>(() => initialDraft ?? createEmptyDraft());
  const [step, setStep] = useState<CvFormStep>('basico');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [phase, setPhase] = useState<Phase>('edit');
  const [banner, setBanner] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [closeAsked, setCloseAsked] = useState(false);
  const [cargoInput, setCargoInput] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [softInput, setSoftInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const monthMax = currentCvMonth();
  const guardActive =
    dirty && (phase === 'edit' || phase === 'error' || phase === 'embeddings-failed' || phase === 'confirm');
  const guard = useCvDraftGuard(guardActive);
  const locked = phase === 'submitting' || phase === 'preparing' || phase === 'ready';
  const waiting = retryIn > 0;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (retryIn <= 0) {
      return;
    }
    const timer = setTimeout(() => setRetryIn((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [retryIn]);

  useEffect(() => {
    if (focusField) {
      document.getElementById(focusField)?.focus();
      return;
    }
    document.getElementById('cv-step-title')?.focus();
  }, [step, focusField]);

  function edit(recipe: (current: CvFormDraft) => CvFormDraft) {
    setDraft(recipe);
    setDirty(true);
    setErrors([]);
  }

  function showErrors(next: FieldError[]) {
    const first = firstFieldError(next);
    setErrors(next);
    if (!first) {
      return;
    }
    setStep(first.step);
    setFocusField(fieldDomId(first.field));
  }

  function goNext() {
    const nextErrors = validateCvStep(draft, step);
    if (nextErrors.length > 0) {
      showErrors(nextErrors);
      return;
    }
    const index = CV_FORM_STEPS.indexOf(step);
    const next = CV_FORM_STEPS[index + 1];
    if (!next) {
      return;
    }
    setErrors([]);
    setFocusField(null);
    setStep(next);
  }

  function goBack() {
    const index = CV_FORM_STEPS.indexOf(step);
    const previous = CV_FORM_STEPS[index - 1];
    if (!previous) {
      requestClose();
      return;
    }
    setErrors([]);
    setFocusField(null);
    setStep(previous);
  }

  function requestClose() {
    if (guardActive) {
      setCloseAsked(true);
      return;
    }
    onCancel();
  }

  function stayHere() {
    guard.stay();
    setCloseAsked(false);
  }

  function confirmLeave() {
    const href = guard.pendingHref ? guard.takeLeave() : 'cancel';
    setDirty(false);
    setCloseAsked(false);
    if (href && href !== 'back' && href !== 'cancel') {
      navigate(href);
      return;
    }
    onCancel();
    if (href === 'back') {
      window.history.back();
    }
  }

  async function persist() {
    if (locked || waiting) {
      return;
    }
    const payload = buildCvPayload(draft);
    if (payloadExceedsLimit(payload)) {
      setBanner(CV_FORM_TOO_LARGE);
      setPhase('error');
      return;
    }
    setPhase('submitting');
    setBanner(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      let result =
        mode === 'update' ? await api.updateStructuredCv(payload) : null;
      if (mode === 'create') {
        try {
          result = await api.createStructuredCv(payload);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            result = await api.updateStructuredCv(payload);
          } else {
            throw error;
          }
        }
      }
      if (controller.signal.aborted || !result) {
        return;
      }
      setDirty(false);
      onSaved?.();
      setPhase('preparing');
      if (result.ready_for_analysis || result.has_embeddings) {
        try {
          await onStatusRefresh?.();
        } catch {
          // O currículo já foi salvo. Falha ao recarregar o status não apaga o rascunho.
        }
        if (controller.signal.aborted) {
          return;
        }
        setPhase('ready');
        onAnalysisReady?.();
        return;
      }
      let ready = false;
      try {
        ready = await pollCvEmbeddings(() => api.getStatus(), {
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        setPhase('embeddings-failed');
        setBanner(CV_FORM_EMBEDDINGS_FAILED);
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      if (ready) {
        try {
          await onStatusRefresh?.();
        } catch {
          // idem
        }
        setPhase('ready');
        onAnalysisReady?.();
        return;
      }
      setPhase('embeddings-failed');
      setBanner(CV_FORM_EMBEDDINGS_FAILED);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      if (error instanceof ApiError && error.outdated) {
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        expireSession();
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        showErrors([fieldErrorFrom422(error.body)]);
        setPhase('edit');
        setDirty(true);
        return;
      }
      if (error instanceof ApiError && error.status === 429) {
        const wait = error.retryAfterSeconds ?? 0;
        setRetryIn(wait);
        setBanner(rateLimitMessage(wait));
        setPhase('error');
        setDirty(true);
        return;
      }
      const status = error instanceof ApiError ? error.status : 0;
      setBanner(
        status === 0
          ? CV_FORM_OFFLINE
          : status === 413
            ? CV_FORM_TOO_LARGE
            : CV_FORM_UNAVAILABLE,
      );
      setPhase('error');
      setDirty(true);
    }
  }

  async function retryEmbeddings() {
    setPhase('preparing');
    setBanner(null);
    try {
      const ready = await pollCvEmbeddings(() => api.getStatus());
      if (ready) {
        try {
          await onStatusRefresh?.();
        } catch {
          // idem
        }
        setPhase('ready');
        onAnalysisReady?.();
        return;
      }
      setPhase('embeddings-failed');
      setBanner(CV_FORM_EMBEDDINGS_FAILED);
    } catch {
      setPhase('embeddings-failed');
      setBanner(CV_FORM_OFFLINE);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (locked || waiting) {
      return;
    }
    if (step !== 'revisao') {
      goNext();
      return;
    }
    const nextErrors = validateCvDraft(draft);
    if (nextErrors.length > 0) {
      showErrors(nextErrors);
      return;
    }
    if (replaceOnSave) {
      setPhase('confirm');
      return;
    }
    void persist();
  }

  function addToList(
    field: 'cargosAlvo' | 'habilidadesTecnicas' | 'habilidadesComportamentais',
    value: string,
    max: number,
    clear: () => void,
  ) {
    const text = value.trim();
    if (!text) {
      return;
    }
    edit((current) => {
      if (current[field].length >= max) {
        return current;
      }
      return { ...current, [field]: [...current[field], text] };
    });
    clear();
  }

  const stepIndex = CV_FORM_STEPS.indexOf(step);
  const savedVisible =
    phase === 'preparing' || phase === 'ready' || phase === 'embeddings-failed';

  return (
    <Card data-testid="cv-form" data-cv-phase={phase} className="mt-6 min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Currículo pelo formulário</CardTitle>
        <CardDescription>
          Passo {stepIndex + 1} de {CV_FORM_STEPS.length}. Os dados ficam só nesta tela até você salvar.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <ol aria-label="Passos do currículo" className="flex flex-wrap gap-2">
          {CV_FORM_STEPS.map((item, index) => (
            <li key={item}>
              <button
                type="button"
                className="rounded-full border border-border px-2.5 py-1 text-xs disabled:opacity-50"
                aria-current={item === step ? 'step' : undefined}
                disabled={locked || index > stepIndex}
                onClick={() => {
                  if (index < stepIndex) {
                    setFocusField(null);
                    setStep(item);
                  }
                }}
              >
                {CV_FORM_STEP_LABELS[item]}
              </button>
            </li>
          ))}
        </ol>

        {replacedByFile ? (
          <Alert data-testid="cv-not-current" variant="warning" className="mt-4">
            <AlertDescription>{CV_FORM_NOT_CURRENT}</AlertDescription>
          </Alert>
        ) : null}

        {savedVisible ? (
          <Alert
            data-testid={phase === 'ready' ? 'cv-form-ready' : 'cv-form-preparing'}
            role="status"
            variant={phase === 'ready' ? 'success' : 'default'}
            className="mt-4"
          >
            <AlertTitle data-testid="cv-form-saved-label">{CV_FORM_SAVED_LABEL}</AlertTitle>
            <AlertDescription className="mt-1">
              {phase === 'ready' ? CV_FORM_READY : phase === 'preparing' ? CV_FORM_PREPARING : banner}
            </AlertDescription>
            {phase === 'embeddings-failed' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                data-testid="cv-form-retry"
                onClick={() => void retryEmbeddings()}
              >
                Tentar de novo
              </Button>
            ) : null}
            {phase === 'ready' ? (
              <Button
                type="button"
                className="mt-3"
                data-testid="cv-form-done"
                onClick={onCancel}
              >
                Continuar
              </Button>
            ) : null}
          </Alert>
        ) : null}

        {phase === 'error' && banner ? (
          <Alert data-testid="cv-form-error" variant="destructive" className="mt-4">
            <AlertDescription>{waiting ? rateLimitMessage(retryIn) : banner}</AlertDescription>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              data-testid="cv-form-retry"
              disabled={waiting || locked}
              onClick={() => void persist()}
            >
              Tentar de novo
            </Button>
          </Alert>
        ) : null}

        {phase === 'preparing' || phase === 'ready' ? null : (
          <form className="mt-5 min-w-0" onSubmit={handleSubmit}>
            <h2
              id="cv-step-title"
              tabIndex={-1}
              data-testid="cv-form-step"
              data-step={step}
              className="font-display text-xl font-semibold outline-none"
            >
              {CV_FORM_STEP_LABELS[step]}
            </h2>

            {step === 'basico' ? (
              <BasicStep
                draft={draft}
                email={email}
                errors={errors}
                disabled={locked}
                cargoInput={cargoInput}
                onCargoInput={setCargoInput}
                onAddCargo={() =>
                  addToList('cargosAlvo', cargoInput, CV_LIMITS.cargosMax, () => setCargoInput(''))
                }
                onEdit={edit}
              />
            ) : null}
            {step === 'resumo' ? (
              <ResumoStep draft={draft} errors={errors} disabled={locked} onEdit={edit} />
            ) : null}
            {step === 'experiencias' ? (
              <ExperienciasStep
                draft={draft}
                errors={errors}
                disabled={locked}
                monthMax={monthMax}
                onEdit={edit}
              />
            ) : null}
            {step === 'formacao' ? (
              <FormacaoStep
                draft={draft}
                errors={errors}
                disabled={locked}
                monthMax={monthMax}
                onEdit={edit}
              />
            ) : null}
            {step === 'cursos' ? (
              <CursosStep
                draft={draft}
                errors={errors}
                disabled={locked}
                monthMax={monthMax}
                onEdit={edit}
              />
            ) : null}
            {step === 'habilidades' ? (
              <HabilidadesStep
                draft={draft}
                errors={errors}
                disabled={locked}
                skillInput={skillInput}
                softInput={softInput}
                onSkillInput={setSkillInput}
                onSoftInput={setSoftInput}
                onAddSkill={() =>
                  addToList(
                    'habilidadesTecnicas',
                    skillInput,
                    CV_LIMITS.habilidadesTecnicasMax,
                    () => setSkillInput(''),
                  )
                }
                onAddSoft={() =>
                  addToList(
                    'habilidadesComportamentais',
                    softInput,
                    CV_LIMITS.habilidadesComportamentaisMax,
                    () => setSoftInput(''),
                  )
                }
                onEdit={edit}
              />
            ) : null}
            {step === 'idiomas' ? (
              <IdiomasStep draft={draft} errors={errors} disabled={locked} onEdit={edit} />
            ) : null}
            {step === 'links' ? (
              <LinksStep draft={draft} errors={errors} disabled={locked} onEdit={edit} />
            ) : null}
            {step === 'revisao' ? (
              <ReviewStep draft={draft} email={email} errors={errors} disabled={locked} onEdit={edit} />
            ) : null}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                data-testid="cv-form-back"
                className="w-full"
                disabled={locked}
                onClick={goBack}
              >
                Voltar
              </Button>
              {step === 'revisao' ? (
                <Button
                  type="submit"
                  data-testid="cv-form-submit"
                  className="w-full"
                  disabled={locked || waiting}
                  aria-busy={phase === 'submitting'}
                >
                  {phase === 'submitting' ? 'Salvando…' : 'Salvar currículo'}
                </Button>
              ) : (
                <Button
                  type="button"
                  data-testid="cv-form-next"
                  className="w-full"
                  disabled={locked}
                  onClick={goNext}
                >
                  Continuar
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>

      {phase === 'confirm' ? (
        <ChoiceDialog
          testId="cv-replace-dialog"
          title="Substituir currículo"
          message={CV_FORM_REPLACE}
          confirmLabel="Substituir"
          confirmTestId="cv-replace-confirm"
          cancelLabel="Voltar"
          cancelTestId="cv-replace-cancel"
          onCancel={() => setPhase('edit')}
          onConfirm={() => void persist()}
        />
      ) : null}

      {guard.message || closeAsked ? (
        <ChoiceDialog
          testId="cv-leave-dialog"
          title="Sair sem salvar?"
          message={CV_FORM_LEAVE}
          confirmLabel="Sair mesmo assim"
          confirmTestId="cv-leave-confirm"
          cancelLabel="Continuar editando"
          cancelTestId="cv-leave-stay"
          onCancel={stayHere}
          onConfirm={confirmLeave}
        />
      ) : null}
    </Card>
  );
}

function BasicStep({
  draft,
  email,
  errors,
  disabled,
  cargoInput,
  onCargoInput,
  onAddCargo,
  onEdit,
}: {
  draft: CvFormDraft;
  email: string;
  errors: FieldError[];
  disabled: boolean;
  cargoInput: string;
  onCargoInput: (value: string) => void;
  onAddCargo: () => void;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  const nomeError = errorText(errors, 'nome');
  const cidadeError = errorText(errors, 'cidade');
  const telefoneError = errorText(errors, 'telefone');
  const cargosError = errorText(errors, 'cargos_alvo');
  return (
    <div className="mt-4 grid gap-4">
      <div className="min-w-0">
        <Label htmlFor="cv-nome">Nome</Label>
        <Input
          id="cv-nome"
          data-testid="cv-nome"
          className="mt-1.5"
          autoComplete="name"
          value={draft.nome}
          disabled={disabled}
          aria-invalid={nomeError ? true : undefined}
          aria-describedby={nomeError ? 'cv-nome-error' : undefined}
          onChange={(event) => onEdit((current) => ({ ...current, nome: event.target.value }))}
        />
        <FieldErrorText id="cv-nome" message={nomeError} />
      </div>
      <div className="min-w-0">
        <Label htmlFor="cv-email">E-mail da conta</Label>
        <Input
          id="cv-email"
          data-testid="cv-email"
          className="mt-1.5"
          value={email}
          readOnly
          aria-readonly="true"
          disabled
        />
        <p className="mt-1 text-sm text-muted-foreground">
          Este e-mail vem da sua conta e não entra no envio.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor="cv-cidade">Cidade</Label>
          <Input
            id="cv-cidade"
            data-testid="cv-cidade"
            className="mt-1.5"
            autoComplete="address-level2"
            value={draft.cidade}
            disabled={disabled}
            aria-invalid={cidadeError ? true : undefined}
            aria-describedby={cidadeError ? 'cv-cidade-error' : undefined}
            onChange={(event) =>
              onEdit((current) => ({ ...current, cidade: event.target.value }))
            }
          />
          <FieldErrorText id="cv-cidade" message={cidadeError} />
        </div>
        <SelectControl
          id="cv-uf"
          label="UF"
          value={draft.uf}
          disabled={disabled}
          error={errorText(errors, 'uf')}
          options={UF_OPTIONS}
          onChange={(value) => onEdit((current) => ({ ...current, uf: value as UfCode | '' }))}
        />
      </div>
      <SelectControl
        id="cv-modalidade"
        label="Modalidade"
        value={draft.modalidade}
        disabled={disabled}
        error={errorText(errors, 'modalidade')}
        options={MODALIDADE_OPTIONS}
        onChange={(value) =>
          onEdit((current) => ({ ...current, modalidade: value as CvModalidade | '' }))
        }
      />
      <div className="min-w-0">
        <Label htmlFor="cv-telefone">Telefone (opcional)</Label>
        <Input
          id="cv-telefone"
          data-testid="cv-telefone"
          className="mt-1.5"
          inputMode="numeric"
          autoComplete="tel"
          value={draft.telefone}
          disabled={disabled}
          aria-invalid={telefoneError ? true : undefined}
          aria-describedby={telefoneError ? 'cv-telefone-error' : 'cv-telefone-hint'}
          onChange={(event) =>
            onEdit((current) => ({ ...current, telefone: event.target.value }))
          }
        />
        <p id="cv-telefone-hint" className="mt-1 text-sm text-muted-foreground">
          DDD e número, de 10 a 13 dígitos.
        </p>
        <FieldErrorText id="cv-telefone" message={telefoneError} />
      </div>
      <div className="min-w-0">
        <Label htmlFor="cv-cargos-alvo">Cargos-alvo</Label>
        <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
          <Input
            id="cv-cargos-alvo"
            data-testid="cv-cargos-alvo"
            value={cargoInput}
            disabled={disabled || draft.cargosAlvo.length >= CV_LIMITS.cargosMax}
            aria-invalid={cargosError ? true : undefined}
            aria-describedby={cargosError ? 'cv-cargos-alvo-error' : undefined}
            onChange={(event) => onCargoInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAddCargo();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            data-testid="cv-cargo-add"
            disabled={disabled || draft.cargosAlvo.length >= CV_LIMITS.cargosMax}
            onClick={onAddCargo}
          >
            Adicionar
          </Button>
        </div>
        <ul className="mt-2 flex flex-wrap gap-2">
          {draft.cargosAlvo.map((item, index) => (
            <li key={`${item}-${index}`} className="max-w-full min-w-0">
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm">
                <span data-testid={`cv-cargo-${index}`} className="min-w-0 break-words">
                  {item}
                </span>
                <button
                  type="button"
                  className="shrink-0 px-1"
                  aria-label={`Remover cargo ${item}`}
                  data-testid={`cv-cargo-remove-${index}`}
                  disabled={disabled}
                  onClick={() =>
                    onEdit((current) => ({
                      ...current,
                      cargosAlvo: current.cargosAlvo.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-sm text-muted-foreground">De 1 a 3 cargos.</p>
        <FieldErrorText id="cv-cargos-alvo" message={cargosError} />
      </div>
      <SelectControl
        id="cv-senioridade"
        label="Senioridade"
        value={draft.senioridade}
        disabled={disabled}
        error={errorText(errors, 'senioridade')}
        options={SENIORIDADE_OPTIONS}
        onChange={(value) =>
          onEdit((current) => ({ ...current, senioridade: value as CvSenioridade | '' }))
        }
      />
    </div>
  );
}

function ResumoStep({
  draft,
  errors,
  disabled,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  const message = errorText(errors, 'resumo');
  const length = cvTextLength(draft.resumo, true);
  return (
    <div className="mt-4 min-w-0">
      <Label htmlFor="cv-resumo">Resumo</Label>
      <Textarea
        id="cv-resumo"
        data-testid="cv-resumo"
        className="mt-1.5 min-h-40"
        value={draft.resumo}
        disabled={disabled}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? 'cv-resumo-error cv-resumo-count' : 'cv-resumo-count'}
        onChange={(event) => onEdit((current) => ({ ...current, resumo: event.target.value }))}
      />
      <p id="cv-resumo-count" data-testid="cv-resumo-count" className="mt-1 text-sm text-muted-foreground">
        {length} de {CV_LIMITS.resumoMax} caracteres. Mínimo de {CV_LIMITS.resumoMin}.
      </p>
      <FieldErrorText id="cv-resumo" message={message} />
    </div>
  );
}

function ExperienciasStep({
  draft,
  errors,
  disabled,
  monthMax,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  monthMax: string;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  const primeiroError = errorText(errors, 'primeiro_emprego');
  function patch(index: number, recipe: (item: ExperienciaDraft) => ExperienciaDraft) {
    onEdit((current) => ({
      ...current,
      experiencias: current.experiencias.map((item, itemIndex) =>
        itemIndex === index ? recipe(item) : item,
      ),
    }));
  }
  return (
    <div className="mt-4 grid gap-4">
      <label className="flex min-w-0 items-start gap-2 text-sm">
        <input
          id="cv-primeiro-emprego"
          data-testid="cv-primeiro-emprego"
          type="checkbox"
          className="legal-checkbox"
          checked={draft.primeiroEmprego}
          disabled={disabled}
          aria-invalid={primeiroError ? true : undefined}
          aria-describedby={primeiroError ? 'cv-primeiro-emprego-error' : undefined}
          onChange={(event) =>
            onEdit((current) => ({ ...current, primeiroEmprego: event.target.checked }))
          }
        />
        <span>Este é meu primeiro emprego</span>
      </label>
      <FieldErrorText id="cv-primeiro-emprego" message={primeiroError} />
      {draft.primeiroEmprego ? (
        <p className="text-sm text-muted-foreground">
          Sem experiências por enquanto. Você pode desmarcar e incluir uma depois.
        </p>
      ) : (
        <>
          {draft.experiencias.map((item, index) => (
            <ExperienciaCard
              key={item.key}
              item={item}
              index={index}
              errors={errors}
              disabled={disabled}
              monthMax={monthMax}
              onPatch={(recipe) => patch(index, recipe)}
              onRemove={() =>
                onEdit((current) => ({
                  ...current,
                  experiencias: current.experiencias.filter((_, itemIndex) => itemIndex !== index),
                }))
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            data-testid="cv-exp-add"
            disabled={disabled || draft.experiencias.length >= CV_LIMITS.experienciasMax}
            onClick={() =>
              onEdit((current) => ({
                ...current,
                experiencias: [...current.experiencias, emptyExperiencia()],
              }))
            }
          >
            Adicionar experiência
          </Button>
        </>
      )}
    </div>
  );
}

function ExperienciaCard({
  item,
  index,
  errors,
  disabled,
  monthMax,
  onPatch,
  onRemove,
}: {
  item: ExperienciaDraft;
  index: number;
  errors: FieldError[];
  disabled: boolean;
  monthMax: string;
  onPatch: (recipe: (item: ExperienciaDraft) => ExperienciaDraft) => void;
  onRemove: () => void;
}) {
  const prefix = `experiencias.${index}`;
  const [realizacao, setRealizacao] = useState('');
  const [tecnologia, setTecnologia] = useState('');
  const cargoId = fieldDomId(`${prefix}.cargo`);
  const empresaId = fieldDomId(`${prefix}.empresa`);
  const inicioId = fieldDomId(`${prefix}.inicio`);
  const fimId = fieldDomId(`${prefix}.fim`);
  const realizacoesId = fieldDomId(`${prefix}.realizacoes`);
  return (
    <fieldset className="min-w-0 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Experiência {index + 1}</legend>
      <div className="grid gap-3">
        <div className="min-w-0">
          <Label htmlFor={cargoId}>Cargo</Label>
          <Input
            id={cargoId}
            data-testid={`cv-exp-${index}-cargo`}
            className="mt-1.5"
            value={item.cargo}
            disabled={disabled}
            aria-invalid={errorText(errors, `${prefix}.cargo`) ? true : undefined}
            aria-describedby={
              errorText(errors, `${prefix}.cargo`) ? `${cargoId}-error` : undefined
            }
            onChange={(event) => onPatch((current) => ({ ...current, cargo: event.target.value }))}
          />
          <FieldErrorText id={cargoId} message={errorText(errors, `${prefix}.cargo`)} />
        </div>
        <div className="min-w-0">
          <Label htmlFor={empresaId}>Empresa</Label>
          <Input
            id={empresaId}
            data-testid={`cv-exp-${index}-empresa`}
            className="mt-1.5"
            value={item.empresa}
            disabled={disabled}
            aria-invalid={errorText(errors, `${prefix}.empresa`) ? true : undefined}
            aria-describedby={
              errorText(errors, `${prefix}.empresa`) ? `${empresaId}-error` : undefined
            }
            onChange={(event) =>
              onPatch((current) => ({ ...current, empresa: event.target.value }))
            }
          />
          <FieldErrorText id={empresaId} message={errorText(errors, `${prefix}.empresa`)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor={inicioId}>Início</Label>
            <Input
              id={inicioId}
              data-testid={`cv-exp-${index}-inicio`}
              className="mt-1.5"
              type="month"
              min={CV_LIMITS.monthMin}
              max={monthMax}
              value={item.inicio}
              disabled={disabled}
              aria-invalid={errorText(errors, `${prefix}.inicio`) ? true : undefined}
              aria-describedby={
                errorText(errors, `${prefix}.inicio`) ? `${inicioId}-error` : undefined
              }
              onChange={(event) =>
                onPatch((current) => ({ ...current, inicio: event.target.value }))
              }
            />
            <FieldErrorText id={inicioId} message={errorText(errors, `${prefix}.inicio`)} />
          </div>
          <div className="min-w-0">
            <Label htmlFor={fimId}>Fim</Label>
            <Input
              id={fimId}
              data-testid={`cv-exp-${index}-fim`}
              className="mt-1.5"
              type="month"
              min={CV_LIMITS.monthMin}
              max={monthMax}
              value={item.fim}
              disabled={disabled || item.atual}
              aria-invalid={errorText(errors, `${prefix}.fim`) ? true : undefined}
              aria-describedby={errorText(errors, `${prefix}.fim`) ? `${fimId}-error` : undefined}
              onChange={(event) => onPatch((current) => ({ ...current, fim: event.target.value }))}
            />
            <FieldErrorText id={fimId} message={errorText(errors, `${prefix}.fim`)} />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            data-testid={`cv-exp-${index}-atual`}
            type="checkbox"
            className="legal-checkbox"
            checked={item.atual}
            disabled={disabled}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                atual: event.target.checked,
                fim: event.target.checked ? '' : current.fim,
              }))
            }
          />
          <span>Cargo atual</span>
        </label>
        <div className="min-w-0">
          <Label htmlFor={`${realizacoesId}-input`}>Realizações</Label>
          <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              id={`${realizacoesId}-input`}
              data-testid={`cv-exp-${index}-realizacao-input`}
              value={realizacao}
              disabled={disabled || item.realizacoes.filter((linha) => linha.trim()).length >= CV_LIMITS.realizacoesMax}
              aria-invalid={errorText(errors, `${prefix}.realizacoes`) ? true : undefined}
              aria-describedby={
                errorText(errors, `${prefix}.realizacoes`) ? `${realizacoesId}-error` : undefined
              }
              onChange={(event) => setRealizacao(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!realizacao.trim()) {
                    return;
                  }
                  onPatch((current) => ({
                    ...current,
                    realizacoes: [...current.realizacoes.filter((linha) => linha.trim()), realizacao],
                  }));
                  setRealizacao('');
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              data-testid={`cv-exp-${index}-realizacao-add`}
              disabled={disabled}
              onClick={() => {
                if (!realizacao.trim()) {
                  return;
                }
                onPatch((current) => ({
                  ...current,
                  realizacoes: [...current.realizacoes.filter((linha) => linha.trim()), realizacao],
                }));
                setRealizacao('');
              }}
            >
              Adicionar
            </Button>
          </div>
          <ul className="mt-2 grid gap-1">
            {item.realizacoes.filter((linha) => linha.trim()).map((linha, linhaIndex) => (
              <li key={`${linha}-${linhaIndex}`} className="flex min-w-0 items-start justify-between gap-2 text-sm">
                <span className="min-w-0 break-words" data-testid={`cv-exp-${index}-realizacao-${linhaIndex}`}>
                  {linha}
                </span>
                <button
                  type="button"
                  className="shrink-0"
                  aria-label={`Remover realização ${linhaIndex + 1}`}
                  disabled={disabled}
                  onClick={() =>
                    onPatch((current) => ({
                      ...current,
                      realizacoes: current.realizacoes
                        .filter((value) => value.trim())
                        .filter((_, valueIndex) => valueIndex !== linhaIndex),
                    }))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-muted-foreground">De 2 a 6 realizações.</p>
          <FieldErrorText id={realizacoesId} message={errorText(errors, `${prefix}.realizacoes`)} />
        </div>
        <div className="min-w-0">
          <Label htmlFor={`cv-exp-${index}-tecnologia-input`}>Tecnologias (opcional)</Label>
          <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              id={`cv-exp-${index}-tecnologia-input`}
              data-testid={`cv-exp-${index}-tecnologia-input`}
              value={tecnologia}
              disabled={disabled || item.tecnologias.length >= CV_LIMITS.tecnologiasMax}
              onChange={(event) => setTecnologia(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!tecnologia.trim() || item.tecnologias.length >= CV_LIMITS.tecnologiasMax) {
                    return;
                  }
                  onPatch((current) => ({
                    ...current,
                    tecnologias: [...current.tecnologias, tecnologia],
                  }));
                  setTecnologia('');
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              data-testid={`cv-exp-${index}-tecnologia-add`}
              disabled={disabled}
              onClick={() => {
                if (!tecnologia.trim() || item.tecnologias.length >= CV_LIMITS.tecnologiasMax) {
                  return;
                }
                onPatch((current) => ({
                  ...current,
                  tecnologias: [...current.tecnologias, tecnologia],
                }));
                setTecnologia('');
              }}
            >
              Adicionar
            </Button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {item.tecnologias.map((tech, techIndex) => (
              <li key={`${tech}-${techIndex}`} className="max-w-full text-sm break-words">
                {tech}
                <button
                  type="button"
                  className="ml-1"
                  aria-label={`Remover tecnologia ${tech}`}
                  disabled={disabled}
                  onClick={() =>
                    onPatch((current) => ({
                      ...current,
                      tecnologias: current.tecnologias.filter((_, techItem) => techItem !== techIndex),
                    }))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <Button type="button" variant="ghost" disabled={disabled} onClick={onRemove}>
          Remover experiência
        </Button>
      </div>
    </fieldset>
  );
}

function FormacaoStep({
  draft,
  errors,
  disabled,
  monthMax,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  monthMax: string;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  function patch(index: number, recipe: (item: FormacaoDraft) => FormacaoDraft) {
    onEdit((current) => ({
      ...current,
      formacoes: current.formacoes.map((item, itemIndex) =>
        itemIndex === index ? recipe(item) : item,
      ),
    }));
  }
  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm text-muted-foreground">Opcional. Inclua só o que quiser mostrar.</p>
      {draft.formacoes.map((item, index) => {
        const prefix = `formacoes.${index}`;
        const cursoId = fieldDomId(`${prefix}.curso`);
        const instituicaoId = fieldDomId(`${prefix}.instituicao`);
        const conclusaoId = fieldDomId(`${prefix}.conclusao`);
        return (
          <fieldset key={item.key} className="min-w-0 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Formação {index + 1}</legend>
            <div className="grid gap-3">
              <div className="min-w-0">
                <Label htmlFor={cursoId}>Curso</Label>
                <Input
                  id={cursoId}
                  data-testid={`cv-formacao-${index}-curso`}
                  className="mt-1.5"
                  value={item.curso}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `${prefix}.curso`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `${prefix}.curso`) ? `${cursoId}-error` : undefined
                  }
                  onChange={(event) =>
                    patch(index, (current) => ({ ...current, curso: event.target.value }))
                  }
                />
                <FieldErrorText id={cursoId} message={errorText(errors, `${prefix}.curso`)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={instituicaoId}>Instituição</Label>
                <Input
                  id={instituicaoId}
                  data-testid={`cv-formacao-${index}-instituicao`}
                  className="mt-1.5"
                  value={item.instituicao}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `${prefix}.instituicao`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `${prefix}.instituicao`) ? `${instituicaoId}-error` : undefined
                  }
                  onChange={(event) =>
                    patch(index, (current) => ({ ...current, instituicao: event.target.value }))
                  }
                />
                <FieldErrorText
                  id={instituicaoId}
                  message={errorText(errors, `${prefix}.instituicao`)}
                />
              </div>
              <SelectControl
                id={fieldDomId(`${prefix}.nivel`)}
                label="Nível"
                value={item.nivel}
                disabled={disabled}
                error={errorText(errors, `${prefix}.nivel`)}
                options={NIVEL_FORMACAO_OPTIONS}
                onChange={(value) =>
                  patch(index, (current) => ({
                    ...current,
                    nivel: value as CvNivelFormacao | '',
                  }))
                }
              />
              <div className="min-w-0">
                <Label htmlFor={conclusaoId}>Conclusão</Label>
                <Input
                  id={conclusaoId}
                  data-testid={`cv-formacao-${index}-conclusao`}
                  className="mt-1.5"
                  type="month"
                  min={CV_LIMITS.monthMin}
                  max={monthMax}
                  value={item.conclusao}
                  disabled={disabled || item.emAndamento}
                  aria-invalid={errorText(errors, `${prefix}.conclusao`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `${prefix}.conclusao`) ? `${conclusaoId}-error` : undefined
                  }
                  onChange={(event) =>
                    patch(index, (current) => ({ ...current, conclusao: event.target.value }))
                  }
                />
                <FieldErrorText
                  id={conclusaoId}
                  message={errorText(errors, `${prefix}.conclusao`)}
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  data-testid={`cv-formacao-${index}-andamento`}
                  type="checkbox"
                  className="legal-checkbox"
                  checked={item.emAndamento}
                  disabled={disabled}
                  onChange={(event) =>
                    patch(index, (current) => ({
                      ...current,
                      emAndamento: event.target.checked,
                      conclusao: event.target.checked ? '' : current.conclusao,
                    }))
                  }
                />
                <span>Em andamento</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onEdit((current) => ({
                    ...current,
                    formacoes: current.formacoes.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              >
                Remover formação
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        data-testid="cv-formacao-add"
        disabled={disabled || draft.formacoes.length >= CV_LIMITS.formacoesMax}
        onClick={() =>
          onEdit((current) => ({ ...current, formacoes: [...current.formacoes, emptyFormacao()] }))
        }
      >
        Adicionar formação
      </Button>
    </div>
  );
}

function CursosStep({
  draft,
  errors,
  disabled,
  monthMax,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  monthMax: string;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm text-muted-foreground">Opcional.</p>
      {draft.cursos.map((item, index) => {
        const prefix = `cursos.${index}`;
        const nomeId = fieldDomId(`${prefix}.nome`);
        const cargaId = fieldDomId(`${prefix}.carga_horaria_h`);
        const anoId = fieldDomId(`${prefix}.ano_mes`);
        return (
          <fieldset key={item.key} className="min-w-0 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Curso {index + 1}</legend>
            <div className="grid gap-3">
              <div className="min-w-0">
                <Label htmlFor={nomeId}>Nome</Label>
                <Input
                  id={nomeId}
                  data-testid={`cv-curso-${index}-nome`}
                  className="mt-1.5"
                  value={item.nome}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `${prefix}.nome`) ? true : undefined}
                  aria-describedby={errorText(errors, `${prefix}.nome`) ? `${nomeId}-error` : undefined}
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      cursos: current.cursos.map((curso, cursoIndex) =>
                        cursoIndex === index ? { ...curso, nome: event.target.value } : curso,
                      ),
                    }))
                  }
                />
                <FieldErrorText id={nomeId} message={errorText(errors, `${prefix}.nome`)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`cv-curso-${index}-instituicao`}>Instituição (opcional)</Label>
                <Input
                  id={`cv-curso-${index}-instituicao`}
                  data-testid={`cv-curso-${index}-instituicao`}
                  className="mt-1.5"
                  value={item.instituicao}
                  disabled={disabled}
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      cursos: current.cursos.map((curso, cursoIndex) =>
                        cursoIndex === index
                          ? { ...curso, instituicao: event.target.value }
                          : curso,
                      ),
                    }))
                  }
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor={anoId}>Mês (opcional)</Label>
                <Input
                  id={anoId}
                  data-testid={`cv-curso-${index}-ano`}
                  className="mt-1.5"
                  type="month"
                  min={CV_LIMITS.monthMin}
                  max={monthMax}
                  value={item.anoMes}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `${prefix}.ano_mes`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `${prefix}.ano_mes`) ? `${anoId}-error` : undefined
                  }
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      cursos: current.cursos.map((curso, cursoIndex) =>
                        cursoIndex === index ? { ...curso, anoMes: event.target.value } : curso,
                      ),
                    }))
                  }
                />
                <FieldErrorText id={anoId} message={errorText(errors, `${prefix}.ano_mes`)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={cargaId}>Carga horária (opcional)</Label>
                <Input
                  id={cargaId}
                  data-testid={`cv-curso-${index}-carga`}
                  className="mt-1.5"
                  inputMode="numeric"
                  value={item.cargaHoraria}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `${prefix}.carga_horaria_h`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `${prefix}.carga_horaria_h`) ? `${cargaId}-error` : undefined
                  }
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      cursos: current.cursos.map((curso, cursoIndex) =>
                        cursoIndex === index
                          ? { ...curso, cargaHoraria: event.target.value }
                          : curso,
                      ),
                    }))
                  }
                />
                <FieldErrorText
                  id={cargaId}
                  message={errorText(errors, `${prefix}.carga_horaria_h`)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onEdit((current) => ({
                    ...current,
                    cursos: current.cursos.filter((_, cursoIndex) => cursoIndex !== index),
                  }))
                }
              >
                Remover curso
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        data-testid="cv-curso-add"
        disabled={disabled || draft.cursos.length >= CV_LIMITS.cursosMax}
        onClick={() =>
          onEdit((current) => ({ ...current, cursos: [...current.cursos, emptyCurso()] }))
        }
      >
        Adicionar curso
      </Button>
    </div>
  );
}

function SkillEditor({
  id,
  label,
  hint,
  items,
  value,
  error,
  disabled,
  addTestId,
  onChange,
  onAdd,
  onRemove,
}: {
  id: string;
  label: string;
  hint: string;
  items: string[];
  value: string;
  error?: string;
  disabled: boolean;
  addTestId: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          data-testid={id}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
        />
        <Button type="button" variant="outline" data-testid={addTestId} disabled={disabled} onClick={onAdd}>
          Adicionar
        </Button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="max-w-full min-w-0 text-sm">
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
              <span className="min-w-0 break-words">{item}</span>
              <button
                type="button"
                aria-label={`Remover ${item}`}
                disabled={disabled}
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      <FieldErrorText id={id} message={error} />
    </div>
  );
}

function HabilidadesStep({
  draft,
  errors,
  disabled,
  skillInput,
  softInput,
  onSkillInput,
  onSoftInput,
  onAddSkill,
  onAddSoft,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  skillInput: string;
  softInput: string;
  onSkillInput: (value: string) => void;
  onSoftInput: (value: string) => void;
  onAddSkill: () => void;
  onAddSoft: () => void;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  return (
    <div className="mt-4 grid gap-4">
      <SkillEditor
        id="cv-habilidades-tecnicas"
        label="Habilidades técnicas"
        hint="De 3 a 30."
        items={draft.habilidadesTecnicas}
        value={skillInput}
        error={errorText(errors, 'habilidades_tecnicas')}
        disabled={disabled || draft.habilidadesTecnicas.length >= CV_LIMITS.habilidadesTecnicasMax}
        addTestId="cv-skill-add"
        onChange={onSkillInput}
        onAdd={onAddSkill}
        onRemove={(index) =>
          onEdit((current) => ({
            ...current,
            habilidadesTecnicas: current.habilidadesTecnicas.filter((_, itemIndex) => itemIndex !== index),
          }))
        }
      />
      <SkillEditor
        id="cv-habilidades-comportamentais"
        label="Habilidades comportamentais (opcional)"
        hint="Até 10."
        items={draft.habilidadesComportamentais}
        value={softInput}
        error={errorText(errors, 'habilidades_comportamentais')}
        disabled={
          disabled ||
          draft.habilidadesComportamentais.length >= CV_LIMITS.habilidadesComportamentaisMax
        }
        addTestId="cv-soft-add"
        onChange={onSoftInput}
        onAdd={onAddSoft}
        onRemove={(index) =>
          onEdit((current) => ({
            ...current,
            habilidadesComportamentais: current.habilidadesComportamentais.filter(
              (_, itemIndex) => itemIndex !== index,
            ),
          }))
        }
      />
    </div>
  );
}

function IdiomasStep({
  draft,
  errors,
  disabled,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm text-muted-foreground">Opcional.</p>
      {draft.idiomas.map((item, index) => {
        const idiomaId = fieldDomId(`idiomas.${index}.idioma`);
        return (
          <fieldset key={item.key} className="min-w-0 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Idioma {index + 1}</legend>
            <div className="grid gap-3">
              <div className="min-w-0">
                <Label htmlFor={idiomaId}>Idioma</Label>
                <Input
                  id={idiomaId}
                  data-testid={`cv-idioma-${index}-nome`}
                  className="mt-1.5"
                  value={item.idioma}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `idiomas.${index}.idioma`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `idiomas.${index}.idioma`) ? `${idiomaId}-error` : undefined
                  }
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      idiomas: current.idiomas.map((idioma, idiomaIndex) =>
                        idiomaIndex === index ? { ...idioma, idioma: event.target.value } : idioma,
                      ),
                    }))
                  }
                />
                <FieldErrorText
                  id={idiomaId}
                  message={errorText(errors, `idiomas.${index}.idioma`)}
                />
              </div>
              <SelectControl
                id={fieldDomId(`idiomas.${index}.nivel`)}
                label="Nível"
                value={item.nivel}
                disabled={disabled}
                error={errorText(errors, `idiomas.${index}.nivel`)}
                options={NIVEL_IDIOMA_OPTIONS}
                onChange={(value) =>
                  onEdit((current) => ({
                    ...current,
                    idiomas: current.idiomas.map((idioma, idiomaIndex) =>
                      idiomaIndex === index
                        ? { ...idioma, nivel: value as CvNivelIdioma | '' }
                        : idioma,
                    ),
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onEdit((current) => ({
                    ...current,
                    idiomas: current.idiomas.filter((_, idiomaIndex) => idiomaIndex !== index),
                  }))
                }
              >
                Remover idioma
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        data-testid="cv-idioma-add"
        disabled={disabled || draft.idiomas.length >= CV_LIMITS.idiomasMax}
        onClick={() =>
          onEdit((current) => ({ ...current, idiomas: [...current.idiomas, emptyIdioma()] }))
        }
      >
        Adicionar idioma
      </Button>
    </div>
  );
}

function LinksStep({
  draft,
  errors,
  disabled,
  onEdit,
}: {
  draft: CvFormDraft;
  errors: FieldError[];
  disabled: boolean;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm text-muted-foreground">Opcional. Só links https.</p>
      {draft.links.map((item, index) => {
        const urlId = fieldDomId(`links.${index}.url`);
        const rotuloId = fieldDomId(`links.${index}.rotulo`);
        return (
          <fieldset key={item.key} className="min-w-0 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Link {index + 1}</legend>
            <div className="grid gap-3">
              <div className="min-w-0">
                <Label htmlFor={rotuloId}>Rótulo (opcional)</Label>
                <Input
                  id={rotuloId}
                  data-testid={`cv-link-${index}-rotulo`}
                  className="mt-1.5"
                  value={item.rotulo}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `links.${index}.rotulo`) ? true : undefined}
                  aria-describedby={
                    errorText(errors, `links.${index}.rotulo`) ? `${rotuloId}-error` : undefined
                  }
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      links: current.links.map((link, linkIndex) =>
                        linkIndex === index ? { ...link, rotulo: event.target.value } : link,
                      ),
                    }))
                  }
                />
                <FieldErrorText id={rotuloId} message={errorText(errors, `links.${index}.rotulo`)} />
              </div>
              <div className="min-w-0">
                <Label htmlFor={urlId}>Endereço</Label>
                <Input
                  id={urlId}
                  data-testid={`cv-link-${index}-url`}
                  className="mt-1.5"
                  inputMode="url"
                  value={item.url}
                  disabled={disabled}
                  aria-invalid={errorText(errors, `links.${index}.url`) ? true : undefined}
                  aria-describedby={errorText(errors, `links.${index}.url`) ? `${urlId}-error` : undefined}
                  onChange={(event) =>
                    onEdit((current) => ({
                      ...current,
                      links: current.links.map((link, linkIndex) =>
                        linkIndex === index ? { ...link, url: event.target.value } : link,
                      ),
                    }))
                  }
                />
                <FieldErrorText id={urlId} message={errorText(errors, `links.${index}.url`)} />
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onEdit((current) => ({
                    ...current,
                    links: current.links.filter((_, linkIndex) => linkIndex !== index),
                  }))
                }
              >
                Remover link
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        data-testid="cv-link-add"
        disabled={disabled || draft.links.length >= CV_LIMITS.linksMax}
        onClick={() =>
          onEdit((current) => ({ ...current, links: [...current.links, emptyLink()] }))
        }
      >
        Adicionar link
      </Button>
    </div>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  if (!value.trim()) {
    return null;
  }
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value}</dd>
    </div>
  );
}

function ReviewStep({
  draft,
  email,
  errors,
  disabled,
  onEdit,
}: {
  draft: CvFormDraft;
  email: string;
  errors: FieldError[];
  disabled: boolean;
  onEdit: (recipe: (current: CvFormDraft) => CvFormDraft) => void;
}) {
  const consentError = errorText(errors, 'consentimento');
  const experiencias = draft.primeiroEmprego
    ? 'Primeiro emprego'
    : draft.experiencias
        .map((item) => [item.cargo, item.empresa].filter(Boolean).join(', '))
        .filter(Boolean)
        .join('; ');
  return (
    <div className="mt-4 grid gap-4">
      <dl data-testid="cv-review" className="grid min-w-0 gap-3">
        <ReviewLine label="Nome" value={draft.nome} />
        <ReviewLine label="E-mail da conta" value={email} />
        <ReviewLine
          label="Cidade"
          value={[draft.cidade, labelOf(UF_OPTIONS, draft.uf)].filter(Boolean).join(' / ')}
        />
        <ReviewLine label="Modalidade" value={labelOf(MODALIDADE_OPTIONS, draft.modalidade)} />
        <ReviewLine label="Telefone" value={draft.telefone} />
        <ReviewLine label="Cargos-alvo" value={draft.cargosAlvo.join(', ')} />
        <ReviewLine label="Senioridade" value={labelOf(SENIORIDADE_OPTIONS, draft.senioridade)} />
        <ReviewLine label="Resumo" value={draft.resumo} />
        <ReviewLine label="Experiências" value={experiencias} />
        <ReviewLine
          label="Formação"
          value={draft.formacoes
            .map((item) =>
              [item.curso, item.instituicao, labelOf(NIVEL_FORMACAO_OPTIONS, item.nivel)]
                .filter(Boolean)
                .join(', '),
            )
            .filter(Boolean)
            .join('; ')}
        />
        <ReviewLine
          label="Cursos"
          value={draft.cursos.map((item) => item.nome).filter(Boolean).join(', ')}
        />
        <ReviewLine label="Habilidades técnicas" value={draft.habilidadesTecnicas.join(', ')} />
        <ReviewLine
          label="Habilidades comportamentais"
          value={draft.habilidadesComportamentais.join(', ')}
        />
        <ReviewLine
          label="Idiomas"
          value={draft.idiomas
            .map((item) =>
              [item.idioma, labelOf(NIVEL_IDIOMA_OPTIONS, item.nivel)].filter(Boolean).join(': '),
            )
            .filter(Boolean)
            .join('; ')}
        />
        <ReviewLine
          label="Links"
          value={draft.links.map((item) => item.rotulo || item.url).filter(Boolean).join(', ')}
        />
      </dl>
      <label className="flex min-w-0 items-start gap-2 text-sm">
        <input
          id="cv-consentimento"
          data-testid="cv-consent"
          type="checkbox"
          className="legal-checkbox"
          checked={draft.consentimento}
          disabled={disabled}
          aria-invalid={consentError ? true : undefined}
          aria-describedby={consentError ? 'cv-consentimento-error' : undefined}
          onChange={(event) =>
            onEdit((current) => ({ ...current, consentimento: event.target.checked }))
          }
        />
        <span>Confirmo que estes dados podem ser usados para montar meu currículo.</span>
      </label>
      <FieldErrorText id="cv-consentimento" message={consentError} />
    </div>
  );
}

export function CvFormSkeleton({ preparing = false }: { preparing?: boolean }) {
  return (
    <div data-testid="cv-form-skeleton" role="status" aria-live="polite" className="mt-4 grid gap-3">
      <span className="sr-only">{preparing ? CV_FORM_PREPARING : 'Carregando currículo'}</span>
      {preparing ? <p data-testid="cv-form-preparing">{CV_FORM_PREPARING}</p> : null}
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

