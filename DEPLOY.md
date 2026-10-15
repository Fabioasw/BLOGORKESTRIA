# Captação comercial TOTVS RM — operação e publicação

## Estado desta entrega

Implementação na branch `feature/totvs-rm-leads-admin`, baseada no commit de produção `1fd8ea9d987ebfd7b3a20c5dbba19f915d1eeaad`. Nenhum push, merge, deploy ou migração remota foi executado nesta etapa. Publicar e migrar o banco exigem autorização expressa do usuário.

O site é HTML/CSS/JavaScript estático, sem React, SPA ou diretório de build de frontend. Não há fallback SPA configurado; seu comportamento continua o padrão de Static Assets. O Worker agora usa `src/worker/index.ts`, TypeScript, o binding `ASSETS` e o binding D1 `DB`. Apenas `/api/*`, `/admin` e `/admin/*` passam primeiro no Worker. Os demais assets mantêm o fluxo e cache da Cloudflare. APIs desconhecidas retornam 404 JSON.

O banco fornecido foi configurado no TOML: `orkestria-leads`, ID `ed13b097-dc98-4800-97dd-04a75c4107b4`. A existência e o conteúdo remotos não foram consultados nem alterados. O nome e o domínio do Worker continuam os existentes. A home não foi modificada.

## Arquivos e dependências

- `src/worker/`: roteamento, tipos de ambiente, HTTP, validação, segurança, captação e APIs administrativas.
- `migrations/0001_commercial_leads.sql`: tabelas `leads`, `lead_events`, `request_limits`, índices, FK com cascade e trigger de criação do histórico.
- `assets/totvs-rm.js`, `totvs-rm.html`: formulário original adaptado; WhatsApp como alternativa secundária.
- `admin/leads.html`, `assets/admin.js`, `assets/admin.css`: painel protegido.
- `wrangler.toml`, `.assetsignore`, `_headers`, `robots.txt`: bindings, roteamento, proteção e indexação.
- `privacidade.html`: finalidade, marketing opcional, retenção e exclusão.
- `tests/`: testes automatizados, teste no runtime Cloudflare e prévia local isolada.
- `package.json`, `package-lock.json`, `tsconfig.json`: ferramentas e versões reproduzíveis.

Única dependência de produção adicionada: `jose`, para validação criptográfica de JWT do Access. Wrangler, TypeScript, tipos Workers e tipos Node são ferramentas de desenvolvimento. O frontend não ganhou framework ou dependências visuais.

## Instalação e testes locais

Use Node.js 24 ou superior e npm. Instale as versões do lockfile com `npm ci`. Se a política do npm bloquear scripts de instalação dos pacotes oficiais esbuild/workerd, aprove-os no gerenciador ou execute os instaladores locais conhecidos:

```text
node node_modules/esbuild/install.js
node node_modules/workerd/install.js
npm run check
npm test
npm run test:runtime
npm run build
```

`check` executa TypeScript estrito. Não havia linter no repositório e não foi adicionado um linter apenas para esta entrega; os scripts de navegador também foram verificados com `node --check`. `build` executa somente `wrangler deploy --dry-run`, sem publicar.

`npm test` usa SQLite local, consultas reais, transações reais e JWTs RSA assinados no próprio teste; a resposta externa do Turnstile é simulada. `npm run test:runtime` inicia temporariamente Workerd com D1 local separado em um diretório curto e exclusivo `work/r<identificador>`, aplica as migrações locais e testa a mesma aplicação no runtime Cloudflare. O Access usa um par de chaves efêmero local com validação real de assinatura; apenas o Turnstile é substituído por uma fixture. Não existe essa substituição no entrypoint de produção. O processo de teste é encerrado ao terminar.

Para o Worker real sem chaves configuradas, use:

```text
npm run db:local
npm run dev -- --ip 127.0.0.1 --port 8789
```

Sem as chaves, a captação responde 503 e o botão fica indisponível. O painel também permanece fechado enquanto o Access não estiver configurado. Isso é esperado.

Para revisar visualmente com dados fictícios, use `npm run preview:fixtures` e abra:

- `http://127.0.0.1:8790/totvs-rm`
- `http://127.0.0.1:8790/admin/leads`

A prévia liga apenas em loopback, usa `work/admin-qa.sqlite`, mostra aviso de teste e assina JWTs locais. Nunca usa o D1 remoto. Os modos `/__fixtures/mode?value=database`, `network`, `lost-response`, `delay`, `anonymous` e `unauthorized` permitem reproduzir falhas. Restaure com `value=normal`. Os caminhos de fixture não existem na aplicação de produção. Não publique `tests/` ou arquivos de `work/`.

## Variáveis e secrets pendentes

Configure valores reais antes de publicar:

