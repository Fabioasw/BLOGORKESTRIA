import type { AdminIdentity, Env, LeadRow } from './types.ts';
import { body, HttpError, json, method, sameOrigin, text, uuid } from './http.ts';
import { STATUSES } from './leads.ts';
import { crmAPI } from './crm.ts';
import { settings } from './automation.ts';
import { commercialAPI } from './commercial.ts';

const summary = 'id,name,email,company,job_title,service_type,status,source,utm_source,utm_campaign,created_at,updated_at,version,last_contact_at,next_action,next_action_at,followup_revision,archived_at,is_test';
const detail = `${summary},description,utm_medium,utm_content,utm_term,gclid,landing_page,privacy_notice_version,marketing_consent`;
function invalid(message: string): never { throw new HttpError(400,'invalid_filter',message); }
function date(value: unknown): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) return invalid('Data inválida.');
  return value;
}

export async function adminAPI(request: Request, env: Env, admin: AdminIdentity, requestId: string): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!env.DB) throw new HttpError(503,'database_unavailable','Banco administrativo indisponível.');
  const commercial=await commercialAPI(request,env,admin,requestId);if(commercial)return commercial;
  const crm=await crmAPI(request,env,admin,requestId);if(crm)return crm;
  if (path==='/api/admin/session') { method(request,['GET']); return json({ok:true,data:{email:admin.email},requestId}); }
  if (path==='/api/admin/stats') {
    method(request,['GET']);
    const rows = await env.DB.prepare('SELECT status, count(*) AS total FROM leads GROUP BY status').all<{status:string;total:number}>();
    const counts: Record<string,number> = Object.fromEntries(STATUSES.map(status=>[status,0]));
    for (const row of rows.results) counts[row.status]=row.total;
    const sources = await env.DB.prepare("SELECT DISTINCT COALESCE(NULLIF(utm_source,''),source) AS source FROM leads ORDER BY source LIMIT 200").all<{source:string}>();
    return json({ok:true,data:{total:Object.values(counts).reduce((a,b)=>a+b,0),counts,sources:sources.results.map(row=>row.source)},requestId});
  }
  if (path==='/api/admin/leads/search') {
    method(request,['POST']); sameOrigin(request);
    const input = await body(request,4000);
    const q = input.q===undefined || input.q==='' ? '' : text(input.q,1,160);
    if (q===null) invalid('Pesquisa inválida.');
    const status = input.status || '';
    if (typeof status!=='string' || (status && !STATUSES.includes(status))) invalid('Status inválido.');
    const source = input.source===undefined || input.source==='' ? '' : text(input.source,1,250);
    if (source===null) invalid('Origem inválida.');
    const from=date(input.from), to=date(input.to);
    if (from && to && from>to) invalid('O início deve ser anterior ao fim do período.');
    const page=input.page??1, size=input.pageSize??20;
    if (typeof page!=='number'||!Number.isInteger(page)||page<1||page>100000 || typeof size!=='number'||!Number.isInteger(size)||size<1||size>100) invalid('Paginação inválida.');
    const sorts: Record<string,string> = {created_at:'created_at',company:'company COLLATE NOCASE',name:'name COLLATE NOCASE',status:'status'};
    const sort = typeof input.sort==='string' ? sorts[input.sort] : sorts.created_at;
    if (!sort) invalid('Ordenação inválida.');
    const direction = input.direction??'desc'; if (direction!=='asc'&&direction!=='desc') invalid('Direção inválida.');
    const where: string[]=[]; const values: (string|number)[]=[];
    const view=input.view||'active';
    if(!['active','overdue','no_action','stale','archived','all'].includes(String(view)))invalid('Visão inválida.');
    if(view==='archived')where.push('archived_at IS NOT NULL');else if(view!=='all')where.push('archived_at IS NULL');
    if(['overdue','no_action','stale'].includes(String(view)))where.push("status NOT IN ('convertido','descartado')");
    if(view==='overdue'){where.push('next_action_at<=?');values.push(new Date().toISOString());}
    if(view==='no_action')where.push('next_action_at IS NULL');
    if(view==='stale'){const config=await settings(env);where.push('COALESCE(last_contact_at,created_at)<=?');values.push(new Date(Date.now()-config.stale_days*86400000).toISOString());}
    if(q) { const needle=`%${q.replace(/[\\%_]/g,'\\$&')}%`;where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR job_title LIKE ? ESCAPE '\\')");values.push(needle,needle,needle,needle); }
    if(status) {where.push('status=?');values.push(status);}
    if(source) {where.push("COALESCE(NULLIF(utm_source,''),source)=?");values.push(source);}
    if(from) {where.push('created_at>=?');values.push(`${from}T00:00:00.000Z`);}
    if(to) {where.push('created_at<?');const next=new Date(to);next.setUTCDate(next.getUTCDate()+1);values.push(next.toISOString());}
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const results = await env.DB.batch([
      env.DB.prepare(`SELECT count(*) AS total FROM leads${clause}`).bind(...values),
      env.DB.prepare(`SELECT ${summary} FROM leads${clause} ORDER BY ${sort} ${direction},id ${direction} LIMIT ? OFFSET ?`).bind(...values,size,(page-1)*size),
    ]);
    return json({ok:true,data:{total:(results[0].results[0] as {total:number}).total,items:results[1].results,page,pageSize:size},requestId});
  }
  const match=path.match(/^\/api\/admin\/leads\/([^/]+)$/);
  if (!match) throw new HttpError(404,'not_found','Endpoint não encontrado.');
  const id=match[1]; if(!uuid(id)) throw new HttpError(400,'invalid_id','Identificador inválido.');
  method(request,['GET','PATCH','DELETE']);
  if(request.method!=='GET') sameOrigin(request);
  const lead=await env.DB.prepare(`SELECT ${detail} FROM leads WHERE id=?`).bind(id).first<LeadRow>();
  if(!lead) throw new HttpError(404,'lead_not_found','Oportunidade não encontrada.');
  if(request.method==='GET') {
    const events=await env.DB.prepare('SELECT id,event_type,previous_status,new_status,note,admin_id,created_at FROM lead_events WHERE lead_id=? ORDER BY created_at,rowid').bind(id).all();
    const automationEvents=await env.DB.prepare('SELECT id,event_type,detail_json,admin_id,created_at FROM automation_events WHERE lead_id=? ORDER BY created_at,rowid').bind(id).all();
    return json({ok:true,data:{lead,events:events.results,automationEvents:automationEvents.results},requestId});
  }
  const input=await body(request,12000);
  if(!Number.isInteger(input.version)||input.version!==lead.version) throw new HttpError(409,'version_conflict','A oportunidade foi alterada. Recarregue os detalhes antes de salvar.');
  if(request.method==='DELETE') {
    if(input.confirmation!==id) throw new HttpError(400,'confirmation_required','Confirme o identificador para excluir.');
    const result=await env.DB.prepare('DELETE FROM leads WHERE id=? AND version=?').bind(id,lead.version).run();
    if(result.meta.changes!==1) throw new HttpError(409,'version_conflict','A oportunidade foi alterada. Recarregue os detalhes.');
    return json({ok:true,data:{deleted:true},requestId});
  }
  const status=input.status??lead.status;
  if(typeof status!=='string'||!STATUSES.includes(status)) throw new HttpError(400,'invalid_status','Status inválido.');
  const note=input.note===undefined||input.note==='' ? null : text(input.note,1,2000);
  if(input.note!==undefined&&input.note!==''&&note===null) throw new HttpError(400,'invalid_note','Use até 2.000 caracteres na observação.');
  const time=(value:unknown)=>{if(value===null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,10)).toISOString().slice(0,10)!==value.slice(0,10))throw new HttpError(400,'invalid_followup','Informe uma data válida com fuso horário.');return new Date(value).toISOString();};
  if(input.record_contact!==undefined&&typeof input.record_contact!=='boolean')throw new HttpError(400,'invalid_followup','Preferência de contato inválida.');
  let lastContact=input.last_contact_at===undefined?lead.last_contact_at:time(input.last_contact_at);
  if(input.record_contact)lastContact=new Date().toISOString();
  if(lastContact&&Date.parse(lastContact)>Date.now()+60000)throw new HttpError(400,'invalid_followup','Último contato não pode estar no futuro.');
  const action=input.next_action===undefined?lead.next_action:input.next_action===null||input.next_action===''?null:text(input.next_action,1,500);
  if(input.next_action!==undefined&&input.next_action!==null&&input.next_action!==''&&action===null)throw new HttpError(400,'invalid_followup','Use até 500 caracteres na próxima ação.');
  const actionAt=input.next_action_at===undefined?lead.next_action_at:time(input.next_action_at);
  if(Boolean(action)!==Boolean(actionAt))throw new HttpError(400,'invalid_followup','Informe a próxima ação e sua data de retorno, ou limpe ambos.');
  if(input.archived!==undefined&&typeof input.archived!=='boolean')throw new HttpError(400,'invalid_followup','Preferência de arquivo inválida.');
  if(input.is_test!==undefined&&typeof input.is_test!=='boolean')throw new HttpError(400,'invalid_followup','Classificação inválida.');
  const isTest=input.is_test===undefined?Boolean(lead.is_test):input.is_test as boolean;
  const archived=input.archived===undefined?lead.archived_at:input.archived?(lead.archived_at||new Date().toISOString()):null;
  const followupChanged=action!==lead.next_action||actionAt!==lead.next_action_at,contactChanged=lastContact!==lead.last_contact_at,archiveChanged=archived!==lead.archived_at;
  if(status===lead.status&&!note&&!followupChanged&&!contactChanged&&!archiveChanged&&isTest===Boolean(lead.is_test)) throw new HttpError(400,'empty_change','Informe uma observação ou altere o acompanhamento.');
  const mutation=crypto.randomUUID();
  const revision=lead.followup_revision+Number(followupChanged||archiveChanged||(status!==lead.status&&['convertido','descartado'].includes(status)));
  const statements=[env.DB.prepare("UPDATE leads SET status=?,last_contact_at=?,next_action=?,next_action_at=?,archived_at=?,followup_revision=?,is_test=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1,last_mutation_id=? WHERE id=? AND version=?").bind(status,lastContact,action,actionAt,archived,revision,Number(isTest),mutation,id,lead.version)];
  if(isTest!==Boolean(lead.is_test))statements.push(env.DB.prepare("INSERT INTO lead_events(id,lead_id,event_type,note,admin_id) SELECT ?,id,'note',?,? FROM leads WHERE id=? AND last_mutation_id=?").bind(crypto.randomUUID(),isTest?'Classificado como TESTE; excluído dos indicadores comerciais.':'Classificado como contato comercial.',admin.id,id,mutation));
  if(status!==lead.status) statements.push(env.DB.prepare("INSERT INTO lead_events(id,lead_id,event_type,previous_status,new_status,admin_id) SELECT ?,id,'status_changed',?,?,? FROM leads WHERE id=? AND last_mutation_id=?").bind(crypto.randomUUID(),lead.status,status,admin.id,id,mutation));
  if(note) statements.push(env.DB.prepare("INSERT INTO lead_events(id,lead_id,event_type,note,admin_id) SELECT ?,id,'note',?,? FROM leads WHERE id=? AND last_mutation_id=?").bind(crypto.randomUUID(),note,admin.id,id,mutation));
  for(const event of [followupChanged?{type:'followup_updated',detail:{previousAction:lead.next_action,previousDate:lead.next_action_at,action,date:actionAt}}:null,contactChanged?{type:'contact_recorded',detail:{previousDate:lead.last_contact_at,date:lastContact}}:null,archiveChanged?{type:archived?'archived':'restored',detail:{}}:null].filter(Boolean)){
    statements.push(env.DB.prepare('INSERT INTO automation_events(id,lead_id,event_type,detail_json,admin_id) SELECT ?,id,?,?,? FROM leads WHERE id=? AND last_mutation_id=?').bind(crypto.randomUUID(),event!.type,JSON.stringify(event!.detail),admin.id,id,mutation));
  }
  if(revision!==lead.followup_revision)statements.push(env.DB.prepare("UPDATE automation_outbox SET status='cancelled',last_error_code='opportunity_changed' WHERE lead_id=? AND kind='followup' AND status='pending' AND EXISTS(SELECT 1 FROM leads WHERE id=? AND last_mutation_id=?)").bind(id,id,mutation));
  const result=await env.DB.batch(statements);
  if(result[0].meta.changes!==1) throw new HttpError(409,'version_conflict','A oportunidade foi alterada. Recarregue os detalhes.');
  return json({ok:true,data:{updated:true,version:lead.version+1},requestId});
}
