// Real Workerd + isolated local D1 for homologation. No Wrangler credentials,
// production config, external email provider, Google SDK or network requests.
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const pair=await generateKeyPair('RS256');
const jwks={keys:[{...await exportJWK(pair.publicKey),kid:'homologation',alg:'RS256'}]};
const bundle=await build({stdin:{resolveDir:root,contents:`
import {createWorker} from './src/worker/index.ts';
import {authorize} from './src/worker/security.ts';
import {createLocalJWKSet} from 'jose';
const keys=createLocalJWKSet(${JSON.stringify(jwks)});
export default createWorker({authorize:(r,e)=>authorize(r,e,keys),verifyTurnstile:async(token)=>{if(token!=='local-only')throw Error('invalid fixture');}});
`},bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'orkestria-ads-homologation-local',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-17',d1Databases:{DB:'orkestria-leads-preview-local-'+crypto.randomUUID()},bindings:{AUTOMATION_MODE:'preview',GOOGLE_ADS_ENABLED:'true',GOOGLE_ADS_CONVERSION_LABEL:'ceC1CO-Vk58dEPW_4v1E',TURNSTILE_SITE_KEY:'local',TURNSTILE_SECRET_KEY:'local',TURNSTILE_HOSTNAMES:'preview.example',RATE_LIMIT_SECRET:'local',PRIVACY_NOTICE_VERSION:'2026-10-15',ACCESS_TEAM_DOMAIN:'https://local.cloudflareaccess.com',ACCESS_AUD:'local-aud',ADMIN_EMAILS:'admin@example.com'},log:new Log(LogLevel.ERROR)}));
let checks=0;const equal=(actual,expected)=>{assert.equal(actual,expected);checks++;};
try{
  await mf.ready;const db=await mf.getD1Database('DB');
  const files=(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort();
  const python=resolve(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  for(const file of files){
    const parsed=spawnSync(python,['-c',"import sqlite3,json,sys; s=''; out=[]\nfor line in sys.stdin:\n s+=line\n if sqlite3.complete_statement(s): out.append(s); s=''\nassert not s.strip(); print(json.dumps(out))"],{input:await readFile('migrations/'+file,'utf8'),encoding:'utf8'});equal(parsed.status,0);
    for(const sql of JSON.parse(parsed.stdout))await db.prepare(sql).run();
  }
  const base='https://preview.example';
  const publicConfig=await(await mf.dispatchFetch(base+'/api/leads/config')).json();equal(publicConfig.data.ads.testMode,true);equal(publicConfig.data.ads.conversionLabel,'ceC1CO-Vk58dEPW_4v1E');equal(publicConfig.data.ads.tagId+'/'+publicConfig.data.ads.conversionLabel,'AW-18517368821/ceC1CO-Vk58dEPW_4v1E');
  const headers={Origin:base,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1','Idempotency-Key':crypto.randomUUID()};
  const data={name:'Local Fixture',email:'fixture@example.com',company:'Homologation Only',job_title:'TI',service_type:'Integração de sistemas',description:'Local D1 fixture for complete Google Ads integration checks.',marketing_consent:false,measurement_consent:true,advertising_consent:true,advertising_consent_version:'2026-10-16-ads-v1',privacy_notice_version:'2026-10-15',token:'local-only'};
  const submit=()=>mf.dispatchFetch(base+'/api/leads/totvs-rm',{method:'POST',headers,body:JSON.stringify(data)});
  const first=await submit();equal(first.status,201);const saved=await first.json();assert.notEqual(saved.data.id,saved.data.conversionId);checks++;
  const repeat=await submit();equal(repeat.status,200);equal((await repeat.json()).data.conversionId,saved.data.conversionId);
  equal((await db.prepare('SELECT count(*) n FROM leads').first()).n,1);equal((await db.prepare('SELECT count(*) n FROM lead_events').first()).n,1);
  equal((await db.prepare('SELECT advertising_consent FROM leads').first()).advertising_consent,1);
  equal((await mf.dispatchFetch(base+'/api/admin/stats')).status,401);
  const token=await new SignJWT({email:'admin@example.com'}).setProtectedHeader({alg:'RS256',kid:'homologation'}).setSubject('fixture-admin').setIssuer('https://local.cloudflareaccess.com').setAudience('local-aud').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const auth={'Cf-Access-Jwt-Assertion':token,Origin:base,'Content-Type':'application/json'};
  equal((await mf.dispatchFetch(base+'/api/admin/stats',{headers:auth})).status,200);
  equal((await mf.dispatchFetch(base+'/api/admin/leads/'+saved.data.id,{method:'PATCH',headers:auth,body:JSON.stringify({version:0,status:'qualificado',note:'Local-only regression'})})).status,200);
  equal((await db.prepare('SELECT count(*) n FROM lead_events').first()).n,3);
  equal((await mf.dispatchFetch('https://alternate.workers.dev/api/admin/leads')).status,401);
  equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
  const result={passed:true,checks,runtime:'Workerd + isolated LOCAL D1 homologation',migrations:files,remoteD1Used:false,productionModified:false,googleRequests:0,externalEmails:0};
  await mkdir('../outputs',{recursive:true});await writeFile('../outputs/google-ads-official-runtime-tests.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}
