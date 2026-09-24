export type User = {
  user_id?: string;
  id?: string;
  email?: string;
  display_name?: string;
  terms_version?: string | null;
  privacy_version?: string | null;
  [key: string]: unknown;
};

/**
 * GET /users/me — campos reais de `get_current_user` (main.py).
 * Nome, e-mail, plano e status da assinatura. Sem cota (used/limit/remaining
 * vivem em GET /users/me/status e GET /billing/me, nao neste payload).
 */
export type CurrentUser = {
  user_id?: string;
  email?: string;
  display_name?: string;
  plan?: string;
  subscription_status?: string;
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

/**
 * POST /users/me/upload-cv — multipart field `file`.
 * Campos reais de services/user_data.save_user_cv.
 */
export type UploadCvResponse = {
  user_id?: string;
  document_id?: string;
  filename?: string;
  content_type?: string;
  bytes_received?: number;
  updated_at?: string;
  cv_file?: string;
  original_file?: string;
  object_key?: string;
  extracted_text_object_key?: string;
};

/**
 * POST /users/me/rebuild-embeddings — sem body.
 * Campos reais de services.main_rag.rebuild_vectorstore_for_user.
 */
export type RebuildEmbeddingsResponse = {
  user_id?: string;
  embedding_run_id?: string;
  chunks?: number;
  processed_at?: string;
  embedding_model?: string;
  chroma_dir?: string;
  vector_store?: string;
  cv_file?: string;
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

/**
 * GET /users/me/gap-history — campos reais de
 * `list_job_analysis_insights` / `_insight_row_to_dict` (SQLite) e
 * `_mongo_insight_to_dict` (Mongo). `id` e string (insight_id ou _id).
 */
export type GapHistoryItem = {
  id: string;
  processing_run_id?: number | string;
  created_at?: string;
  job_title?: string;
  company_name?: string;
  job_summary?: string;
  match_score: number;
  strengths: string[];
  critical_gaps: string[];
  matching_skills: string[];
  missing_skills: string[];
  status?: string;
  generation_blocked: boolean;
  blocked_reason?: string | null;
  source?: string;
};

export type GapHistoryResponse = {
  items: GapHistoryItem[];
  limit?: number;
  offset?: number;
};

/**
 * GET /users/me/export — objeto JSON de `export_current_user`.
 * A API nao envia Content-Disposition; o cliente conserva todas as chaves
 * recebidas. Chaves de topo conhecidas (collect_user_export_payload +
 * exported_at): user, profile, processing_runs, job_analysis_insights,
 * development_plans, documents, generated_files, processar_usage, exported_at.
 */
export type UserDataExport = Record<string, unknown>;

/**
 * DELETE /users/me com body {"confirm":"DELETE"}.
 * Sucesso real: { user_id, deleted: true, deleted_at }.
 */
export type DeleteAccountResult = {
  deleted: true;
  user_id?: string;
  deleted_at?: string;
};