| Nome | Tipo | Finalidade |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Variável pública | Widget do formulário; liberada por `/api/leads/config` |
| `TURNSTILE_SECRET_KEY` | Secret | Validação no Siteverify; nunca exposta ao frontend |
| `RATE_LIMIT_SECRET` | Secret aleatório forte | Derivação diária do identificador de IP para proteção de abuso |
| `ACCESS_TEAM_DOMAIN` | Variável | `https://SEU-TIME.cloudflareaccess.com`, sem barra final |
| `ACCESS_AUD` | Variável | AUD da aplicação Access que protege painel e APIs |
| `ADMIN_EMAILS` | Variável | Já configurada com `fabioasw01@gmail.com`, escolhido pelo usuário |
| `RETENTION_DAYS` | Variável | 180 por padrão; inteiro entre 1 e 3650 |
| `PRIVACY_NOTICE_VERSION` | Variável | `2026-10-15`; atualizar junto com a política de privacidade |

Os nomes acima estão nos tipos TypeScript. O endpoint público não revela secrets ou configurações administrativas. Não envie secrets pelo chat nem faça commit de arquivos com credenciais. `.dev.vars*` e `.env*` são ignorados pelo Git; a lista de assets permite apenas o site.

## Proteção administrativa com Cloudflare Access

Depois da aprovação para configuração externa, crie uma aplicação Access para o domínio existente e inclua os destinos `/admin/*`, `/admin` e `/api/admin/*`. Inclua aliases `.html` e eventuais domínios de preview na proteção quando existirem. Preferencialmente use a mesma aplicação/AUD para todos esses caminhos. A política deve permitir somente os administradores aprovados, começando por `fabioasw01@gmail.com`. Ative o método de autenticação adequado no Access e exija verificação do e-mail. Não use política Bypass.

Copie o team domain e AUD reais para a configuração. O Worker verifica assinatura RSA usando JWKS do domínio confiável, issuer, audience, expiração, presença de identidade e a lista `ADMIN_EMAILS`. Cabeçalhos de e-mail isolados não autenticam ninguém. Sem token válido, a aplicação não serve nem o HTML administrativo nem os dados. A proteção do backend permanece ativa mesmo se uma regra do Access na borda estiver incorreta; nesse caso o painel fecha com 401/403/503.

Todas as respostas administrativas são privadas e sem cache; a página recebe `noindex,nofollow` e CSP. O painel não carrega analytics. A pesquisa usa POST para evitar nome/e-mail pesquisado em URLs. Mutação e exclusão exigem Origin do mesmo site; concorrência usa a versão do registro. Não há exportação pública nem senha fixa de administrador.

## API e armazenamento

- `GET /api/leads/config`: disponibilidade, site key pública e versão do aviso.
- `POST /api/leads/totvs-rm`: seis campos, preferências, campanha e token; exige `Idempotency-Key` UUID v4.
- `GET /api/admin/session`, `GET /api/admin/stats`: identidade e indicadores, autenticados.
- `POST /api/admin/leads/search`: pesquisa, status, datas UTC, origem, ordenação e paginação.
- `GET /api/admin/leads/:id`: dados completos e histórico.
- `PATCH /api/admin/leads/:id`: status e/ou observação, com `version` atual; histórico transacional.
- `DELETE /api/admin/leads/:id`: exclusão permanente com `version` e confirmação do ID. O painel exige digitar EXCLUIR.

Respostas seguem `{ok,data,requestId}` ou `{ok:false,error:{code,message,fields?},requestId}`. Sucesso na criação é 201, repetição confirmada é 200. Payload inválido 400, sessão ausente/inválida 401, falta de autorização/origem 403, API desconhecida 404, método 405, versão conflitante 409, payload excessivo 413, tipo incorreto 415, limite 429, erro interno 500 e dependência/configuração indisponível 503. O backend só retorna sucesso depois de consultar a gravação confirmada no D1.

A tabela `leads` armazena os campos solicitados, campanha quando permitida, consentimento de marketing, aviso de privacidade, datas, versão de concorrência e chave/hash de idempotência. A tabela `lead_events` registra criação, mudanças de status e observações com o ID do administrador. Dados textuais são tratados como texto na interface, sem innerHTML de conteúdo recebido. Todas as consultas com entradas do usuário são parametrizadas; nomes de colunas e direções são escolhidos de listas fechadas.

O limite é de oito tentativas por IP e janela fixa de dez minutos, incluindo payloads inválidos. O IP não é salvo em claro nessa tabela, e o identificador muda diariamente. O Turnstile complementa a proteção e verifica success, hostname e action `totvs_rm_lead`. Em tráfego hostil distribuído, complemente com as regras WAF adequadas à conta.

## Retenção e solicitações de exclusão

O cron diário às 03:17 UTC limpa contadores expirados e exclui leads `novo`, `convertido` e `descartado` sem atualização por mais de `RETENTION_DAYS`. O histórico desses leads é removido por FK cascade. Oportunidades em análise, qualificadas, com reunião ou proposta exigem revisão humana periódica; o cron não apaga negociações em andamento automaticamente. A versão e as datas mudam nas atualizações comerciais. O parâmetro inválido impede a limpeza e gera somente um identificador genérico de erro.

