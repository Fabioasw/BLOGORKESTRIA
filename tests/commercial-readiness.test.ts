import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {setup,request,payload,accessToken} from './support.ts';
import {MEASUREMENT_VERSION} from '../src/worker/measurement.ts';
import {cleanMeasurement,operational} from '../src/worker/operations.ts';
import {DatabaseSync} from 'node:sqlite';
import {scheduleAutomation,processOutbox} from '../src/worker/automation.ts';

async function fixture(){const s=setup();s.env.MEASUREMENT_ENABLED='true';s.env.MEASUREMENT_LIMITER={limit:async()=>({success:true})};const auth=await accessToken();
 const call=(path:string,data?:unknown,admin=false,key?:string)=>s.app.fetch(request(path,{method:data===undefined?'GET':'POST',data,token:admin?auth:undefined,key}),s.env);
 const start=await call('/api/measurement/session',{consent:true,version:MEASUREMENT_VERSION});const session=(await start.json() as any).data;
 return {...s,call,session,auth};}
const evt=(event='landing_view')=>({id:crypto.randomUUID(),event});
test('migration 0005 preserves pre-existing leads, notes and outbox; no automatic historical test classification',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const name of ['0001_commercial_leads','0002_challenge_replay','0003_commercial_automation','0004_google_ads_consent'])db.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO leads(id,idempotency_key,payload_hash,name,email,company,job_title,service_type,description,privacy_notice_version) VALUES('old','old-key','hash','Historical','old@example.com','Existing Company','TI','Outros','Existing commercial description','old'); INSERT INTO lead_events(id,lead_id,event_type,note) VALUES('note','old','note','Existing note'); INSERT INTO automation_outbox(id,dedupe_key,lead_id,kind,recipient,payload_json,available_at) VALUES('job','old-job','old','new_lead_admin','owner@example.com','{}',0);");
 const before=db.prepare('SELECT * FROM leads').get()!;db.exec(readFileSync(new URL('../migrations/0005_commercial_readiness.sql',import.meta.url),'utf8'));const after=db.prepare('SELECT * FROM leads').get()!;
 for(const [k,v] of Object.entries(before))assert.equal(after[k],v);assert.equal(after.is_test,0);assert.equal(db.prepare('SELECT count(*) n FROM lead_events').get()!.n,2);assert.equal(db.prepare('SELECT count(*) n FROM automation_outbox').get()!.n,1);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
});
test('measurement: explicit versioned consent, origin and native gate; no database writes on denied request',async()=>{
 const s=await fixture();
 for(const data of [{consent:false,version:MEASUREMENT_VERSION},{consent:true,version:'old'},{consent:true,version:MEASUREMENT_VERSION,email:'secret@example.com'}])assert.equal((await s.call('/api/measurement/session',data)).status,400);
 assert.equal((await s.app.fetch(request('/api/measurement/session',{method:'POST',origin:'https://evil.example',data:{consent:true,version:MEASUREMENT_VERSION}}),s.env)).status,403);
 s.env.MEASUREMENT_LIMITER={limit:async()=>({success:false})};assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:[evt()]})).status,429);
 assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM measurement_events').get()!.n,0);s.db.sqlite.close();
});
test('measurement: deduplicates, aggregates and rejects personal fields, arbitrary strings, forged server confirmation and tokens',async()=>{
 const s=await fixture(),entry=evt();
 for(let i=0;i<2;i++)assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:[entry]})).status,202);
 assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM measurement_events').get()!.n,1);assert.equal(s.db.sqlite.prepare('SELECT total FROM measurement_totals').get()!.total,1);
 for(const extra of [{email:'private@example.com'},{code:'SQL with private content'},{service:'private name'},{event:'lead_confirmed'}])assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:[{...evt(),...extra}]})).status,400);
 assert.equal((await s.call('/api/measurement/events',{token:s.session.token+'bad',events:[evt()]})).status,400);
 assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:Array.from({length:11},()=>evt())})).status,400);
 assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:[evt()],phone:'private'})).status,400);s.db.sqlite.close();
});
test('measurement: thirty events per page, daily write ceiling, and missing binding fail closed',async()=>{
 const s=await fixture();for(let i=0;i<3;i++)assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:Array.from({length:10},()=>evt())})).status,202);
 assert.equal((await s.call('/api/measurement/events',{token:s.session.token,events:[evt()]})).status,429);
 s.db.sqlite.prepare('UPDATE measurement_days SET accepted=2000').run();const next=(await (await s.call('/api/measurement/session',{consent:true,version:MEASUREMENT_VERSION})).json() as any).data;
 assert.equal((await s.call('/api/measurement/events',{token:next.token,events:[evt()]})).status,429);
 s.env.MEASUREMENT_LIMITER=undefined;assert.equal((await s.call('/api/measurement/events',{token:next.token,events:[evt()]})).status,503);s.db.sqlite.close();
});
test('confirmation comes from committed D1 only; no consent means no behavioral event; retry creates no second event',async()=>{
 const s=await fixture(),key=crypto.randomUUID(),data={...payload(),funnel_consent:true,funnel_consent_version:MEASUREMENT_VERSION};
 assert.equal((await s.call('/api/leads/totvs-rm',data,false,key)).status,201);assert.equal((await s.call('/api/leads/totvs-rm',data,false,key)).status,200);
 assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM measurement_events WHERE event='lead_confirmed'").get()!.n,1);
 assert.equal((await s.call('/api/leads/totvs-rm',payload(),false,crypto.randomUUID())).status,201);
 assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM measurement_events').get()!.n,1);
 s.db.sqlite.exec('DROP TABLE measurement_events');assert.equal((await s.call('/api/leads/totvs-rm',{...data,token:crypto.randomUUID()},false,crypto.randomUUID())).status,201);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,3);s.db.sqlite.close();
});
test('manual WhatsApp: authorized only, real optional email, idempotency, history and concurrency; no outbox/Ads',async()=>{
 const s=await fixture(),key=crypto.randomUUID(),data={name:'Local TEST',company:'Local Only',phone:'+55 19 90000-0000',email:'',note:'Local-only conversation fixture',service_type:'Outros',next_action:'Local follow-up',next_action_at:'2026-11-01T13:00:00Z',is_test:true};
 assert.equal((await s.call('/api/admin/contacts',data,false,key)).status,401);
 const first=await s.call('/api/admin/contacts',data,true,key);assert.equal(first.status,201);const id=(await first.json() as any).data.id;
 assert.equal((await s.call('/api/admin/contacts',data,true,key)).status,200);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM manual_contacts').get()!.n,1);assert.equal(s.db.sqlite.prepare('SELECT email FROM manual_contacts').get()!.email,null);
 assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,0);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM automation_outbox').get()!.n,0);
 const patch=()=>s.app.fetch(request('/api/admin/contacts/'+id,{method:'PATCH',token:s.auth,data:{...data,status:'qualificado',version:0}}),s.env);
 assert.equal((await patch()).status,200);assert.equal((await patch()).status,409);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM manual_contact_events').get()!.n,2);
 const overview=await(await s.call('/api/admin/funnel',undefined,true)).json() as any;assert.equal(overview.data.current.qualificado,undefined);assert.equal(overview.data.events.landing_view,null);
 assert.equal((await s.call('/api/admin/contacts',{...data,phone:''},true,crypto.randomUUID())).status,400);s.db.sqlite.close();
});
test('lead test classification is audited, excludes commercial KPIs, preserves old history and raw stats',async()=>{
 const s=await fixture();const lead=await(await s.call('/api/leads/totvs-rm',payload(),false,crypto.randomUUID())).json() as any;
 const before=s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n;
 assert.equal((await s.app.fetch(request('/api/admin/leads/'+lead.data.id,{method:'PATCH',token:s.auth,data:{version:0,is_test:true,next_action:'Verify local only',next_action_at:'2026-11-01T13:00:00Z'}}),s.env)).status,200);
 assert.ok(Number(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n)>Number(before));
 const overview=await(await s.call('/api/admin/funnel',undefined,true)).json() as any;assert.equal(overview.data.confirmed,0);
 const stats=await(await s.call('/api/admin/stats',undefined,true)).json() as any;assert.equal(stats.data.total,1);s.db.sqlite.close();
});
test('retention only removes technical data; operational logs use fixed codes and no private message',async()=>{
 const s=await fixture();await s.call('/api/leads/totvs-rm',payload(),false,crypto.randomUUID());
 await operational(s.env,'notification_uncertain','notification');await operational(s.env,'SQL private@example.com','evil');
 s.db.sqlite.exec("INSERT INTO measurement_events VALUES('old','p','landing_view',NULL,NULL,'2000-01-01','2000-01-01','v'); INSERT INTO operational_events(id,operation,code,created_at) VALUES('old','request','worker_unexpected_error','2000-01-01');");
 await cleanMeasurement(s.env);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM lead_events').get()!.n,1);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM measurement_events').get()!.n,0);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM operational_events').get()!.n,1);assert.ok(!JSON.stringify(s.db.sqlite.prepare('SELECT * FROM operational_events').all()).includes('private@example.com'));s.db.sqlite.close();
});
test('manual follow-up joins daily summary, deduplicates and cancels when the opportunity changes',async()=>{
 const s=await fixture();s.env.AUTOMATION_MODE='preview';s.env.EMAIL_PROVIDER='cloudflare';s.env.EMAIL_FROM='crm@example.com';s.env.EMAIL_ADMIN_TO='admin@example.com';s.env.EMAIL_TEST_RECIPIENTS='admin@example.com';s.env.CRM_PUBLIC_ORIGIN='https://preview.example';s.env.EMAIL={send:async()=>({messageId:'fixture'})} as any;
 s.db.sqlite.exec('UPDATE automation_settings SET enabled=1,daily_summary=0');
 const data={name:'Manual local',company:'Local only',phone:'19900000000',service_type:'Outros',note:'Received local fixture',next_action:'Return contact',next_action_at:'2020-01-01T13:00:00Z',is_test:false};
 const r=await(await s.call('/api/admin/contacts',data,true,crypto.randomUUID())).json() as any;
 const now=Math.floor(Date.now()/1000);await scheduleAutomation(s.env,now);await scheduleAutomation(s.env,now);assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM automation_outbox WHERE kind='followup'").get()!.n,1);
 s.db.sqlite.prepare("UPDATE manual_contacts SET next_action_at='2030-01-01T13:00:00Z' WHERE id=?").run(r.data.id);let sends=0;await processOutbox(s.env,now,async()=>{sends++;return {messageId:'local'};});assert.equal(sends,0);assert.equal(s.db.sqlite.prepare('SELECT status FROM automation_outbox').get()!.status,'cancelled');s.db.sqlite.close();
});
test('browser: default consent makes no requests; category-only WhatsApp; grant, start after grant and revoke in flight',async()=>{
 const listeners=new Map<string,Function[]>(),elements=new Map<string,any>(),requests:any[]=[],store=new Map<string,string>();
 function el(id:string){if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(event:string,fn:Function){listeners.set(id+':'+event,[...(listeners.get(id+':'+event)||[]),fn]);}});return elements.get(id);}
 const category=el('category');category.value='Integração de sistemas';const form=el('rm-form');form.elements={necessidade:category,email:{value:'private@example.com'}};
 const wa=el('wa'),primary=el('primary'),service=el('service');service.dataset={service:'Integração de sistemas'};primary.dataset={};
 const sandbox:any={crypto,AbortSignal,Date,URLSearchParams,encodeURIComponent,localStorage:{getItem:(k:string)=>store.get(k),setItem:(k:string,v:string)=>store.set(k,v)},document:{getElementById:el,querySelectorAll:(s:string)=>s.includes('wa.me')?[wa]:[primary,service]},addEventListener(event:string,fn:Function){listeners.set('window:'+event,[fn]);},fetch:async(path:string,options:any)=>{requests.push({path,data:JSON.parse(options.body)});return {ok:true,status:202,json:async()=>({data:{token:'local-only',expires:Math.floor(Date.now()/1000)+1800}})};}};
 sandbox.window=sandbox;runInNewContext(readFileSync(new URL('../assets/measurement.js',import.meta.url),'utf8'),sandbox);
 const click=async(id:string,event='click')=>{for(const fn of listeners.get(id+':'+event)||[])fn({});await new Promise(r=>setImmediate(r));};
 await click('rm-form','input');assert.equal(requests.length,0);assert.match(decodeURIComponent(wa.href),/Integração de sistemas/);assert.ok(!wa.href.includes('private'));
 await click('measurement-accept');await click('rm-form','input');await click('primary');await click('service');await click('category','change');await click('wa');
 const names=requests.flatMap(r=>r.data.events||[]).map(e=>e.event);for(const name of ['landing_view','form_start','primary_cta_click','service_cta_click','service_category_change','whatsapp_click'])assert.ok(names.includes(name));assert.ok(!JSON.stringify(requests).includes('private@example.com'));
 await click('measurement-reject');const count=requests.length;await click('wa');assert.equal(requests.length,count);assert.equal(sandbox.OrkestriaMeasure.granted(),false);
});
