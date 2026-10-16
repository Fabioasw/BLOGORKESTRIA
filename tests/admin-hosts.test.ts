import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup,accessToken } from './support.ts';
import { readFileSync } from 'node:fs';

const hosts=['https://orkestriaplatform.com','https://orkestriaplatform.fabioasw01.workers.dev','https://test-version-orkestriaplatform.fabioasw01.workers.dev'];
const routes=['/admin','/admin/','/admin/leads','/admin/leads.html','/api/admin','/api/admin/session','/api/admin/stats','/api/admin/leads','/api/admin/leads/search','/api/admin/leads/00000000-0000-4000-8000-000000000000','/%61dmin/leads','/admin%2fleads','/%2561dmin/leads','//admin/leads','/%61pi/admin/stats','/safe/%2e%2e%2fadmin/leads'];

test('todos os hostnames e aliases administrativos exigem JWT antes de acessar dados ou assets',async()=>{
  const s=setup();let assets=0,queries=0;
  s.env.ASSETS={fetch:async()=>{assets++;throw new Error('unauthorized asset access');}} as any;
  const prepare=s.db.prepare.bind(s.db);s.db.prepare=(sql:string)=>{queries++;return prepare(sql);};
  for(const host of hosts)for(const path of routes)for(const method of ['GET','HEAD','POST','PATCH','DELETE']){
    const r=await s.app.fetch(new Request(host+path,{method}),s.env);
    assert.equal(r.status,401,host+path+' '+method);
    assert.match(r.headers.get('Cache-Control')!,/no-store/);
  }
  assert.equal(assets,0);assert.equal(queries,0);s.db.sqlite.close();
});

test('assinatura, emissor, AUD, validade e email são verificados também em workers.dev e previews',async()=>{
  const s=setup();
  const bad=['forged',await accessToken({issuer:'https://other.cloudflareaccess.com'}),await accessToken({audience:'wrong-app'}),await accessToken({expiration:1})];
  const tampered=(await accessToken()).split('.');tampered[2]=(tampered[2][0]==='A'?'B':'A')+tampered[2].slice(1);bad.push(tampered.join('.'));
  for(const host of hosts){
    const url=host+'/api/admin/session';
    assert.equal((await s.app.fetch(new Request(url,{headers:{'Cf-Access-Authenticated-User-Email':'admin@example.com'}}),s.env)).status,401);
    for(const token of bad)assert.equal((await s.app.fetch(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':token}}),s.env)).status,401);
    assert.equal((await s.app.fetch(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':await accessToken({email:'other@example.com'})}}),s.env)).status,403);
    const ok=await s.app.fetch(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':await accessToken()}}),s.env);
    assert.equal(ok.status,200);assert.equal((await ok.json() as any).data.email,'admin@example.com');
    assert.equal((await s.app.fetch(new Request(url),{...s.env,ACCESS_AUD:undefined})).status,503);
  }s.db.sqlite.close();
});

test('configuração mantém URLs alternativos e impede assets de ignorarem o gate',()=>{
  const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
  assert.match(config,/^workers_dev = true$/m);assert.match(config,/^preview_urls = true$/m);
  assert.match(config,/^run_worker_first = true$/m);
});
