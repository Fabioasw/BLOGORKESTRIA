import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {setup,payload,request} from './support.ts';
import {ADS_CONSENT_VERSION,adsConfig} from '../src/worker/ads.ts';

const source=readFileSync(new URL('../assets/google-ads.js',import.meta.url),'utf8');
const config={enabled:true,testMode:false,tagId:'AW-18517368821',conversionLabel:null,consentVersion:ADS_CONSENT_VERSION};
const leadId=crypto.randomUUID(),conversionId=crypto.randomUUID();
const confirmed={ok:true,data:{id:leadId,conversionId}};
const ok={ok:true,status:201};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const officialLabel='ceC1CO-Vk58dEPW_4v1E';
const officialTarget='AW-18517368821/'+officialLabel;
function releaseAdsConfig() {
  const vars=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8').split('[vars]')[1].split('[triggers]')[0];
  const read=(key:string)=>vars.match(new RegExp('^'+key+' = "([^"]*)"','m'))?.[1];
  return adsConfig({AUTOMATION_MODE:read('AUTOMATION_MODE'),GOOGLE_ADS_ENABLED:read('GOOGLE_ADS_ENABLED'),GOOGLE_ADS_CONVERSION_LABEL:read('GOOGLE_ADS_CONVERSION_LABEL')} as any);
}
function browser(shared=new Map<string,string>(),opts:{blocked?:boolean;delayed?:boolean;failed?:boolean;existingTag?:boolean}={}) {
  const scripts:any[]=[],events:any[]=[],listeners=new Map<string,Function[]>();let reloads=0,address='';
  const storage={getItem(key:string){if(opts.blocked)throw Error('blocked');return shared.get(key)||null;},setItem(key:string,v:string){if(opts.blocked)throw Error('blocked');shared.set(key,v);},removeItem(key:string){shared.delete(key);}};
  const sandbox:any={localStorage:storage,sessionStorage:storage,URL,Date,Set,Promise,Number,JSON,
    navigator:{locks:{request:async(_key:string,fn:Function)=>fn()}},
    CustomEvent:class{type;detail;constructor(type:string,options:any={}){this.type=type;this.detail=options.detail;}},
    location:{href:'https://preview.example/totvs-rm?email=private%40example.com&utm_term=private-name&gclid=OpaqueClickIdentifier123456#avaliacao',hostname:'preview.example',reload(){reloads++;}},
    history:{state:null,replaceState(_s:unknown,_t:string,url:string){address=url;}},
    document:{cookie:'_gcl_aw=fixture; necessary=keep',querySelector(){return opts.existingTag?{}:null;},createElement(){return {remove(){}};},head:{append(script:any){scripts.push(script);if(!opts.delayed)queueMicrotask(()=>opts.failed?script.onerror():script.onload());}}},
    addEventListener(name:string,fn:Function){listeners.set(name,[...(listeners.get(name)||[]),fn]);},
    dispatchEvent(event:any){events.push(event.detail);for(const fn of listeners.get(event.type)||[])fn(event);},
  };
  sandbox.window=sandbox;runInNewContext(source,sandbox);
  return {s:sandbox,ads:sandbox.OrkestriaAds,scripts,events,shared,reloads:()=>reloads,address:()=>address,reexecute:()=>runInNewContext(source,sandbox)};
}

test('Ads: default, legacy consent, rejection and missing configuration make no Google requests',async()=>{
  const b=browser(new Map([['orkestria-measurement','granted']]));
  b.ads.configure(config);await tick();assert.equal(b.ads.granted(),false);assert.equal(b.scripts.length,0);
  b.ads.setConsent(false);assert.equal(await b.ads.acceptLead(ok,confirmed),false);assert.equal(b.scripts.length,0);
  const disabled=browser();disabled.ads.configure({...config,enabled:false});disabled.ads.setConsent(true);await tick();assert.equal(disabled.scripts.length,0);
});

