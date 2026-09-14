# Meu Agente de Emprego (web / PWA)

Cliente web das fatias **W1** (auth + consentimento), **W2** (cota + `POST /processar`) e **Fatia 1** (upload de CV + rebuild de embeddings).

Paridade de UX com o app Flutter `app-release-1.4.1` (abas Entrar / Criar conta, paineis legais, analise de vaga com PDF autenticado).

## Stack

- Vite + React + TypeScript
- React Router
- PWA (`vite-plugin-pwa`: manifest + service worker)
- Tailwind CSS
- Vitest + Testing Library
- Playwright (e2e com API mockada)

## Como rodar

```bash
npm install
npm run dev
```

Build de producao:

```bash
npm run build
npm run preview
```

Testes:

```bash
npm test          # unitarios (Vitest)
npm run test:e2e  # Playwright (Chromium / Chrome do sistema)
```

O e2e sobe o Vite em `http://127.0.0.1:5173` e **nao chama a API live**: as rotas `/auth/*`, `/legal/*`, `/consent`, `/users/me/status`, `/users/me/upload-cv`, `/users/me/rebuild-embeddings`, `/processar` e `/users/me/files/*` sao mockadas.

## Variaveis de ambiente

| Variavel | Padrao | Descricao |
|---|---|---|
| `VITE_API_BASE_URL` | `https://meu-agente-de-emprego.onrender.com` | Base da API. Sem barra final. |

Copie `.env.example` para `.env` se quiser sobrescrever no dev. **Nao coloque segredos no bundle.**

No `npm run dev`, chamadas a uma URL absoluta passam pelo proxy Vite (`/__mae_api` → API live). Isso evita CORS no browser em localhost. O **build de producao** chama a URL absoluta diretamente; o backend precisa liberar o origin do site (`Access-Control-Allow-Origin`).

OpenAPI: `https://meu-agente-de-emprego.onrender.com/openapi.json`  
Swagger: `https://meu-agente-de-emprego.onrender.com/docs`

## Escopo W1 (o que entra)

- Tela de auth com abas **Entrar** | **Criar conta**
- Login: email + senha
- Cadastro: `display_name`, email, senha (>= 8 no hint), dois paineis legais (texto markdown da API, nao so link)
- Checkboxes comecam **desmarcados** e so habilitam **depois** do texto carregar
- `POST /auth/register` envia os 4 campos vigentes:
  - `terms_accepted: true`
  - `terms_version: "1.0"`
  - `privacy_accepted: true`
  - `privacy_version: "1.0"`
- `POST /auth/login` e `GET /auth/me` com `Authorization: Bearer <access_token>`
- Token **so em memoria** (context React). Logout limpa a sessao. Recarregar a pagina desloga (W1).
- Gate de consentimento se a API autenticada responder `403` com `detail.code` `TERMS_OUTDATED` ou `PRIVACY_OUTDATED`
- Reaceite via `POST /consent` (`doc` + `version: "1.0"`), depois `GET /auth/me`
- Shell autenticado + Sair
- PWA (manifest + service worker no build)
- HTTPS obrigatorio no build de producao

## Escopo W2 (processar + cotas)

- `GET /users/me/status` apos login (so com JWT e sem gate OUTDATED)
- UI de plano/cota **somente** com o JSON do status — sem calcular Free 5 / Essencial 30 no browser e sem persistir cota
- `POST /processar` com OpenAPI `RequestData`: `{ "texto": "..." }`
- Sucesso com `pdf_url` → `GET /users/me/files/{file_name}` com Bearer; so trata como download ok se os bytes comecam com `%PDF`
- `generation_blocked: true` / `pdf_url: null` → bloco, sem link de PDF
- `402` `detail.code` `QUOTA_EXCEEDED` | `SUBSCRIPTION_REQUIRED` → bloco, sem loop de retry, sem queimar cota local
- `400` (ex.: embeddings ausentes) → erro acionavel, nao UI de sucesso
- `403` OUTDATED continua no ConsentGate do W1

## Escopo Fatia 1 (CV + embeddings)

Fluxo BDD (ordem exata; sem Stripe):

