import { fileNameFromPdfUrl } from './processar';
import type { CoverLetterResponse } from './types';

type CoverLetterErrorLike = {
  status?: number;
  message?: string;
  outdated?: { message?: string } | null;
};

export const COVER_LETTER_PATH = '/users/me/cover-letter';

export const COVER_LETTER_LOGIN_REQUIRED =
  'Entre na sua conta para gerar a carta.';
export const COVER_LETTER_SESSION_EXPIRED =
  'Sessao expirada. Entre novamente para gerar a carta.';
export const COVER_LETTER_FAILED =
  'Nao foi possivel gerar a carta.';
export const COVER_LETTER_BAD_REQUEST =
  'Nao foi possivel gerar a carta para esta empresa.';
export const COVER_LETTER_COMPANY_REQUIRED =
  'Informe a empresa para gerar a carta.';
export const COVER_LETTER_QUOTA =
  'Limite de uso atingido. Nao e possivel gerar a carta agora.';
export const COVER_LETTER_DOWNLOAD_FAILED =
  'Nao foi possivel baixar o PDF da carta.';
export const COVER_LETTER_PDF_INVALID =
  'O arquivo recebido nao e um PDF valido.';
export const COVER_LETTER_COPY_SUCCESS = 'Carta copiada.';
export const COVER_LETTER_COPY_FAILED = 'Nao foi possivel copiar a carta.';
export const COVER_LETTER_MISSING_COMPANY =
  'Esta analise nao tem empresa. A carta so pode ser gerada quando a vaga informa o nome da empresa.';

/**
 * POST /users/me/cover-letter — 200 { texto_resposta, pdf_url, user_id }.
 * Quebras de linha de `texto_resposta` sao preservadas.
 */
export function parseCoverLetterResponse(payload: unknown): CoverLetterResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de carta em formato invalido');
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.texto_resposta !== 'string') {
    throw new Error('Resposta de carta em formato invalido');
  }
  const pdfUrl =
    typeof record.pdf_url === 'string' ? record.pdf_url.trim() : '';
  return {
    texto_resposta: record.texto_resposta,
    pdf_url: pdfUrl,
    user_id:
      typeof record.user_id === 'string' && record.user_id.trim()
        ? record.user_id.trim()
        : undefined,
  };
}

/** Extrai o nome do arquivo. Absoluto ou relativo: o GET sai pela base da API. */
export function coverLetterFileName(
  pdfUrl: string | null | undefined,
): string | null {
  return fileNameFromPdfUrl(pdfUrl);
}

export function coverLetterErrorLeaksInternals(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('http://') || lower.includes('https://')) {
    return true;
  }
  if (
    lower.includes('/users/me') ||
    lower.includes('cover-letter') ||
    lower.includes('/files/')
  ) {
    return true;
  }
  if (lower.includes('authorization') || lower.includes('bearer ')) {
    return true;
  }
  if (/\.py\b/.test(lower) || lower.includes('traceback')) {
    return true;
  }
  if (
    lower.includes('jwt-') ||
    lower.includes('access_token') ||
    lower.includes('x-user-id')
  ) {
    return true;
  }
  return false;
}

export function safeCoverLetterErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as CoverLetterErrorLike;
    if (record.message === COVER_LETTER_LOGIN_REQUIRED) {
      return COVER_LETTER_LOGIN_REQUIRED;
    }
    if (record.message === COVER_LETTER_COMPANY_REQUIRED) {
      return COVER_LETTER_COMPANY_REQUIRED;
    }
    if (record.status === 401) {
      return COVER_LETTER_SESSION_EXPIRED;
    }
    if (record.status === 400) {
      return COVER_LETTER_BAD_REQUEST;
    }
    if (record.status === 402 || record.status === 429) {
      return COVER_LETTER_QUOTA;
    }
    if (
      record.outdated?.message?.trim() &&
      !coverLetterErrorLeaksInternals(record.outdated.message)
    ) {
      return record.outdated.message;
    }
  }
  return COVER_LETTER_FAILED;
}

export function safeCoverLetterDownloadMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as CoverLetterErrorLike;
    if (record.status === 401) {
      return COVER_LETTER_SESSION_EXPIRED;
    }
    if (record.status === 402 || record.status === 429) {
      return COVER_LETTER_QUOTA;
    }
  }
  return COVER_LETTER_DOWNLOAD_FAILED;
}
