# Orkestria Consult — orkestriaplatform.com

Site institucional + blog da **Orkestria Consult**, consultoria especializada em inteligência operacional para educação e negócios.

## Estrutura

```
/
├── index.html          ← site principal editorial
├── processos.html      ← biblioteca de 8 processos BPMN interativos
├── wrangler.toml       ← config Cloudflare Workers
├── assets/
│   └── bpmn.js         ← motor de diagramas BPMN (SVG gerado em JS)
├── blog/
│   ├── index.html      ← listagem dos artigos
│   ├── article.css     ← estilos compartilhados dos artigos
│   ├── do-xml-ao-erp.html
│   ├── instituicoes-nao-precisam-de-mais-planilhas.html
│   ├── custo-invisivel-dos-dados-que-nao-conversam.html
│   ├── dashboards-bonitos-nao-resolvem-dados-ruins.html
│   ├── o-problema-nao-e-o-sistema.html
│   └── operacao-educacional-inteligencia-de-gestao.html
```

## Páginas do site principal (index.html)

| Seção | ID | Conteúdo |
|-------|----|----------|
| Hero | topo | Headline principal, CTA de diagnóstico e CTA para exemplos BPMN |
| Manifesto | `#manifesto` | Posicionamento sobre tecnologia, dados e gestão |
| Metodologia | `#metodologia` | 6 etapas do diagnóstico consultivo |
| Histórias de Processo | `#processo` | Caso: do XML ao ERP (fluxo manual → inteligente) |
| Processos Inteligentes | `#processos` | Vitrine premium de 4 processos BPMN + link para processos.html |
| Diagnóstico | `#diagnostico` | Oferta principal de Diagnóstico de Eficiência Operacional |
| Capacidade Estratégica | `#autoridade` | Experiência, tecnologias e entregas |
| Inteligência | `#inteligencia` | Vitrine editorial dos artigos |
| Contato | `#contato` | Formulário + email + WhatsApp |

## Destaque da home para Processos BPMN

A home agora direciona o visitante com mais força para a biblioteca `processos.html`.

Pontos de entrada:

- menu principal com link destacado `Processos BPMN`;
- CTA no hero: `Ver exemplos BPMN`;
- seção `#processos` com selo `BPMN Executivo · Antes vs Depois`;
- cards para os quatro fluxos principais:
  - `processos.html#xml-erp`
  - `processos.html#conciliacao-financeira`
  - `processos.html#fluxo-caixa`
  - `processos.html#conciliacao-contabil`
- bloco editorial antes do diagnóstico chamando para a biblioteca completa;
- rodapé com links para `Processos Inteligentes` e `Biblioteca BPMN`.

Objetivo estratégico:

> Mostrar exemplos de arquitetura de processo antes de pedir uma conversa comercial. A página entrega percepção de método, mas não revela regras internas, integrações, SQL, APIs, IA ou lógica proprietária.

## Página de Processos (processos.html)

Biblioteca completa com **8 processos estratégicos** mapeados em diagramas BPMN interativos (antes × depois). Cada diagrama é gerado em SVG via `assets/bpmn.js` e suporta:

- Visualização lado a lado (fluxo manual vs. fluxo inteligente)
- Clique para ampliar em tela cheia com zoom e troca de estado
- Navegação por teclado (←/→, +/−, Esc)

| # | ID | Título | Categoria |
|---|----|--------|-----------|
| 01 | `#xml-erp` | Do XML ao ERP | BackOffice · Compras |
| 02 | `#conciliacao-financeira` | Conciliação Financeira | Financeiro |
| 03 | `#fluxo-caixa` | Fluxo de Caixa Inteligente | Tesouraria |
| 04 | `#conciliacao-contabil` | Conciliação Contábil | Contabilidade |
| 05 | `#patrimonio` | Patrimônio | Patrimônio |
| 06 | `#rh-ponto` | RH e Ponto Mensal | RH |
| 07 | `#assinaturas` | Central de Assinaturas Digitais | Jurídico · Documental |
| 08 | `#recebimentos` | Recebimentos e Cartão de Crédito | Financeiro · Recebíveis |

## Artigos publicados

| Código | Título | Categoria |
|--------|--------|-----------|
| HP·01 | Do XML ao ERP: a entrada de NF como fluxo inteligente | Histórias de Processo |
| A·01 | Instituições de ensino não precisam de mais planilhas | Educação |
| A·02 | O custo invisível dos dados que não conversam | Eficiência Operacional |
| A·03 | Por que dashboards bonitos não resolvem dados ruins | Dados & BI |
| A·04 | O problema não é o sistema | Eficiência Operacional |
| A·05 | Operação educacional e inteligência de gestão | Educação |

## Stack

- HTML5 estático, sem framework ou build step
- CSS customizado com variáveis (design system próprio)
- JS vanilla puro — `assets/bpmn.js` gera SVG proceduralmente (sem dependências)
- Fontes: Instrument Serif + Geist + Geist Mono (Google Fonts)
- Deploy: Cloudflare Workers com assets estáticos (`wrangler.toml`)
- CI/CD: push na branch `main` → deploy automático via Cloudflare

## Deploy

```bash
git add index.html README.md
git commit -m "mensagem"
git push
# → Cloudflare detecta o push e publica automaticamente
```

---

**Orkestria Consult** · Inteligência Operacional para Educação e Negócios  
[orkestriaplatform.com](https://orkestriaplatform.com)