test('Ads: one tag after explicit consent; safe URL, denied defaults and no form data',async()=>{
  const b=browser();b.ads.configure(config);b.ads.setConsent(true);b.ads.setConsent(true);b.reexecute();await tick();
  assert.equal(b.scripts.length,1);assert.equal(b.scripts[0].referrerPolicy,'no-referrer');
  assert.equal(b.scripts[0].src,'https://www.googletagmanager.com/gtag/js?id=AW-18517368821');
  const commands=JSON.parse(JSON.stringify(b.s.dataLayer.map((a:any)=>Array.from(a))));
  assert.equal(commands[0][0],'consent');assert.equal(commands[0][2].ad_storage,'denied');
  const update=commands.find((a:any)=>a[0]==='consent'&&a[1]==='update');assert.equal(update[2].ad_personalization,'denied');
  assert.equal(b.address(),'/totvs-rm?gclid=OpaqueClickIdentifier123456');
  assert.ok(!JSON.stringify(commands).includes('private'));assert.ok(!JSON.stringify(commands).includes(leadId));
  assert.equal(await b.ads.acceptLead(ok,confirmed),false); // Official label still absent.
  assert.equal(commands.filter((a:any)=>a[1]==='conversion').length,0);
});

test('Ads: preview transport never loads Google even with a mock conversion label',async()=>{
  const b=browser();b.ads.configure({...config,testMode:true,conversionLabel:'MOCK_ONLY'});b.ads.setConsent(true);
  assert.equal(await b.ads.acceptLead(ok,confirmed),true);assert.equal(b.scripts.length,0);assert.equal(b.s.dataLayer,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(b.events)),[{event:'tag_simulated'},{event:'conversion_simulated'}]);
  assert.ok(!JSON.stringify(b.events).includes(conversionId));
});

test('Ads: conversion requires successful API response and stable UUID; reload and concurrent retry deduplicate',async()=>{
  const shared=new Map<string,string>(),b=browser(shared);
  b.ads.configure({...config,conversionLabel:'MOCK_ONLY'});b.ads.setConsent(true);await tick();
  for(const status of [400,409,429,500,503])assert.equal(await b.ads.acceptLead({ok:false,status},confirmed),false);
  for(const result of [{ok:false}, {ok:true,data:{id:leadId}}, {ok:true,data:{id:leadId,conversionId:'email@example.com'}}])assert.equal(await b.ads.acceptLead(ok,result),false);
  assert.deepEqual(await Promise.all([b.ads.acceptLead(ok,confirmed),b.ads.acceptLead(ok,confirmed)]),[true,false]);
  const conversion=b.s.dataLayer.map((a:any)=>Array.from(a)).filter((a:any)=>a[1]==='conversion');
  assert.equal(conversion.length,1);assert.equal(conversion[0][2].transaction_id,conversionId);
  assert.deepEqual(Object.keys(conversion[0][2]).sort(),['page_location','page_referrer','send_to','transaction_id']);
  const reloaded=browser(shared);reloaded.ads.configure({...config,conversionLabel:'MOCK_ONLY'});await tick();
  assert.equal(await reloaded.ads.acceptLead({ok:true,status:200},confirmed),false);
  assert.equal(reloaded.s.dataLayer.map((a:any)=>Array.from(a)).filter((a:any)=>a[1]==='conversion').length,0);
  assert.equal(await reloaded.ads.acceptLead(ok,{ok:true,data:{id:crypto.randomUUID(),conversionId:crypto.randomUUID()}}),true);
});

test('Ads: revocation during loading, across tabs and expired consent block conversions',async()=>{
  const b=browser(undefined,{delayed:true});b.ads.configure({...config,conversionLabel:'MOCK_ONLY'});b.ads.setConsent(true);
  const pending=b.ads.acceptLead(ok,confirmed);b.ads.setConsent(false);b.scripts[0].onload();assert.equal(await pending,false);assert.equal(b.reloads(),1);
  const expired=browser(new Map([['orkestria-advertising-v1',JSON.stringify({version:ADS_CONSENT_VERSION,granted:true,at:Date.now()-181*86400000})]]));
  expired.ads.configure(config);await tick();assert.equal(expired.scripts.length,0);
  const other=browser();other.ads.configure({...config,conversionLabel:'MOCK_ONLY'});other.ads.setConsent(true);await tick();
  other.s.dispatchEvent({type:'storage',key:'orkestria-advertising-v1',newValue:null});assert.equal(other.ads.granted(),false);assert.equal(other.reloads(),1);
});