A pessoa responsável deve confirmar pedidos legítimos e sua autorização antes de usar a exclusão do painel. A exclusão é permanente e inclui o histórico. Contatos feitos no WhatsApp alternativo são atendidos naquele canal e não são importados automaticamente para o D1. A identificação jurídica do controlador, a política e o prazo precisam de revisão do negócio antes da ativação.

## Marketing e SEO

A medição opcional controla armazenamento de UTMs/gclid e eventos. O backend descarta a atribuição quando `measurement_consent=false`, mesmo que o cliente envie parâmetros. Marketing por e-mail é um checkbox separado e desmarcado por padrão. A solicitação funciona sem aceitar marketing ou medição.

Eventos preparados: `page_view`, `view_totvs_rm`, `select_service`, `begin_lead_form`, `generate_lead`. O último só aparece após confirmação de gravação, uma vez na página. O dataLayer não contém dados do formulário, query string, ID do lead ou conteúdo administrativo. Nenhum ID GA4/GTM ou pixel foi inventado. A conexão a anúncios e suas regras de consentimento/revogação permanecem opcionais e pendentes; não inicie campanhas automaticamente.

A página mantém HTML indexável, um H1, canonical, Open Graph, JSON-LD Service, sitemap e links internos. Título e descrição foram revisados conforme o briefing. `/admin` e `/api/` ficam fora da indexação. A home e os artigos não tiveram design alterado.

## Sequência de ativação — somente após autorização expressa

1. Revisar a branch, o relatório de testes, a política e a estratégia de rollback. Confirmar o e-mail administrativo e obter os valores reais de Turnstile e Access.
2. Configurar o widget Turnstile com os hostnames exatos de produção e o Access com os caminhos e a política acima. Não usar chaves fictícias em produção.
3. Autenticar Wrangler numa conta autorizada com `npx wrangler login`. Conferir que a conta contém o Worker e o D1 informados.
4. Fazer backup do D1 existente, se necessário: `npx wrangler d1 export DB --remote --output work/pre-activation.sql`. Tratar o backup como dado restrito e mantê-lo fora do Git/assets.
5. Aplicar a migração, SOMENTE após autorização para essa ação: `npx wrangler d1 migrations apply DB --remote`. Não executar comandos destrutivos de teste no banco remoto.
6. Preencher as variáveis públicas reais em `wrangler.toml`. Criar localmente um arquivo ignorado `.dev.vars.production` com apenas `TURNSTILE_SECRET_KEY` e `RATE_LIMIT_SECRET`, sem imprimi-las ou incluí-las no Git.
7. Para a primeira ativação saindo de um Worker somente estático, Wrangler 4.151.0 permite publicar código e secrets na mesma versão: `npx wrangler deploy --secrets-file .dev.vars.production`. Isso adiciona o entrypoint e o binding `DB` no Worker existente sem depender de adicionar binding manualmente ao Worker somente estático. Essa operação publica em produção e exige aprovação.
8. Integrar a branch a `main` apenas se o merge também tiver sido autorizado. O GitHub pode acionar novo deploy do mesmo código; mantenha o comando de deploy e as variáveis coerentes com o TOML. Secrets existentes são preservados por deploys posteriores. Sem o cuidado com as variáveis, Wrangler pode substituir vars definidas somente no painel.
9. Validar a URL pública, disponibilidade, Turnstile real, criação de um lead de homologação autorizado, registro no painel, repetição idempotente, histórico, bloqueio de usuário não autorizado e funcionamento das páginas antigas. Verificar também CSP, cache, cron e exclusões de assets.

Não foi criado um ambiente remoto de homologação com binding de produção. Se for necessário, configure um D1 separado antes de testar ali. As chaves padrão de teste Turnstile podem retornar hostname fictício e são rejeitadas pela checagem estrita; use uma fixture local ou um widget separado para desenvolvimento. A validação do serviço Turnstile real e do Access real ainda depende da configuração externa.

## Rollback

Antes da ativação, registre a versão ativa do Worker na Cloudflare e preserve o commit de produção. Se a nova versão falhar, restaure a versão anterior pelo painel de deployments ou por `npx wrangler rollback <VERSION_ID_REAL>`, após autorização para o rollback. Suspenda/coordene o deploy automático para não republicar a versão problemática. Outra opção é reverter o commit de aplicação na main com revisão e autorização, mantendo o esquema do banco.

A migração inicial é aditiva. Não apague tabelas nem reverta dados para fazer rollback da aplicação. O site anterior com WhatsApp pode continuar funcionando enquanto o D1 fica preservado. Faça correções futuras com novas migrações versionadas; nunca edite uma migração já aplicada. Uma restauração de dados/backups exige avaliação e autorização separadas.

Referências: [Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/), [validação Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [D1](https://developers.cloudflare.com/d1/worker-api/), [Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
