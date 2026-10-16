// Workerd + real local D1. No Cloudflare credentials or external email calls.
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const code=await build({stdin:{resolveDir:root,sourcefile:'local-crm-runtime.js',contents:`
import {processOutbox} from './src/worker/automation.ts';
let sends=0;
export default {async fetch(request,env){
  if(new URL(request.url).pathname==='/run'){
    await processOutbox({...env,EMAIL:{send:async()=>({messageId:'local-only'})}},Math.floor(Date.now()/1000),async()=>{sends++;await new Promise(resolve=>setTimeout(resolve,5));return {messageId:'local-'+sends};});
  }
  return Response.json({sends});
}};`},bundle:true,platform:'browser',format:'esm',write:false,logLevel:'silent'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'local-crm-test',host:'127.0.0.1',port:0,modules:true,script:code.outputFiles[0].text,compatibilityDate:'2026-05-17',d1Databases:{DB:'crm-only-local'},bindings:{AUTOMATION_MODE:'preview',EMAIL_PROVIDER:'cloudflare',EMAIL_FROM:'crm@example.com',EMAIL_ADMIN_TO:'admin@example.com',EMAIL_TEST_RECIPIENTS:'admin@example.com',CRM_PUBLIC_ORIGIN:'https://preview.example.com'},log:new Log(LogLevel.ERROR)}));
try{
  await mf.ready;const db=await mf.getD1Database('DB');
  const sql=(await Promise.all((await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile('migrations/'+f,'utf8')))).join('\n');
  const python=resolve(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const parsed=spawnSync(python,['-c',"import sqlite3,json,sys; s=''; out=[]\nfor line in sys.stdin:\n s+=line\n if sqlite3.complete_statement(s): out.append(s); s=''\nassert not s.strip(); print(json.dumps(out))"],{input:sql,encoding:'utf8'});assert.equal(parsed.status,0);
  for(const statement of JSON.parse(parsed.stdout))await db.prepare(statement).run();
  await db.prepare('UPDATE automation_settings SET enabled=1').run();
  for(let i=0;i<20;i++)await db.prepare("INSERT INTO automation_outbox(id,dedupe_key,kind,recipient,payload_json,available_at) VALUES(?,?,'daily_summary','admin@example.com',?,0)").bind('job-'+i,'dedupe-'+i,JSON.stringify({day:'2026-10-16',since:'2026-10-15T12:00:00Z',until:'2026-10-16T12:00:00Z',newLeads:0,overdue:0,stale:0,failures:0})).run();
  // Overlapping Cron/manual invocations must claim each job exactly once.
  const responses=await Promise.all(Array.from({length:4},()=>mf.dispatchFetch('http://local.test/run')));for(const r of responses)assert.equal(r.status,200);
  const count=await(await mf.dispatchFetch('http://local.test/count')).json();assert.equal(count.sends,20);
  assert.equal((await db.prepare("SELECT count(*) n FROM automation_outbox WHERE status='accepted'").first()).n,20);
  assert.equal((await db.prepare("SELECT count(*) n FROM automation_events WHERE event_type='email_accepted'").first()).n,20);
  await mf.dispatchFetch('http://local.test/run');assert.equal((await(await mf.dispatchFetch('http://local.test/count')).json()).sends,20);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const result={passed:true,runtime:'Workerd + local D1',concurrentProcessors:4,uniqueJobs:20,providerCalls:20,repeatedCalls:0,remoteResourcesModified:false,externalEmailsSent:0};
  await mkdir('../outputs',{recursive:true});await writeFile('../outputs/crm-runtime-tests.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}