1. `POST /users/me/upload-cv` (multipart, campo `file`, PDF)
2. `POST /users/me/rebuild-embeddings` (sem body)
3. Gate de **Analisar vaga** so com `has_embeddings === true` em `GET /users/me/status` — o cliente nao inventa prontidao a partir do upload, do rebuild ou de `has_cv`

- Sem embeddings no status: `Analisar vaga` fica desabilitado, com mensagem clara no painel de CV e no painel de analise
- UI: enviando → **processando embeddings** → **pronto**
- Erro de upload ou de embeddings: estado de erro + **Tentar de novo** (retry de embeddings nao reenvia o PDF se o upload ja passou)
- `403` TERMS/PRIVACY_OUTDATED continua no ConsentGate

### Contrato descoberto (OpenAPI live + `main.py`)

Base: `https://meu-agente-de-emprego.onrender.com` — Bearer JWT only. Sem `X-User-Id`.

**POST `/users/me/upload-cv`**

- Content-Type: `multipart/form-data` (o browser define o boundary; nao forcar header)
- Campo: `file` (OpenAPI `Body_upload_cv_users_me_upload_cv_post`)
- Aceito no servidor: `.pdf` e `.txt`; esta fatia da UI envia PDF
- Limite default: `MAX_UPLOAD_SIZE_MB` = 10
- 200 JSON (campos reais de `save_user_cv`):
  - `user_id`, `document_id`, `filename`, `content_type`, `bytes_received`, `updated_at`
  - `cv_file`, `original_file`, `object_key`, `extracted_text_object_key`
- 400 exemplos: formato invalido, arquivo vazio, acima de 10 MB, texto nao extraido

**POST `/users/me/rebuild-embeddings`**

- Sem request body
- 200 JSON (campos reais de `rebuild_vectorstore_for_user`):
  - `user_id`, `embedding_run_id`, `chunks`, `processed_at`, `embedding_model`
  - `chroma_dir`, `vector_store` (`mongodb` | `chroma`), `cv_file`
- 400 se nao houver curriculo ou se nao der para gerar chunks

**GET `/users/me/status`** (gate de Analisar vaga)

- Gate: somente `has_embeddings === true`
- Outros campos espelhados: `has_cv`, `has_profile`, `generated_files`
- mais cota quando o JSON trouxer: `plan`, `used`, `limit`, `remaining`, `period`, `subscription_status`

## Fora desta fatia

Nao implementar: Stripe/checkout (W3), exportar/apagar conta (W4), cookies ou header `X-User-Id`.

## HTTPS em producao

No **build de producao** (`npm run build`):

1. Redirect runtime `http://` → `https://` (exceto localhost / 127.0.0.1)
2. Meta CSP `upgrade-insecure-requests` injetada no HTML do build

O `npm run dev` em localhost **pode** usar `http://`. Nao force HTTPS no desenvolvimento local.

## Deploy

Site estatico no Render: `https://meuagentedeemprego-web.onrender.com`. Infra em `render.yaml` (Blueprint).

SPA precisa do rewrite `/*` → `/index.html` (ja no Blueprint). Sem isso, rotas profundas como `/login` retornam 404 no CDN.

## Auth e consentimento (contrato)

- Bearer only. Sem cookies. Sem `X-User-Id`.
- Cadastro sem os 4 campos de consentimento (ou versao diferente de `1.0`) → API `400` e usuario nao e criado.
- Documentos publicos: `GET /legal/terms?version=1.0` e `GET /legal/privacy?version=1.0` (markdown/texto, nao JSON). Versao desconhecida → `404`.
- Rotas autenticadas (exceto `/consent` e `/legal/*`) com versao velha → `403` OUTDATED → overlay bloqueia o app (nao da para contornar por rota).

## JWT (minimo W1)

O `access_token` vive em memoria. `sessionStorage` nao e usado: sobreviveria ao F5, mas um XSS no origin leria o token. Logout zera o token e o estado de consentimento.

## PWA

O plugin gera `manifest.webmanifest` e o service worker no `dist/`. Instalar / offline do shell e suportado apos o build. No e2e o service worker e bloqueado para evitar flakiness.
