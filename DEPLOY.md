# Publicação da landing page TOTVS RM

O site continua em HTML/CSS/JavaScript estático, com o mesmo Worker Cloudflare e sem dependências de produção. A nova função de backend usa o D1 (SQLite gerenciado) porque o repositório não contém SQL Server nem outro banco configurado. Não execute publicação com a captação incompleta.

## Configuração da Cloudflare

1. Autentique o Wrangler em uma conta autorizada: `pnpm dlx wrangler@4.151.0 login`.
2. Crie o banco: `pnpm dlx wrangler@4.151.0 d1 create orkestria-leads`.
3. Descomente o bloco `[[d1_databases]]` em `wrangler.toml` e substitua o exemplo pelo ID real retornado. Preserve o binding `LEADS_DB` e `migrations_dir = "migrations"`.
4. Aplique a migração: `pnpm dlx wrangler@4.151.0 d1 migrations apply orkestria-leads --remote`.
5. Crie um widget Turnstile com os domínios reais de publicação autorizados. Configure a chave pública `TURNSTILE_SITE_KEY` como variável no Worker, ou em `[vars]` no TOML. Para uso via CI, mantenha a configuração coerente com o Wrangler, pois variáveis de configuração podem ser substituídas no deploy.
6. Configure os segredos interativamente, sem incluí-los no repositório ou em argumentos de shell:

```text
pnpm dlx wrangler@4.151.0 secret put TURNSTILE_SECRET_KEY
pnpm dlx wrangler@4.151.0 secret put RATE_LIMIT_SECRET
```

Use um valor aleatório forte e exclusivo para `RATE_LIMIT_SECRET`. As chaves Turnstile reais devem corresponder ao mesmo widget. O backend verifica sucesso, hostname e a action `totvs_rm_lead`. Não há bypass de CAPTCHA no código de produção.

7. Revise a política `/privacidade`, a identificação jurídica do controlador, a retenção de 180 dias e as pessoas autorizadas a acessar os registros. A relação comercial Orkestria/FNunes não está documentada no repositório e precisa de confirmação; a página conserva Orkestria Consult.
8. Valide primeiro em Worker/domínio de homologação, com D1 e chaves próprios. Não reutilize o banco de produção para testes. O hostname de homologação precisa ser autorizado no widget.

