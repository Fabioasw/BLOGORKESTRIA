import type { Env,AdminIdentity } from './types.ts';
import { body,HttpError,json,method,sameOrigin,sha256,text,uuid } from './http.ts';
import { SERVICES,STATUSES } from './leads.ts';
import { EVENTS } from './measurement.ts';

export async function commercialAPI(request:Request,env:Env,admin:AdminIdentity,requestId:string):Promise<Response|null>{
 const path=new URL(request.url).pathname;
 if(path==='/api/admin/funnel'){
  method(request,['GET']);
  const now=new Date(),localDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(now),month=localDay.slice(0,7)+'-01T03:00:00.000Z',today=now.toISOString().slice(0,10);
  const [settings,totals,leadCounts,contactCounts,transitions,manualTransitions,issues]=await env.DB.batch([
   env.DB.prepare('SELECT started_at FROM measurement_settings WHERE id=1'),
   env.DB.prepare('SELECT event,sum(total) total FROM measurement_totals WHERE day>=? GROUP BY event').bind(month.slice(0,10)),
   env.DB.prepare('SELECT status,count(*) total FROM leads WHERE is_test=0 GROUP BY status'),
   env.DB.prepare('SELECT status,count(*) total FROM manual_contacts WHERE is_test=0 GROUP BY status'),
   env.DB.prepare("SELECT e.new_status status,count(DISTINCT e.lead_id) total FROM lead_events e JOIN leads l ON l.id=e.lead_id WHERE l.is_test=0 AND e.event_type='status_changed' AND e.created_at>=? GROUP BY e.new_status").bind(month),
   env.DB.prepare('SELECT e.new_status status,count(DISTINCT e.contact_id) total FROM manual_contact_events e JOIN manual_contacts c ON c.id=e.contact_id WHERE c.is_test=0 AND e.previous_status IS NOT NULL AND e.created_at>=? GROUP BY e.new_status').bind(month),
   env.DB.prepare('SELECT code,count(*) total FROM operational_events WHERE created_at>=? GROUP BY code').bind(today),
  ]);
  const started=(settings.results[0] as {started_at:string}|undefined)?.started_at||null;
  const measured=Object.fromEntries(totals.results.map(r=>[(r as {event:string}).event,Number((r as {total:number}).total)]));
  const counts:Record<string,number>={},changed:Record<string,number>={};
  for(const row of [...leadCounts.results,...contactCounts.results]){const r=row as {status:string;total:number};counts[r.status]=(counts[r.status]||0)+r.total;}
  for(const row of [...transitions.results,...manualTransitions.results]){const r=row as {status:string;total:number};changed[r.status]=(changed[r.status]||0)+r.total;}
  const confirmed=await env.DB.prepare('SELECT count(*) total FROM leads WHERE is_test=0 AND source=\'totvs-rm\' AND created_at>=?').bind(month).first<{total:number}>();
  return json({ok:true,data:{startedAt:started,monthStart:month,events:Object.fromEntries(EVENTS.filter(e=>e!=='lead_confirmed').map(e=>[e,measured[e]??null])),confirmed:confirmed?.total??0,current:counts,transitions:changed,issues:issues.results,coverage:'Somente eventos consentidos; limite diário de coleta. Envios são cadastros no D1, não entrega de e-mail. Sem comparação direta com todos os visitantes.'},requestId});
 }
 if(path==='/api/admin/contacts'){
  method(request,['GET','POST']);
  if(request.method==='GET'){
   const contacts=await env.DB.prepare('SELECT id,name,company,email,phone,service_type,status,next_action,next_action_at,is_test,version,created_at,updated_at FROM manual_contacts ORDER BY created_at DESC LIMIT 100').all();
   return json({ok:true,data:{items:contacts.results},requestId});
  }
  sameOrigin(request);const data=await body(request,6000),key=request.headers.get('Idempotency-Key');
  if(!uuid(key))throw new HttpError(400,'invalid_idempotency','Identificador inválido.');
  const name=text(data.name,2,120),company=text(data.company,2,160),email=data.email?text(data.email,5,254):null,phone=data.phone?text(data.phone,8,30):null,note=text(data.note,1,2000),action=text(data.next_action,1,500);
  const service=typeof data.service_type==='string'&&SERVICES.includes(data.service_type)?data.service_type:null;
  if(!name||!company||!note||!action||!service||(!email&&!phone)||(email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))||(phone&&!/^[+()\d .-]+$/.test(phone))||typeof data.is_test!=='boolean'||typeof data.next_action_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(data.next_action_at)||!Number.isFinite(Date.parse(data.next_action_at)))throw new HttpError(400,'invalid_contact','Informe nome, empresa, um contato válido, necessidade, observação e próxima ação com data.');
  const at=new Date(data.next_action_at).toISOString(),stamp=new Date().toISOString(),hash=await sha256(JSON.stringify({name,company,email,phone,note,action,service,at,test:data.is_test}));
  const prior=await env.DB.prepare('SELECT id,payload_hash FROM manual_contacts WHERE idempotency_key=?').bind(key).first<{id:string;payload_hash:string}>();
  if(prior){if(prior.payload_hash!==hash)throw new HttpError(409,'idempotency_conflict','Recarregue para cadastrar outro contato.');return json({ok:true,data:{id:prior.id,duplicate:true},requestId});}
  const id=crypto.randomUUID();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO manual_contacts(id,idempotency_key,payload_hash,name,company,email,phone,service_type,note,next_action,next_action_at,is_test,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,key,hash,name,company,email,phone,service,note,action,at,Number(data.is_test),stamp,stamp),
   env.DB.prepare("INSERT INTO manual_contact_events(id,contact_id,new_status,note,admin_id,created_at) VALUES(?,?,'novo',?,?,?)").bind(crypto.randomUUID(),id,note,admin.id,stamp),
  ]);
  return json({ok:true,data:{id},requestId},201);
 }
 const match=path.match(/^\/api\/admin\/contacts\/([^/]+)$/);
 if(match){
  if(!uuid(match[1]))throw new HttpError(400,'invalid_id','Identificador inválido.');
  method(request,['GET','PATCH']);
  const contact=await env.DB.prepare('SELECT * FROM manual_contacts WHERE id=?').bind(match[1]).first<{id:string;version:number;status:string}>();
  if(!contact)throw new HttpError(404,'not_found','Contato não encontrado.');
  if(request.method==='GET'){const events=await env.DB.prepare('SELECT new_status,note,created_at FROM manual_contact_events WHERE contact_id=? ORDER BY created_at').bind(contact.id).all();return json({ok:true,data:{contact,events:events.results},requestId});}
  sameOrigin(request);const data=await body(request,4000),note=text(data.note,1,2000),action=text(data.next_action,1,500);
  if(data.version!==contact.version)throw new HttpError(409,'version_conflict','Contato alterado. Reabra os detalhes.');
  if(!note||!action||!STATUSES.includes(data.status as string)||typeof data.is_test!=='boolean'||typeof data.next_action_at!=='string'||!Number.isFinite(Date.parse(data.next_action_at)))throw new HttpError(400,'invalid_contact','Revise status, observação e próxima ação.');
  const stamp=new Date().toISOString(),at=new Date(data.next_action_at).toISOString();
  const result=await env.DB.batch([
   env.DB.prepare('UPDATE manual_contacts SET status=?,note=?,next_action=?,next_action_at=?,is_test=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(data.status as string,note,action,at,Number(data.is_test),stamp,contact.id,contact.version),
   env.DB.prepare('INSERT INTO manual_contact_events(id,contact_id,previous_status,new_status,note,admin_id,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),contact.id,contact.status,data.status as string,note,admin.id,stamp),
  ]);
  if(result[0].meta.changes!==1)throw new HttpError(409,'version_conflict','Contato alterado. Reabra os detalhes.');
  return json({ok:true,data:{updated:true},requestId});
 }
 return null;
}
