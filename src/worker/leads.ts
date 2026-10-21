import { ADS_CONSENT_VERSION } from './ads.ts';
import type { Env } from './types.ts';
import { body, HttpError, json, method, sameOrigin, sha256, text, uuid } from './http.ts';
import { captureReady, rateLimit, verifyTurnstile } from './security.ts';
import { queueStatements } from './automation.ts';

export const SERVICES = ['Customização TOTVS RM','Fórmula Visual','Integração de sistemas','Automação financeira / CNAB','Compras e recebimento','Relatórios / Power BI','Desenvolvimento web integrado','Outros'];
export const STATUSES = ['novo','em_analise','qualificado','reuniao_agendada','proposta_enviada','convertido','descartado'];
export const CAMPAIGN_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid'] as const;
export type ChallengeVerifier = typeof verifyTurnstile;

export async function capture(request: Request, env: Env, requestId: string, verify: ChallengeVerifier): Promise<Response> {
  method(request,['POST']); sameOrigin(request);
  if (!captureReady(env)) throw new HttpError(503,'capture_not_configured','O formulário ainda não está disponível. Tente novamente mais tarde ou use nosso contato alternativo.');
  await rateLimit(request,env);
  const data = await body(request);
  const key = request.headers.get('Idempotency-Key');
  if (!uuid(key)) throw new HttpError(400,'invalid_idempotency','Identificador de envio inválido. Recarregue a página.');
  if (data.website) throw new HttpError(400,'invalid_request','Não foi possível validar o envio.');
  const limits: Record<string,[number,number]> = { name:[2,120],email:[5,254],company:[2,160],job_title:[2,120],service_type:[2,80],description:[20,4000] };
  const fields: Record<string,string> = {}, errors: Record<string,string> = {};
  for (const [name,[min,max]] of Object.entries(limits)) {
    // Keep the existing NOT NULL/length constraint and historic CRM contract.
    // An omitted optional role is explicitly unknown, never a fabricated title.
    const optionalRole = name === 'job_title' && (data[name] === undefined || (typeof data[name] === 'string' && !data[name].trim()));
    const value = optionalRole ? 'Não informado' : text(data[name],min,max);
    if (value === null) errors[name] = `Use entre ${min} e ${max} caracteres.`;
    fields[name] = value || '';
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(fields.email)) errors.email = 'Informe um e-mail válido.';
  if (!SERVICES.includes(fields.service_type)) errors.service_type = 'Selecione uma necessidade válida.';
  if (Object.keys(errors).length) throw new HttpError(400,'invalid_fields','Revise os campos indicados.',errors);
  if (typeof data.marketing_consent !== 'boolean' || typeof data.measurement_consent !== 'boolean') throw new HttpError(400,'invalid_consent','Preferências inválidas.');
  if (data.privacy_notice_version !== env.PRIVACY_NOTICE_VERSION) throw new HttpError(409,'privacy_notice_changed','O aviso de privacidade foi atualizado. Recarregue a página antes de enviar.');
  if (typeof data.token !== 'string' || !data.token || data.token.length > 2048) throw new HttpError(400,'invalid_challenge','Conclua a verificação de segurança.');
  if (data.campaign !== undefined && (!data.campaign || typeof data.campaign !== 'object' || Array.isArray(data.campaign))) throw new HttpError(400,'invalid_campaign','Parâmetros de campanha inválidos.');
  const campaign: Record<string,string|null> = {};
  for (const name of CAMPAIGN_KEYS) {
    const value = (data.campaign as Record<string,unknown> | undefined)?.[name];
    if (value !== undefined && (typeof value !== 'string' || value.length>250 || /[\u0000-\u001f\u007f]/.test(value))) throw new HttpError(400,'invalid_campaign','Parâmetros de campanha inválidos.');
    campaign[name] = data.measurement_consent && typeof value === 'string' ? value : null;
  }
  if(data.advertising_consent !== undefined && typeof data.advertising_consent !== 'boolean') throw new HttpError(400,'invalid_consent','Preferências inválidas.');
  const advertisingConsent=data.advertising_consent===true;
  if(advertisingConsent && (data.advertising_consent_version!==ADS_CONSENT_VERSION || !data.measurement_consent)) throw new HttpError(400,'invalid_consent','Atualize sua preferência de publicidade.');
  const adsHash=advertisingConsent?{advertising_consent:true,advertising_consent_version:ADS_CONSENT_VERSION}:{};
  const hash = await sha256(JSON.stringify({...fields,campaign,marketing_consent:data.marketing_consent,privacy:env.PRIVACY_NOTICE_VERSION,...adsHash}));
  const prior = await env.DB.prepare('SELECT id,payload_hash,ads_conversion_id FROM leads WHERE idempotency_key=?').bind(key).first<{id:string;payload_hash:string;ads_conversion_id:string|null}>();
  if (prior) {
    if (prior.payload_hash !== hash) throw new HttpError(409,'idempotency_conflict','Este identificador já foi usado para outra solicitação. Recarregue a página.');
    return json({ok:true,data:{id:prior.id,duplicate:true,conversionId:prior.ads_conversion_id},requestId},200);
  }
  const tokenHash=await sha256(data.token);
  const challengeUsed=()=>env.DB.prepare('SELECT token_hash FROM used_challenges WHERE token_hash=?').bind(tokenHash).first();
  if(await challengeUsed()) throw new HttpError(400,'invalid_challenge','Verificação já utilizada. Conclua uma nova verificação.');
  await verify(data.token,key,request,env);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO used_challenges(token_hash,expires_at) VALUES (?,?)').bind(tokenHash,Math.floor(Date.now()/1000)+600),
      env.DB.prepare(`INSERT INTO leads(id,idempotency_key,payload_hash,name,email,company,job_title,service_type,description,utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid,privacy_notice_version,marketing_consent,advertising_consent,advertising_consent_version,ads_conversion_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,key,hash,fields.name,fields.email,fields.company,fields.job_title,fields.service_type,fields.description,...CAMPAIGN_KEYS.map(name=>campaign[name]),env.PRIVACY_NOTICE_VERSION!,Number(data.marketing_consent),Number(advertisingConsent),advertisingConsent?ADS_CONSENT_VERSION:null,advertisingConsent?crypto.randomUUID():null),
      ...queueStatements(env,{id,name:fields.name,email:fields.email,company:fields.company,service_type:fields.service_type}),
    ]);
  } catch(error) {
    // Concurrent retries may race after the initial lookup. D1 rolls back both
    // statements; resolve the original idempotency key before reporting replay.
    const raced=await env.DB.prepare('SELECT id,payload_hash,ads_conversion_id FROM leads WHERE idempotency_key=?').bind(key).first<{id:string;payload_hash:string;ads_conversion_id:string|null}>();
    if(raced){
      if(raced.payload_hash!==hash)throw new HttpError(409,'idempotency_conflict','Solicitação conflitante. Recarregue a página.');
      return json({ok:true,data:{id:raced.id,duplicate:true,conversionId:raced.ads_conversion_id},requestId},200);
    }
    if(await challengeUsed())throw new HttpError(400,'invalid_challenge','Verificação já utilizada. Conclua uma nova verificação.');
    throw error;
  }
  const saved = await env.DB.prepare('SELECT id,payload_hash,ads_conversion_id FROM leads WHERE idempotency_key=?').bind(key).first<{id:string;payload_hash:string;ads_conversion_id:string|null}>();
  if (!saved) throw new Error('storage_confirmation_failed');
  if (saved.payload_hash !== hash) throw new HttpError(409,'idempotency_conflict','Solicitação conflitante. Recarregue a página.');
  return json({ok:true,data:{id:saved.id,duplicate:saved.id!==id,conversionId:saved.ads_conversion_id},requestId},saved.id===id?201:200);
}