test('Ads: blocked storage, tag failures and pre-existing Google tags fail closed',async()=>{
  for(const options of [{blocked:true},{failed:true},{existingTag:true}]){
    const b=browser(undefined,options);b.ads.configure({...config,conversionLabel:'MOCK_ONLY'});b.ads.setConsent(true);await tick();
    assert.equal(await b.ads.acceptLead(ok,confirmed),false);
  }
});

test('Ads: incremental migration preserves old rows/history; legacy submissions remain compatible',async()=>{
  const db=new DatabaseSync(':memory:');
  for(const file of ['0001_commercial_leads.sql','0002_challenge_replay.sql','0003_commercial_automation.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  db.exec("INSERT INTO leads(id,idempotency_key,payload_hash,name,email,company,job_title,service_type,description,privacy_notice_version) VALUES('old','old','hash','Old','old@example.com','Company','IT','Other','Existing commercial description before migration','old')");
  const before=db.prepare('SELECT * FROM leads').get()!,history=db.prepare('SELECT * FROM lead_events').all();
  db.exec(readFileSync(new URL('../migrations/0004_google_ads_consent.sql',import.meta.url),'utf8'));
  const after=db.prepare('SELECT * FROM leads').get()!;for(const key of Object.keys(before))assert.equal(after[key],before[key]);
  assert.equal(after.ads_conversion_id,null);assert.equal(after.advertising_consent,0);assert.deepEqual(db.prepare('SELECT * FROM lead_events').all(),history);db.close();
  const s=setup();try{
    const r=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key:crypto.randomUUID(),data:payload()}),s.env);
    assert.equal(r.status,201);assert.equal((await r.json() as any).data.conversionId,null);
  }finally{s.db.sqlite.close();}
});

test('Ads: D1 commit returns separate stable conversion ID; failed commit returns none; consent is validated',async()=>{
  const s=setup(),key=crypto.randomUUID(),data={...payload(),advertising_consent:true,advertising_consent_version:ADS_CONSENT_VERSION};
  try{
    s.db.failBatch=true;let r=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key,data}),s.env);
    assert.equal(r.status,500);assert.equal((await r.json() as any).data,undefined);assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,0);
    s.db.failBatch=false;r=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key,data}),s.env);assert.equal(r.status,201);const first=await r.json() as any;
    assert.notEqual(first.data.conversionId,first.data.id);assert.match(first.data.conversionId,/^[0-9a-f-]{36}$/);
    const replay=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key,data}),s.env);assert.equal(replay.status,200);assert.equal((await replay.json() as any).data.conversionId,first.data.conversionId);
    const row=s.db.sqlite.prepare('SELECT * FROM leads').get()!;assert.equal(row.advertising_consent,1);assert.equal(row.advertising_consent_version,ADS_CONSENT_VERSION);
    for(const patch of [{advertising_consent:'true'},{advertising_consent_version:'old'},{measurement_consent:false}])assert.equal((await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key:crypto.randomUUID(),data:{...data,...patch}}),s.env)).status,400);
    assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,1);
  }finally{s.db.sqlite.close();}
});

test('Ads: production defaults disabled; preview uses simulation; no invented conversion label',()=>{
  const s=setup();try{
    assert.equal(adsConfig({...s.env,AUTOMATION_MODE:'production'}).enabled,false);
    assert.equal(adsConfig({...s.env,AUTOMATION_MODE:'preview',GOOGLE_ADS_ENABLED:'true'}).testMode,true);
    assert.equal(adsConfig(s.env).conversionLabel,null);
    assert.equal(adsConfig({...s.env,GOOGLE_ADS_CONVERSION_LABEL:'invalid/email'}).conversionLabel,null);
    const html=readFileSync(new URL('../totvs-rm.html',import.meta.url),'utf8');assert.equal(html.split('src="/assets/google-ads.js"').length-1,1);
    assert.ok(!readFileSync(new URL('../admin/leads.html',import.meta.url),'utf8').includes('google-ads.js'));
    const csp=readFileSync(new URL('../_headers',import.meta.url),'utf8');
    assert.match(csp,/^\/totvs-rm\*/);assert.match(csp,/https:\/\/www.googletagmanager.com/);
    assert.ok(!csp.includes('unsafe-inline'));assert.ok(!csp.includes('unsafe-eval'));
    const previews=readFileSync(new URL('../wrangler.preview.toml',import.meta.url),'utf8');
    assert.ok(previews.includes('fde6d7c1-919e-4d04-8f26-946f5b9f03d0'));assert.ok(!previews.includes('ed13b097-dc98-4800-97dd-04a75c4107b4'));
    const nativePreview=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8').split('[previews.vars]')[1];
    assert.ok(nativePreview.includes('fde6d7c1-919e-4d04-8f26-946f5b9f03d0'));assert.ok(!nativePreview.includes('ed13b097-dc98-4800-97dd-04a75c4107b4'));
  }finally{s.db.sqlite.close();}
});

