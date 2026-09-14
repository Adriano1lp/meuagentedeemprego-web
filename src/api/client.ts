import {
  buildConsentRequest,
  buildRegisterConsentFields,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  type LegalDocId,
} from '../legal/versions';
import { parseOutdatedResponse, type OutdatedDetail } from './outdated';
import { parseProcessarResponse } from './processar';
import { parseQuotaResponse } from './quota';
import { parseUserStatus } from './status';
import { bearerHeaders, extractAccessToken } from './token';
import type {
  AuthResponse,
  ProcessarRequest,
  ProcessarResponse,
  QuotaDetail,
  RegisterPayload,
  User,
  UserStatus,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly outdated: OutdatedDetail | null;
  readonly quota: QuotaDetail | null;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.outdated = parseOutdatedResponse(status, body);
    this.quota = parseQuotaResponse(status, body);
  }
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  getToken: () => string | null;
  onOutdated?: (detail: OutdatedDetail) => void;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
  }
  if (typeof body === 'string' && body.trim()) {
    return body;
  }
  if (status === 402) {
    return 'Cota mensal esgotada.';
  }
  if (status === 400) {
    return 'Nao foi possivel processar o pedido.';
  }
  if (status >= 500) {
    return `Erro no servidor: ${status}`;
  }
  return 'Falha ao falar com a API';
}

export type RegisterInput = {
  displayName: string;
  email: string;
  password: string;
  termsAccepted?: boolean;
  privacyAccepted?: boolean;
};

/** So envia true quando a UI passa true explicito. Omitido ou false → false (API 400). */
export function buildRegisterPayload(input: RegisterInput): RegisterPayload {
  return {
    display_name: input.displayName,
    email: input.email,
    password: input.password,
    ...buildRegisterConsentFields({
      termsAccepted: input.termsAccepted === true,
      privacyAccepted: input.privacyAccepted === true,
    }),
  };
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(
    path: string,
    init: RequestInit & { parse?: 'json' | 'text' | 'bytes' } = {},
  ): Promise<unknown> {
    const { parse = 'json', headers: initHeaders, ...rest } = init;
    const headers = new Headers(initHeaders);
    const token = options.getToken();
    const auth = bearerHeaders(token);
    if (auth.Authorization) {
      headers.set('Authorization', auth.Authorization);
    }
    if (!headers.has('Accept')) {
      headers.set(
        'Accept',
        parse === 'text'
          ? 'text/markdown, text/plain, */*'
          : parse === 'bytes'
            ? 'application/pdf, application/octet-stream, */*'
            : 'application/json',
      );
    }

    let response: Response;
    try {
      response = await fetchImpl(joinUrl(options.baseUrl, path), {
        ...rest,
        headers,
      });
    } catch {
      throw new ApiError(
        0,
        null,
        `Nao foi possivel alcancar a API em ${options.baseUrl}.`,
      );
    }

    if (parse === 'text') {
      if (!response.ok) {
        const body = await readBody(response);
        const error = new ApiError(response.status, body, errorMessage(response.status, body));
        if (error.outdated) {
          options.onOutdated?.(error.outdated);
        }
        throw error;
      }
      const markdown = await response.text();
      if (!markdown.trim()) {
        throw new ApiError(response.status, markdown, 'Documento legal vazio');
      }
      return markdown;
    }

    if (parse === 'bytes') {
      if (!response.ok) {
        const body = await readBody(response);
        const error = new ApiError(
          response.status,
          body,
          errorMessage(response.status, body),
        );
        if (error.outdated) {
          options.onOutdated?.(error.outdated);
        }
        throw error;
      }
      return response.arrayBuffer();
    }

    const body = await readBody(response);
    if (!response.ok) {
      const error = new ApiError(
        response.status,
        body,
        errorMessage(response.status, body),
      );
      if (error.outdated) {
        options.onOutdated?.(error.outdated);
      }
      throw error;
    }
    return body;
  }

  return {
    async register(input: RegisterInput): Promise<AuthResponse> {
      const payload = buildRegisterPayload(input);
      const body = await request('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return assertAuthResponse(body);
    },

    async login(input: { email: string; password: string }): Promise<AuthResponse> {
      const body = await request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
        }),
      });
      return assertAuthResponse(body);
    },

    async me(): Promise<User> {
      const body = await request('/auth/me', { method: 'GET' });
      if (!body || typeof body !== 'object') {
        throw new ApiError(200, body, 'Resposta da API em formato invalido');
      }
      return body as User;
    },

    async fetchLegal(doc: LegalDocId, version?: string): Promise<string> {
      const resolved =
        version ??
        (doc === 'terms' ? CURRENT_TERMS_VERSION : CURRENT_PRIVACY_VERSION);
      const markdown = await request(
        `/legal/${doc}?version=${encodeURIComponent(resolved)}`,
        { method: 'GET', parse: 'text' },
      );
      return String(markdown);
    },

    async acceptConsent(doc: LegalDocId, version?: string): Promise<unknown> {
      return request('/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConsentRequest(doc, version)),
      });
    },

    async getStatus(): Promise<UserStatus> {
      const body = await request('/users/me/status', { method: 'GET' });
      try {
        return parseUserStatus(body);
      } catch {
        throw new ApiError(200, body, 'Resposta de status em formato invalido');
      }
    },

    async processar(texto: string): Promise<ProcessarResponse> {
      const payload: ProcessarRequest = { texto };
      const body = await request('/processar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      try {
        return parseProcessarResponse(body);
      } catch {
        throw new ApiError(200, body, 'Resposta de processar em formato invalido');
      }
    },

    async downloadUserFile(fileName: string): Promise<ArrayBuffer> {
      const safeName = fileName.split('/').pop()?.trim() || fileName;
      if (!safeName) {
        throw new ApiError(400, null, 'Nome de arquivo invalido');
      }
      const body = await request(
        `/users/me/files/${encodeURIComponent(safeName)}`,
        { method: 'GET', parse: 'bytes' },
      );
      if (!(body instanceof ArrayBuffer)) {
        throw new ApiError(200, body, 'Arquivo em formato invalido');
      }
      return body;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function assertAuthResponse(body: unknown): AuthResponse {
  const token = extractAccessToken(body);
  if (!token || !body || typeof body !== 'object') {
    throw new ApiError(200, body, 'Resposta de autenticacao incompleta');
  }
  const record = body as Record<string, unknown>;
  return {
    access_token: token,
    token_type:
      typeof record.token_type === 'string' ? record.token_type : 'bearer',
    user:
      record.user && typeof record.user === 'object'
        ? (record.user as User)
        : undefined,
  };
}
