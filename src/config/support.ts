export const SUPPORT_EMAIL = 'clickredeonline@gmail.com';

export const SUPPORT_SUBJECT = 'Suporte MAE';

/** Mailto fixo: só o assunto, sem corpo e sem dado da pessoa. */
export function supportMailto(): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}`;
}