test('Ads: actual form handler → simulated Turnstile → Worker → isolated DB → conversion gate',async()=>{
  const formSource=readFileSync(new URL('../assets/totvs-rm.js',import.meta.url),'utf8');
  for(const mode of ['success','database','network','no-label','declined']){
    const s=setup(),b=browser();const handlers=new Map<string,Function>();const fields:any={};
    for(const name of ['nome','email','empresa','cargo','necessidade','descricao','website','marketing_consent'])fields[name]={checked:false,value:''};
    const form:any={elements:fields,addEventListener(name:string,fn:Function){handlers.set('form:'+name,fn);},reportValidity(){return true;},querySelectorAll(){return [];},querySelector(){return null;},setAttribute(){},removeAttribute(){}};
    const elements:any={'rm-form':form};
    for(const id of ['lead-submit','form-status','consent-description','consent-accept','consent-reject'])elements[id]={dataset:{},textContent:'',addEventListener(name:string,fn:Function){handlers.set(id+':'+name,fn);},focus(){}};
    b.s.document.getElementById=(id:string)=>elements[id];b.s.document.querySelectorAll=()=>[];
    const append=b.s.document.head.append;
    b.s.document.head.append=(script:any)=>{
      if(script.src.startsWith('https://challenges.cloudflare.com/')){
        b.s.turnstile={render(_selector:string,options:any){options.callback('local-fixture-'+crypto.randomUUID());return 1;},reset(){}};
        b.s.orkestriaTurnstileReady();
      }else append(script);
    };
    b.s.FormData=class{*[Symbol.iterator](){yield* Object.entries({nome:'Pessoa Teste',email:'private@example.com',empresa:'Empresa Privada',cargo:'TI',necessidade:'Integração de sistemas',descricao:'Descrição privada de solicitação comercial válida.',website:''});}};
    b.s.crypto=crypto;b.s.AbortSignal=AbortSignal;b.s.URLSearchParams=URLSearchParams;b.s.matchMedia=()=>({matches:false});
    b.s.location.search='?utm_source=google';
    let apiCalls=0;
    b.s.fetch=async(path:string,options:any)=>{
      if(path==='/api/leads/config')return Response.json({ok:true,data:{available:true,siteKey:'local-fixture',privacyNoticeVersion:'2026-10-15',ads:{...releaseAdsConfig(),testMode:true,conversionLabel:mode==='no-label'?null:officialLabel}}});
      apiCalls++;if(mode==='network')throw Error('network failure');s.db.failBatch=mode==='database';
      return s.app.fetch(request(path,{method:'POST',key:options.headers['Idempotency-Key'],data:JSON.parse(options.body)}),s.env);
    };
    try{
      runInNewContext(formSource,b.s);await tick();
      if(mode!=='declined')handlers.get('consent-accept:click')!();
      await handlers.get('form:submit')!({preventDefault(){}});await tick();
      const expected=mode==='success';assert.equal(b.events.filter((e:any)=>e?.event==='conversion_simulated').length,Number(expected),mode);
      assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n,Number(!['network','database'].includes(mode)),mode);
      if(!['network','database'].includes(mode)){
        assert.match(elements['form-status'].textContent,/Recebemos/);await handlers.get('form:submit')!({preventDefault(){}});assert.equal(apiCalls,1);
      }
      assert.equal(b.scripts.length,0);assert.ok(!JSON.stringify(b.events).includes('private@example.com'));
    }finally{s.db.sqlite.close();}
  }
});