Referências oficiais: [assets e exclusões](https://developers.cloudflare.com/workers/static-assets/binding/), [D1](https://developers.cloudflare.com/d1/worker-api/), [validação Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Verificação e publicação

```text
node --check worker.mjs
node --check assets/totvs-rm.js
node --check assets/navigation.js
node --test tests/worker.test.mjs
pnpm dlx wrangler@4.151.0 deploy --dry-run --outdir work/dry-run
```

Não existe build de frontend, lint ou TypeScript no projeto. O `deploy --dry-run` valida e empacota o Worker sem publicar. Para testar com o runtime Cloudflare instalado, use `pnpm dlx wrangler@4.151.0 dev --local` e aplique a migração com `d1 migrations apply orkestria-leads --local`. Valide também o Turnstile real em homologação; as chaves de teste da Cloudflare podem retornar um hostname fictício, que o backend corretamente rejeita.

Depois de concluir as configurações e os testes de homologação, publique com `pnpm dlx wrangler@4.151.0 deploy`, ou pelo fluxo Git/Cloudflare existente. O README original informa que push em `main` dispara publicação automática. Sem as configurações externas, a página pode ser publicada, mas a captação permanece indisponível. Preserve o domínio e as rotas existentes no painel Cloudflare. O sucesso do push não comprova a conclusão do deploy; confira o resultado na Cloudflare e teste a URL pública.

Confira por acesso direto e atualização: `/totvs-rm`, `/privacidade`, `/`, `/processos.html`, `/blog/` e os artigos. Confirme resposta `available: true` em `/api/leads/config`, envio válido com HTTP 201, um registro no D1, repetição sem duplicação, erro de validação com HTTP 422 e limitação com HTTP 429. Confira `_headers`, exclusões de `.assetsignore`, sitemap e robots no ambiente publicado. O default de Static Assets resolve `totvs-rm.html` na rota amigável `/totvs-rm`; não foi adicionada regra de fallback SPA.

O endpoint `POST /api/leads/totvs-rm` retorna 503 quando faltam banco ou chaves. O frontend desabilita o envio e informa indisponibilidade. Isso impede confirmação simulada; o fluxo comercial não está concluído em produção até a configuração e o teste reais.

## Leads e acompanhamento comercial

Os registros ficam na tabela `leads`, com os seis campos do formulário, origem `totvs-rm`, UTMs, gclid, datas, fingerprint e status (`novo`, `em_contato`, `encerrado`). Todas as entradas são parâmetros SQL; conteúdo do usuário não é renderizado em HTML nem registrado em logs. A tabela `lead_rate_limits` guarda um hash diário derivado do IP e um contador temporário. O limite é oito tentativas de payload válido por janela fixa de dez minutos e IP; o Turnstile complementa essa proteção. Para ataques distribuídos, configure também as regras WAF apropriadas à conta.

As pessoas autorizadas podem consultar os novos contatos no console D1 da Cloudflare:

```sql
SELECT id, nome, email, empresa, cargo, necessidade, descricao,
       utm_source, utm_medium, utm_campaign, criado_em, status
FROM leads WHERE status = 'novo' ORDER BY criado_em DESC;
```

Atualize o status ao iniciar o atendimento. Não há painel público, envio automático de e-mail ou integração com CRM nesta implementação. O fluxo exige um responsável por consultar o D1 e acompanhar os novos registros. O cron diário às 03:17 UTC limpa contadores expirados e leads `novo`/`encerrado` sem atualização há 180 dias; leads `em_contato` exigem revisão humana periódica. Confirme a execução do cron em produção. O trigger atualiza `atualizado_em` nas alterações comerciais.

## Medição e consentimento

Não foram encontrados GA4/GTM no código. Nenhum ID de medição foi inventado e nenhum script de publicidade foi instalado. Com permissão opcional do visitante, os eventos `page_view`, `view_totvs_rm`, `select_service`, `begin_lead_form` e `generate_lead` são enviados ao `dataLayer` e ao evento DOM `orkestria:analytics`. `generate_lead` só ocorre após `ok: true` recebido do backend. Os eventos contêm apenas rota canônica e o serviço selecionado; excluem dados do formulário e a query string.

UTMs e gclid são mantidos em `sessionStorage` apenas após permissão, recuperados na mesma aba e enviados junto do lead. A recusa elimina essa atribuição local e não impede o formulário. A preferência é armazenada em `localStorage`. Sem permissão, o lead continua sendo registrado com a origem funcional `totvs-rm`, sem identificadores de campanha. Novos anúncios não devem incluir dados pessoais em UTMs.

Para ativar GA4/GTM, configure IDs reais, consentimento/revogação e sanitização de URLs no gerenciador. Ajuste a CSP apenas para os domínios efetivamente usados. Evite page views automáticos duplicados, medição de formulários automáticos e captura de query strings/PII pelo gerenciador. A integração com as plataformas de anúncios e a persistência de consentimento nessas plataformas ainda precisam ser testadas.

## Prévia e testes isolados

`node tests/preview.mjs` abre uma prévia sem captação configurada em `http://127.0.0.1:8787/totvs-rm`. Este servidor é de desenvolvimento e não substitui o runtime Cloudflare.

`node tests/preview.mjs --fixtures` abre o ambiente **somente de teste** em `http://127.0.0.1:8788/totvs-rm`. Usa o Worker real com SQLite local em `work/preview.sqlite` e uma fixture local que simula o serviço de verificação; nunca carrega/resolve CAPTCHA real. Os arquivos `tests/` e `work/` não são publicados. `/__fixtures/mode?value=network` simula falha de conexão, `value=delay` atrasa o envio e `value=normal` restaura o funcionamento. Esse modo não existe no Worker de produção.

Limitações desta entrega: sem sessão Cloudflare autenticada; D1 remoto, Turnstile real, cron, cabeçalhos da CDN e métricas de usuários reais não verificados. O `wrangler dev` falhou neste computador por ausência do executável `workerd.exe`; a inspeção visual usou a prévia Node. Não há evidência para declarar as metas de Core Web Vitals cumpridas.
