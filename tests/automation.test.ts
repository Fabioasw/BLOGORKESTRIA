import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {setup,addLead,request,payload,accessToken} from './support.ts';
import {processOutbox,scheduleAutomation,localClock,renderMessage,type OutboxJob} from '../src/worker/automation.ts';
import {cloudflareSender,DeliveryError,emailReady} from '../src/worker/email.ts';

const now=()=>Math.floor(Date.now()/1000)+1;
function configured(){
  const s=setup();Object.assign(s.env,{AUTOMATION_MODE:'preview',EMAIL_PROVIDER:'cloudflare',EMAIL_FROM:'crm@example.com',EMAIL_ADMIN_TO:'admin@example.com',EMAIL_TEST_RECIPIENTS:'admin@example.com,teste@example.com',CRM_PUBLIC_ORIGIN:'https://crm-preview.example.com',EMAIL:{send:async()=>({messageId:crypto.randomUUID()})}});
  s.db.sqlite.exec('UPDATE automation_settings SET enabled=1,daily_summary=0');return s;
}
function jobs(s:ReturnType<typeof setup>){return s.db.sqlite.prepare('SELECT * FROM automation_outbox ORDER BY kind').all() as unknown as OutboxJob[];}

test('migração incremental preserva registro, identificador e histórico anteriores',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0001_commercial_leads.sql','0002_challenge_replay.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  // Populate using the original schema before introducing CRM columns.
  const original=setup();const sql=original.db.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='leads'").get();assert.ok(sql);
  db.exec("INSERT INTO leads(id,idempotency_key,payload_hash,name,email,company,job_title,service_type,description,source,landing_page,privacy_notice_version) VALUES('old','old-key','fixture-hash','Teste','teste@example.com','Exemplo','TI','Integração','Solicitação anterior à migração CRM','site','/totvs-rm','2026-10-15')");
  db.exec(readFileSync(new URL('../migrations/0003_commercial_automation.sql',import.meta.url),'utf8'));
  assert.equal(db.prepare('SELECT id FROM leads').get()!.id,'old');assert.equal(db.prepare('SELECT count(*) n FROM lead_events').get()!.n,1);assert.equal(db.prepare('SELECT enabled FROM automation_settings').get()!.enabled,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();original.db.sqlite.close();
});
test('lead e intenções são atômicos, retry idempotente não duplica notificações',async()=>{
  const s=setup(),key=crypto.randomUUID(),data=payload();
  for(let i=0;i<2;i++)assert.ok((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key,data}),s.env)).ok);
  assert.equal(jobs(s).length,2);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM automation_events').get()!.n,2);
  assert.equal(JSON.parse(jobs(s).find(j=>j.kind==='lead_confirmation')!.payload_json).company,undefined);
  s.db.failBatch=true;const response=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key:crypto.randomUUID(),data:payload()}),s.env);assert.equal(response.status,500);assert.equal(jobs(s).length,2);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);s.db.sqlite.close();
});
test('envio pausado ou sem configuração não chama provedor; lead continua salvo',async()=>{
  const s=setup();await addLead(s);let calls=0;await processOutbox(s.env,now(),async()=>{calls++;return {messageId:'x'};});assert.equal(calls,0);assert.equal(jobs(s).filter(j=>j.status==='pending').length,2);assert.equal(emailReady(s.env),false);s.db.sqlite.close();
});
test('sucesso registra aceite, preserva lead e não reenvia no próximo processamento',async()=>{
  const s=configured();await addLead(s);const messages:unknown[]=[];const sender=async(message:unknown)=>{messages.push(message);return {messageId:crypto.randomUUID()};};
  await processOutbox(s.env,now(),sender);await processOutbox(s.env,now()+1000,sender);assert.equal(messages.length,2);assert.equal(jobs(s).filter(j=>j.status==='accepted').length,2);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);
  const admin=renderMessage(jobs(s).find(j=>j.kind==='new_lead_admin')!,s.env);assert.match(admin.text,/login necessário/);assert.doesNotMatch(admin.text,/processos financeiros|teste@example.com/);s.db.sqlite.close();
});
test('homologação bloqueia destinatário externo mesmo com sender injetado',async()=>{
  const s=configured();s.env.EMAIL_TEST_RECIPIENTS='admin@example.com';await addLead(s);let calls=0;await processOutbox(s.env,now(),async()=>{calls++;return {messageId:'local'};});assert.equal(calls,1);assert.equal(jobs(s).find(j=>j.kind==='lead_confirmation')!.status,'failed');assert.equal(s.db.sqlite.prepare("SELECT last_error_code FROM automation_outbox WHERE kind='lead_confirmation'").get()!.last_error_code,'preview_recipient_blocked');s.db.sqlite.close();
});
test('limite do provedor usa backoff, respeita espera e encerra após cinco tentativas',async()=>{
  const s=configured();await addLead(s);let calls=0,t=now();const reject=async()=>{calls++;throw new DeliveryError('provider_rate_limit',true);};
  await processOutbox(s.env,t,reject);await processOutbox(s.env,t+299,reject);assert.equal(calls,2);
  for(const delay of [300,900,3600,21600]){t+=delay;await processOutbox(s.env,t,reject);}
  assert.equal(calls,10);assert.equal(jobs(s).filter(j=>j.status==='failed'&&j.attempts===5).length,2);s.db.sqlite.close();
});
test('resultado ambíguo não é reenviado automaticamente nem vaza erro privado',async()=>{
  const s=configured();await addLead(s);let calls=0;const unknown=async()=>{calls++;throw new Error('private@example.com SECRET');};await processOutbox(s.env,now(),unknown);await processOutbox(s.env,now()+86400,unknown);assert.equal(calls,2);assert.ok(jobs(s).every(j=>j.status==='uncertain'));assert.doesNotMatch(JSON.stringify(s.db.sqlite.prepare('SELECT detail_json FROM automation_events').all()),/SECRET|private@example.com/);s.db.sqlite.close();
});
test('lease abandonado vira revisão sem nova chamada nem auditoria repetida',async()=>{
  const s=configured();await addLead(s);s.db.sqlite.exec("UPDATE automation_outbox SET status='processing',locked_until=0,lock_token='abandoned'");let calls=0;const sender=async()=>{calls++;return {messageId:'x'};};await processOutbox(s.env,now(),sender);await processOutbox(s.env,now(),sender);assert.equal(calls,0);assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM automation_events WHERE event_type='email_uncertain'").get()!.n,2);s.db.sqlite.close();
});
test('follow-up é único por revisão; reagendamento cancela pendente e mantém histórico',async()=>{
  const s=configured(),id=await addLead(s),token=await accessToken(),t=now();
  let response=await s.app.fetch(request('/api/admin/leads/'+id,{method:'PATCH',token,data:{version:0,next_action:'Conversar sobre escopo',next_action_at:new Date((t-1000)*1000).toISOString(),record_contact:true}}),s.env);assert.equal(response.status,200);
  await scheduleAutomation(s.env,t);await scheduleAutomation(s.env,t);assert.equal(jobs(s).filter(j=>j.kind==='followup').length,1);
  response=await s.app.fetch(request('/api/admin/leads/'+id,{method:'PATCH',token,data:{version:1,next_action:'Retornar proposta',next_action_at:new Date((t+86400)*1000).toISOString()}}),s.env);assert.equal(response.status,200);assert.equal(jobs(s).find(j=>j.kind==='followup')!.status,'cancelled');
  const detail=await(await s.app.fetch(request('/api/admin/leads/'+id,{token}),s.env)).json() as any;assert.equal(detail.data.automationEvents.filter((e:any)=>e.event_type==='followup_updated').length,2);assert.ok(detail.data.lead.last_contact_at);s.db.sqlite.close();
});
test('resumo respeita horário/dia de São Paulo e não duplica em Cron repetido',async()=>{
  const s=configured();s.db.sqlite.exec('UPDATE automation_settings SET daily_summary=1');
  const morning=Date.parse('2026-10-16T11:59:00Z')/1000;await scheduleAutomation(s.env,morning);assert.equal(jobs(s).length,0);
  await scheduleAutomation(s.env,morning+60);await scheduleAutomation(s.env,morning+3600);assert.equal(jobs(s).length,1);assert.equal(jobs(s)[0].kind,'daily_summary');assert.deepEqual(localClock(Date.parse('2026-10-17T01:30:00Z')/1000),{day:'2026-10-16',time:'22:30'});s.db.sqlite.close();
});
test('rotas CRM exigem JWT; configurações, origem, datas e reprocessamento são validados',async()=>{
  const s=configured(),id=await addLead(s),token=await accessToken();
  for(const path of ['/api/admin/crm','/api/admin/automation','/api/admin/automation/run'])assert.equal((await s.app.fetch(request(path),s.env)).status,401);
  assert.equal((await s.app.fetch(request('/api/admin/leads/'+id,{method:'PATCH',token,data:{version:0,next_action:'Retorno',next_action_at:'2026-02-30T12:00:00Z'}}),s.env)).status,400);
  assert.equal((await s.app.fetch(request('/api/admin/automation',{method:'PATCH',token,origin:'https://evil.example',data:{version:0}}),s.env)).status,403);
  const prefs={version:0,enabled:true,notify_admin:true,confirm_customer:true,followup_alerts:true,daily_summary:false,daily_time:'09:00',stale_days:7};assert.equal((await s.app.fetch(request('/api/admin/automation',{method:'PATCH',token,data:prefs}),s.env)).status,200);assert.equal((await s.app.fetch(request('/api/admin/automation',{method:'PATCH',token,data:prefs}),s.env)).status,409);
  const job=jobs(s)[0];s.db.sqlite.prepare("UPDATE automation_outbox SET status='uncertain' WHERE id=?").run(job.id);const path=`/api/admin/automation/${job.id}/retry`;
  assert.equal((await s.app.fetch(request(path,{method:'POST',token,data:{}}),s.env)).status,400);assert.equal((await s.app.fetch(request(path,{method:'POST',token,data:{confirmed_not_delivered:true}}),s.env)).status,200);assert.equal((await s.app.fetch(request(path,{method:'POST',token,data:{}}),s.env)).status,409);
  s.env.AUTOMATION_MODE='production';assert.equal((await s.app.fetch(request('/api/admin/automation/run',{method:'POST',token}),s.env)).status,404);s.db.sqlite.close();
});
test('adaptador Cloudflare classifica erros sem guardar mensagens ou repetir resultado desconhecido',async()=>{
  const s=configured();for(const [code,expected,retryable,uncertain] of [['E_RATE_LIMIT_EXCEEDED','provider_rate_limit',true,false],['E_DAILY_LIMIT_EXCEEDED','provider_daily_limit',true,false],['E_SENDER_NOT_VERIFIED','provider_rejected',false,false],['E_INTERNAL_SERVER_ERROR','provider_result_unknown',false,true]] as const){
    s.env.EMAIL={send:async()=>{throw Object.assign(new Error('private content'),{code});}} as any;
    await assert.rejects(cloudflareSender(s.env)({to:'admin@example.com',subject:'Local',text:'Fictício'}),(e:unknown)=>e instanceof DeliveryError&&e.code===expected&&e.retryable===retryable&&e.uncertain===uncertain);
  }s.db.sqlite.close();
});
test('identidade do remetente e Reply-To usam campos estruturados; nome malformado bloqueia envio',async()=>{
  const s=configured();Object.assign(s.env,{EMAIL_FROM_NAME:'Fabio Nunes | ORKESTRIA CONSULT',EMAIL_FROM:'contato@orkestriaplatform.com',EMAIL_REPLY_TO:'contato@orkestriaplatform.com'});
  let received:any,calls=0;s.env.EMAIL={send:async(message:any)=>{calls++;received=message;return {messageId:'local-identity-test'};}} as any;
  await cloudflareSender(s.env)({to:'admin@example.com',subject:'Teste local',text:'Dados fictícios'});
  assert.deepEqual(received.from,{email:'contato@orkestriaplatform.com',name:'Fabio Nunes | ORKESTRIA CONSULT'});
  assert.equal(received.replyTo,'contato@orkestriaplatform.com');assert.equal(calls,1);
  for(const name of ['','   ','Fabio\r\nBcc: outra@example.com','a'.repeat(121)]){
    s.env.EMAIL_FROM_NAME=name;assert.equal(emailReady(s.env),false);
    await assert.rejects(cloudflareSender(s.env)({to:'admin@example.com',subject:'Teste',text:'Fictício'}),(e:unknown)=>e instanceof DeliveryError&&e.code==='email_not_configured');
  }assert.equal(calls,1);s.db.sqlite.close();
});
test('agenda distingue atraso, ausência de ação e arquivamento; arquivo preserva histórico',async()=>{
  const s=configured(),id=await addLead(s),token=await accessToken();
  s.db.sqlite.prepare("UPDATE leads SET created_at='2020-01-01T00:00:00Z',updated_at='2026-10-16T10:00:00Z' WHERE id=?").run(id);
  const search=async(view:string)=>((await(await s.app.fetch(request('/api/admin/leads/search',{method:'POST',token,data:{view}}),s.env)).json()) as any).data.total;
  assert.equal(await search('stale'),1);assert.equal(await search('no_action'),1);assert.equal(await search('overdue'),0);
  const result=await s.app.fetch(request('/api/admin/leads/'+id,{method:'PATCH',token,data:{version:0,archived:true,note:'Arquivado para revisão posterior.'}}),s.env);assert.equal(result.status,200);
  assert.equal(await search('active'),0);assert.equal(await search('archived'),1);assert.equal(await search('all'),1);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,2);s.db.sqlite.close();
});
test('mais de 100 retornos não ficam bloqueados pelos primeiros já agendados',async()=>{
  const s=configured(),id=await addLead(s);
  const insert=s.db.sqlite.prepare("INSERT INTO leads(id,idempotency_key,payload_hash,name,email,company,job_title,service_type,description,privacy_notice_version,next_action,next_action_at) SELECT ?,?,payload_hash,name,email,company,job_title,service_type,description,privacy_notice_version,'Retorno','2020-01-01T00:00:00Z' FROM leads WHERE id=?");
  for(let i=0;i<105;i++)insert.run(crypto.randomUUID(),crypto.randomUUID(),id);
  await scheduleAutomation(s.env,now());await scheduleAutomation(s.env,now());await scheduleAutomation(s.env,now());assert.equal(jobs(s).filter(j=>j.kind==='followup').length,105);s.db.sqlite.close();
});
test('produção Free não cria confirmações nem permite ativá-las; fila anterior é cancelada',async()=>{
  const s=configured();await addLead(s);Object.assign(s.env,{AUTOMATION_MODE:'production',EMAIL_CUSTOMER_CONFIRMATIONS:'false',CRM_PUBLIC_ORIGIN:'https://orkestriaplatform.com'});
  await addLead(s,{email:'outra@example.com'});assert.equal(jobs(s).filter(j=>j.kind==='lead_confirmation').length,1);
  const token=await accessToken(),response=await s.app.fetch(request('/api/admin/automation',{method:'PATCH',token,data:{version:0,enabled:true,notify_admin:true,confirm_customer:true,followup_alerts:true,daily_summary:false,daily_time:'09:00',stale_days:7}}),s.env);assert.equal(response.status,400);
  const data=await(await s.app.fetch(request('/api/admin/automation',{token}),s.env)).json() as any;assert.equal(data.data.customerConfirmationsAvailable,false);
  let calls=0;await processOutbox(s.env,now(),async()=>{calls++;return {messageId:crypto.randomUUID()};});assert.equal(calls,2);assert.equal(jobs(s).find(j=>j.kind==='lead_confirmation')!.status,'cancelled');s.db.sqlite.close();
});
