export type User = {
  user_id?: string;
  id?: string;
  email?: string;
  display_name?: string;
  terms_version?: string | null;
  privacy_version?: string | null;
  [key: string]: unknown;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user?: User;
};

export type RegisterPayload = {
  display_name: string;
  email: string;
  password: string;
  terms_accepted: boolean;
  terms_version: string;
  privacy_accepted: boolean;
  privacy_version: string;
};

/**
 * GET /users/me/status — campos reais do backend (main.py).
 * Cota mensal vive em get_entitlement / GET /billing/me; se o JSON de
 * /status trouxer os mesmos nomes, a UI mostra. Nao calcular no browser.
 */
export type UserStatus = {
  user_id?: string;
  has_cv?: boolean;
  has_profile?: boolean;
  has_embeddings?: boolean;
  generated_files?: number;
  plan?: string;
  subscription_status?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  period?: string;
};

/** OpenAPI RequestData */
export type ProcessarRequest = {
  texto: string;
};

/** POST /processar — campos reais do backend (main.py). */
export type ProcessarResponse = {
  texto_resposta?: string;
  pdf_url?: string | null;
  user_id?: string;
  match_score?: number;
  pdf_generated?: boolean;
  generation_blocked?: boolean;
  blocked_reason?: string | null;
};

export type QuotaCode = 'QUOTA_EXCEEDED' | 'SUBSCRIPTION_REQUIRED';

export type QuotaDetail = {
  code: QuotaCode;
  message: string;
  used?: number;
  limit?: number;
  plan?: string;
};
