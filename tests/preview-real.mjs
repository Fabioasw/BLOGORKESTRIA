// Loopback-only preview of the actual Worker, real Siteverify and isolated local D1.
// Never reads Wrangler configuration, cloud credentials or production D1 IDs.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir, mkdir, cp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');process.chdir(root);
const dir=resolve('work/q'+crypto.randomUUID().slice(0,8));await mkdir(dir,{recursive:true});
const publicDir=resolve(dir,'public');await mkdir(publicDir,{recursive:true});
for(const file of ['index.html','processos.html','totvs-rm.html','privacidade.html','robots.txt','sitemap.xml','_headers','assets','blog','admin']) await cp(file,resolve(publicDir,file),{recursive:true});
const html=await readFile(resolve(publicDir,'totvs-rm.html'),'utf8');
await writeFile(resolve(publicDir,'totvs-rm.html'),html.replace('<body>','<body><div style="background:#fff3b0;color:#111;padding:12px;text-align:center">PRÉVIA LOCAL — D1 isolado de desenvolvimento. Somente dados fictícios.</div>'));
const ignored=spawnSync('git',['check-ignore','-q','.dev.vars']);
assert.equal(ignored.status,0,'The local secret store must be ignored by Git.');
const envFile=await readFile('.dev.vars','utf8');
function secret(name){const value=envFile.split(/\r?\n/).find(line=>line.startsWith(name+'='))?.slice(name.length+1).trim().replace(/^['"]|['"]$/g,'');assert.ok(value,`Missing local binding ${name}`);return value;}
// QA wrapper observes a successful real submission, then tests retries through the
// same production handler. No verifier/auth mocks and no tokens written to disk.
const compiled=await build({stdin:{resolveDir:root,sourcefile:'real-qa-entry.js',contents:`
import app from './src/worker/index.ts';
export default {...app,async fetch(request,env,ctx){
  if(new URL(request.url).pathname!=='/api/leads/totvs-rm'||request.method!=='POST')return app.fetch(request,env,ctx);
  const saved=request.clone();const response=await app.fetch(request,env,ctx);
  if(response.status===201){
    const input=await saved.json();const headers=new Headers(saved.headers);
    const before=await env.DB.prepare('SELECT count(*) n FROM leads').first();
    const send=()=>app.fetch(new Request(saved.url,{method:'POST',headers,body:JSON.stringify(input)}),env,ctx);
    const retry=await send();
    input.description+=' Modified payload for conflict test.';const conflict=await send();
    input.description=input.description.replace(' Modified payload for conflict test.','');
    headers.set('Idempotency-Key',crypto.randomUUID());const replay=await send();
    const after=await env.DB.prepare('SELECT count(*) n FROM leads').first();
    const events=await env.DB.prepare('SELECT count(*) n FROM lead_events').first();
    console.log(JSON.stringify({event:'real_qa_result',create:response.status,retry:retry.status,conflict:conflict.status,tokenReplay:replay.status,before:before.n,after:after.n,events:events.n,pass:retry.status===200&&conflict.status===409&&replay.status===400&&before.n===after.n}));
  }return response;
}};`},bundle:true,format:'esm',write:false,platform:'browser',logLevel:'silent'});
const options=convertV4MiniflareOptions({
  name:'orkestria-local-real-qa',host:'127.0.0.1',port:8792,modules:true,
  script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-17',
  d1Databases:{DB:'orkestria-development-local-only'},
  bindings:{TURNSTILE_SITE_KEY:'0x4AAAAAAFYAVXdns4_TqXWF',TURNSTILE_SECRET_KEY:secret('TURNSTILE_SECRET_KEY'),RATE_LIMIT_SECRET:secret('RATE_LIMIT_SECRET'),TURNSTILE_HOSTNAMES:'127.0.0.1',PRIVACY_NOTICE_VERSION:'2026-10-15',RETENTION_DAYS:'180',ADMIN_EMAILS:'fabioasw01@gmail.com'},
  assets:{directory:publicDir,binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
  log:new Log(LogLevel.ERROR),
});
options.resourcePersistencePath=resolve(dir,'db');
const mf=new Miniflare(options);
try {
  await mf.ready;
  const db=await mf.getD1Database('DB');
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'").first();
  if(!exists){
    // sqlite3.complete_statement handles multiline SQL and trigger bodies correctly.
    const python=resolve(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    const migrations=(await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort();
    const sql=(await Promise.all(migrations.map(file=>readFile('migrations/'+file,'utf8')))).join('\n');
    const parser=spawnSync(python,['-c',"import sqlite3,json,sys; s=''; out=[]\nfor line in sys.stdin:\n s+=line\n if sqlite3.complete_statement(s): out.append(s); s=''\nassert not s.strip(); print(json.dumps(out))"],{input:sql,encoding:'utf8'});
    assert.equal(parser.status,0,'SQL migration parser failed.');
    for(const sql of JSON.parse(parser.stdout))await db.prepare(sql).run();
  }
  const base='http://127.0.0.1:8792';
  const data={name:'Teste QA Real',email:'qa@example.com',company:'Teste D1 Desenvolvimento',job_title:'TI',service_type:'Integração de sistemas',description:'Teste isolado de captura comercial no D1 de desenvolvimento.',marketing_consent:false,measurement_consent:false,privacy_notice_version:'2026-10-15',token:'invalid-qa-token'};
  const before=await db.prepare('SELECT count(*) n FROM leads').first();
  const invalid=await fetch(base+'/api/leads/totvs-rm',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(data)});
  const invalidBody=await invalid.text();
  assert.equal(invalid.status,400,invalidBody);assert.equal(JSON.parse(invalidBody).error.code,'invalid_challenge');
  assert.equal((await db.prepare('SELECT count(*) n FROM leads').first()).n,before.n);
  console.log('Real Siteverify invalid token: rejected 400; local D1 unchanged.');
  console.log('Actual Worker preview ready: '+base+'/totvs-rm');
  console.log('D1: local development only. Real token success and replay: pending browser test.');
  process.on('SIGINT',async()=>{await mf.dispose();process.exit(0);});
  process.on('SIGTERM',async()=>{await mf.dispose();process.exit(0);});
}catch(error){await mf.dispose();let message=String(error?.stack||error);for(const name of ['TURNSTILE_SECRET_KEY','RATE_LIMIT_SECRET'])message=message.replaceAll(secret(name),'[redacted]');console.error(message);process.exit(1);}
