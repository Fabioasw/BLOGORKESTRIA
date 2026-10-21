// Real local Cloudflare runtime test, ephemeral JWT keys, separate local D1 state.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import assert from 'node:assert/strict';
// Keep the path short for SQLite/Workerd on Windows, and isolate each run.
const dir=`work/r${crypto.randomUUID().slice(0,8)}`;await mkdir(dir,{recursive:true});
const pair=await generateKeyPair('RS256',{modulusLength:2048});
await writeFile('work/runtime-fixture-jwks.json',JSON.stringify({keys:[{...await exportJWK(pair.publicKey),kid:'runtime-test',alg:'RS256',use:'sig'}]}));
const cli='node_modules/wrangler/bin/wrangler.js';
const migration=spawnSync(process.execPath,[cli,'d1','migrations','apply','DB','--config','wrangler.preview.toml','--local','--persist-to',dir],{encoding:'utf8',timeout:60000});
if(migration.status!==0)throw new Error(`Local migration failed: ${migration.stdout}\n${migration.stderr}`);
console.log('D1 local migration: OK');
const child=spawn(process.execPath,[cli,'dev','tests/runtime-fixture.ts','--config','wrangler.preview.toml','--local','--ip','127.0.0.1','--port','8791','--persist-to',dir,'--var','TURNSTILE_SITE_KEY:local-fixture','--var','TURNSTILE_SECRET_KEY:local-fixture','--var','TURNSTILE_HOSTNAMES:127.0.0.1','--var','RATE_LIMIT_SECRET:local-fixture','--var','ACCESS_TEAM_DOMAIN:https://runtime-test.cloudflareaccess.com','--var','ACCESS_AUD:runtime-test-aud','--var','ADMIN_EMAILS:admin@example.com'],{stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
const base='http://127.0.0.1:8791';
try {
  let ready=false;
  for(let i=0;i<240;i++){try{const r=await fetch(base+'/api/leads/config',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  if(!ready)throw new Error('Local Workerd did not become ready. '+log);
  const token=await new SignJWT({email:'admin@example.com'}).setProtectedHeader({alg:'RS256',kid:'runtime-test'}).setSubject('runtime-test-admin').setIssuer('https://runtime-test.cloudflareaccess.com').setAudience('runtime-test-aud').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const headers={'Content-Type':'application/json',Origin:base,'Cf-Access-Jwt-Assertion':token};
  assert.equal((await fetch(base+'/api/admin/stats')).status,401);
  const key=crypto.randomUUID();const data={name:'Pessoa Teste Runtime',email:'runtime@example.com',company:'Teste D1 Local',job_title:'TI',service_type:'Integração de sistemas',description:'Teste completo no runtime local da Cloudflare com banco D1.',marketing_consent:false,measurement_consent:true,privacy_notice_version:'2026-10-15',token:'local-fixture',campaign:{utm_source:'runtime-test',utm_campaign:'local'}};
  let r=await fetch(base+'/api/leads/totvs-rm',{method:'POST',headers:{...headers,'Idempotency-Key':key},body:JSON.stringify(data)});assert.equal(r.status,201);const created=await r.json();const id=created.data.id;
  r=await fetch(base+'/api/leads/totvs-rm',{method:'POST',headers:{...headers,'Idempotency-Key':key},body:JSON.stringify(data)});assert.equal(r.status,200);assert.equal((await r.json()).data.id,id);
  r=await fetch(base+'/api/admin/leads/search',{method:'POST',headers,body:JSON.stringify({q:'Teste D1 Local',page:1,pageSize:20})});assert.equal(r.status,200);assert.ok((await r.json()).data.items.some(lead=>lead.id===id));
  r=await fetch(base+'/api/admin/leads/'+id,{method:'PATCH',headers,body:JSON.stringify({version:0,status:'qualificado',note:'Validação do runtime local.'})});assert.equal(r.status,200);
  r=await fetch(base+'/api/admin/leads/'+id,{headers});const detail=await r.json();assert.equal(detail.data.lead.status,'qualificado');assert.equal(detail.data.events.length,3);
  for(const path of ['/','/totvs-rm','/processos.html','/blog/','/assets/admin.js'])assert.equal((await fetch(base+path)).status,200,path);
  assert.equal((await fetch(base+'/api/not-found')).status,404);
  assert.equal((await fetch(base+'/.git/config')).status,404);
  assert.equal((await fetch(base+'/src/worker/index.ts')).status,404);
  for(const path of ['/admin/leads','/admin/leads.html','/admin%2Fleads','/%61dmin/leads'])assert.equal((await fetch(base+path)).status,401,path);
  r=await fetch(base+'/admin/leads',{headers});assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);
  console.log('Workerd + D1 local: create, replay, JWT authentication, search, status, history, static routes and source exclusions: OK');
}finally{
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});else child.kill('SIGTERM');
  await writeFile('work/runtime-fixture.log',log);
}
