import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker.mjs';

const migration = readFileSync(new URL('../migrations/0001_leads.sql', import.meta.url), 'utf8');
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  return {
    sqlite,
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async run() { return sqlite.prepare(sql).run(...this.values); },
      };
    },
    async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
}
function setup() {
  const db = database();
  return { db, env: { LEADS_DB: db, TURNSTILE_SITE_KEY: 'test-public', TURNSTILE_SECRET_KEY: 'test-secret', RATE_LIMIT_SECRET: 'test-rate' } };
}
const payload = () => ({ nome: 'Pessoa Teste', email: 'teste@example.com', empresa: 'Empresa Teste', cargo: 'TI', necessidade: 'Integração de sistemas', descricao: 'Precisamos integrar os processos financeiros ao ERP.', token: 'test-token', requestId: crypto.randomUUID(), website: '', campaign: { utm_source: 'teste', utm_campaign: 'rm', gclid: 'test-click' } });
function request(data, options = {}) {
  return new Request('https://orkestriaplatform.com/api/leads/totvs-rm', { method: 'POST', headers: { Origin: 'https://orkestriaplatform.com', 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...options.headers }, body: JSON.stringify(data), ...options });
}
async function verifyMock(fn, result = { success: true, hostname: 'orkestriaplatform.com', action: 'totvs_rm_lead' }) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    return Response.json(result);
  };
  try { await fn(); } finally { globalThis.fetch = original; }
}

test('grava dados reais em SQLite, campanhas e estado comercial; repetição é idempotente', async () => {
  const { db, env } = setup();
  const data = payload();
  data.empresa = "Empresa D'Ávila <script>exemplo</script>";
  await verifyMock(async () => {
    assert.equal((await worker.fetch(request(data), env)).status, 201);
    assert.equal((await worker.fetch(request(data), env)).status, 200);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM leads').get().n, 1);
    const saved = db.sqlite.prepare('SELECT * FROM leads').get();
    assert.equal(saved.empresa, data.empresa);
    assert.equal(saved.utm_source, 'teste');
    assert.equal(saved.gclid, 'test-click');
    assert.equal(saved.status, 'novo');
    assert.equal(saved.origem, 'totvs-rm');
    assert.ok(saved.criado_em && saved.atualizado_em);
    assert.equal((await worker.fetch(request({ ...data, descricao: 'Outro problema suficientemente detalhado.' }), env)).status, 409);
  });
  db.sqlite.close();
});
test('valida campos, e-mail, necessidade, honeypot, campanha e tamanho no servidor', async () => {
  const { db, env } = setup();
  for (const patch of [{ nome: '' }, { email: 'invalido' }, { empresa: '' }, { cargo: '' }, { necessidade: 'inexistente' }, { descricao: 'curto' }, { descricao: 'x'.repeat(4001) }, { nome: 'abc\u0000' }, { campaign: { utm_source: 'x'.repeat(251) } }, { campaign: [] }, { campaign: 'invalid' }, { token: '' }]) {
    assert.equal((await worker.fetch(request({ ...payload(), ...patch }), env)).status, 422);
  }
  assert.equal((await worker.fetch(request({ ...payload(), website: 'spam' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ ...payload(), requestId: 'bad' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ ...payload(), descricao: 'x'.repeat(17000) }), env)).status, 413);
  assert.equal((await worker.fetch(new Request('https://orkestriaplatform.com/api/leads/totvs-rm', { method: 'POST', headers: { Origin: 'https://orkestriaplatform.com', 'Content-Type': 'application/json' }, body: '{' }), env)).status, 400);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM leads').get().n, 0);
  db.sqlite.close();
});
test('bloqueia origem externa, tipo incorreto, métodos e dependências ausentes', async () => {
  const { db, env } = setup();
  assert.equal((await worker.fetch(request(payload(), { headers: { Origin: 'https://outro.example', 'Content-Type': 'application/json' } }), env)).status, 403);
  assert.equal((await worker.fetch(request(payload(), { headers: { Origin: 'https://orkestriaplatform.com', 'Content-Type': 'text/plain' } }), env)).status, 415);
  assert.equal((await worker.fetch(new Request('https://orkestriaplatform.com/api/leads/totvs-rm'), env)).status, 405);
  assert.equal((await worker.fetch(request(payload()), {})).status, 503);
  assert.equal((await (await worker.fetch(new Request('https://orkestriaplatform.com/api/leads/config'), {})).json()).available, false);
  assert.equal((await worker.fetch(new Request('https://orkestriaplatform.com/api/unknown'), env)).status, 404);
  db.sqlite.close();
});
test('valida assinatura Turnstile, hostname e action antes de gravar', async () => {
  for (const result of [{ success: false }, { success: true, hostname: 'outro.example', action: 'totvs_rm_lead' }, { success: true, hostname: 'orkestriaplatform.com', action: 'outro' }]) {
    const { db, env } = setup();
    await verifyMock(async () => { assert.equal((await worker.fetch(request(payload()), env)).status, 422); }, result);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM leads').get().n, 0);
    db.sqlite.close();
  }
});
test('limite atômico impede a nona tentativa na janela, sem guardar IP original', async () => {
  const { db, env } = setup();
  await verifyMock(async () => {
    for (let i = 0; i < 8; i++) assert.equal((await worker.fetch(request(payload()), env)).status, 201);
    const blocked = await worker.fetch(request(payload()), env);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
  });
  assert.ok(!JSON.stringify(db.sqlite.prepare('SELECT * FROM lead_rate_limits').all()).includes('192.0.2.1'));
  db.sqlite.close();
});
test('falhas de serviço e banco não geram confirmação de sucesso', async () => {
  const { db, env } = setup();
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network'); };
  try { assert.equal((await worker.fetch(request(payload()), env)).status, 503); } finally { globalThis.fetch = original; }
  await verifyMock(async () => {
    db.sqlite.exec('DROP TABLE leads');
    const oldError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    try { assert.equal((await worker.fetch(request(payload()), env)).status, 503); } finally { console.error = oldError; }
    assert.deepEqual(logs, ['lead_storage_failed']);
  });
  db.sqlite.close();
});
test('retenção elimina leads inativos antigos, preserva oportunidades ativas e limpa buckets', async () => {
  const { db, env } = setup();
  await verifyMock(async () => {
    for (let i = 0; i < 3; i++) await worker.fetch(request(payload()), env);
  });
  const ids = db.sqlite.prepare('SELECT id FROM leads').all();
  db.sqlite.prepare("UPDATE leads SET atualizado_em = datetime('now', '-181 days') WHERE id = ?").run(ids[0].id);
  db.sqlite.prepare("UPDATE leads SET status = 'em_contato', atualizado_em = datetime('now', '-181 days') WHERE id = ?").run(ids[1].id);
  db.sqlite.exec("INSERT INTO lead_rate_limits VALUES ('old',1,0)");
  await worker.scheduled({}, env);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM leads').get().n, 2);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM lead_rate_limits WHERE bucket='old'").get().n, 0);
  db.sqlite.close();
});
test('páginas existentes continuam encaminhadas ao binding de assets', async () => {
  for (const path of ['/', '/totvs-rm', '/totvs-rm/', '/processos.html', '/blog/do-xml-ao-erp.html']) {
    let called = false;
    const response = await worker.fetch(new Request('https://orkestriaplatform.com' + path), { ASSETS: { fetch(request) { called = true; assert.equal(new URL(request.url).pathname, path); return new Response('asset'); } } });
    assert.ok(called); assert.equal(await response.text(), 'asset');
  }
});
