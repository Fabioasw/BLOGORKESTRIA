import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from '../src/worker/index.ts';
import type { Env } from '../src/worker/types.ts';
import { authorize } from '../src/worker/security.ts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

export const keys=await generateKeyPair('RS256',{modulusLength:2048});
const publicKey=await exportJWK(keys.publicKey);
export const localKeys=createLocalJWKSet({keys:[{...publicKey,kid:'local-test',alg:'RS256',use:'sig'}]});
export async function accessToken(overrides: { email?: string; issuer?: string; audience?: string; expiration?: string|number }={}) {
  return new SignJWT({email:overrides.email||'admin@example.com'}).setProtectedHeader({alg:'RS256',kid:'local-test'}).setSubject('admin-test-id').setIssuer(overrides.issuer||'https://unit-test.cloudflareaccess.com').setAudience(overrides.audience||'test-audience').setIssuedAt().setExpirationTime(overrides.expiration||'5m').sign(keys.privateKey);
}
export function database(path=':memory:') {
  const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON');
  const migration=readFileSync(new URL('../migrations/0001_commercial_leads.sql',import.meta.url),'utf8');
  if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'").get()) sqlite.exec(migration);
  const db={
    sqlite,
    failBatch:false,
    prepare(sql:string) {
      return {
        values:[] as (string|number|null)[],
        bind(...values:(string|number|null)[]) {this.values=values;return this;},
        async first() {return sqlite.prepare(sql).get(...this.values)||null;},
        async all() {return {success:true,results:sqlite.prepare(sql).all(...this.values),meta:{}};},
        async run() {const result=sqlite.prepare(sql).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};},
      };
    },
    async batch(statements: {run:()=>Promise<unknown>;all?:()=>Promise<unknown>}[]) {
      sqlite.exec('BEGIN');
      try {
        const results=[];
        for(let i=0;i<statements.length;i++) {
          const statement=statements[i];
          // D1 batch() returns SELECT rows as well as modification metadata.
          try {const result=await statement.all!();results.push(result);} catch(error) {throw error;}
          if(this.failBatch&&i===0) throw new Error('simulated transaction failure with private data');
        }
        sqlite.exec('COMMIT');return results;
      } catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
  };
  // SQLite statement.all() also executes writes; use column information to preserve meta.changes.
  const prepare=db.prepare.bind(db);
  db.prepare=(sql:string)=>{
    const stmt=prepare(sql);
    stmt.all=async()=>{
      const statement=sqlite.prepare(sql);
      if(statement.columns().length) return {success:true,results:statement.all(...stmt.values),meta:{changes:0}};
      const result=statement.run(...stmt.values);
      return {success:true,results:[],meta:{changes:Number(result.changes)}};
    };
    return stmt;
  };
  return db;
}
export function setup() {
  const db=database();
  const env={DB:db,ASSETS:{fetch:async(request:Request)=>new Response(`asset:${new URL(request.url).pathname}`)},TURNSTILE_SITE_KEY:'local-public-fixture',TURNSTILE_SECRET_KEY:'local-secret-fixture',RATE_LIMIT_SECRET:'local-rate-fixture',PRIVACY_NOTICE_VERSION:'2026-10-15',RETENTION_DAYS:'180',ACCESS_TEAM_DOMAIN:'https://unit-test.cloudflareaccess.com',ACCESS_AUD:'test-audience',ADMIN_EMAILS:'admin@example.com'} as unknown as Env;
  const app=createWorker({authorize:(request,env)=>authorize(request,env,localKeys),verifyTurnstile:async()=>{}});
  return {db,env,app};
}
export function payload() {return {name:'Pessoa Teste',email:'teste@example.com',company:'Empresa Teste',job_title:'TI',service_type:'Integração de sistemas',description:'Precisamos integrar os processos financeiros ao ERP.',marketing_consent:false,measurement_consent:true,privacy_notice_version:'2026-10-15',campaign:{utm_source:'google',utm_medium:'cpc',utm_campaign:'rm',utm_content:'teste',utm_term:'consultoria',gclid:'test-click'},token:'local-token',website:''};}
export function request(path:string,options: {method?:string;data?:unknown;key?:string;token?:string;origin?:string;headers?:Record<string,string>}={}) {
  return new Request('https://orkestriaplatform.com'+path,{method:options.method||'GET',headers:{Origin:options.origin||'https://orkestriaplatform.com','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.123',...(options.key?{'Idempotency-Key':options.key}:{}),...(options.token?{'Cf-Access-Jwt-Assertion':options.token}:{}),...options.headers},...(options.data===undefined?{}:{body:JSON.stringify(options.data)})});
}
export async function addLead(s:ReturnType<typeof setup>,patch:Record<string,unknown>={}) {
  const response=await s.app.fetch(request('/api/leads/totvs-rm',{method:'POST',key:crypto.randomUUID(),data:{...payload(),...patch}}),s.env);
  const result=await response.json() as {data:{id:string}};return result.data.id;
}
