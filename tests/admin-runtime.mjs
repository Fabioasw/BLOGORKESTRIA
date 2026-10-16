// Actual asset router + Workerd. Ephemeral JWT keys and local D1 binding only.
import { Miniflare,convertV4MiniflareOptions,Log,LogLevel } from 'miniflare';
import { build } from 'esbuild';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { mkdir,cp,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const dir=resolve('work/h'+crypto.randomUUID().slice(0,8));await mkdir(resolve(dir,'admin'),{recursive:true});
await cp('index.html',resolve(dir,'index.html'));await cp('admin/leads.html',resolve(dir,'admin/leads.html'));
const pair=await generateKeyPair('RS256',{modulusLength:2048});
const jwks={keys:[{...await exportJWK(pair.publicKey),kid:'local-audit',alg:'RS256',use:'sig'}]};
const bundle=await build({stdin:{resolveDir:root,sourcefile:'admin-audit.js',contents:`import {createWorker} from './src/worker/index.ts';import {authorize} from './src/worker/security.ts';import {createLocalJWKSet} from 'jose';const keys=createLocalJWKSet(${JSON.stringify(jwks)});export default createWorker({authorize:(request,env)=>authorize(request,env,keys)});`},bundle:true,platform:'browser',format:'esm',write:false,logLevel:'silent'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'admin-local-audit',host:'127.0.0.1',port:0,modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-17',d1Databases:{DB:'audit-local-no-production'},bindings:{ACCESS_TEAM_DOMAIN:'https://audit-local.cloudflareaccess.com',ACCESS_AUD:'local-audit-only',ADMIN_EMAILS:'admin@example.com'},assets:{directory:dir,binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},log:new Log(LogLevel.ERROR)}));
const token=await new SignJWT({email:'admin@example.com'}).setProtectedHeader({alg:'RS256',kid:'local-audit'}).setIssuer('https://audit-local.cloudflareaccess.com').setAudience('local-audit-only').setSubject('audit-local-user').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
let checks=0;
try{
  await mf.ready;
  for(const host of ['https://orkestriaplatform.com','https://orkestriaplatform.fabioasw01.workers.dev','https://local-audit-orkestriaplatform.fabioasw01.workers.dev']){
    for(const path of ['/admin','/admin/','/admin/leads','/admin/leads.html','/%61dmin/leads','/admin%2fleads','/%2561dmin/leads','//admin/leads','/safe/%2e%2e%2fadmin/leads','/api/admin','/api/admin/stats','/%61pi/admin/stats','/api/admin/leads/search']){
      const r=await mf.dispatchFetch(host+path,{redirect:'manual'});assert.equal(r.status,401,host+path);checks++;
    }
    const session=await mf.dispatchFetch(host+'/api/admin/session',{headers:{'Cf-Access-Jwt-Assertion':token}});assert.equal(session.status,200);checks++;
    const panel=await mf.dispatchFetch(host+'/admin/leads',{headers:{'Cf-Access-Jwt-Assertion':token},redirect:'manual'});assert.equal(panel.status,200);assert.match(panel.headers.get('Cache-Control'),/no-store/);checks++;
    const home=await mf.dispatchFetch(host+'/');assert.equal(home.status,200);checks++;
  }
  const result={runtime:'Workerd + actual asset router',checks,passed:true,usesCloudCredentials:false,usesProductionD1:false,previewHostnames:'synthetic, local only'};
  await writeFile('../outputs/auditoria-backend-runtime.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await mf.dispose();}
