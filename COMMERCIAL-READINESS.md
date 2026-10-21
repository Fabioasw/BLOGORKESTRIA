# Preparação comercial — 21/10/2026

Incremento sem redesign da landing e sem mudança de campanhas ou do módulo Google Ads.

## Migração e publicação

Aplicar `0005_commercial_readiness.sql` primeiro no D1 exclusivo de homologação,
`fde6d7c1-919e-4d04-8f26-946f5b9f03d0`. Validar estrutura, testes e preview antes
de aplicar a mesma migração aditiva em produção. Registrar a migração no ledger
`d1_migrations` quando a aplicação for feita pelo console do painel, para impedir
reaplicação pelo Wrangler. O console é de linha única: remover comentários de
linha e normalizar quebras para espaços; preservar strings e blocos de triggers.
Nunca copiar a configuração DB de produção para o preview.

Não é necessário nem permitido publicar arquivos de testes, docs, banco local ou
secrets: `.assetsignore` mantém a lista explícita do site. Rollback do código é
compatível com a migração aditiva; não apagar as novas tabelas nem restaurar o D1
para desfazer apenas a interface. `MEASUREMENT_ENABLED=false` interrompe a coleta
sem afetar o cadastro. Falha de medição não invalida um lead já gravado.

## Medição própria

Consentimento independente, recusado por padrão, versão `2026-10-21-funnel-v1`.
Preferência no navegador por 180 dias; identificador de página apenas em memória,
token assinado válido por 30 minutos, nenhum usuário persistente entre páginas.
Revogação impede novos envios e descarta a fila local; requisições já recebidas
não podem ser recolhidas retroativamente. Não são coletados campos do formulário,
IP armazenado, URL completa, referrer, parâmetros livres ou user-agent.

Eventos: landing_view, primary_cta_click, service_cta_click,
service_category_change, form_start, form_validation_error, form_submit_failed,
lead_confirmed (somente no servidor) e whatsapp_click. Categorias e erros usam
listas fechadas. Não existe chamada gtag nesta coleta. O cadastro conta no D1
independentemente da autorização de analytics; a telemetria é parcial/consentida.

Limites: 4 KB por requisição, 10 eventos/lote, 30 eventos por página no cliente e
por token no servidor, orçamento de 2.000 eventos comportamentais/dia (retries
também consomem orçamento), gate nativo aproximado 120 req/min por localidade.
Token/origem reduzem abuso, não autenticam humanos. Não há promessa de métricas
livres de bots nem proteção absoluta contra consumo da cota da conta.

Raw: 30 dias; totais: 90 dias; operações: 14 dias. Cron limpa em lotes de até
1.000 registros por execução; uma indisponibilidade prolongada pode atrasar
limpeza. Logs estruturados próprios, sem invocations/URLs automáticas, seguem
retenção do plano. Revisar preços de logs antes de dezembro de 2026.

O custo incremental esperado no volume inicial é zero dentro das cotas Free
compartilhadas; índices, limpeza e tentativas consomem leituras/escritas reais.
Não há contratação ou upgrade automático. Acompanhar Metrics do D1 e Workers.

## CRM e WhatsApp

Links WhatsApp usam apenas mensagem padrão e categoria canônica, nunca descrição
ou identificação do formulário. Clique não cria lead, conversa ou conversão.
Contatos efetivamente recebidos são criados por POST administrativo autenticado,
com chave de idempotência e ao menos telefone ou email, sem endereços fictícios.
Tabela separada mantém as restrições e o histórico dos leads originais.
Atualizações usam versão; histórico é preservado. Retornos manuais aparecem na
lista, alertas e resumo. Cadastro manual não dispara Google Ads nem confirmação
ao cliente. A listagem manual mostra os 100 mais recentes; KPIs consultam todos.

Indicadores novos excluem is_test=1. Dados históricos não são reclassificados
automaticamente. Lista/indicadores antigos mantêm todos os registros, sinalizados
na interface. Métricas comportamentais ausentes exibem Sem dados, não zero.
Estoque de status é separado de transições mensais; datas mensais em São Paulo.

## Validação e teste real autorizado

Executar typecheck, testes Node/SQLite, runtime Workerd/D1 local, build dry-run e
verificação de navegador local. Testes não chamam Google ou e-mail externo.
No único envio real aprovado: TESTE E2E — ORKESTRIA / TESTE INTERNO — NÃO COMERCIAL,
email Outlook do proprietário, Outra necessidade, descrição de teste e publicidade
recusada; registrar HTTP/ID, D1, CRM, outbox, provedor e próxima ação. Classificar
como teste pelo administrador, preservando histórico. Aceite pelo provedor não
comprova caixa de entrada. Conferência da inbox pode exigir o proprietário.
