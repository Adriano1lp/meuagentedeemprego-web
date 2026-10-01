# Frontend web — Meu Agente de Emprego

Documentação de produto do cliente web: telas, rotas e fluxos. Os contratos por fatia (campos, status HTTP e cenários de teste) continuam no [README](../README.md).

Nada aqui descreve endpoint, campo, cota ou tela que o código não implemente. A análise de vaga usa a API `POST /processar`, mas **não existe rota de página `/processar`**. Login e cadastro ficam em `/`; **não existe `/login`**.

## Visão geral

| | |
|---|---|
| Site | [https://meuagentedeemprego-web.onrender.com](https://meuagentedeemprego-web.onrender.com) |
| API | [https://meu-agente-de-emprego.onrender.com](https://meu-agente-de-emprego.onrender.com) (`VITE_API_BASE_URL`, sem barra final) |
| OpenAPI / Swagger | `/openapi.json` e `/docs` na mesma base da API |

Stack: Vite, React, TypeScript, React Router, Tailwind CSS e PWA (`vite-plugin-pwa`: manifest + service worker no build).

O site é um SPA estático. O Blueprint (`render.yaml`) reescreve `/*` para `/index.html`, então rotas profundas abrem o app em vez de 404 no CDN.

No `npm run dev`, uma base absoluta passa pelo proxy same-origin `/__mae_api` (evita CORS no localhost). O build de produção chama a URL absoluta; o backend precisa liberar o origin do site.

## Mapa de rotas

Definido em `src/App.tsx`. A autenticação é “existe JWT em memória”, não um cookie. Qualquer path fora da tabela cai no curinga e volta para `/`.

| Path | Tela | Exige sessão? | O que faz |
|---|---|---|---|
| `/` | **Entrar / Criar conta** (`AuthPage`) | Não | Login e cadastro. É a tela de quem não tem JWT. |
| `/` | **Início** (`HomePage`) | Sim | Saudação, cota/status, upload de CV + embeddings e análise de vaga. |
| `/historico` | **Histórico** (`HistoryPage`) | Sim | Lista as análises da conta e, em cada item, a carta de apresentação. Sem JWT, redireciona para `/` e não chama a API. |
| `/perfil` | **Perfil** (`ProfilePage`) | Sim | Conta leve, política de privacidade, exportar e excluir. Sem JWT, redireciona para `/` e não chama a API. |
| qualquer outro (`/login`, `/processar`, …) | — | — | `Navigate` para `/`. |

O **ConsentGate** não é uma rota. Com JWT e aceite desatualizado, um diálogo cobre o app inteiro (incluindo `/`, `/historico` e `/perfil`) até o reaceite ou o logout.

## Telas

### Login e cadastro (`/`, sem JWT)

Cabeçalho “Entrar na conta” e abas **Entrar** | **Criar conta**.

**Entrar** pede e-mail e senha. O botão fica “Entrando...” enquanto a API responde. E-mail ou senha vazios mostram “Preencha email e senha.” sem chamar a API.

**Criar conta** pede nome, e-mail e senha. O campo de senha tem `minLength={8}` e o placeholder “Senha com pelo menos 8 caracteres”. Abaixo, dois painéis carregam o markdown da API (não só um link):

- Termos de uso — `GET /legal/terms?version=1.0`
- Política de privacidade — `GET /legal/privacy?version=1.0`

Os checkboxes começam desmarcados e só habilitam depois que o texto correspondente carregou. **Criar conta** só habilita com os dois textos carregados e os dois aceites marcados. Se o documento falha, o checkbox permanece desligado e há “Tentar de novo”.

Depois de excluir a conta, esta mesma tela mostra “Sua conta foi excluida.”

### Shell autenticado

`AppHeader` aparece em Início, Histórico e Perfil:

- **Início** → `/`
- **Histórico** → `/historico`
- **Perfil** → `/perfil`
- **Sair** — zera o JWT em memória e o estado de consentimento, e a rota `/` volta a mostrar o login. Não grava aviso de conta excluída (esse aviso só existe depois do `DELETE` bem-sucedido).

Não há `localStorage` nem `sessionStorage` para o token. Recarregar a página desloga.

### Início e análise de vaga (`/`, com JWT)

Quatro blocos, nesta ordem:

1. **Saudação** — “Ola, {nome}” (cai para o e-mail, depois para “usuario”). O texto da tela ainda diz que billing Stripe e exportação LGPD ficam para as próximas fatias. A exportação e a exclusão já estão em Perfil; Stripe continua fora.
2. **Cota e status** — espelha `GET /users/me/status`. Mostra só o que o JSON trouxer: plano, período UTC, cota (`used` / `limit` / `remaining`), embeddings, currículo e quantidade de arquivos gerados. O browser não calcula Free nem Essencial e não guarda cota.
3. **Currículo e embeddings** — arquivo `.pdf` ou `.txt`. Estados: idle → enviando → reconstruindo embeddings → pronto ou erro, com “Tentar de novo”.
4. **Análise de vaga** — textarea “Texto da vaga” e **Analisar vaga**. O botão só habilita com texto não vazio, `has_embeddings === true` no status e sem upload/rebuild em andamento. Enquanto o CV está ocupado, a mensagem é “Reconstruindo embeddings…”. Sem status, sem CV ou sem embeddings, o painel explica o bloqueio e não envia `POST /processar`.

Resultados possíveis no próprio painel (não há outra página):

- **Análise concluída** — match em “Match: N%” quando vier número, texto da resposta e, se couber, **Baixar PDF autenticado**.
- **PDF não gerado** — `generation_blocked: true` (aderência abaixo do mínimo). Mostra `blocked_reason` quando existe. Não oferece link de PDF.
- **Cota mensal esgotada** — HTTP 402. Sem botão de pagamento e sem descontar cota no navegador.
- **Não foi possível analisar** — inclui HTTP 400 (por exemplo embeddings ausentes). Não é tratado como sucesso.

### Histórico (`/historico`)

Estados: **Carregando histórico...** → lista, **Nenhum retorno salvo ainda.** ou erro com **Tentar novamente**.

Cada card mostra, quando o item traz o campo:

- título (`job_title`, ou “Analise sem titulo”)
- data em UTC, formato `dd/mm/aaaa HH:mm`
- “Empresa: …” se houver `company_name`
- “Aderencia: N/100”
- aviso de PDF não gerado, com `blocked_reason` se houver
- resumo da vaga, pontos fortes e lacunas críticas
- **Baixar CV** somente se `cv_file_name` vier preenchido
- **Baixar PDF da vaga** somente se `pdf_url` apontar para `/users/me/files/{nome}` e `generation_blocked` não for verdadeiro

`matching_skills` e `missing_skills` entram no parse e não aparecem no card. Abaixo de cada análise fica a seção de carta (fluxo d).

A tela pede a primeira página com `limit=20` e `offset=0`. Não há controle de paginação.

### Perfil (`/perfil`)

Três seções:

1. **Perfil** — `GET /users/me`. Exibe nome, e-mail, plano e status da assinatura somente se o JSON trouxer. Rótulos de plano: `free` → “Free”, `essencial` → “Essencial”; outro valor aparece cru. Status: `none` → “Sem assinatura”, `active` → “Ativa”, `past_due` → “Pagamento pendente”, `canceled` → “Cancelada”; valor desconhecido fica cru. Sem nome, e-mail, plano e status, a tela diz “A conta nao trouxe nome, email ou plano.” Cota (`used` / `limit` / `remaining`) não faz parte deste endpoint. Há um segundo botão **Sair**, com o mesmo efeito do header. Erro de carga tem **Tentar novamente**.
2. **Privacidade e LGPD** — abre a política vigente com o mesmo `GET /legal/privacy?version=1.0` do cadastro.
3. **Seus dados** — **Exportar meus dados** e **Solicitar exclusao de conta** (fluxo f).

Não há edição de currículo, perfil manual nem upload nesta tela.

### Consent gate

Diálogo modal “Documentos legais atualizados” / “Atualizar aceites”. O app por baixo fica sem clique (`pointer-events-none`); trocar de rota não contorna o bloqueio.

Mostra só o documento desatualizado (termos, privacidade ou os dois), versão vigente 1.0, com o mesmo painel de texto + checkbox do cadastro. **Aceitar e continuar** só habilita depois da leitura e do aceite de cada documento pendente. **Sair** desloga.

## Fluxos

Autenticação em todas as chamadas abaixo: header `Authorization: Bearer <access_token>` quando há JWT. O cliente não envia `X-User-Id` nem cookie de sessão.

### a) Auth e consentimento

1. Cadastro carrega `GET /legal/terms?version=1.0` e `GET /legal/privacy?version=1.0` (texto, não JSON).
2. **Criar conta** envia `POST /auth/register` com `display_name`, `email`, `password`, `terms_accepted: true`, `terms_version: "1.0"`, `privacy_accepted: true`, `privacy_version: "1.0"`.
3. **Entrar** envia `POST /auth/login` com `email` e `password`.
4. A resposta traz `access_token` (e `token_type`, em geral `bearer`). O token fica só no store em memória do `AuthProvider`.
5. Em seguida o app chama `GET /auth/me` com o Bearer. `user` da resposta de login, se vier, é só um passo intermediário.
6. Se `GET /auth/me` devolver `terms_version` ou `privacy_version` preenchida e diferente de `1.0`, o ConsentGate abre. Versão ausente ou em branco não abre o gate por si só.
7. Qualquer chamada autenticada que responda **403** com `detail.code` `TERMS_OUTDATED` ou `PRIVACY_OUTDATED` também abre o gate. O overlay lista o documento de cada code devolvido; os dois podem aparecer juntos.
8. **Aceitar e continuar** faz um `POST /consent` por documento pendente, body `{ "doc": "terms" | "privacy", "version": "1.0" }`, e depois outro `GET /auth/me`. Se as versões voltarem vigentes, o overlay some e a tela de baixo volta a responder.
9. **Sair**, ou recarregar a página, apaga o JWT. Não há sessão restaurada.

`/consent` e `/legal/*` são as rotas de API que o gate e os painéis legais usam; o restante autenticado fica atrás do gate.

### b) Análise de vaga

Pré-condição: JWT e ConsentGate fechado. A Home então chama `GET /users/me/status`.

Preparar o currículo, se `has_embeddings` não for `true`:

1. `POST /users/me/upload-cv` — `multipart/form-data`, campo `file` (`.pdf` ou `.txt`). O browser define o boundary.
2. `POST /users/me/rebuild-embeddings` — sem body.
3. `GET /users/me/status` de novo. **Analisar vaga** só liga se este JSON tiver `has_embeddings === true`. Upload ou rebuild ok, sozinhos, não liberam o botão. Se já havia CV sem embeddings, dá para **Gerar embeddings** sem reenviar o arquivo.

Analisar:

1. `POST /processar` com `{ "texto": "<descrição colada>" }`.
2. Sucesso com PDF: a UI mostra o texto e o match. **Baixar PDF autenticado** extrai o nome do arquivo de `pdf_url` (absoluta ou relativa, no padrão `/users/me/files/{nome}`) e faz `GET /users/me/files/{nome}` com Bearer. O token não entra na URL e não há `<a href>` direto para a API. Os bytes só contam como download se começam com `%PDF`; aí o browser baixa um Blob e a object URL é revogada. Senão, erro no painel (“O arquivo baixado nao e um PDF valido…”).
3. `generation_blocked: true` ou `pdf_url` nulo/ausente: bloco “PDF nao gerado”, sem botão de download.
4. **402** com `detail.code` `QUOTA_EXCEEDED` ou `SUBSCRIPTION_REQUIRED`: bloco “Cota mensal esgotada” com a mensagem da API (ou o texto padrão do cliente). Não há retry em loop nem cota gravada no browser. A mensagem orienta a esperar o próximo período UTC ou uma assinatura no servidor. Não há checkout.
5. **400** e outras falhas: alerta “Nao foi possivel analisar”, com a mensagem devolvida. Não vira sucesso.
6. **403** `TERMS_OUTDATED` / `PRIVACY_OUTDATED` volta ao ConsentGate.
7. Depois de um processar aceito, a Home atualiza o status. Falha nesse refresh não transforma a análise já recebida em erro.

### c) Histórico

1. Com JWT e sem gate, abrir `/historico` dispara `GET /users/me/gap-history?limit=20&offset=0`.
2. **200** `{ items, limit, offset }` com itens: lista das análises desta conta (título, empresa, score, data e o restante descrito na tela).
3. **200** com `items: []`, ou lista nua vazia: estado vazio. Itens sem `id` (ou `insight_id`) são ignorados.
4. Sem JWT a rota nem monta o painel: redirect para `/`, sem Bearer vazio.
5. **401**: “Sessao expirada. Entre novamente para ver o historico.” O painel não chama logout sozinho; **Sair** (ou F5) limpa a sessão.
6. **403** de consentimento abre o ConsentGate. Outro erro (5xx, rede) mostra texto fixo, sem path, URL, token ou stack, e **Tentar novamente**.
7. **Baixar CV** chama `GET /users/me/files/{cv_file_name}` com Bearer, cria um Blob e revoga a object URL. Sem link direto e sem token na query. Sem `cv_file_name` (null, vazio ou ausente) não há botão e a API de arquivo não é chamada.
8. **Baixar PDF da vaga** usa `pdf_url` só para achar o nome do arquivo e faz o mesmo GET autenticado. `generation_blocked: true` ou `pdf_url` que não seja `/users/me/files/{nome}` não mostra esse botão.
9. No download, o botão fica em loading e desabilitado (sem segundo clique). **401** volta ao login. **403** `TERMS_OUTDATED` / `PRIVACY_OUTDATED` abre o ConsentGate. **404**, **5xx**, rede e HTML de erro mostram texto fixo, sem stack, path, URL, HTML cru ou token. A lista e **Gerar carta** permanecem.
10. O arquivo sai só por fetch com Bearer e Blob. `pdf_url` e `cv_file_name` não viram `<a href>` nem `window.open`. JWT, bytes do PDF/CV e o token não são gravados em `localStorage`, `sessionStorage` ou IndexedDB, e não vão para o console. Não há Stripe nem checkout nesta tela.

### d) Carta de apresentação

Na lista do histórico, cada análise tem **Gerar carta**. O texto da carta vive só no estado do componente: não vai para `localStorage` nem `sessionStorage`. Sair de `/historico` ou recarregar apaga a carta. A lista de análises continua no servidor.

1. `company_name` vazio, ausente ou só espaços: botão desabilitado, dica “Esta analise nao tem empresa. A carta so pode ser gerada quando a vaga informa o nome da empresa.”, e **nenhuma** chamada.
2. Com empresa, **Gerar carta** envia `POST /users/me/cover-letter` com `{ "empresa": "<company_name>" }` e Bearer. Enquanto a requisição corre o botão fica desabilitado (sem segundo POST).
3. Sucesso: mostra `texto_resposta` com as quebras de linha, título “Carta de apresentacao para {empresa}”.
4. **Copiar** usa `navigator.clipboard.writeText`. Aviso `aria-live`: “Carta copiada.” ou “Nao foi possivel copiar a carta.”
5. **Baixar PDF** usa `pdf_url` só para achar o nome do arquivo e chama `GET /users/me/files/{nome}` com Bearer. O download é um Blob (`application/pdf`); a object URL é revogada. Sem link direto e sem token na query. O arquivo precisa começar com `%PDF`.
6. **500** ou rede: “Nao foi possivel gerar a carta.” (ou a variante sanitizada), com **Tentar de novo**. A lista do histórico permanece.
7. **402** ou **429**: aviso “Limite de uso” / “Limite de uso atingido. Nao e possivel gerar a carta agora.” Sem botão nem link de pagamento. A fatia registra que esta rota não consome cota hoje; a UI trata esses status por defesa.
8. Sem JWT, `/historico` nem abre. **401** na carta ou no PDF desloga e volta ao login em `/`. **403** de termos/privacidade abre o ConsentGate.

Ver a nota no final sobre empresa gravada como `Nao informado`.

### e) Perfil leve

1. Abrir `/perfil` com JWT e sem gate chama `GET /users/me`.
2. A tela mostra `display_name`, `email`, `plan` e `subscription_status` quando presentes. Não mostra cota.
3. **Política de privacidade** chama `GET /legal/privacy?version=1.0` e mostra o markdown no painel.
4. **Sair** (header ou o botão do perfil) limpa o JWT em memória e volta a `/` no estado de login. Nada é escrito em `localStorage` ou `sessionStorage`.
5. Sem JWT, redirect para `/` antes do GET. **401** na carga do perfil mostra “Sessao expirada. Entre novamente para ver o perfil.” **403** de consentimento abre o gate.

### f) LGPD (na mesma tela Perfil)

Os botões só agem com JWT e gate fechado. Sem sessão, `/perfil` redireciona e estes endpoints não são chamados.

**Exportar meus dados**

1. `GET /users/me/export` com Bearer.
2. Resposta 200 `application/json`, sem `Content-Disposition`. O cliente baixa o objeto como `meus-dados.json` (Blob + object URL).
3. Antes do download, remove em qualquer nível as chaves `password`, `password_hash`, `passwd`, `hash`, `access_token`, `refresh_token`, `jwt`, `token` e `authorization` (comparação sem diferenciar maiúsculas). Essas chaves não aparecem na tela. O restante do JSON permanece, inclusive `user`, `profile`, `processing_runs`, `job_analysis_insights`, `development_plans`, `documents`, `generated_files`, `processar_usage` e `exported_at` quando a API os envia.
4. Erro 404/5xx: mensagem sem path, URL ou token, com **Tentar novamente**.
5. **401** volta ao login, sem o aviso de conta excluída. **403** `TERMS_OUTDATED` ou `PRIVACY_OUTDATED` abre o ConsentGate.

**Solicitar exclusão de conta**

1. Abre o diálogo “Excluir conta”. Cancelar, Escape, campo vazio ou qualquer texto que não seja exatamente `DELETE` **não** chama a API. Texto diferente mostra “A confirmacao nao confere. A exclusao nao foi enviada.”
2. Só com `DELETE` exato o cliente envia `DELETE /users/me` e body `{ "confirm": "DELETE" }`.
3. Sucesso exige `deleted: true` (a resposta também traz `user_id` e `deleted_at`). Aí o JWT é limpo e `/` mostra “Sua conta foi excluida.” Sem `deleted: true`, a sessão permanece e a tela mostra erro.
4. **401** também volta ao login, sem essa mensagem.
5. Este DELETE não passa pela checagem de termos no backend. A UI de perfil fica atrás do ConsentGate, então o botão não é clicável enquanto o reaceite está aberto.

## Regras transversais

- **Bearer only.** Header `Authorization: Bearer <access_token>`. Nunca `X-User-Id`, nunca cookie de sessão. O JWT não entra em query string, nem no `href` de download.
- **JWT só em memória.** Logout, exclusão de conta e F5 zeram a sessão. O store não usa `localStorage` nem `sessionStorage`.
- **Erros sem path, URL ou token** nas telas de histórico, perfil, carta e LGPD: mensagem que vazaria path (`/users/me`, `/auth/`, `/legal/`, `cover-letter`, `gap-history`), URL, `Bearer`, `access_token` ou stack é trocada por texto fixo em pt-BR. O ConsentGate continua a ver o 403 de aceite. No cliente genérico (login, processar, upload), a mensagem pode ser o `detail`/`message` da API; falha de rede inclui a base configurada.
- **HTTPS em produção.** No build, `http://` redireciona para `https://` (exceto localhost e `127.0.0.1`) e o HTML ganha CSP `upgrade-insecure-requests`. `npm run dev` em localhost pode ficar em `http://`.
- **PWA.** Manifest `Meu Agente de Emprego` / short name `MAE`, `lang: pt-BR`, `display: standalone`, `start_url: /`. O service worker registra só no build de produção (`registerType: autoUpdate`). No dev o plugin de PWA fica desligado; no e2e o service worker é bloqueado.

## Fora de escopo atual

Não há tela nem fluxo para:

- Stripe, checkout ou upgrade de plano (W3). Cota esgotada não abre pagamento.
- UI de PDI (plano de desenvolvimento). O export pode trazer `development_plans` no JSON; o app não tem tela para isso.
- Edição de currículo, edição da carta, perfil manual ou biometria. O CV só entra pelo upload `.pdf`/`.txt` do Início; a carta só é gerada, copiada e baixada na sessão.
- App mobile. A paridade visual com o Flutter é referência de UX; este repositório é o cliente web.

## Nota conhecida: empresa `Nao informado`

O bloqueio da carta (cenário C5) olha só se `company_name`, depois do trim, está vazio. `null`, ausência ou espaços desabilitam **Gerar carta**.

O backend pode gravar empresa ausente como a string `Nao informado`. Isso não é vazio, então o front trata como empresa de verdade: mostra “Empresa: Nao informado” e **habilita** o botão, enviando `{ "empresa": "Nao informado" }`. O bloqueio C5 não cobre esse sentinela.
