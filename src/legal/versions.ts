export const CURRENT_TERMS_VERSION = '1.0';
export const CURRENT_PRIVACY_VERSION = '1.0';

export const LegalDoc = {
  terms: 'terms',
  privacy: 'privacy',
} as const;

export type LegalDocId = (typeof LegalDoc)[keyof typeof LegalDoc];

export function currentVersionFor(doc: LegalDocId): string {
  return doc === LegalDoc.terms
    ? CURRENT_TERMS_VERSION
    : CURRENT_PRIVACY_VERSION;
}

export function legalTitle(doc: LegalDocId): string {
  return doc === LegalDoc.terms ? 'Termos de uso' : 'Politica de privacidade';
}

export function legalCheckboxLabel(doc: LegalDocId): string {
  const version = currentVersionFor(doc);
  return doc === LegalDoc.terms
    ? `Li e aceito os Termos de uso (v${version}). Obrigatorio apos ler o texto acima.`
    : `Li e aceito a Politica de privacidade (v${version}). Obrigatorio apos ler o texto acima.`;
}

export function legalEndpoint(doc: LegalDocId): string {
  return `GET /legal/${doc}?version=${currentVersionFor(doc)}`;
}

export function isCurrentTermsVersion(version: string | null | undefined): boolean {
  return (version ?? '').trim() === CURRENT_TERMS_VERSION;
}

export function isCurrentPrivacyVersion(
  version: string | null | undefined,
): boolean {
  return (version ?? '').trim() === CURRENT_PRIVACY_VERSION;
}

export function buildRegisterConsentFields(input: {
  termsAccepted: boolean;
  privacyAccepted: boolean;
}): {
  terms_accepted: boolean;
  terms_version: string;
  privacy_accepted: boolean;
  privacy_version: string;
} {
  return {
    terms_accepted: input.termsAccepted,
    terms_version: CURRENT_TERMS_VERSION,
    privacy_accepted: input.privacyAccepted,
    privacy_version: CURRENT_PRIVACY_VERSION,
  };
}

export function buildConsentRequest(
  doc: LegalDocId,
  version?: string,
): { doc: LegalDocId; version: string } {
  return {
    doc,
    version: (version ?? currentVersionFor(doc)).trim(),
  };
}
