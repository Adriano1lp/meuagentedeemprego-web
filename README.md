# Meu Agente de Emprego (web / PWA)

Cliente web das fatias **W1** (auth + consentimento), **W2** (cota + `POST /processar`), **Fatia 1** (upload de CV + rebuild de embeddings), **W-Historico** (`GET /users/me/gap-history`), **W-Perfil** (`GET /users/me`) e **W-LGPD** (`GET /users/me/export`, `DELETE /users/me`).

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

O e2e sobe o Vite em `http://127.0.0.1:5173` e **nao chama a API live**: as rotas `/auth/*`, `/legal/*`, `/consent`, `/users/me`, `/users/me/export`, `/users/me/status`, `/users/me/upload-cv`, `/users/me/rebuild-embeddings`, `/users/me/gap-history`, `/processar` e `/users/me/files/*` sao mockadas. `DELETE /users/me` tambem e mockado nos testes de exclusao.

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

Fluxo BDD (JWT + termos OK; ordem exata; sem Stripe/LGPD/manual-profile):

1. `POST /users/me/upload-cv` — multipart campo `file` (`.pdf` | `.txt`) → `{filename, bytes_received, updated_at, …}`
2. `POST /users/me/rebuild-embeddings` — sem body → `{chunks, processed_at, embedding_model, …}`
3. `GET /users/me/status` → `has_cv`, `has_embeddings` (campos de cota do W2 se vierem)

UI: **idle → uploading → rebuilding → pronto | erro**.  
**Analisar vaga** so habilita se `has_embeddings === true` no status (nunca inventado no cliente).

Cenarios (testes unitarios + e2e):

1. Happy PDF: upload `.pdf` + rebuild OK → status `has_cv`+`has_embeddings` → UI pronto → Analisar enabled
2. Formato invalido: `.docx` ou vazio → API 400 → UI erro → Analisar disabled
3. Rebuild falha: upload OK, rebuild 400/5xx → UI erro + retry → Analisar disabled
4. Already ready: status ja com `has_cv`+`has_embeddings` → UI pronto sem reupload → Analisar enabled
5. Sem CV / `has_embeddings` false: mesmo com texto da vaga preenchido → Analisar disabled

- `403` TERMS/PRIVACY_OUTDATED continua no ConsentGate

## Escopo W-Historico (paridade mobile app #8)

Tela autenticada **Historico** (`/historico`, link na nav) lista as analises do dono do JWT via `GET /users/me/gap-history`.

Estados: **loading → lista | vazio | erro**. pt-BR, acessivel, responsivo.

Cenarios (testes unitarios + e2e mockado):

1. Logado + 200 com `items` → lista das minhas analises (titulo, empresa, score, data)
2. Logado + 200 `items: []` (ou lista nua vazia) → estado vazio claro
3. 401/403 → erro legivel; nunca mostra dados de outro usuario
4. 5xx/rede → erro sanitizado (sem path, token, URL ou stack)
5. Sem JWT → redirect para login (`/`); **nao** chama a API e nao envia Bearer vazio

`403` OUTDATED continua no ConsentGate do W1. Token so em memoria. Sem `X-User-Id`.

Fora desta fatia: Stripe/W3, perfil, LGPD, carta, PDI, edicao de historico, mudancas no backend.

## Escopo W-Perfil (paridade minima com o app)

Tela autenticada **Perfil** (`/perfil`, link na nav) mostra a conta do JWT via `GET /users/me`.

Campos exibidos somente se o JSON trouxer: `display_name`, `email`, `plan`, `subscription_status`. Sem cota calculada no browser (used/limit/remaining nao fazem parte deste endpoint).

**Sair** zera o JWT em memoria e volta ao login (`/`). Sem token em `localStorage` ou `sessionStorage`.

Atalho **Politica de privacidade** reutiliza `GET /legal/privacy?version=1.0` (o mesmo documento do cadastro), sem API nova.

Sem JWT: redirect para `/` e a API de perfil nao e chamada.

Fora desta fatia: edicao de CV, upload, biometria, perfil manual, Stripe/checkout, carta, PDI. Exportar e apagar conta entraram na fatia W-LGPD.

## Escopo W-LGPD (exportar e excluir conta)

Na tela autenticada **Perfil** (`/perfil`), secao **Seus dados**:

