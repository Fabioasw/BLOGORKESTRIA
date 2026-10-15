const SERVICES = ['Customização TOTVS RM', 'Fórmula Visual', 'Integração de sistemas', 'Automação financeira / CNAB', 'Compras e recebimento', 'Relatórios / Power BI', 'Desenvolvimento web integrado', 'Outros'];
const CAMPAIGN = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid'];
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
const ready = env => Boolean(env.LEADS_DB && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY && env.RATE_LIMIT_SECRET);

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > 16000) throw new Error('size');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('json');
  let total = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 16000) { await reader.cancel(); throw new Error('size'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function lead(request, env) {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, { Allow: 'POST' });
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Origem não permitida.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Envie JSON.' }, 415);
  if (!ready(env)) return json({ error: 'A captação ainda não está disponível. Tente novamente mais tarde.' }, 503);
  let data;
  try { data = await readBody(request); } catch (error) { return json({ error: error.message === 'size' ? 'Dados acima do limite permitido.' : 'Dados inválidos.' }, error.message === 'size' ? 413 : 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Dados inválidos.' }, 400);
  if (data.website) return json({ error: 'Não foi possível validar o envio.' }, 400);
  const fields = {};
  const limits = { nome: [2, 120], email: [5, 254], empresa: [2, 160], cargo: [2, 120], necessidade: [2, 80], descricao: [20, 4000] };
  const errors = {};
  for (const [name, [min, max]] of Object.entries(limits)) {
    const value = typeof data[name] === 'string' ? data[name].trim().normalize('NFC') : '';
    if (value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) errors[name] = `Use entre ${min} e ${max} caracteres.`;
    fields[name] = value;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.email)) errors.email = 'Informe um e-mail válido.';
  if (!SERVICES.includes(fields.necessidade)) errors.necessidade = 'Selecione uma opção válida.';
  if (Object.keys(errors).length) return json({ error: 'Revise os campos indicados.', fields: errors }, 422);
  if (typeof data.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId)) return json({ error: 'Identificador inválido.' }, 400);
  if (typeof data.token !== 'string' || !data.token || data.token.length > 2048) return json({ error: 'Conclua a verificação de segurança.' }, 422);
  const campaign = {};
  if (data.campaign !== undefined && (!data.campaign || typeof data.campaign !== 'object' || Array.isArray(data.campaign))) return json({ error: 'Parâmetros de campanha inválidos.' }, 422);
  for (const name of CAMPAIGN) {
    const value = data.campaign?.[name];
    if (value !== undefined && (typeof value !== 'string' || value.length > 250 || /[\u0000-\u001f\u007f]/.test(value))) return json({ error: 'Parâmetros de campanha inválidos.' }, 422);
    campaign[name] = value || null;
  }
  const fingerprint = await digest(JSON.stringify({ ...fields, campaign }));
  const now = Math.floor(Date.now() / 1000);
  // Fixed windows, atomic increments and a daily salted IP hash; no raw IP stored.
  const window = Math.floor(now / 600);
  const ipHash = await digest(`${env.RATE_LIMIT_SECRET}:${Math.floor(now / 86400)}:${request.headers.get('cf-connecting-ip') || 'unknown'}`);
  const bucket = `${ipHash}:${window}`;
  try {
    const limit = await env.LEADS_DB.prepare('INSERT INTO lead_rate_limits (bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(bucket, now + 1200).first();
    if (limit.attempts > 8) return json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429, { 'Retry-After': String(600 - now % 600) });
    await env.LEADS_DB.prepare('DELETE FROM lead_rate_limits WHERE expires_at < ?').bind(now).run();
    const existing = await env.LEADS_DB.prepare('SELECT fingerprint FROM leads WHERE id = ?').bind(data.requestId).first();
    if (existing) return existing.fingerprint === fingerprint ? json({ ok: true }, 200) : json({ error: 'Este envio já foi utilizado. Recarregue a página.' }, 409);
    let verification;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: data.token, idempotency_key: data.requestId }),
      });
      if (!response.ok) throw new Error('verification');
      verification = await response.json();
    } catch { return json({ error: 'Verificação indisponível. Tente novamente.' }, 503); }
    if (!verification.success || verification.hostname !== url.hostname || verification.action !== 'totvs_rm_lead') return json({ error: 'A verificação expirou ou não é válida. Tente novamente.' }, 422);
    await env.LEADS_DB.prepare(`INSERT INTO leads (id, nome, email, empresa, cargo, necessidade, descricao, origem, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, 'totvs-rm', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(data.requestId, fields.nome, fields.email, fields.empresa, fields.cargo, fields.necessidade, fields.descricao, ...CAMPAIGN.map(name => campaign[name]), fingerprint).run();
    const saved = await env.LEADS_DB.prepare('SELECT fingerprint FROM leads WHERE id = ?').bind(data.requestId).first();
    if (!saved || saved.fingerprint !== fingerprint) return json({ error: 'Conflito no envio. Recarregue a página.' }, 409);
    return json({ ok: true }, 201);
  } catch {
    console.error('lead_storage_failed'); // Deliberately excludes payloads and database errors.
    return json({ error: 'Não foi possível registrar sua solicitação. Tente novamente.' }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/leads/totvs-rm') return lead(request, env);
    if (url.pathname === '/api/leads/config') {
      if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405, { Allow: 'GET' });
      return json({ available: ready(env), siteKey: ready(env) ? env.TURNSTILE_SITE_KEY : null });
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Rota não encontrada.' }, 404);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env) {
    if (!env.LEADS_DB) return;
    // Retention applies to inactive leads; active opportunities are reviewed manually.
    await env.LEADS_DB.batch([
      env.LEADS_DB.prepare('DELETE FROM lead_rate_limits WHERE expires_at < ?').bind(Math.floor(Date.now() / 1000)),
      env.LEADS_DB.prepare("DELETE FROM leads WHERE status IN ('novo', 'encerrado') AND atualizado_em < datetime('now', '-180 days')"),
    ]);
  },
};
