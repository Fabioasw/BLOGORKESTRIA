import type { Env } from './types.ts';

export interface CommercialMessage {to:string;subject:string;text:string}
export type EmailSender=(message:CommercialMessage)=>Promise<{messageId:string}>;
export class DeliveryError extends Error {
  code:string;retryable:boolean;uncertain:boolean;
  constructor(code:string,retryable=false,uncertain=false){super(code);this.code=code;this.retryable=retryable;this.uncertain=uncertain;}
}
const emailPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const validEmail=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&emailPattern.test(value)&&!/[\r\n]/.test(value);
export const customerConfirmationsAvailable=(env:Env)=>env.AUTOMATION_MODE!=='production'||env.EMAIL_CUSTOMER_CONFIRMATIONS==='true';
export function emailReady(env:Env):boolean {
  if(!['preview','production'].includes(env.AUTOMATION_MODE||'')||env.EMAIL_PROVIDER!=='cloudflare'||!env.EMAIL||!validEmail(env.EMAIL_FROM)||!validEmail(env.EMAIL_ADMIN_TO))return false;
  if(env.EMAIL_REPLY_TO&&!validEmail(env.EMAIL_REPLY_TO))return false;
  if(env.EMAIL_FROM_NAME!==undefined&&(!env.EMAIL_FROM_NAME.trim()||env.EMAIL_FROM_NAME.length>120||/[\u0000-\u001f\u007f]/.test(env.EMAIL_FROM_NAME)))return false;
  try{const url=new URL(env.CRM_PUBLIC_ORIGIN||'');if(url.protocol!=='https:'||url.origin!==env.CRM_PUBLIC_ORIGIN||url.username||url.password)return false;if(env.AUTOMATION_MODE==='production'&&url.hostname!=='orkestriaplatform.com')return false;if(env.AUTOMATION_MODE==='preview'&&url.hostname==='orkestriaplatform.com')return false;}catch{return false;}
  return env.AUTOMATION_MODE!=='preview'||testRecipients(env).length>0;
}
export function testRecipients(env:Env):string[]{return (env.EMAIL_TEST_RECIPIENTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(validEmail);}
export function cloudflareSender(env:Env):EmailSender {
  return async message=>{
    if(!emailReady(env))throw new DeliveryError('email_not_configured');
    if(!validEmail(message.to))throw new DeliveryError('invalid_recipient');
    if(env.AUTOMATION_MODE==='preview'&&!testRecipients(env).includes(message.to.toLowerCase()))throw new DeliveryError('preview_recipient_blocked');
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
      // A timeout is ambiguous: the provider may already have accepted the email.
      // No automatic resend without provider-side idempotency/reconciliation.
      const sent=await Promise.race([
        env.EMAIL!.send({from:env.EMAIL_FROM_NAME?{email:env.EMAIL_FROM!,name:env.EMAIL_FROM_NAME}:env.EMAIL_FROM!,to:message.to,replyTo:env.EMAIL_REPLY_TO||undefined,subject:message.subject,text:message.text}),
        new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new DeliveryError('provider_timeout',false,true)),12000);}),
      ]);
      if(!sent?.messageId)throw new DeliveryError('provider_result_unknown',false,true);
      return {messageId:sent.messageId};
    }catch(error){
      if(error instanceof DeliveryError)throw error;
      const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
      // Persist only our own codes, never raw provider messages or addresses.
      if(code==='E_RATE_LIMIT_EXCEEDED')throw new DeliveryError('provider_rate_limit',true);
      if(code==='E_DAILY_LIMIT_EXCEEDED')throw new DeliveryError('provider_daily_limit',true);
      if(['E_VALIDATION_ERROR','E_FIELD_MISSING','E_SENDER_NOT_VERIFIED','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_HEADER_NOT_ALLOWED'].includes(code))throw new DeliveryError('provider_rejected');
      throw new DeliveryError('provider_result_unknown',false,true);
    }finally{if(timeout!==undefined)clearTimeout(timeout);}
  };
}
