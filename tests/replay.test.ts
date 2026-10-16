import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup,payload,request,accessToken } from './support.ts';

test('token reutilizado com nova chave é bloqueado mesmo se Siteverify aceitasse; retry continua idempotente',async()=>{
  const s=setup(),data=payload(),key=crypto.randomUUID();
  const send=(k=key,d=data)=>s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key:k,data:d}),s.env);
  assert.equal((await send()).status,201);
  assert.equal((await send()).status,200);
  assert.equal((await send(key,{...data,description:'Outro conteúdo válido para testar conflito.'})).status,409);
  const replay=await send(crypto.randomUUID());
  assert.equal(replay.status,400);assert.equal((await replay.json() as any).error.code,'invalid_challenge');
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);
  const challenge=s.db.sqlite.prepare('SELECT * FROM used_challenges').get()!;
  assert.match(String(challenge.token_hash),/^[0-9a-f]{64}$/);assert.ok(!JSON.stringify(challenge).includes(data.token));
  s.db.sqlite.close();
});

test('falha na gravação reverte consumo de token; uma nova tentativa consegue salvar',async()=>{
  const s=setup(),data=payload(),key=crypto.randomUUID();s.db.failBatch=true;
  const send=()=>s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key,data}),s.env);
  const old=console.error;console.error=()=>{};
  try{assert.equal((await send()).status,500);}finally{console.error=old;}
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM used_challenges').get()!.n,0);
  assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,0);
  s.db.failBatch=false;assert.equal((await send()).status,201);s.db.sqlite.close();
});

test('origem workers.dev não dispensa JWT nem autorização administrativa',async()=>{
  const s=setup(),url='https://alternate.example.workers.dev/api/admin/stats';
  for(const headers of [{},{'Cf-Access-Authenticated-User-Email':'admin@example.com'},{'Cf-Access-Jwt-Assertion':'forged'},{'Cf-Access-Jwt-Assertion':await accessToken({audience:'wrong-aud'})}])assert.equal((await s.app.fetch(new Request(url,{headers}),s.env)).status,401);
  assert.equal((await s.app.fetch(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':await accessToken({email:'other@example.com'})}}),s.env)).status,403);
  s.db.sqlite.close();
});
