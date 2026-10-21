import type { Env } from './types.ts';
import { body,HttpError,json,method,sameOrigin,uuid } from './http.ts';
export const MEASUREMENT_VERSION='2026-10-21-funnel-v1';
export const EVENTS=['landing_view','primary_cta_click','service_cta_click','service_category_change','form_start','form_validation_error','form_submit_failed','lead_confirmed','whatsapp_click'] as const;
const services=['customization','formula','integration','finance','purchasing','reports','web','other'];
const errors=['validation','network','rejected','unavailable','challenge'];
async function key(env:Env){return crypto.subtle.importKey('raw',new TextEncoder().encode(env.RATE_LIMIT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function bytes(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
export async function measurementAPI(request:Request,env:Env,requestId:string):Promise<Response>{
  method(request,['POST']);sameOrigin(request);
  if(env.MEASUREMENT_ENABLED!=='true'||!env.RATE_LIMIT_SECRET||!env.MEASUREMENT_LIMITER)throw new HttpError(503,'measurement_disabled','Medição indisponível.');
  const gate=await env.MEASUREMENT_LIMITER.limit({key:'measurement'});
  if(!gate.success)throw new HttpError(429,'measurement_limited','Limite de medição.');
  const input=await body(request,4096);
  const invalid=()=>{throw new HttpError(400,'invalid_measurement','Evento de medição inválido.');};
  const path=new URL(request.url).pathname;
  if(path==='/api/measurement/session'){
    if(Object.keys(input).some(k=>!['consent','version'].includes(k))||input.consent!==true||input.version!==MEASUREMENT_VERSION)invalid();
    const page=crypto.randomUUID(),expires=Math.floor(Date.now()/1000)+1800;
    const data=btoa(JSON.stringify({page,expires,origin:new URL(request.url).origin}));
    const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',await key(env),new TextEncoder().encode(data)))));
    return json({ok:true,data:{page,token:data+'.'+signature,expires},requestId});
  }
  if(Object.keys(input).some(k=>!['token','events'].includes(k))||typeof input.token!=='string'||input.token.length>1000)invalid();
  let session:{page:string;expires:number;origin:string};
  try{
    const [data,signature,...extra]=(input.token as string).split('.');
    if(extra.length||!await crypto.subtle.verify('HMAC',await key(env),bytes(signature),new TextEncoder().encode(data)))return invalid();
    session=JSON.parse(atob(data));
    if(!uuid(session.page)||!Number.isInteger(session.expires)||session.expires<Math.floor(Date.now()/1000)||session.expires>Math.floor(Date.now()/1000)+1800||session.origin!==new URL(request.url).origin)return invalid();
  }catch{return invalid();}
  if(!Array.isArray(input.events)||input.events.length<1||input.events.length>10)invalid();
  const events=input.events as Record<string,unknown>[];
  for(const event of events){
    if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).some(k=>!['id','event','service','code'].includes(k))||!uuid(event.id)||!EVENTS.includes(event.event as typeof EVENTS[number])||(event.service!==undefined&&!services.includes(event.service as string))||(event.code!==undefined&&!errors.includes(event.code as string)))invalid();
    // Confirmations are authoritative D1 lead counts, not trusted browser events.
    if(event.event==='lead_confirmed')invalid();
  }
  const stamp=new Date().toISOString(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date()),marker=crypto.randomUUID();
  const result=await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO measurement_days(day) VALUES(?)').bind(day),
    env.DB.prepare('UPDATE measurement_days SET accepted=accepted+?,last_batch=? WHERE day=? AND accepted+?<=2000 AND (SELECT count(*) FROM measurement_events WHERE page_id=?) + ?<=30').bind(events.length,marker,day,events.length,session!.page,events.length),
    ...events.map(e=>env.DB.prepare('INSERT OR IGNORE INTO measurement_events(id,page_id,event,service,code,day,created_at,consent_version) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM measurement_days WHERE day=? AND last_batch=?)').bind(e.id as string,session!.page,e.event as string,e.service as string||null,e.code as string||null,day,stamp,MEASUREMENT_VERSION,day,marker)),
  ]);
  if(result[1].meta.changes!==1)throw new HttpError(429,'measurement_limited','Limite de medição.');
  return json({ok:true,data:{accepted:result.slice(2).reduce((n,r)=>n+r.meta.changes,0)},requestId},202);
}
