import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AdminIdentity, Env } from './types.ts';
import { HttpError, sha256 } from './http.ts';

const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authorize(request: Request, env: Env, testKeys?: JWTVerifyGetKey): Promise<AdminIdentity> {
  const domain = env.ACCESS_TEAM_DOMAIN;
  if (!domain || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD || !env.ADMIN_EMAILS?.trim()) throw new HttpError(503,'access_not_configured','Acesso administrativo ainda não configurado.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new HttpError(401,'authentication_required','Autenticação Cloudflare Access necessária.');
  if (!sets.has(domain)) sets.set(domain,createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`),{timeoutDuration:5000}));
  let claims;
  try {
    const verified = await jwtVerify(token, testKeys || sets.get(domain)!, { issuer: domain, audience: env.ACCESS_AUD, algorithms:['RS256'], requiredClaims:['exp','iat','sub','email'], clockTolerance:5 });
    claims = verified.payload;
  } catch { throw new HttpError(401,'invalid_identity','Sessão inválida ou expirada. Entre novamente.'); }
  const allowed = env.ADMIN_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (typeof claims.email !== 'string' || !allowed.includes(claims.email.toLowerCase()) || typeof claims.sub !== 'string') throw new HttpError(403,'admin_not_authorized','Usuário sem autorização administrativa.');
  return { id:claims.sub, email:claims.email };
}
export function captureReady(env: Env): boolean {
  return Boolean(env.DB && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_HOSTNAMES?.trim() && env.RATE_LIMIT_SECRET && env.PRIVACY_NOTICE_VERSION);
}
export async function rateLimit(request: Request, env: Env): Promise<void> {
  const now = Math.floor(Date.now()/1000), window = Math.floor(now/600);
  const hash = await sha256(`${env.RATE_LIMIT_SECRET}:${Math.floor(now/86400)}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
  const row = await env.DB.prepare('INSERT INTO request_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(`${hash}:${window}`,now+1200).first<{attempts:number}>();
  if (!row || row.attempts > 8) throw new HttpError(429,'rate_limited','Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
}
export async function verifyTurnstile(token: string, key: string, request: Request, env: Env): Promise<void> {
  const expectedHostnames = new Set((env.TURNSTILE_HOSTNAMES || '').split(',').map(hostname => hostname.trim()).filter(Boolean));
  const requestHostname = new URL(request.url).hostname;
  if (!expectedHostnames.has(requestHostname) || typeof token !== 'string' || token.length === 0 || token.length > 2048) throw new HttpError(400,'invalid_challenge','Não foi possível validar a origem ou a verificação de segurança.');
  let data: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(8000),
      body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,idempotency_key:key}),
    });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch { throw new HttpError(503,'verification_unavailable','Verificação indisponível. Tente novamente.'); }
  if (data.success !== true || data.hostname !== requestHostname || !expectedHostnames.has(data.hostname) || data.action !== 'totvs_rm_lead') throw new HttpError(400,'invalid_challenge','A verificação de segurança expirou ou é inválida. Tente novamente.');
}
