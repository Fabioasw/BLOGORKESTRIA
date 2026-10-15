// Development-only Node preview; never included in Cloudflare static assets.
// --fixtures uses a local bot-verification fixture, not the Turnstile service.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.mjs';

const fixture = process.argv.includes('--fixtures');
const port = fixture ? 8788 : 8787;
const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
await mkdir(resolve(root, 'work'), { recursive: true });
const sqlite = fixture ? new DatabaseSync(resolve(root, 'work/preview.sqlite')) : null;
sqlite?.exec(readFileSync(resolve(root, 'migrations/0001_leads.sql'), 'utf8'));
const db = { prepare(sql) { return { values: [], bind(...values) { this.values = values; return this; }, async first() { return sqlite.prepare(sql).get(...this.values) || null; }, async run() { return sqlite.prepare(sql).run(...this.values); } }; } };
let mode = 'normal';
if (fixture) {
  globalThis.fetch = async url => {
    if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') throw new Error('Unexpected fixture request');
    return Response.json({ success: true, hostname: '127.0.0.1', action: 'totvs_rm_lead' });
  };
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const env = fixture ? { LEADS_DB: db, TURNSTILE_SITE_KEY: 'local-fixture', TURNSTILE_SECRET_KEY: 'local-fixture', RATE_LIMIT_SECRET: 'local-only-fixture' } : {};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (fixture && url.pathname === '/__fixtures/recorder.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`(()=>{const events=[];let output;function render(){if(output)output.textContent=JSON.stringify(events);}addEventListener('orkestria:analytics',e=>{events.push(e.detail);render();});addEventListener('DOMContentLoaded',()=>{output=document.createElement('output');output.id='fixture-events';output.hidden=true;document.body.append(output);render();});})();`);
    }
    if (fixture && url.pathname === '/__fixtures/turnstile.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`window.turnstile={render(selector,options){const node=document.querySelector(selector);node.textContent='Ambiente de teste: verificação local simulada.';setTimeout(()=>options.callback('local-fixture'),0);window.fixtureOptions=options;return 'test';},reset(){setTimeout(()=>window.fixtureOptions.callback('local-fixture'),0);}};window.orkestriaTurnstileReady();`);
    }
    if (fixture && url.pathname === '/__fixtures/mode') {
      mode = url.searchParams.get('value') || 'normal';
      res.end('ok'); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (fixture && mode === 'network' && req.method === 'POST') { req.socket.destroy(); return; }
      if (fixture && mode === 'delay' && req.method === 'POST') await new Promise(resolve => setTimeout(resolve, 1000));
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const body = Buffer.concat(chunks);
      const request = new Request(url, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '192.0.2.10' }, ...(body.length ? { body } : {}) });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    if (path.endsWith('/')) path += 'index.html';
    if (!extname(path)) path += '.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep) || /(?:^|\/)\./.test(path) || !/^\/(?:assets\/[^/]+\.(?:css|js|svg)|blog\/[^/]+\.(?:html|css)|(?:index|processos|totvs-rm|privacidade)\.html|sitemap\.xml|robots\.txt)$/.test(path) || !existsSync(file)) { res.writeHead(404); res.end('Não encontrado'); return; }
    let bytes = await readFile(file);
    if (fixture && file.endsWith('totvs-rm.html')) bytes = Buffer.from(bytes.toString().replace('<head>', '<head><script src="/__fixtures/recorder.js"></script>'));
    if (fixture && file.endsWith('totvs-rm.js')) bytes = Buffer.from(bytes.toString().replace('https://challenges.cloudflare.com/turnstile/v0/api.js?onload=orkestriaTurnstileReady&render=explicit', '/__fixtures/turnstile.js'));
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(bytes);
  } catch { res.writeHead(500); res.end('Erro na prévia'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/totvs-rm${fixture ? ' (test-only verification fixture, real local SQLite)' : ''}`));
