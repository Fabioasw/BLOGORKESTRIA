// Real Workerd and isolated local D1. No remote resources, Google or mail.
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const code=await build({stdin:{resolveDir:root,contents:`import {createWorker} from './src/worker/index.ts';const worker=createWorker({authorize:async()=>({id:'local-admin',email:'local@example.com'}),verifyTurnstile:async()=>{}});export default {fetch(r,e){return worker.fetch(r,{...e,MEASUREMENT_LIMITER:{limit:async()=>({success:true})}})}};`},bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'local-readiness',modules:true,script:code.outputFiles[0].text,compatibilityDate:'2026-05-17',d1Databases:{DB:'readiness-local-'+crypto.randomUUID()},bindings:{MEASUREMENT_ENABLED:'true',AUTOMATION_MODE:'preview',RATE_LIMIT_SECRET:'local-fixture',TURNSTILE_SITE_KEY:'local',TURNSTILE_SECRET_KEY:'local',TURNSTILE_HOSTNAMES:'preview.example',PRIVACY_NOTICE_VERSION:'2026-10-15'},log:new Log(LogLevel.ERROR)}));
let checks=0;function equal(a,b){assert.equal(a,b);checks++;}
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 const python=resolve(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const parsed=spawnSync(python,['-c',"import sqlite3,json,sys; s=''; out=[]\nfor line in sys.stdin:\n s+=line\n if sqlite3.complete_statement(s): out.append(s); s=''\nassert not s.strip(); print(json.dumps(out))"],{input:await readFile('migrations/'+file,'utf8'),encoding:'utf8'});equal(parsed.status,0);for(const sql of JSON.parse(parsed.stdout))await db.prepare(sql).run();
 }
 const origin='https://preview.example',call=(path,data,method='POST',key)=>mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const session=await call('/api/measurement/session',{consent:true,version:'2026-10-21-funnel-v1'});equal(session.status,200);const token=(await session.json()).data.token;
 const event={id:crypto.randomUUID(),event:'landing_view'};
 equal((await call('/api/measurement/events',{token,events:[event]})).status,202);equal((await call('/api/measurement/events',{token,events:[event]})).status,202);
 equal((await db.prepare('SELECT total FROM measurement_totals').first()).total,1);
 equal((await call('/api/measurement/events',{token,events:[{...event,id:crypto.randomUUID(),email:'private@example.com'}]})).status,400);
 const key=crypto.randomUUID(),contact={name:'TEST LOCAL',company:'LOCAL ONLY',phone:'+55 19 90000-0000',service_type:'Outros',note:'Only local D1 fixture',next_action:'Verify local fixture',next_action_at:'2026-11-01T13:00:00Z',is_test:false};
 equal((await call('/api/admin/contacts',contact,'POST',key)).status,201);equal((await call('/api/admin/contacts',contact,'POST',key)).status,200);
 equal((await db.prepare('SELECT count(*) n FROM manual_contacts').first()).n,1);equal((await db.prepare('SELECT count(*) n FROM automation_outbox').first()).n,0);
 const funnel=await call('/api/admin/funnel',null,'GET');equal(funnel.status,200);equal((await funnel.json()).data.events.landing_view,1);
 equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
 const result={passed:true,checks,runtime:'Workerd + isolated LOCAL D1',remoteWrites:0,externalEmails:0,googleRequests:0};await mkdir('../outputs/preparacao-comercial-2026-10-21',{recursive:true});await writeFile('../outputs/preparacao-comercial-2026-10-21/runtime.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}
