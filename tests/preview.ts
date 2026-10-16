// Isolated browser QA: same application, local SQLite, real locally signed JWTs.
// Bot verification is a fixture, never a production bypass. Loopback only.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from '../src/worker/index.ts';
import { authorize } from '../src/worker/security.ts';
import { accessToken, database, localKeys, payload } from './support.ts';
import type { Env } from '../src/worker/types.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(resolve(root,'work'),{recursive:true});
const port=Number(process.env.CRM_PREVIEW_PORT||8790);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const base=`http://127.0.0.1:${port}`;
const db=database(resolve(root,`work/crm-qa-${port}.sqlite`));
let mode='normal';
const mime: Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.xml':'application/xml','.txt':'text/plain'};
async function assets(request:Request) {
  let path=decodeURIComponent(new URL(request.url).pathname);
  if(path==='/')path='/index.html';if(path.endsWith('/'))path+='index.html';if(!extname(path))path+='.html';
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root.endsWith(sep)?root:root+sep)||!/^\/(?:assets\/[^/]+\.(?:css|js|svg)|blog\/[^/]+\.(?:html|css)|admin\/leads\.html|(?:index|processos|totvs-rm|privacidade)\.html|sitemap\.xml|robots\.txt)$/.test(path)||!existsSync(file))return new Response('Não encontrado',{status:404});
  let content=await readFile(file,'utf8');
  if(path==='/assets/totvs-rm.js')content=content.replace('https://challenges.cloudflare.com/turnstile/v0/api.js?onload=orkestriaTurnstileReady&render=explicit','/__fixtures/turnstile.js');
  if(path==='/totvs-rm.html')content=content.replace('<head>','<head><script src="/__fixtures/recorder.js"></script>');
  if(path==='/assets/site-base.css')content+='\n.qa-banner{position:fixed;bottom:0;left:0;right:0;z-index:200;background:#C9AC7D;color:#0A0E14;text-align:center;padding:7px;font:12px sans-serif;}';
  if(path.endsWith('.html'))content=content.replace('<body>','<body><div class="qa-banner">PRÉVIA DE TESTE LOCAL · dados fictícios · sem acesso ao banco de produção</div>');
  return new Response(content,{headers:{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}});
}
const env={DB:db,ASSETS:{fetch:assets},TURNSTILE_SITE_KEY:'local-public-fixture',TURNSTILE_SECRET_KEY:'local-secret-fixture',TURNSTILE_HOSTNAMES:'127.0.0.1',RATE_LIMIT_SECRET:'local-rate-fixture',PRIVACY_NOTICE_VERSION:'2026-10-15',RETENTION_DAYS:'180',ACCESS_TEAM_DOMAIN:'https://unit-test.cloudflareaccess.com',ACCESS_AUD:'test-audience',ADMIN_EMAILS:'admin@example.com'} as unknown as Env;
const app=createWorker({authorize:(request,env)=>authorize(request,env,localKeys),verifyTurnstile:async()=>{}});
if(db.sqlite.prepare('SELECT count(*) n FROM leads').get()!.n===0){
  for(const company of ['Instituição Demonstração','Indústria Exemplo','Serviços Modelo']) {
    await app.fetch(new Request(base+'/api/leads/totvs-rm',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),'CF-Connecting-IP':company},body:JSON.stringify({...payload(),company})}),env);
  }
}
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url!,base);
    if(url.pathname==='/__fixtures/mode'){mode=url.searchParams.get('value')||'normal';res.end('ok');return;}
    if(url.pathname==='/__fixtures/recorder.js'){res.setHeader('Content-Type','text/javascript');res.end(`(()=>{const events=[];let output;function render(){if(output)output.textContent=JSON.stringify(events);}addEventListener('orkestria:analytics',e=>{events.push(e.detail);render();});addEventListener('DOMContentLoaded',()=>{output=document.createElement('output');output.id='fixture-events';output.hidden=true;document.body.append(output);render();});})();`);return;}
    if(url.pathname==='/__fixtures/turnstile.js'){res.setHeader('Content-Type','text/javascript');res.end(`window.turnstile={render(selector,options){document.querySelector(selector).textContent='Verificação simulada somente para teste local.';setTimeout(()=>options.callback('local-token-'+crypto.randomUUID()),0);window.fixtureOptions=options;return 'fixture';},reset(){setTimeout(()=>window.fixtureOptions.callback('local-token-'+crypto.randomUUID()),0);}};window.orkestriaTurnstileReady();`);return;}
    if(url.pathname==='/api/leads/totvs-rm'&&mode==='network'){req.socket.destroy();return;}
    if(url.pathname==='/api/leads/totvs-rm'&&mode==='delay')await new Promise(resolve=>setTimeout(resolve,1500));
    const chunks=[];for await(const part of req)chunks.push(part);const data=Buffer.concat(chunks);
    const headers=new Headers(req.headers as Record<string,string>);
    if(mode!=='anonymous')headers.set('Cf-Access-Jwt-Assertion',await accessToken({email:mode==='unauthorized'?'outro@example.com':'admin@example.com'}));
    headers.set('CF-Connecting-IP','192.0.2.99');
    const request=new Request(url,{method:req.method,headers,...(data.length?{body:data}:{})});
    const selected=mode==='database'&&url.pathname==='/api/leads/totvs-rm'?{...env,DB:{prepare(){throw new Error('local failure');}} as unknown as D1Database}:env;
    const response=await app.fetch(request,selected);
    if(url.pathname==='/api/leads/totvs-rm'&&mode==='lost-response'){req.socket.destroy();return;}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Erro no ambiente de teste');}
}).listen(port,'127.0.0.1',()=>console.log('Local QA only: '+base+'/admin/leads'));
