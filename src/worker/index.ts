import { adsConfig } from './ads.ts';
import type { Env } from './types.ts';
import { HttpError, json, method } from './http.ts';
import { authorize, captureReady, verifyTurnstile } from './security.ts';
import { capture } from './leads.ts';
import { adminAPI } from './admin.ts';
import { runAutomations } from './automation.ts';
import type { EmailSender } from './email.ts';
import { measurementAPI } from './measurement.ts';
import { cleanMeasurement,operational } from './operations.ts';

export function createWorker(deps: { authorize?: typeof authorize; verifyTurnstile?: typeof verifyTurnstile; sendEmail?:EmailSender } = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const requestId=crypto.randomUUID();
      try {
        // Guard encoded/slash aliases before ASSETS can canonicalize them.
        let path=new URL(request.url).pathname;
        try {
          for(let depth=0;depth<4;depth++){
            const decoded=decodeURIComponent(path).replace(/\\/g,'/').replace(/\/{2,}/g,'/');
            if(decoded===path)break;
            path=decoded;
            if(depth===3&&decodeURIComponent(path)!==path)throw new Error();
          }
          // Resolve dot segments after decoding without treating // as a host.
          path=new URL('https://route.invalid'+path).pathname;
        } catch {throw new HttpError(400,'invalid_path','Caminho inválido.');}
        if(path==='/api/leads/config') {
          method(request,['GET']);
          return json({ok:true,data:{available:captureReady(env),siteKey:captureReady(env)?env.TURNSTILE_SITE_KEY:null,privacyNoticeVersion:env.PRIVACY_NOTICE_VERSION,ads:adsConfig(env)},requestId});
        }
        if(path==='/api/leads/totvs-rm') return await capture(request,env,requestId,deps.verifyTurnstile||verifyTurnstile);
        if(['/api/measurement/session','/api/measurement/events'].includes(path))return await measurementAPI(request,env,requestId);
        const adminAPIPath=path==='/api/admin'||path.startsWith('/api/admin/');
        if(path==='/admin'||path.startsWith('/admin/')||adminAPIPath) {
          const admin=await (deps.authorize||authorize)(request,env);
          if(adminAPIPath) return await adminAPI(request,env,admin,requestId);
          if(!['/admin/leads','/admin/leads/','/admin/leads.html'].includes(path)) throw new HttpError(404,'not_found','Página não encontrada.');
          method(request,['GET','HEAD']);
          // ASSETS uses clean-URL canonicalization. Fetch its canonical path so
          // the .html -> clean URL redirect cannot loop through this handler.
          const target=new URL(request.url);target.pathname='/admin/leads';target.search='';
          const asset=await env.ASSETS.fetch(new Request(target,request));
          const headers=new Headers(asset.headers);
          headers.set('Cache-Control','no-store, private');headers.set('X-Robots-Tag','noindex, nofollow');
          headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
          headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
          return new Response(asset.body,{status:asset.status,headers});
        }
        if(path==='/api'||path.startsWith('/api/')) throw new HttpError(404,'not_found','Endpoint não encontrado.');
        return env.ASSETS.fetch(request);
      } catch(error) {
        if(error instanceof HttpError) {
          if(new URL(request.url).pathname==='/api/leads/totvs-rm'&&[400,409,503].includes(error.status))await operational(env,'form_request_rejected','capture',requestId,error.status);
          return json({ok:false,error:{code:error.code,message:error.message,...(error.fields?{fields:error.fields}:{})},requestId},error.status,{...error.headers,...(error.status===429?{'Retry-After':'600'}:{})});
        }
        // Never log paths, search strings, tokens, SQL errors, or lead content.
        await operational(env,'worker_unexpected_error','request',requestId,500);
        return json({ok:false,error:{code:'internal_error',message:'Não foi possível concluir a solicitação. Tente novamente.'},requestId},500);
      }
    },
    async scheduled(_event: ScheduledController,env: Env): Promise<void> {
      const days=Number(env.RETENTION_DAYS);
      if(!env.DB||!Number.isInteger(days)||days<1||days>3650) {console.error('retention_not_configured');return;}
      try {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM request_limits WHERE expires_at<?').bind(Math.floor(Date.now()/1000)),
          env.DB.prepare('DELETE FROM used_challenges WHERE expires_at<?').bind(Math.floor(Date.now()/1000)),
        ]);
        // Commercial history is preserved. Data erasure remains an explicit,
        // authenticated operation, separate from routine technical cleanup.
        await runAutomations(env,deps.sendEmail);
        await cleanMeasurement(env);
      } catch {await operational(env,'maintenance_failed','maintenance');}
    },
  };
}
export default createWorker();
