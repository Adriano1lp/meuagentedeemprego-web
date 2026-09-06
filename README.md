# Meu Agente de Emprego (web / PWA)

Cliente web da **fatia W1**: autenticacao JWT Bearer, leitura/aceite de Termos e Privacidade, e gate de reaceite quando a API devolve `403` `TERMS_OUTDATED` / `PRIVACY_OUTDATED`.

Paridade de UX com o app Flutter `app-release-1.4.1` (abas Entrar / Criar conta, paineis legais com texto vigente, checkboxes so apos o load, overlay bloqueante de consentimento).

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

O e2e sobe o Vite em `http://127.0.0.1:5173` e **nao chama a API live**: as rotas `/auth/*`, `/legal/*` e `/consent` sao mockadas.

## Variaveis de ambiente

| Variavel | Padrao | Descricao |
|---|---|---|
| `VITE_API_BASE_URL` | `https://meu-agente-de-emprego.onrender.com` | Base da API. Sem barra final. |

Copie `.env.example` para `.env` se quiser sobrescrever no dev. **Nao coloque segredos no bundle.**

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
- Shell autenticado placeholder ("logado") + Sair
- PWA (manifest + service worker no build)
- HTTPS obrigatorio no build de producao

## Fora do W1

Nao implementar: upload de CV, processar, Stripe/billing, PDF, exportar/apagar conta, `POST /users/me/terms/accept`, cookies ou header `X-User-Id`.

## HTTPS em producao

No **build de producao** (`npm run build`):

1. Redirect runtime `http://` → `https://` (exceto localhost / 127.0.0.1)
2. Meta CSP `upgrade-insecure-requests` injetada no HTML do build

O `npm run dev` em localhost **pode** usar `http://`. Nao force HTTPS no desenvolvimento local.

## Auth e consentimento (contrato)

- Bearer only. Sem cookies. Sem `X-User-Id`.
- Cadastro sem os 4 campos de consentimento (ou versao diferente de `1.0`) → API `400` e usuario nao e criado.
- Documentos publicos: `GET /legal/terms?version=1.0` e `GET /legal/privacy?version=1.0` (markdown/texto, nao JSON). Versao desconhecida → `404`.
- Rotas autenticadas (exceto `/consent` e `/legal/*`) com versao velha → `403` OUTDATED → overlay bloqueia o app (nao da para contornar por rota).

## JWT (minimo W1)

O `access_token` vive em memoria. `sessionStorage` nao e usado: sobreviveria ao F5, mas um XSS no origin leria o token. Logout zera o token e o estado de consentimento.

## PWA

O plugin gera `manifest.webmanifest` e o service worker no `dist/`. Instalar / offline do shell e suportado apos o build. No e2e o service worker e bloqueado para evitar flakiness.
