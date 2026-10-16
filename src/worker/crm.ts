import type { Env,AdminIdentity } from './types.ts';
import { body,HttpError,json,method,sameOrigin,uuid } from './http.ts';
import { settings,runAutomations } from './automation.ts';
import { emailReady,customerConfirmationsAvailable } from './email.ts';
export async function crmAPI(request:Request,env:Env,admin:AdminIdentity,requestId:string):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(path==='/api/admin/automation/run'){
    if(env.AUTOMATION_MODE!=='preview')throw new HttpError(404,'not_found','Endpoint não encontrado.');
    method(request,['POST']);sameOrigin(request);
    if(!emailReady(env)||!(await settings(env)).enabled)throw new HttpError(503,'automation_disabled','Configure e ative os envios de homologação primeiro.');
    await runAutomations(env);
    return json({ok:true,data:{processed:true},requestId});
  }
  if(path==='/api/admin/crm'){
    method(request,['GET']);const config=await settings(env),now=new Date().toISOString(),stale=new Date(Date.now()-config.stale_days*86400000).toISOString();
    const rows=await env.DB.batch([
      env.DB.prepare("SELECT count(*) n FROM leads WHERE archived_at IS NULL AND status NOT IN ('convertido','descartado') AND next_action_at<=?").bind(now),
      env.DB.prepare("SELECT count(*) n FROM leads WHERE archived_at IS NULL AND status NOT IN ('convertido','descartado') AND next_action_at IS NULL"),
      env.DB.prepare("SELECT count(*) n FROM leads WHERE archived_at IS NULL AND status NOT IN ('convertido','descartado') AND COALESCE(last_contact_at,created_at)<=?").bind(stale),
      env.DB.prepare('SELECT count(*) n FROM leads WHERE archived_at IS NOT NULL'),
    ]);
    const count=(index:number)=>Number((rows[index].results[0] as {n:number}).n);
    return json({ok:true,data:{overdue:count(0),noAction:count(1),stale:count(2),archived:count(3),staleDays:config.stale_days},requestId});
  }
  if(path==='/api/admin/automation'){
    method(request,['GET','PATCH']);
    const config=await settings(env);
    if(request.method==='GET'){
      const counts=await env.DB.prepare('SELECT status,count(*) total FROM automation_outbox GROUP BY status').all();
      const jobs=await env.DB.prepare("SELECT id,lead_id,kind,status,attempts,last_error_code,created_at,accepted_at FROM automation_outbox WHERE status IN ('failed','uncertain','pending') ORDER BY created_at DESC LIMIT 30").all();
      return json({ok:true,data:{settings:config,counts:counts.results,jobs:jobs.results,deliveryAvailable:emailReady(env),customerConfirmationsAvailable:customerConfirmationsAvailable(env),mode:env.AUTOMATION_MODE||'disabled',provider:env.EMAIL_PROVIDER||null},requestId});
    }
    sameOrigin(request);const data=await body(request,3000);
    if(data.version!==config.version)throw new HttpError(409,'version_conflict','Configuração alterada. Recarregue o painel.');
    const flags=['enabled','notify_admin','confirm_customer','followup_alerts','daily_summary'] as const;
    for(const flag of flags)if(typeof data[flag]!=='boolean')throw new HttpError(400,'invalid_settings','Preferências inválidas.');
    if(data.confirm_customer&&!customerConfirmationsAvailable(env))throw new HttpError(400,'customer_confirmation_unavailable','Confirmações ao cliente não estão habilitadas no plano atual.');
    if(data.enabled&&!emailReady(env))throw new HttpError(503,'email_not_configured','Configure o envio e o ambiente antes de ativar as automações.');
    if(typeof data.daily_time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.daily_time)||!Number.isInteger(data.stale_days)||(data.stale_days as number)<1||(data.stale_days as number)>365)throw new HttpError(400,'invalid_settings','Informe horário e intervalo válidos.');
    const mutation=crypto.randomUUID();
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE automation_settings SET enabled=?,notify_admin=?,confirm_customer=?,followup_alerts=?,daily_summary=?,daily_time=?,stale_days=?,version=version+1 WHERE id=1 AND version=?').bind(...flags.map(flag=>Number(data[flag])),data.daily_time,data.stale_days as number,config.version),
      env.DB.prepare("INSERT INTO automation_events(id,event_type,detail_json,admin_id) SELECT ?,'settings_changed',?,? WHERE changes()=1").bind(mutation,JSON.stringify({enabled:data.enabled,daily_time:data.daily_time,stale_days:data.stale_days}),admin.id),
    ]);
    if(result[0].meta.changes!==1)throw new HttpError(409,'version_conflict','Configuração alterada. Recarregue o painel.');
    return json({ok:true,data:{updated:true},requestId});
  }
  const retry=path.match(/^\/api\/admin\/automation\/([^/]+)\/retry$/);
  if(retry){
    method(request,['POST']);sameOrigin(request);if(!uuid(retry[1]))throw new HttpError(400,'invalid_id','Identificador inválido.');
    const data=await body(request,1000),job=await env.DB.prepare('SELECT id,status,attempts FROM automation_outbox WHERE id=?').bind(retry[1]).first<{id:string;status:string;attempts:number}>();
    if(!job)throw new HttpError(404,'not_found','Envio não encontrado.');
    if(!['failed','uncertain'].includes(job.status))throw new HttpError(409,'job_not_retryable','O envio já está em processamento ou finalizado.');
    if(job.status==='uncertain'&&data.confirmed_not_delivered!==true)throw new HttpError(400,'reconciliation_required','Confira o Activity Log do provedor e confirme que o e-mail não foi aceito antes de tentar novamente.');
    const marker=crypto.randomUUID();
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE automation_outbox SET status='pending',attempts=0,available_at=?,locked_until=NULL,lock_token=?,last_error_code=NULL WHERE id=? AND status=? AND attempts=?").bind(Math.floor(Date.now()/1000),marker,job.id,job.status,job.attempts),
      env.DB.prepare("INSERT INTO automation_events(id,lead_id,job_id,event_type,detail_json,admin_id) SELECT ?,lead_id,id,'manual_retry',?,? FROM automation_outbox WHERE id=? AND lock_token=?").bind(crypto.randomUUID(),JSON.stringify({previousStatus:job.status,previousAttempts:job.attempts}),admin.id,job.id,marker),
    ]);
    if(result[0].meta.changes!==1)throw new HttpError(409,'version_conflict','O envio foi alterado. Recarregue o painel.');
    return json({ok:true,data:{queued:true},requestId});
  }return null;
}
