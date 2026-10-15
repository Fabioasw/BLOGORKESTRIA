# Publicação da landing page TOTVS RM

## Arquitetura atual

O site mantém HTML/CSS/JavaScript estático e a publicação existente na Cloudflare. A rota `/totvs-rm` prepara uma mensagem para o WhatsApp **+55 (19) 97154-1730**. O visitante revisa e confirma o envio no aplicativo. Por escolha do usuário, a versão anterior com D1/Turnstile foi removida; não existe endpoint de captação, banco, migração, cron, segredo ou serviço de envio para configurar.

O conteúdo preenchido permanece na memória da página e é incluído no link `wa.me` ao continuar. O site não grava os dados do formulário em armazenamento persistente. As mensagens efetivamente enviadas ficam no WhatsApp. Abrir a mensagem não comprova envio ou recebimento. Se a abertura automática for bloqueada, aparece um link para abrir manualmente.

## Verificação e publicação

```text
node --check assets/totvs-rm.js
node --check assets/navigation.js
pnpm dlx wrangler@4.151.0 deploy --dry-run --outdir work/dry-run
```

Não há build de frontend, lint ou TypeScript no projeto. O dry-run valida a configuração e prepara os assets sem publicar. A lista `.assetsignore` permite apenas as páginas e pastas públicas; arquivos Git, documentação, testes e arquivos temporários não são assets públicos. Inclua novas páginas nessa lista quando necessário.

O README original informa que push em `main` dispara a publicação automática na Cloudflare. O sucesso do push não comprova o deploy. Verifique a execução no painel e depois acesse `https://orkestriaplatform.com/totvs-rm`. Não é necessário configurar D1 ou Turnstile para esta versão.

Confira acesso direto e atualização de `/totvs-rm`, `/privacidade`, `/`, `/processos.html`, `/blog/` e artigos. Confira também sitemap, robots, cabeçalhos e a ausência de publicação dos arquivos internos. Teste o WhatsApp pelo celular e pelo WhatsApp Web; o último envio deve ser confirmado pelo visitante.

## Medição opcional

Não foram encontrados GA4/GTM e nenhum ID foi inventado. Com permissão opcional do visitante, os eventos `page_view`, `view_totvs_rm`, `select_service`, `begin_lead_form` e `open_whatsapp` são disponibilizados no dataLayer e no evento DOM `orkestria:analytics`. Nenhum evento `generate_lead` é disparado, pois o site não tem confirmação do envio da mensagem. Os eventos excluem dados pessoais do formulário e usam somente a URL canônica e o serviço selecionado.

UTMs e gclid ficam em sessionStorage apenas após permissão e podem acompanhar a mensagem preparada. A preferência fica em localStorage; a recusa apaga a atribuição nesta aba e não impede o contato. A configuração de IDs reais, consentimento e tags das plataformas de anúncios continua opcional e pendente. Evite medição automática de formulários, URLs completas com mensagens e duplicação de page views.

## Prévia local

`node tests/preview.mjs` inicia `http://127.0.0.1:8787/totvs-rm`, sem banco e sem simulação de envio. O servidor serve apenas os arquivos públicos. Não substitui os testes da CDN Cloudflare.

A política `/privacidade` descreve o uso do WhatsApp e deve ter os dados jurídicos da operação revisados. A relação comercial entre Orkestria e FNunes não está documentada; a marca Orkestria Consult foi mantida. As metas de Core Web Vitals ainda exigem medição representativa em produção.
