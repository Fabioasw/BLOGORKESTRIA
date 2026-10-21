import type { Env } from './types.ts';
const codes=new Set(['form_request_rejected','worker_unexpected_error','lead_storage_failed','notification_failed','notification_uncertain','measurement_failed','maintenance_failed']);
// Never pass Error.message, payloads, SQL, request URLs, email or tokens here.
export async function operational(env:Env,code:string,operation:string,requestId?:string,status?:number){
  if(!codes.has(code))return;
  const entry={event:code,operation:['capture','notification','measurement','maintenance','request'].includes(operation)?operation:'request',requestId,status};
  console.error(JSON.stringify(entry));
  try{await env.DB.prepare('INSERT INTO operational_events(id,operation,code,request_id,status) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM operational_events WHERE created_at>=?)<1000').bind(crypto.randomUUID(),entry.operation,code,requestId||null,status||null,new Date().toISOString().slice(0,10)).run();}catch{/* Logging must never invalidate a commercial operation. */}
}
export async function cleanMeasurement(env:Env){
  const date=(days:number)=>new Date(Date.now()-days*86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM measurement_events WHERE id IN (SELECT id FROM measurement_events WHERE day<? LIMIT 1000)').bind(date(30).slice(0,10)),
    env.DB.prepare('DELETE FROM measurement_totals WHERE day<?').bind(date(90).slice(0,10)),
    env.DB.prepare('DELETE FROM measurement_days WHERE day<?').bind(date(2).slice(0,10)),
    env.DB.prepare('DELETE FROM operational_events WHERE id IN (SELECT id FROM operational_events WHERE created_at<? LIMIT 1000)').bind(date(14)),
  ]);
}
