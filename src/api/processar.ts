import type { ProcessarResponse } from './types';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return undefined;
}

export function parseProcessarResponse(payload: unknown): ProcessarResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta de processar em formato invalido');
  }
  const record = payload as Record<string, unknown>;
  return {
    texto_resposta: asOptionalString(record.texto_resposta),
    pdf_url: asNullableString(record.pdf_url),
    user_id: asOptionalString(record.user_id),
    match_score: asOptionalNumber(record.match_score),
    pdf_generated: asOptionalBoolean(record.pdf_generated),
    generation_blocked: asOptionalBoolean(record.generation_blocked),
    blocked_reason: asNullableString(record.blocked_reason),
  };
}

export function fileNameFromPdfUrl(
  pdfUrl: string | null | undefined,
): string | null {
  if (!pdfUrl || !pdfUrl.trim()) {
    return null;
  }
  try {
    const url = new URL(pdfUrl, 'https://meu-agente-de-emprego.onrender.com');
    const parts = url.pathname.split('/').filter(Boolean);
    const filesIndex = parts.findIndex(
      (part, index) =>
        part === 'files' &&
        parts[index - 1] === 'me' &&
        parts[index - 2] === 'users',
    );
    if (filesIndex >= 0) {
      const name = parts[filesIndex + 1];
      return name ? decodeURIComponent(name) : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** PDF so quando o servidor gerou: pdf_url presente e generation_blocked nao e true. */
export function canOfferPdfDownload(result: ProcessarResponse): boolean {
  if (result.generation_blocked === true) {
    return false;
  }
  if (result.pdf_generated === false) {
    return false;
  }
  return Boolean(fileNameFromPdfUrl(result.pdf_url));
}

export function isPdfMagic(bytes: ArrayBuffer | Uint8Array): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < PDF_MAGIC.length) {
    return false;
  }
  return PDF_MAGIC.every((byte, index) => view[index] === byte);
}

export function triggerBrowserDownload(
  bytes: ArrayBuffer,
  fileName: string,
  createObjectUrl: (blob: Blob) => string = (blob) =>
    URL.createObjectURL(blob),
  revokeObjectUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  clickAnchor: (anchor: HTMLAnchorElement) => void = (anchor) =>
    anchor.click(),
): void {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const href = createObjectUrl(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  clickAnchor(anchor);
  revokeObjectUrl(href);
}