test('Ads: official release configuration generates exact send_to once, including after reload; SDK is stubbed',async()=>{
  const release=releaseAdsConfig();assert.equal(release.enabled,true);assert.equal(release.testMode,false);
  assert.equal(release.tagId,'AW-18517368821');assert.equal(release.conversionLabel,officialLabel);
  const shared=new Map<string,string>(),b=browser(shared);b.ads.configure(release);
  assert.equal(await b.ads.acceptLead(ok,confirmed),false);assert.equal(b.scripts.length,0);
  b.ads.setConsent(true);await tick();
  assert.deepEqual(await Promise.all([b.ads.acceptLead(ok,confirmed),b.ads.acceptLead(ok,confirmed)]),[true,false]);
  const conversions=b.s.dataLayer.map((a:any)=>Array.from(a)).filter((a:any)=>a[1]==='conversion');
  assert.equal(conversions.length,1);assert.equal(conversions[0][2].send_to,officialTarget);
  assert.equal(conversions[0][2].transaction_id,conversionId);
  assert.ok(!JSON.stringify(conversions).includes(leadId));
  assert.deepEqual(Object.keys(conversions[0][2]).sort(),['page_location','page_referrer','send_to','transaction_id']);
  const refreshed=browser(shared);refreshed.ads.configure(release);await tick();
  assert.equal(await refreshed.ads.acceptLead({ok:true,status:200},confirmed),false);
  assert.equal(refreshed.s.dataLayer.map((a:any)=>Array.from(a)).filter((a:any)=>a[1]==='conversion').length,0);
  const preview=browser();preview.ads.configure({...release,testMode:true});preview.ads.setConsent(true);
  assert.equal(await preview.ads.acceptLead(ok,confirmed),true);assert.equal(preview.scripts.length,0);assert.equal(preview.s.dataLayer,undefined);
});

test('Ads: CSP allows documented script/collection/frame endpoints and Turnstile only on public page',()=>{
  const text=readFileSync(new URL('../_headers',import.meta.url),'utf8');
  const csp=text.match(/Content-Security-Policy: ([^\r\n]+)/)![1];
  const directives=new Map(csp.split(';').filter(s=>s.trim()).map(s=>{const [key,...values]=s.trim().split(/\s+/);return [key,values];}));
  const required={
    'script-src':['https://www.googletagmanager.com','https://www.googleadservices.com','https://www.google.com','https://challenges.cloudflare.com'],
    'connect-src':['https://www.googletagmanager.com','https://www.googleadservices.com','https://googleads.g.doubleclick.net','https://pagead2.googlesyndication.com','https://www.google.com','https://www.google.com.br','https://ad.doubleclick.net','https://challenges.cloudflare.com'],
    'img-src':['https://www.googletagmanager.com','https://www.googleadservices.com','https://googleads.g.doubleclick.net','https://pagead2.googlesyndication.com','https://www.google.com','https://www.google.com.br'],
    'frame-src':['https://www.googletagmanager.com','https://challenges.cloudflare.com'],
  };
  for(const [directive,origins] of Object.entries(required))for(const origin of origins)assert.ok(directives.get(directive)?.includes(origin),directive+': '+origin);
  assert.ok(!csp.includes('unsafe-inline'));assert.ok(!csp.includes('unsafe-eval'));assert.ok(!csp.includes('*'));
  assert.deepEqual(directives.get('form-action'),["'self'"]);assert.deepEqual(directives.get('frame-ancestors'),["'none'"]);
  const index=readFileSync(new URL('../src/worker/index.ts',import.meta.url),'utf8');
  const adminPolicy=index.match(/headers.set\('Content-Security-Policy',"([^"]+)"\)/)![1];
  assert.ok(!adminPolicy.includes('googletagmanager'));assert.ok(adminPolicy.includes("script-src 'self';"));
  const html=readFileSync(new URL('../totvs-rm.html',import.meta.url),'utf8');
  assert.equal(html.split('src="/assets/google-ads.js"').length-1,1);
  assert.ok(!html.includes('googletagmanager.com/gtag'));assert.ok(!html.includes(officialLabel));
});
