import type { Env,LeadRow } from './types.ts';
import { operational } from './operations.ts';
import { cloudflareSender,DeliveryError,emailReady,validEmail,testRecipients,customerConfirmationsAvailable,type EmailSender,type CommercialMessage } from './email.ts';
export interface AutomationSettings {enabled:number;notify_admin:number;confirm_customer:number;followup_alerts:number;daily_summary:number;daily_time:string;stale_days:number;version:number}
export interface OutboxJob {id:string;lead_id:string|null;kind:'new_lead_admin'|'lead_confirmation'|'followup'|'daily_summary';recipient:string;payload_json:string;attempts:number;lock_token:string;status:string}
const terminal="'convertido','descartado'";
const stamp=(seconds:number)=>new Date(seconds*1000).toISOString();
export async function settings(env:Env){return (await env.DB.prepare('SELECT * FROM automation_settings WHERE id=1').first<AutomationSettings>())!;}
export function localClock(seconds:number){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(seconds*1000));
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {day:`${values.year}-${values.month}-${values.day}`,time:`${values.hour}:${values.minute}`};
}
export function queueStatements(env:Env,lead:{id:string;name:string;email:string;company:string;service_type:string},now=Math.floor(Date.now()/1000)){
  const recipient=env.EMAIL_ADMIN_TO||env.ADMIN_EMAILS?.split(',')[0]?.trim()||'';
  const statements:D1PreparedStatement[]=[];
  for(const kind of ['new_lead_admin','lead_confirmation'] as const){
    if(kind==='lead_confirmation'&&!customerConfirmationsAvailable(env))continue;
    const id=crypto.randomUUID(),flag=kind==='new_lead_admin'?'notify_admin':'confirm_customer';
    const payload=JSON.stringify(kind==='lead_confirmation'?{id:lead.id,name:lead.name}:{id:lead.id,name:lead.name,company:lead.company,service:lead.service_type,createdAt:stamp(now)});
    statements.push(env.DB.prepare(`INSERT INTO automation_outbox(id,dedupe_key,lead_id,kind,recipient,payload_json,available_at) SELECT ?,?,?,?,?,?,? FROM automation_settings WHERE id=1 AND ${flag}=1`).bind(id,`${kind}:${lead.id}`,lead.id,kind,kind==='new_lead_admin'?recipient:lead.email,payload,now));
    statements.push(env.DB.prepare("INSERT INTO automation_events(id,lead_id,job_id,event_type) SELECT ?,lead_id,id,'email_queued' FROM automation_outbox WHERE id=?").bind(crypto.randomUUID(),id));
  }return statements;
}
export async function scheduleAutomation(env:Env,now:number){
  const config=await settings(env);if(!config.enabled)return;
  if(config.followup_alerts){
    const due=await env.DB.prepare(`SELECT id,name,company,next_action_at,followup_revision FROM leads WHERE is_test=0 AND archived_at IS NULL AND status NOT IN (${terminal}) AND next_action_at<=? AND NOT EXISTS(SELECT 1 FROM automation_outbox o WHERE o.dedupe_key='followup:'||leads.id||':'||leads.followup_revision) ORDER BY next_action_at LIMIT 100`).bind(stamp(now)).all<Pick<LeadRow,'id'|'name'|'company'|'next_action_at'|'followup_revision'>>();
    for(const lead of due.results){
      const id=crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO automation_outbox(id,dedupe_key,lead_id,kind,recipient,payload_json,available_at) VALUES (?,?,?,'followup',?,?,?) ON CONFLICT(dedupe_key) DO NOTHING").bind(id,`followup:${lead.id}:${lead.followup_revision}`,lead.id,env.EMAIL_ADMIN_TO||'',JSON.stringify({...lead,createdAt:stamp(now)}),now),
        env.DB.prepare("INSERT INTO automation_events(id,lead_id,job_id,event_type) SELECT ?,lead_id,id,'email_queued' FROM automation_outbox WHERE id=?").bind(crypto.randomUUID(),id),
      ]);
    }
  }
  if(config.followup_alerts){
    const due=await env.DB.prepare(`SELECT id,name,company,next_action_at FROM manual_contacts WHERE is_test=0 AND status NOT IN (${terminal}) AND next_action_at<=? AND NOT EXISTS(SELECT 1 FROM automation_outbox o WHERE o.dedupe_key='manual-followup:'||manual_contacts.id||':'||manual_contacts.next_action_at) ORDER BY next_action_at LIMIT 100`).bind(stamp(now)).all<{id:string;name:string;company:string;next_action_at:string}>();
    for(const contact of due.results){const id=crypto.randomUUID();await env.DB.batch([
      env.DB.prepare("INSERT INTO automation_outbox(id,dedupe_key,kind,recipient,payload_json,available_at) VALUES(?,?,'followup',?,?,?) ON CONFLICT(dedupe_key) DO NOTHING").bind(id,`manual-followup:${contact.id}:${contact.next_action_at}`,env.EMAIL_ADMIN_TO||'',JSON.stringify({...contact,manualContact:true}),now),
      env.DB.prepare("INSERT INTO automation_events(id,job_id,event_type) SELECT ?,id,'email_queued' FROM automation_outbox WHERE id=?").bind(crypto.randomUUID(),id),
    ]);}
  }
  const clock=localClock(now);
  if(config.daily_summary&&clock.time>=config.daily_time){
    const previous=await env.DB.prepare("SELECT created_at FROM automation_outbox WHERE kind='daily_summary' AND status='accepted' ORDER BY created_at DESC LIMIT 1").first<{created_at:string}>();
    const since=previous?.created_at||stamp(now-86400);
    const rows=await env.DB.batch([
      env.DB.prepare('SELECT (SELECT count(*) FROM leads WHERE is_test=0 AND created_at>=? AND created_at<?)+(SELECT count(*) FROM manual_contacts WHERE is_test=0 AND created_at>=? AND created_at<?) n').bind(since,stamp(now),since,stamp(now)),
      env.DB.prepare(`SELECT (SELECT count(*) FROM leads WHERE is_test=0 AND archived_at IS NULL AND status NOT IN (${terminal}) AND next_action_at<=?)+(SELECT count(*) FROM manual_contacts WHERE is_test=0 AND status NOT IN (${terminal}) AND next_action_at<=?) n`).bind(stamp(now),stamp(now)),
      env.DB.prepare(`SELECT (SELECT count(*) FROM leads WHERE is_test=0 AND archived_at IS NULL AND status NOT IN (${terminal}) AND COALESCE(last_contact_at,created_at)<=?)+(SELECT count(*) FROM manual_contacts WHERE is_test=0 AND status NOT IN (${terminal}) AND updated_at<=?) n`).bind(stamp(now-config.stale_days*86400),stamp(now-config.stale_days*86400)),
      env.DB.prepare("SELECT count(*) n FROM automation_outbox WHERE status IN ('failed','uncertain')"),
    ]);
    const count=(i:number)=>Number((rows[i].results[0] as {n:number}).n),id=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO automation_outbox(id,dedupe_key,kind,recipient,payload_json,available_at) VALUES (?,?,'daily_summary',?,?,?) ON CONFLICT(dedupe_key) DO NOTHING").bind(id,`summary:${clock.day}`,env.EMAIL_ADMIN_TO||'',JSON.stringify({day:clock.day,since,until:stamp(now),newLeads:count(0),overdue:count(1),stale:count(2),failures:count(3)}),now),
      env.DB.prepare("INSERT INTO automation_events(id,job_id,event_type) SELECT ?,id,'email_queued' FROM automation_outbox WHERE id=?").bind(crypto.randomUUID(),id),
    ]);
  }
}
export function renderMessage(job:OutboxJob,env:Env):CommercialMessage {
  const data=JSON.parse(job.payload_json),date=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const base=env.CRM_PUBLIC_ORIGIN!;
  const link=data.manualContact?`${base}/admin/leads?contact=${encodeURIComponent(data.id)}`:job.lead_id?`${base}/admin/leads?lead=${encodeURIComponent(job.lead_id)}`:`${base}/admin/leads`;
  const prefix=env.AUTOMATION_MODE==='preview'?'[HOMOLOGAÇÃO] ':'';
  if(job.kind==='lead_confirmation')return {to:job.recipient,subject:prefix+'Recebemos sua solicitação — Orkestria',text:`Olá, ${data.name}.\n\nRecebemos sua solicitação de avaliação de projeto TOTVS RM. Nossa equipe analisará as informações e poderá entrar em contato pelo e-mail informado para conversar sobre sua necessidade.\n\nEsta mensagem confirma o recebimento; não representa uma proposta ou compromisso de prazo.\n\nAtenciosamente,\nOrkestria Platform`};
  if(job.kind==='daily_summary')return {to:job.recipient,subject:prefix+`Resumo comercial Orkestria — ${data.day}`,text:`Resumo até ${date(data.until)} (Brasília).\nNovos leads desde ${date(data.since)}: ${data.newLeads}\nRetornos vencidos: ${data.overdue}\nOportunidades sem contato: ${data.stale}\nEnvios que precisam de revisão: ${data.failures}\n\nAbrir painel protegido: ${link}`};
  return {to:job.recipient,subject:prefix+(job.kind==='followup'?'Retorno comercial pendente — Orkestria':'Nova solicitação TOTVS RM — Orkestria'),text:`Nome: ${data.name}\nEmpresa: ${data.company}\n${job.kind==='followup'?`Retorno previsto: ${date(data.next_action_at)}`:`Necessidade: ${data.service}\nRecebido em: ${date(data.createdAt)}`}\n\nAbrir oportunidade (login necessário): ${link}`};
}
async function releaseJob(env:Env,job:OutboxJob,state:string,code:string|null,now:number,messageId:string|null=null){
  const retryAt=code==='provider_daily_limit'?now+86400:now+[300,900,3600,21600][Math.min(job.attempts-1,3)];
  await env.DB.batch([
    env.DB.prepare("UPDATE automation_outbox SET status=?,available_at=?,last_error_code=?,provider_message_id=?,accepted_at=?,locked_until=NULL WHERE id=? AND lock_token=? AND status='processing'").bind(state,state==='pending'?retryAt:now,code,messageId,state==='accepted'?stamp(now):null,job.id,job.lock_token),
    env.DB.prepare('INSERT INTO automation_events(id,lead_id,job_id,event_type,detail_json) SELECT ?,lead_id,id,?,? FROM automation_outbox WHERE id=? AND lock_token=? AND status=?').bind(crypto.randomUUID(),`email_${state}`,JSON.stringify({attempt:job.attempts,code}),job.id,job.lock_token,state),
  ]);
  if(state==='failed'||state==='uncertain')await operational(env,state==='failed'?'notification_failed':'notification_uncertain','notification');
}
export async function processOutbox(env:Env,now:number,sender:EmailSender=cloudflareSender(env)){
  const config=await settings(env);
  if(!config.enabled||!emailReady(env))return;
  // A crashed/timed-out send cannot safely be retried without reconciliation.
  const expired=await env.DB.prepare("SELECT id,lead_id FROM automation_outbox WHERE status='processing' AND locked_until<=?").bind(now).all<{id:string;lead_id:string|null}>();
  for(const job of expired.results){const marker=crypto.randomUUID();await env.DB.batch([
    env.DB.prepare("UPDATE automation_outbox SET status='uncertain',last_error_code='lease_expired',locked_until=NULL,lock_token=? WHERE id=? AND status='processing' AND locked_until<=?").bind(marker,job.id,now),
    env.DB.prepare("INSERT INTO automation_events(id,lead_id,job_id,event_type,detail_json) SELECT ?,lead_id,id,'email_uncertain','{\"code\":\"lease_expired\"}' FROM automation_outbox WHERE id=? AND lock_token=? AND status='uncertain'").bind(crypto.randomUUID(),job.id,marker),
  ]);await operational(env,'notification_uncertain','notification');}
  for(let i=0;i<10;i++){
    const lease=crypto.randomUUID();
    const job=await env.DB.prepare("UPDATE automation_outbox SET status='processing',lock_token=?,locked_until=?,attempts=attempts+1 WHERE id=(SELECT id FROM automation_outbox WHERE status='pending' AND available_at<=? ORDER BY available_at,created_at LIMIT 1) AND status='pending' RETURNING *").bind(lease,now+180,now).first<OutboxJob>();
    if(!job)break;
    const current=await settings(env);
    const flag=job.kind==='new_lead_admin'?current.notify_admin:job.kind==='lead_confirmation'?current.confirm_customer:job.kind==='followup'?current.followup_alerts:current.daily_summary;
    if(!flag){await releaseJob(env,job,'cancelled','notification_disabled',now);continue;}
    if(!current.enabled){await releaseJob(env,job,'pending','automation_paused',now);break;}
    if(job.kind==='lead_confirmation'&&!customerConfirmationsAvailable(env)){await releaseJob(env,job,'cancelled','customer_confirmation_unavailable',now);continue;}
    if(job.lead_id){
      const lead=await env.DB.prepare('SELECT status,archived_at,followup_revision,is_test FROM leads WHERE id=?').bind(job.lead_id).first<Pick<LeadRow,'status'|'archived_at'|'followup_revision'|'is_test'>>();
      if(!lead||(job.kind==='followup'&&(lead.is_test||lead.archived_at||['convertido','descartado'].includes(lead.status)||JSON.parse(job.payload_json).followup_revision!==lead.followup_revision))){await releaseJob(env,job,'cancelled','opportunity_changed',now);continue;}
    }
    if(job.kind==='followup'&&!job.lead_id){
      const data=JSON.parse(job.payload_json);
      if(data.manualContact){const current=await env.DB.prepare('SELECT status,is_test,next_action_at FROM manual_contacts WHERE id=?').bind(data.id).first<{status:string;is_test:number;next_action_at:string}>();if(!current||current.is_test||['convertido','descartado'].includes(current.status)||current.next_action_at!==data.next_action_at){await releaseJob(env,job,'cancelled','opportunity_changed',now);continue;}}
    }
    if(!validEmail(job.recipient)){await releaseJob(env,job,'failed','invalid_recipient',now);continue;}
    if(env.AUTOMATION_MODE==='preview'&&!testRecipients(env).includes(job.recipient.toLowerCase())){await releaseJob(env,job,'failed','preview_recipient_blocked',now);continue;}
    // At most one customer confirmation per recipient per 30 minutes. Admin
    // notifications remain independent, including legitimate repeat inquiries.
    if(job.kind==='lead_confirmation'){
      const recent=await env.DB.prepare("SELECT id FROM automation_outbox WHERE kind='lead_confirmation' AND lower(recipient)=lower(?) AND status='accepted' AND accepted_at>=? LIMIT 1").bind(job.recipient,stamp(now-1800)).first();
      if(recent){await releaseJob(env,job,'cancelled','confirmation_cooldown',now);continue;}
    }
    try{const sent=await sender(renderMessage(job,env));if(!sent?.messageId)throw new DeliveryError('provider_result_unknown',false,true);await releaseJob(env,job,'accepted',null,now,sent.messageId);}
    catch(error){
      const failure=error instanceof DeliveryError?error:new DeliveryError('provider_result_unknown',false,true);
      await releaseJob(env,job,failure.uncertain?'uncertain':failure.retryable&&job.attempts<5?'pending':'failed',failure.code,now);
    }
  }
}
export async function runAutomations(env:Env,sender?:EmailSender){
  const now=Math.floor(Date.now()/1000);if(!emailReady(env))return;
  await scheduleAutomation(env,now);await processOutbox(env,now,sender);
}
