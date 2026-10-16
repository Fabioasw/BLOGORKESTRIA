import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, addLead, payload, request, setup } from './support.ts';
import { createWorker } from '../src/worker/index.ts';
import { authorize, verifyTurnstile } from '../src/worker/security.ts';
import { localKeys } from './support.ts';

test('migração cria tabelas, índices, FK e trigger; armazenamento, UTM e idempotência reais',async()=>{
  const s=setup(),key=crypto.randomUUID(),data=payload();data.company="D'Ávila <script>exemplo</script>";
  const send=()=>s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key,data}),s.env);
  assert.equal((await send()).status,201);assert.equal((await send()).status,200);
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);
  const row=s.db.sqlite.prepare('SELECT * FROM leads').get()!;
  assert.equal(row.company,data.company);assert.equal(row.utm_source,'google');assert.equal(row.gclid,'test-click');assert.equal(row.marketing_consent,0);assert.equal(row.privacy_notice_version,'2026-10-15');
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,1);
  data.description='Outro problema válido para a mesma solicitação.';assert.equal((await send()).status,409);
  assert.ok(s.db.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index'").get()!.n as number >= 7);
  s.db.sqlite.close();
});
test('servidor rejeita campos inválidos e malformados sem gravar',async()=>{
  const s=setup();let i=0;
  for(const patch of [{name:''},{name:'🙂'},{email:'email-invalido'},{company:''},{job_title:''},{service_type:'falso'},{description:'curto'},{marketing_consent:'sim'},{measurement_consent:null},{campaign:[]},{campaign:{utm_source:'x'.repeat(251)}},{name:'nome\u0000'},{token:''}]) {
    // Separate IP for each assertion so each test exercises validation, not rate limiting.
    const r=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key:crypto.randomUUID(),data:{...payload(),...patch},headers:{'CF-Connecting-IP':`192.0.2.${++i}`}}),s.env);assert.equal(r.status,400,JSON.stringify(patch));
  }
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,0);s.db.sqlite.close();
});
test('métodos, JSON, tamanho, origem, honeypot, secrets e versão da política',async()=>{
  const s=setup();
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm'),s.env)).status,405);
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:payload(),key:crypto.randomUUID(),origin:'https://outro.example'}),s.env)).status,403);
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:payload(),key:crypto.randomUUID(),headers:{'Content-Type':'text/plain'}}),s.env)).status,415);
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:{...payload(),description:'a'.repeat(17000)},key:crypto.randomUUID()}),s.env)).status,413);
  assert.equal((await s.app.fetch(new Request('https://orkestriaplatform.com/api/leads/totvs-rm',{method:'POST',headers:{Origin:'https://orkestriaplatform.com','Content-Type':'application/json'},body:'{' }),s.env)).status,400);
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:{...payload(),website:'spam'},key:crypto.randomUUID()}),s.env)).status,400);
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:{...payload(),privacy_notice_version:'antiga'},key:crypto.randomUUID()}),s.env)).status,409);
  assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:payload(),key:crypto.randomUUID()}),{...s.env,TURNSTILE_SECRET_KEY:undefined})).status,503);
  const c=await(await s.app.fetch(request('/api/leads/config'),{...s.env,TURNSTILE_SECRET_KEY:undefined})).json() as any;assert.equal(c.data.available,false);assert.equal(c.data.siteKey,null);
  s.db.sqlite.close();
});
test('rate limiting conta tentativas inválidas e retorna 429 com espera; sem IP em claro',async()=>{
  const s=setup();
  for(let i=0;i<8;i++) assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:{...payload(),name:''},key:crypto.randomUUID()}),s.env)).status,400);
  const r=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:payload(),key:crypto.randomUUID()}),s.env);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'600');
  assert.ok(!JSON.stringify(s.db.sqlite.prepare('SELECT * FROM request_limits').all()).includes('192.0.2.123'));s.db.sqlite.close();
});
test('recusa de medição descarta campanha no backend mesmo se cliente enviar parâmetros',async()=>{
  const s=setup();await addLead(s,{measurement_consent:false,marketing_consent:true});const row=s.db.sqlite.prepare('SELECT * FROM leads').get()!;assert.equal(row.utm_source,null);assert.equal(row.gclid,null);assert.equal(row.marketing_consent,1);s.db.sqlite.close();
});
test('validação Turnstile real exige success, hostname e action; falha de rede não confirma',async()=>{
  const s=setup(),original=globalThis.fetch;
  try {
    for(const result of [{success:false},{success:'true',hostname:'orkestriaplatform.com',action:'totvs_rm_lead'},{success:true,hostname:'outro.example',action:'totvs_rm_lead'},{success:true,hostname:'orkestriaplatform.com',action:'outro'}]) {
      globalThis.fetch=async()=>Response.json(result);
      await assert.rejects(()=>verifyTurnstile('token',crypto.randomUUID(),request('/'),s.env),(error:any)=>error.status===400);
    }
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');const body=JSON.parse(options!.body as string);assert.equal(body.secret,s.env.TURNSTILE_SECRET_KEY);assert.ok(body.idempotency_key);return Response.json({success:true,hostname:'orkestriaplatform.com',action:'totvs_rm_lead'});};
    await verifyTurnstile('token',crypto.randomUUID(),request('/'),s.env);
    await assert.rejects(()=>verifyTurnstile('token',crypto.randomUUID(),request('/'),{...s.env,TURNSTILE_HOSTNAMES:undefined}),(error:any)=>error.status===400);
    await assert.rejects(()=>verifyTurnstile('token',crypto.randomUUID(),request('/'),{...s.env,TURNSTILE_HOSTNAMES:'localhost,127.0.0.1'}),(error:any)=>error.status===400);
    globalThis.fetch=async()=>{throw new Error('network');};await assert.rejects(()=>verifyTurnstile('token',crypto.randomUUID(),request('/'),s.env),(error:any)=>error.status===503);
    const app=createWorker({verifyTurnstile});const r=await app.fetch(request('/api/leads/totvs-rm',{method:'POST',data:payload(),key:crypto.randomUUID()}),s.env);assert.equal(r.status,503);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,0);
  }finally{globalThis.fetch=original;s.db.sqlite.close();}
});
test('JWT com assinatura RSA, issuer, audience e expiração; identidade falsa e usuário não autorizado bloqueados',async()=>{
  const s=setup();
  for(const path of ['/admin','/admin/leads','/admin/leads/','/admin/leads.html','/api/admin/session','/api/admin/stats','/api/admin/leads/export']) assert.equal((await s.app.fetch(request(path),s.env)).status,401,path);
  assert.equal((await s.app.fetch(request('/api/admin/stats',{headers:{'Cf-Access-Authenticated-User-Email':'admin@example.com'}}),s.env)).status,401);
  for(const token of ['falso',await accessToken({audience:'outro'}),await accessToken({issuer:'https://outro.cloudflareaccess.com'}),await accessToken({expiration:1})]) assert.equal((await s.app.fetch(request('/api/admin/stats',{token}),s.env)).status,401);
  const tampered=(await accessToken()).split('.');tampered[2]=(tampered[2][0]==='A'?'B':'A')+tampered[2].slice(1);
  assert.equal((await s.app.fetch(request('/api/admin/stats',{token:tampered.join('.')}),s.env)).status,401);
  assert.equal((await s.app.fetch(request('/api/admin/stats',{token:await accessToken({email:'nao-autorizado@example.com'})}),s.env)).status,403);
  const token=await accessToken();const user=await authorize(request('/api/admin/session',{token}),s.env,localKeys);assert.equal(user.id,'admin-test-id');
  assert.equal((await s.app.fetch(request('/admin/leads',{token}),s.env)).status,200);
  assert.equal((await s.app.fetch(request('/admin/leads'),{...s.env,ACCESS_AUD:undefined})).status,503);s.db.sqlite.close();
});
test('painel, pesquisa parametrizada, filtros, ordenação, paginação e indicadores',async()=>{
  const s=setup(),token=await accessToken();for(let i=0;i<3;i++)await addLead(s,{company:`Empresa ${i}`});
  const search=async(data:unknown)=>{const r=await s.app.fetch(request('/api/admin/leads/search',{method:'POST',token,data}),s.env);return {r,j:await r.json() as any};};
  let result=await search({page:1,pageSize:2,sort:'company',direction:'asc',source:'google',status:'novo'});assert.equal(result.r.status,200);assert.equal(result.j.data.total,3);assert.equal(result.j.data.items.length,2);assert.equal(result.j.data.items[0].company,'Empresa 0');
  result=await search({page:2,pageSize:2});assert.equal(result.j.data.items.length,1);
  result=await search({q:"' OR 1=1 --"});assert.equal(result.j.data.total,0);
  result=await search({q:'%'});assert.equal(result.j.data.total,0);
  for(const data of [{sort:'created_at; DROP TABLE leads'},{page:0},{pageSize:500},{status:'x'},{from:'2026-02-30'},{from:'2026-02-01',to:'2026-01-01'}])assert.equal((await search(data)).r.status,400);
  const stats=await(await s.app.fetch(request('/api/admin/stats',{token}),s.env)).json() as any;assert.equal(stats.data.total,3);assert.equal(stats.data.counts.novo,3);assert.deepEqual(stats.data.sources,['google']);s.db.sqlite.close();
});
test('status e notas são transacionais, com histórico e proteção contra atualizações concorrentes',async()=>{
  const s=setup(),id=await addLead(s),token=await accessToken(),path=`/api/admin/leads/${id}`;
  const update=(data:unknown)=>s.app.fetch(request(path,{method:'PATCH',token,data}),s.env);
  assert.equal((await update({version:0,status:'qualificado',note:'Necessidade avaliada.'})).status,200);
  const data=await(await s.app.fetch(request(path,{token}),s.env)).json() as any;
  assert.equal(data.data.lead.status,'qualificado');assert.equal(data.data.lead.version,1);assert.equal(data.data.events.length,3);assert.equal(data.data.events.find((e:any)=>e.event_type==='status_changed').admin_id,'admin-test-id');
  assert.equal((await update({version:0,status:'convertido'})).status,409);
  assert.equal((await update({version:1,note:'<script>alert(1)</script>'})).status,200);
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,4);
  assert.equal((await s.app.fetch(request(path,{method:'PATCH',token,origin:'https://outro.example',data:{version:2,status:'convertido'}}),s.env)).status,403);
  s.db.sqlite.close();
});
test('falha de transação reverte status e histórico; erros não expõem dados internos',async()=>{
  const s=setup(),id=await addLead(s),token=await accessToken();s.db.failBatch=true;
  const log=console.error,logs:string[]=[];console.error=(value)=>logs.push(String(value));
  try{const r=await s.app.fetch(request(`/api/admin/leads/${id}`,{method:'PATCH',token,data:{version:0,status:'convertido'}}),s.env);assert.equal(r.status,500);assert.ok(!(await r.text()).includes('private data'));assert.ok(!logs.join('').includes('private data'));}finally{console.error=log;}
  assert.equal(s.db.sqlite.prepare('SELECT status FROM leads').get()!.status,'novo');assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,1);s.db.sqlite.close();
});
test('exclusão autenticada requer confirmação, usa versão e remove histórico por cascade',async()=>{
  const s=setup(),id=await addLead(s),token=await accessToken(),path=`/api/admin/leads/${id}`;
  assert.equal((await s.app.fetch(request(path,{method:'DELETE',token,data:{version:0}}),s.env)).status,400);
  assert.equal((await s.app.fetch(request(path,{method:'DELETE',data:{version:0,confirmation:id}}),s.env)).status,401);
  assert.equal((await s.app.fetch(request(path,{method:'DELETE',token,data:{version:0,confirmation:id}}),s.env)).status,200);
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,0);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,0);s.db.sqlite.close();
});
test('retenção configurável apaga registros inativos e histórico; preserva oportunidades em acompanhamento',async()=>{
  const s=setup();const old=await addLead(s),active=await addLead(s);s.db.sqlite.prepare("UPDATE leads SET updated_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(old);s.db.sqlite.prepare("UPDATE leads SET status='em_analise',updated_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(active);s.db.sqlite.exec("INSERT INTO request_limits VALUES ('expired',1,0)");
  await s.app.scheduled({} as any,s.env);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,1);assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM request_limits WHERE bucket='expired'").get()!.n,0);s.db.sqlite.close();
});
test('rotas estáticas preservadas, APIs desconhecidas 404 JSON e painel sem cache/indexação',async()=>{
  const s=setup();for(const path of ['/','/totvs-rm','/totvs-rm/','/processos.html','/blog/','/assets/bpmn.js','/nao-existe'])assert.equal(await(await s.app.fetch(request(path),s.env)).text(),`asset:${path}`);
  const missing=await s.app.fetch(request('/api/nao-existe'),s.env);assert.equal(missing.status,404);assert.match(missing.headers.get('Content-Type')!,/application\/json/);
  const panel=await s.app.fetch(request('/admin/leads',{token:await accessToken()}),s.env);assert.match(panel.headers.get('Cache-Control')!,/no-store/);assert.match(panel.headers.get('X-Robots-Tag')!,/noindex/);s.db.sqlite.close();
});