1. **Exportar meus dados** — `GET /users/me/export` com Bearer.
2. **Solicitar exclusao de conta** — dialogo destrutivo. A API so e chamada se o usuario digitar exatamente `DELETE` e confirmar. Cancelar, campo vazio ou qualquer outro texto nao chama `DELETE /users/me`. Sucesso (`deleted: true`, com `user_id` e `deleted_at`) limpa o JWT e volta ao login (`/`) com a mensagem "Sua conta foi excluida." 401 tambem volta ao login, sem essa mensagem.

Sem JWT: a rota `/perfil` redireciona para `/` e esses endpoints nao sao chamados.

Contrato (backend `services/account.py` + `main.py`; OpenAPI descreve so `application/json` com `additionalProperties`):

**GET `/users/me/export`**

- Exige termos vigentes (`_require_terms_accepted`). `403` OUTDATED segue no ConsentGate.
- 200 `application/json`, **sem** `Content-Disposition`. O browser baixa esse objeto como `meus-dados.json`.
- Erro 404/5xx: mensagem sem path, URL ou token, com **Tentar novamente**.
- 401 redireciona ao login (`/`). 403 `TERMS_OUTDATED` ou `PRIVACY_OUTDATED` abre o ConsentGate ja existente.
- Antes do download, o cliente remove em qualquer nivel `password`, `password_hash`, `passwd`, `hash`, `access_token`, `refresh_token`, `jwt`, `token` e `authorization`. Essas chaves nao aparecem na tela. O restante do JSON permanece (`user`, `profile`, `processing_runs`, `job_analysis_insights`, `development_plans`, `documents`, `generated_files`, `processar_usage`, `exported_at`).

**DELETE `/users/me`**

- Body JSON obrigatorio: `{"confirm":"DELETE"}` (qualquer outro valor → 400).
- 200: `{ "user_id", "deleted": true, "deleted_at" }`. Sem `deleted: true`, a sessao permanece.
- Este endpoint nao passa por `_require_terms_accepted`. A UI de perfil fica atras do ConsentGate, entao o botao nao e clicavel enquanto o reaceite estiver aberto.

## Contrato descoberto (OpenAPI live + `main.py`)

Base: `https://meu-agente-de-emprego.onrender.com` — Bearer JWT only. Sem `X-User-Id`.

**POST `/users/me/upload-cv`**

- Content-Type: `multipart/form-data` (o browser define o boundary; nao forcar header)
- Campo: `file` (OpenAPI `Body_upload_cv_users_me_upload_cv_post`)
- Aceito no servidor e na UI: `.pdf` e `.txt`
- 200 JSON (campos reais de `save_user_cv`), incluindo: `filename`, `bytes_received`, `updated_at`
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

**GET `/users/me/gap-history`** (historico do dono do JWT)

- Query: `limit` 1–100 (default 20), `offset` >= 0 (default 0)
- 200 JSON: `{ items, limit, offset }` — `items: []` quando nao ha analises
- O cliente tambem aceita lista nua `[]` (vazio)
- Item (campos reais de `_insight_row_to_dict` / `_mongo_insight_to_dict`):
  - `id` (string; SQLite `insight_id` ou Mongo `_id`) — fallback de parse: `insight_id`
  - `processing_run_id`, `created_at`, `job_title`, `company_name`, `job_summary`
  - `match_score` (int; parse aceita string numerica)
  - `strengths`, `critical_gaps`, `matching_skills`, `missing_skills` (listas)
  - `status`, `generation_blocked`, `blocked_reason`, `source` (`"processar"`)
- OpenAPI live nao descreve o schema do item (`additionalProperties: true`); nomes acima vieram do `main.py` + repository

**GET `/users/me`** (perfil leve)

- Bearer JWT. Sem `X-User-Id`
- 200 JSON de `get_current_user`: `user_id`, `auth_mode`, `display_name`, `email`, `plan`, `subscription_status`, mais aceite de termos/privacidade quando o usuario existe
- A UI mostra so `display_name`, `email`, `plan` e `subscription_status` se vierem no JSON
- Nao traz `used`, `limit` ou `remaining` (esses ficam em `GET /users/me/status`)

## Fora desta fatia

Nao implementar: Stripe/checkout (W3), perfil manual, edicao de perfil, mudancas no backend, cookies ou header `X-User-Id`. Exportar e apagar conta estao na fatia W-LGPD.

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
