/* ============================================================
   ORKESTRIA · Motor de diagramas BPMN editoriais
   Gera SVG de raias (swimlanes) a partir de dados enxutos.
   Não expõe regras internas — apenas o desenho do fluxo.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- geometria ---------- */
  var LABEL_W = 132, COL_W = 164, LANE_H = 96, PAD = 28;
  var TW = 132, TH = 52, R = 18, GH = 25; // task w/h, event radius, gateway half-diagonal

  /* ---------- paleta por tom ---------- */
  var TONE = {
    mute:  { s: "rgba(245,242,235,0.34)", t: "rgba(245,242,235,0.82)", f: "rgba(245,242,235,0.022)", b: "rgba(245,242,235,0.50)" },
    warn:  { s: "#B8894B", t: "#D8B57A", f: "rgba(184,137,75,0.07)",  b: "#C79A5C" },
    risk:  { s: "#B5654A", t: "#D09277", f: "rgba(181,101,74,0.07)",  b: "#C57E63" },
    gold:  { s: "#B89968", t: "#C9AC7D", f: "rgba(184,153,104,0.07)", b: "#C9AC7D" },
    blue:  { s: "#2E6BFF", t: "#88A6FF", f: "rgba(46,107,255,0.08)",  b: "#6E92FF" },
    green: { s: "#5B9E7A", t: "#8FCAA9", f: "rgba(91,158,122,0.09)",  b: "#7FBE9A" }
  };

  var uidc = 0;
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* quebra rótulo em até 2 linhas (respeita \n explícito) */
  function wrap(label, max) {
    if (label.indexOf("\n") >= 0) return label.split("\n").slice(0, 2);
    var words = String(label).split(" "), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if ((cur ? cur + " " + w : w).length <= max) cur = cur ? cur + " " + w : w;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > 2) { lines[1] = lines[1] + "…"; lines = lines.slice(0, 2); }
    return lines;
  }

  function tspans(lines, x, cy, lh, attrs) {
    var n = lines.length, y0 = cy - (n - 1) * lh / 2;
    var out = "";
    for (var i = 0; i < n; i++) {
      out += '<text x="' + x + '" y="' + (y0 + i * lh).toFixed(1) + '" ' + attrs + '>' + esc(lines[i]) + "</text>";
    }
    return out;
  }

  /* ---------- desenho de um diagrama ---------- */
  function render(spec) {
    var uid = "b" + (++uidc);
    var lanes = spec.lanes;
    var nodes = spec.nodes;
    var flows = spec.flows || [];
    var accent = spec.accentLanes || [];
    var defTone = spec.variant === "after" ? "blue" : "mute";

    var cols = 0;
    nodes.forEach(function (n) { if (n.col + 1 > cols) cols = n.col + 1; });

    var W = LABEL_W + cols * COL_W + PAD;
    var H = PAD * 2 + lanes.length * LANE_H;

    function colX(c) { return LABEL_W + c * COL_W + COL_W / 2; }
    function laneY(i) { return PAD + i * LANE_H + LANE_H / 2; }

    // posiciona nós
    var map = {};
    nodes.forEach(function (n) {
      n.x = colX(n.col); n.y = laneY(n.lane);
      n.tone = n.tone || (spec.variant === "after" ? "blue" : "mute");
      map[n.id] = n;
    });

    function eR(n) { return n.type === "task" ? n.x + TW / 2 : n.type === "gateway" ? n.x + GH : n.x + R; }
    function eL(n) { return n.type === "task" ? n.x - TW / 2 : n.type === "gateway" ? n.x - GH : n.x - R; }
    function eB(n) { return n.type === "task" ? n.y + TH / 2 : n.type === "gateway" ? n.y + GH : n.y + R; }

    /* ---- defs: marcadores de seta por tom ---- */
    var defs = '<defs>';
    Object.keys(TONE).forEach(function (k) {
      defs += '<marker id="' + uid + '-ar-' + k + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
        '<path d="M0.5,1 L9,5 L0.5,9" fill="none" stroke="' + TONE[k].s + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>';
    });
    defs += '</defs>';

    /* ---- raias ---- */
    var laneSvg = "";
    for (var i = 0; i < lanes.length; i++) {
      var y0 = PAD + i * LANE_H;
      var isAcc = accent.indexOf(i) >= 0;
      var fill = isAcc
        ? (spec.variant === "after" ? "rgba(46,107,255,0.035)" : "rgba(184,153,104,0.04)")
        : (i % 2 ? "rgba(245,242,235,0.012)" : "rgba(245,242,235,0.0)");
      laneSvg += '<rect x="0" y="' + y0 + '" width="' + W + '" height="' + LANE_H + '" fill="' + fill + '"/>';
      laneSvg += '<line x1="0" y1="' + y0 + '" x2="' + W + '" y2="' + y0 + '" stroke="rgba(245,242,235,0.08)" stroke-width="1"/>';
      var lines = wrap(lanes[i], 14);
      var ly = y0 + LANE_H / 2;
      laneSvg += tspans(lines, 16, ly, 13,
        'font-family="Geist Mono, monospace" font-size="10" letter-spacing="1.4" fill="' +
        (isAcc ? (spec.variant === "after" ? "#7FA0FF" : "#C9AC7D") : "rgba(245,242,235,0.5)") +
        '" text-transform="uppercase" style="text-transform:uppercase"');
    }
    // moldura
    laneSvg += '<line x1="0" y1="' + (PAD + lanes.length * LANE_H) + '" x2="' + W + '" y2="' + (PAD + lanes.length * LANE_H) + '" stroke="rgba(245,242,235,0.08)" stroke-width="1"/>';
    laneSvg += '<line x1="' + LABEL_W + '" y1="' + PAD + '" x2="' + LABEL_W + '" y2="' + (PAD + lanes.length * LANE_H) + '" stroke="rgba(245,242,235,0.10)" stroke-width="1"/>';

    /* ---- conexões (atrás dos nós) ---- */
    var flowSvg = "";
    flows.forEach(function (fl) {
      var a = map[fl.from], b = map[fl.to];
      if (!a || !b) return;
      var tk = fl.tone || (fl.rework ? "risk" : defTone);
      var col = TONE[tk].s;
      var d, lx, ly, dash = fl.rework ? ' stroke-dasharray="5 5"' : (fl.dash ? ' stroke-dasharray="2 5"' : "");

      if (fl.rework) {
        var drop = PAD + (Math.max(a.lane, b.lane) + 1) * LANE_H - 12;
        d = "M" + a.x + " " + eB(a) + " L" + a.x + " " + drop + " L" + b.x + " " + drop + " L" + b.x + " " + eB(b);
        lx = (a.x + b.x) / 2; ly = drop - 7;
      } else {
        var sx = eR(a), sy = a.y, tx = eL(b), ty = b.y;
        if (Math.abs(sy - ty) < 1) { d = "M" + sx + " " + sy + " L" + tx + " " + ty; lx = (sx + tx) / 2; ly = sy - 9; }
        else { var mx = sx + (tx - sx) / 2; d = "M" + sx + " " + sy + " L" + mx + " " + sy + " L" + mx + " " + ty + " L" + tx + " " + ty; lx = mx; ly = (sy + ty) / 2; }
      }
      flowSvg += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.4"' + dash +
        ' marker-end="url(#' + uid + '-ar-' + tk + ')"/>';
      if (fl.label) {
        var lw = fl.label.length * 5.4 + 12;
        flowSvg += '<rect x="' + (lx - lw / 2) + '" y="' + (ly - 8) + '" width="' + lw + '" height="14" rx="3" fill="#0A0E14" opacity="0.92"/>';
        flowSvg += '<text x="' + lx + '" y="' + (ly + 2.5) + '" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.8" fill="' + TONE[tk].b + '">' + esc(fl.label) + "</text>";
      }
    });

    /* ---- nós ---- */
    var nodeSvg = "";
    nodes.forEach(function (n) {
      var c = TONE[n.tone];
      if (n.type === "task") {
        nodeSvg += '<rect x="' + (n.x - TW / 2) + '" y="' + (n.y - TH / 2) + '" width="' + TW + '" height="' + TH + '" rx="9" fill="' + c.f + '" stroke="' + c.s + '" stroke-width="1.3"/>';
        nodeSvg += tspans(wrap(n.label, 17), n.x, n.y, 14,
          'text-anchor="middle" font-family="Geist, sans-serif" font-size="12.5" font-weight="500" fill="' + c.t + '"');
        if (n.badge) {
          var bw = n.badge.length * 5.6 + 16, by = n.y - TH / 2 - 9;
          nodeSvg += '<rect x="' + (n.x - bw / 2) + '" y="' + (by - 8) + '" width="' + bw + '" height="16" rx="8" fill="#0A0E14" stroke="' + c.s + '" stroke-width="1"/>';
          nodeSvg += '<text x="' + n.x + '" y="' + (by + 3) + '" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.8" fill="' + c.b + '" style="text-transform:uppercase">' + esc(n.badge.toUpperCase()) + "</text>";
        }
      } else if (n.type === "gateway") {
        var p = (n.x) + "," + (n.y - GH) + " " + (n.x + GH) + "," + (n.y) + " " + (n.x) + "," + (n.y + GH) + " " + (n.x - GH) + "," + (n.y);
        nodeSvg += '<polygon points="' + p + '" fill="' + c.f + '" stroke="' + c.s + '" stroke-width="1.3"/>';
        // marca de decisão (×)
        nodeSvg += '<path d="M' + (n.x - 6) + ' ' + (n.y - 6) + ' L' + (n.x + 6) + ' ' + (n.y + 6) + ' M' + (n.x + 6) + ' ' + (n.y - 6) + ' L' + (n.x - 6) + ' ' + (n.y + 6) + '" stroke="' + c.b + '" stroke-width="1.3" stroke-linecap="round"/>';
        nodeSvg += tspans(wrap(n.label, 16), n.x, n.y + GH + 16, 12,
          'text-anchor="middle" font-family="Geist, sans-serif" font-size="11" fill="' + c.t + '"');
      } else { // start / end
        if (n.type === "end") {
          nodeSvg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + R + '" fill="' + c.f + '" stroke="' + c.s + '" stroke-width="2.6"/>';
        } else {
          nodeSvg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + R + '" fill="' + c.f + '" stroke="' + c.s + '" stroke-width="1.4"/>';
        }
        nodeSvg += '<circle cx="' + n.x + '" cy="' + n.y + '" r="3.2" fill="' + c.b + '"/>';
        nodeSvg += tspans(wrap(n.label, 16), n.x, n.y + R + 16, 12,
          'text-anchor="middle" font-family="Geist, sans-serif" font-size="11" fill="' + c.t + '"');
        if (n.badge) {
          var bw2 = n.badge.length * 5.6 + 16, by2 = n.y - R - 9;
          nodeSvg += '<rect x="' + (n.x - bw2 / 2) + '" y="' + (by2 - 8) + '" width="' + bw2 + '" height="16" rx="8" fill="#0A0E14" stroke="' + c.s + '" stroke-width="1"/>';
          nodeSvg += '<text x="' + n.x + '" y="' + (by2 + 3) + '" text-anchor="middle" font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="0.8" fill="' + c.b + '" style="text-transform:uppercase">' + esc(n.badge.toUpperCase()) + "</text>";
        }
      }
    });

    return '<svg class="bpmn-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="Diagrama de processo BPMN" xmlns="http://www.w3.org/2000/svg">' +
      defs + laneSvg + flowSvg + nodeSvg + '</svg>';
  }

  /* ============================================================
     DADOS · 8 processos estratégicos
     ============================================================ */
  var PROCS = [
    {
      n: "01", id: "xml-erp", tag: "BackOffice · Compras",
      title: "Do XML ao ERP",
      pain: "O XML chega por e-mail e percorre uma fila manual de conferências e aprovações até virar lançamento. O custo dessa fila não aparece em relatório — aparece em atraso e retrabalho.",
      gains: ["Menos retrabalho", "Mais controle", "Fechamento no prazo"],
      before: {
        variant: "before", lanes: ["E-mail", "Operação", "Aprovação", "ERP RM"],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "XML recebido", badge: "E-mail" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Baixa manual", badge: "Manual" },
          { id: "t2", type: "task", lane: 1, col: 2, label: "Confere fornecedor e pedido", badge: "Planilha" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Valores conferem?" },
          { id: "ap", type: "task", lane: 2, col: 4, label: "Aguarda OK", badge: "Fila", tone: "warn" },
          { id: "er", type: "task", lane: 3, col: 4, label: "Lança no ERP", badge: "Manual" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Entrada concluída", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "t2" }, { from: "t2", to: "g" },
          { from: "g", to: "er", label: "ok" }, { from: "g", to: "ap", label: "divergência", tone: "warn" },
          { from: "ap", to: "er" }, { from: "er", to: "e" },
          { from: "ap", to: "t2", label: "retrabalho", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Entrada", "ORKESTRIA", "Aprovação", "ERP RM", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "XML capturado", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Localiza pedido", badge: "Integração" },
          { id: "a2", type: "task", lane: 1, col: 2, label: "Valida por regra", badge: "Validação" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Divergência?", tone: "gold" },
          { id: "ap", type: "task", lane: 2, col: 4, label: "Aprovação direcionada", badge: "Aprovação" },
          { id: "er", type: "task", lane: 3, col: 4, label: "Entrada no ERP", badge: "Integração" },
          { id: "ind", type: "task", lane: 4, col: 4, label: "Indicador gerado", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 4, col: 5, label: "Rastreável", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "a2" }, { from: "a2", to: "g" },
          { from: "g", to: "er", label: "ok" }, { from: "g", to: "ap", label: "divergência", tone: "gold" },
          { from: "ap", to: "er" }, { from: "er", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "02", id: "conciliacao-financeira", tag: "Financeiro",
      title: "Conciliação Financeira",
      pain: "Extratos, cartões, boletos e baixas conferidos à mão, em planilhas que raramente batem na primeira tentativa. O fechamento espera a conferência terminar.",
      gains: ["Fechamento mais rápido", "Menos erro", "Previsibilidade"],
      before: {
        variant: "before", lanes: ["Bancos", "Financeiro", "Exceções", "ERP RM"],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Extratos e arquivos", badge: "E-mail" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Baixa planilhas", badge: "Planilha" },
          { id: "t2", type: "task", lane: 1, col: 2, label: "Concilia manual", badge: "Manual" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Bate?" },
          { id: "iv", type: "task", lane: 2, col: 4, label: "Investiga divergência", badge: "Fila", tone: "warn" },
          { id: "bx", type: "task", lane: 3, col: 4, label: "Baixa no ERP", badge: "Manual" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Fechamento", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "t2" }, { from: "t2", to: "g" },
          { from: "g", to: "bx", label: "ok" }, { from: "g", to: "iv", label: "difere", tone: "warn" },
          { from: "iv", to: "bx" }, { from: "bx", to: "e" },
          { from: "iv", to: "t2", label: "retrabalho", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Movimentos", "ORKESTRIA", "Exceções", "ERP RM", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Movimentos captados", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Concilia por regra", badge: "Validação" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Divergência?", tone: "gold" },
          { id: "a2", type: "task", lane: 1, col: 3, label: "Classifica baixa", badge: "Integração" },
          { id: "ex", type: "task", lane: 2, col: 3, label: "Exceção encaminhada", badge: "Roteamento" },
          { id: "er", type: "task", lane: 3, col: 4, label: "Baixa controlada", badge: "Integração" },
          { id: "ind", type: "task", lane: 4, col: 4, label: "Painel de pendências", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 4, col: 5, label: "Previsível", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "g" },
          { from: "g", to: "a2", label: "ok" }, { from: "g", to: "ex", label: "exceção", tone: "gold" },
          { from: "a2", to: "er" }, { from: "ex", to: "er" }, { from: "er", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "03", id: "fluxo-caixa", tag: "Tesouraria",
      title: "Fluxo de Caixa Inteligente",
      pain: "Contas a pagar, a receber e previsões espalhadas em relatórios e planilhas que envelhecem rápido. A diretoria decide olhando para trás.",
      gains: ["Decisão antecipada", "Visão de caixa", "Menos surpresa"],
      before: {
        variant: "before", lanes: ["A Pagar", "A Receber", "Financeiro", "Diretoria"],
        nodes: [
          { id: "s", type: "start", lane: 2, col: 0, label: "Coleta relatórios", badge: "Manual" },
          { id: "ap", type: "task", lane: 0, col: 1, label: "Consolida a pagar", badge: "Planilha" },
          { id: "ar", type: "task", lane: 1, col: 1, label: "Consolida a receber", badge: "Planilha" },
          { id: "pv", type: "task", lane: 2, col: 2, label: "Monta previsão", badge: "Manual", tone: "warn" },
          { id: "g", type: "gateway", lane: 2, col: 3, label: "Caixa cobre?" },
          { id: "dt", type: "task", lane: 3, col: 4, label: "Decisão tardia", badge: "Atraso", tone: "risk" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Surpresa no caixa", tone: "risk" }
        ],
        flows: [
          { from: "s", to: "ap" }, { from: "s", to: "ar" }, { from: "ap", to: "pv" }, { from: "ar", to: "pv" },
          { from: "pv", to: "g" }, { from: "g", to: "dt", label: "não", tone: "risk" }, { from: "dt", to: "e" },
          { from: "g", to: "pv", label: "recalcula", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Entradas", "ORKESTRIA", "Cenários", "Diretoria"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Entradas e saídas integradas", badge: "Integração", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Projeção por vencimento", badge: "Validação" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Risco de caixa?", tone: "gold" },
          { id: "al", type: "task", lane: 1, col: 3, label: "Alerta de risco", badge: "Sinal", tone: "warn" },
          { id: "cs", type: "task", lane: 2, col: 3, label: "Cenário executivo", badge: "Cenário" },
          { id: "ind", type: "task", lane: 3, col: 4, label: "Visão por centro de custo", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Decisão antecipada", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "g" },
          { from: "g", to: "cs", label: "ok" }, { from: "g", to: "al", label: "risco", tone: "warn" },
          { from: "al", to: "cs" }, { from: "cs", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "04", id: "conciliacao-contabil", tag: "Contabilidade",
      title: "Conciliação Contábil",
      pain: "Lançamentos conferidos só no fim do mês. Divergências aparecem tarde e viram retrabalho entre financeiro e contabilidade, com fechamento sob pressão.",
      gains: ["Fechamento limpo", "Auditoria facilitada", "Menos retrabalho"],
      before: {
        variant: "before", lanes: ["Financeiro", "Contabilidade", "Fechamento", "Auditoria"],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Lançamentos do mês", badge: "Planilha" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Confere no fim do mês", badge: "Manual", tone: "warn" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Consistente?" },
          { id: "cd", type: "task", lane: 1, col: 3, label: "Corrige divergência", badge: "Fila", tone: "risk" },
          { id: "rb", type: "task", lane: 2, col: 4, label: "Reabre fechamento", badge: "Atraso", tone: "warn" },
          { id: "e", type: "end", lane: 2, col: 5, label: "Fecha com ressalva", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "g" },
          { from: "g", to: "rb", label: "ok" }, { from: "g", to: "cd", label: "difere", tone: "risk" },
          { from: "cd", to: "rb" }, { from: "rb", to: "e" },
          { from: "cd", to: "t1", label: "retrabalho", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Lançamentos", "ORKESTRIA", "Contabilidade", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Lançamento contínuo", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Cruza contas e centro de custo", badge: "Validação" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Inconsistência?", tone: "gold" },
          { id: "a2", type: "task", lane: 1, col: 3, label: "Sinaliza antes do fecho", badge: "Roteamento" },
          { id: "fc", type: "task", lane: 2, col: 4, label: "Fechamento limpo", badge: "Integração" },
          { id: "ind", type: "task", lane: 3, col: 4, label: "Trilha de auditoria", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Auditável", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "g" },
          { from: "g", to: "fc", label: "ok" }, { from: "g", to: "a2", label: "inconsistência", tone: "gold" },
          { from: "a2", to: "fc" }, { from: "fc", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "05", id: "patrimonio", tag: "Patrimônio",
      title: "Patrimônio",
      pain: "Cadastro, movimentação, inventário e baixa controlados em planilhas fragmentadas. Quando o inventário não bate, ninguém sabe ao certo onde está o bem.",
      gains: ["Controle patrimonial", "Redução de perda", "Rastreabilidade"],
      before: {
        variant: "before", lanes: ["Solicitante", "Patrimônio", "Operação", "Contábil"],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Aquisição do bem", badge: "E-mail" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Cadastra em planilha", badge: "Planilha" },
          { id: "t2", type: "task", lane: 1, col: 2, label: "Movimenta sem registro", badge: "Manual", tone: "warn" },
          { id: "g", type: "gateway", lane: 2, col: 3, label: "Inventário bate?" },
          { id: "pr", type: "task", lane: 2, col: 4, label: "Procura o bem", badge: "Fila", tone: "risk" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Baixa atrasada", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "t2" }, { from: "t2", to: "g" },
          { from: "g", to: "e", label: "ok" }, { from: "g", to: "pr", label: "não acha", tone: "risk" },
          { from: "pr", to: "e" }, { from: "pr", to: "t2", label: "retrabalho", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Entrada", "ORKESTRIA", "Operação", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Bem identificado", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Movimentação rastreável", badge: "Integração" },
          { id: "a2", type: "task", lane: 1, col: 2, label: "Inventário digital", badge: "Validação" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Baixa?", tone: "gold" },
          { id: "op", type: "task", lane: 2, col: 4, label: "Baixa controlada", badge: "Aprovação" },
          { id: "ind", type: "task", lane: 3, col: 4, label: "Histórico e indicadores", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Rastreável", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "a2" }, { from: "a2", to: "g" },
          { from: "g", to: "ind", label: "ativo" }, { from: "g", to: "op", label: "baixa", tone: "gold" },
          { from: "op", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "06", id: "rh-ponto", tag: "RH",
      title: "RH e Ponto Mensal",
      pain: "Ponto conferido à mão, documentos circulando por e-mail e assinaturas que demoram. A pendência só aparece quando já virou cobrança.",
      gains: ["Menos cobrança manual", "Mais conformidade", "Ciclo fluido"],
      before: {
        variant: "before", lanes: ["Colaborador", "RH", "Gestor", "Folha"],
        nodes: [
          { id: "s", type: "start", lane: 1, col: 0, label: "Fecha ponto manual", badge: "Manual" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Confere marcações", badge: "Planilha", tone: "warn" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Pendência?" },
          { id: "cb", type: "task", lane: 0, col: 3, label: "Cobra colaborador", badge: "E-mail", tone: "warn" },
          { id: "as", type: "task", lane: 2, col: 4, label: "Assina em papel", badge: "Fila", tone: "risk" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Folha atrasada", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "g" },
          { from: "g", to: "as", label: "ok" }, { from: "g", to: "cb", label: "pendência", tone: "warn" },
          { from: "cb", to: "as" }, { from: "as", to: "e" },
          { from: "cb", to: "t1", label: "retrabalho", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Ponto", "ORKESTRIA", "Colaborador", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Ponto consolidado", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Identifica pendências", badge: "Validação" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Pendência?", tone: "gold" },
          { id: "nt", type: "task", lane: 2, col: 3, label: "Colaborador notificado", badge: "Roteamento" },
          { id: "a2", type: "task", lane: 1, col: 4, label: "Assinatura digital", badge: "Aprovação" },
          { id: "ind", type: "task", lane: 3, col: 4, label: "Status por área", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Ciclo fluido", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "g" },
          { from: "g", to: "a2", label: "ok" }, { from: "g", to: "nt", label: "pendência", tone: "gold" },
          { from: "nt", to: "a2" }, { from: "a2", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "07", id: "assinaturas", tag: "Jurídico · Documental",
      title: "Central de Assinaturas Digitais",
      pain: "Contratos enviados manualmente, status perdido em e-mails. Saber quem assinou exige garimpar a caixa de entrada — e a validade fica sem controle.",
      gains: ["Menos atraso", "Trilha de auditoria", "Controle documental"],
      before: {
        variant: "before", lanes: ["Solicitante", "Jurídico", "Signatário", "Arquivo"],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Gera contrato", badge: "Manual" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Envia por e-mail", badge: "E-mail" },
          { id: "g", type: "gateway", lane: 1, col: 2, label: "Assinou?" },
          { id: "cb", type: "task", lane: 2, col: 3, label: "Cobra assinatura", badge: "Fila", tone: "warn" },
          { id: "ps", type: "task", lane: 1, col: 4, label: "Procura status", badge: "Manual", tone: "risk" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Arquivo solto", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "g" },
          { from: "g", to: "e", label: "ok" }, { from: "g", to: "cb", label: "pendente", tone: "warn" },
          { from: "cb", to: "ps" }, { from: "ps", to: "e" },
          { from: "ps", to: "t1", label: "reenvia", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Documento", "ORKESTRIA", "Signatário", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Documento gerado", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Define responsável", badge: "Roteamento" },
          { id: "a2", type: "task", lane: 2, col: 2, label: "Assinatura solicitada", badge: "Aprovação" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Assinado?", tone: "gold" },
          { id: "a3", type: "task", lane: 1, col: 4, label: "Validade controlada", badge: "Validação" },
          { id: "ind", type: "task", lane: 3, col: 4, label: "Trilha de auditoria", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Arquivo organizado", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "a2" }, { from: "a2", to: "g" },
          { from: "g", to: "a3", label: "sim" }, { from: "g", to: "a2", label: "aguarda", tone: "gold", rework: true },
          { from: "a3", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    },
    {
      n: "08", id: "recebimentos", tag: "Financeiro · Recebíveis",
      title: "Recebimentos e Cartão de Crédito",
      pain: "Boletos e cartões conferidos manualmente. Taxas e repasses difíceis de reconciliar e baixa sempre atrasada — a inadimplência real fica incerta.",
      gains: ["Recebimento ágil", "Controle de taxas", "Visão de inadimplência"],
      before: {
        variant: "before", lanes: ["Adquirente", "Financeiro", "Exceções", "ERP RM"],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Transações do dia", badge: "Planilha" },
          { id: "t1", type: "task", lane: 1, col: 1, label: "Confere recebimentos", badge: "Manual" },
          { id: "t2", type: "task", lane: 1, col: 2, label: "Calcula taxas", badge: "Planilha", tone: "warn" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Repasse bate?" },
          { id: "iv", type: "task", lane: 2, col: 4, label: "Investiga diferença", badge: "Fila", tone: "risk" },
          { id: "bx", type: "task", lane: 3, col: 4, label: "Baixa manual", badge: "Manual" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Inadimplência incerta", tone: "warn" }
        ],
        flows: [
          { from: "s", to: "t1" }, { from: "t1", to: "t2" }, { from: "t2", to: "g" },
          { from: "g", to: "bx", label: "ok" }, { from: "g", to: "iv", label: "difere", tone: "risk" },
          { from: "iv", to: "bx" }, { from: "bx", to: "e" },
          { from: "iv", to: "t2", label: "retrabalho", rework: true }
        ]
      },
      after: {
        variant: "after", lanes: ["Transações", "ORKESTRIA", "Exceções", "Gestão"], accentLanes: [1],
        nodes: [
          { id: "s", type: "start", lane: 0, col: 0, label: "Transações importadas", badge: "Captura", tone: "gold" },
          { id: "a1", type: "task", lane: 1, col: 1, label: "Identifica taxas", badge: "Validação" },
          { id: "a2", type: "task", lane: 1, col: 2, label: "Concilia repasses", badge: "Integração" },
          { id: "g", type: "gateway", lane: 1, col: 3, label: "Divergência?", tone: "gold" },
          { id: "er", type: "task", lane: 1, col: 4, label: "Baixa integrada", badge: "Integração" },
          { id: "ex", type: "task", lane: 2, col: 4, label: "Exceção aberta", badge: "Roteamento" },
          { id: "ind", type: "task", lane: 3, col: 4, label: "Visão de inadimplência", badge: "Indicador", tone: "green" },
          { id: "e", type: "end", lane: 3, col: 5, label: "Recebimento ágil", tone: "green" }
        ],
        flows: [
          { from: "s", to: "a1", tone: "gold" }, { from: "a1", to: "a2" }, { from: "a2", to: "g" },
          { from: "g", to: "er", label: "ok" }, { from: "g", to: "ex", label: "divergência", tone: "gold" },
          { from: "ex", to: "er" }, { from: "er", to: "ind" }, { from: "ind", to: "e", tone: "green" }
        ]
      }
    }
  ];

  /* ---------- construção de um bloco de processo ---------- */
  function diagramCard(label, sub, spec, pi, variant) {
    return '' +
      '<div class="dgm" data-pi="' + pi + '" data-variant="' + variant + '" role="button" tabindex="0" aria-label="Ampliar diagrama: ' + esc(label) + '">' +
        '<div class="dgm-head">' +
          '<span class="dgm-tag dgm-' + (spec.variant) + '">' + esc(label) + '</span>' +
          '<span class="dgm-sub">' + esc(sub) + '</span>' +
          '<span class="dgm-expand">⤢ Ampliar</span>' +
        '</div>' +
        '<div class="bpmn-scroll"><div class="bpmn-inner">' + render(spec) + '</div></div>' +
        '<div class="bpmn-hint" aria-hidden="true">Toque para ampliar · deslize para ver o fluxo →</div>' +
      '</div>';
  }

  function gains(list) {
    return list.map(function (g) { return '<span class="gain"><span class="gd"></span>' + esc(g) + '</span>'; }).join("");
  }

  function block(p, i) {
    return '' +
      '<article class="proc" id="' + p.id + '">' +
        '<div class="proc-top">' +
          '<div class="proc-id">' +
            '<span class="proc-num">' + p.n + '</span>' +
            '<span class="proc-tag">◆ ' + esc(p.tag) + '</span>' +
          '</div>' +
          '<div class="proc-lead">' +
            '<h3 class="proc-title display">' + esc(p.title) + '</h3>' +
            '<p class="proc-pain">' + esc(p.pain) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="proc-diagrams">' +
          diagramCard("Antes", "Fluxo manual · as-is", p.before, i, "before") +
          '<div class="proc-arrow" aria-hidden="true"><span>EVOLUÇÃO</span></div>' +
          diagramCard("Depois", "Fluxo inteligente · to-be", p.after, i, "after") +
        '</div>' +
        '<div class="proc-foot">' +
          '<div class="proc-gains">' +
            '<span class="proc-gains-k">Ganho executivo</span>' +
            '<div class="gains">' + gains(p.gains) + '</div>' +
          '</div>' +
          '<a href="#diagnostico-cta" class="btn btn-ghost proc-cta">Analisar este processo <span class="arrow">→</span></a>' +
        '</div>' +
      '</article>';
  }

  /* ---------- visualizador em tela cheia ---------- */
  var V = { pi: 0, variant: "before", zoom: 1, keyfn: null };

  function buildViewer() {
    if (document.getElementById("bpmnViewer")) return;
    var v = document.createElement("div");
    v.className = "bpmn-viewer"; v.id = "bpmnViewer"; v.hidden = true;
    v.innerHTML =
      '<div class="bv-backdrop" data-close="1"></div>' +
      '<div class="bv-panel" role="dialog" aria-modal="true" aria-label="Diagrama ampliado">' +
        '<div class="bv-bar">' +
          '<div class="bv-title"><span class="t"></span><span class="s"></span></div>' +
          '<div class="bv-tabs"><button type="button" data-v="before">Antes</button><button type="button" data-v="after">Depois</button></div>' +
          '<div class="bv-zoom"><button type="button" data-z="out" aria-label="Reduzir">−</button><span class="bv-zlabel">100%</span><button type="button" data-z="in" aria-label="Ampliar">+</button></div>' +
          '<button type="button" class="bv-close" data-close="1" aria-label="Fechar">✕</button>' +
        '</div>' +
        '<div class="bv-stage"><div class="bv-canvas"></div></div>' +
      '</div>';
    document.body.appendChild(v);

    v.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) { closeViewer(); return; }
      var tab = e.target.closest("[data-v]");
      if (tab) { V.variant = tab.getAttribute("data-v"); V.zoom = 1; renderViewer(); return; }
      var zb = e.target.closest("[data-z]");
      if (zb) { stepZoom(zb.getAttribute("data-z") === "in" ? 0.25 : -0.25); }
    });
  }

  function stepZoom(d) {
    V.zoom = Math.max(0.5, Math.min(3, Math.round((V.zoom + d) * 100) / 100));
    applyZoom();
  }

  function applyZoom() {
    var v = document.getElementById("bpmnViewer");
    var stage = v.querySelector(".bv-stage");
    var svg = v.querySelector(".bv-canvas svg");
    if (!svg) return;
    var natW = svg.viewBox.baseVal.width || parseFloat(svg.getAttribute("width"));
    var stageW = stage.clientWidth - 52;
    var fit = Math.min(1, stageW / natW);
    svg.style.width = (natW * fit * V.zoom).toFixed(0) + "px";
    v.querySelector(".bv-zlabel").textContent = Math.round(V.zoom * 100) + "%";
  }

  function renderViewer() {
    var v = document.getElementById("bpmnViewer");
    var p = PROCS[V.pi];
    var spec = p[V.variant];
    v.querySelector(".bv-canvas").innerHTML = render(spec);
    v.querySelector(".bv-title .t").textContent = p.n + " · " + p.title;
    v.querySelector(".bv-title .s").textContent =
      (V.variant === "before" ? "Antes · fluxo manual" : "Depois · fluxo inteligente") + " · " + p.tag;
    v.querySelectorAll(".bv-tabs button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-v") === V.variant);
    });
    applyZoom();
  }

  function openViewer(pi, variant) {
    buildViewer();
    V.pi = +pi; V.variant = variant || "before"; V.zoom = 1;
    var v = document.getElementById("bpmnViewer");
    v.hidden = false;
    document.body.style.overflow = "hidden";
    renderViewer();
    V.keyfn = function (e) {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { V.variant = V.variant === "before" ? "after" : "before"; V.zoom = 1; renderViewer(); }
      else if (e.key === "+" || e.key === "=") stepZoom(0.25);
      else if (e.key === "-" || e.key === "_") stepZoom(-0.25);
    };
    document.addEventListener("keydown", V.keyfn);
  }

  function closeViewer() {
    var v = document.getElementById("bpmnViewer");
    if (v) v.hidden = true;
    document.body.style.overflow = "";
    if (V.keyfn) { document.removeEventListener("keydown", V.keyfn); V.keyfn = null; }
  }

  function wireOpeners() {
    document.addEventListener("click", function (e) {
      var d = e.target.closest(".dgm[data-pi]");
      if (d) openViewer(d.getAttribute("data-pi"), d.getAttribute("data-variant"));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var d = document.activeElement;
      if (d && d.classList && d.classList.contains("dgm") && d.hasAttribute("data-pi")) {
        e.preventDefault();
        openViewer(d.getAttribute("data-pi"), d.getAttribute("data-variant"));
      }
    });
  }

  /* ---------- API ---------- */
  window.ORK_BPMN = {
    procs: PROCS,
    render: render,
    openViewer: openViewer,
    mountAll: function (sel) {
      var el = typeof sel === "string" ? document.querySelector(sel) : sel;
      if (!el) return;
      el.innerHTML = PROCS.map(block).join('<div class="proc-rule"></div>');
      buildViewer();
      wireOpeners();
    }
  };
})();
