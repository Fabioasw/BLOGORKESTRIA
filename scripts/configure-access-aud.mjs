// Read-only Cloudflare API lookup; --apply changes only the local Wrangler file.
// Credentials stay in memory, never in arguments, logs or output artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const account='050967fd65bf47c8f473b0ac81edc7d0';
const expectedName='orkestriaplatform.com';
const expectedDestinations=['orkestriaplatform.com/admin/*','orkestriaplatform.com/api/admin/*'];
export function selectApplication(apps){
  const matches=apps.filter(app=>{
    const destinations=[app.domain,...(app.self_hosted_domains||[]),...(app.destinations||[]).map(item=>item.uri)].filter(value=>typeof value==='string').map(value=>value.replace(/^https?:\/\//,''));
    return app.name===expectedName && expectedDestinations.every(destination=>destinations.includes(destination));
  });
  if(matches.length!==1)throw new Error('Expected exactly one application matching the name AND both protected destinations. No local config changed.');
  return matches[0];
}
async function main(){
  let token=process.env.CLOUDFLARE_API_TOKEN||process.env.CF_API_TOKEN;
  const fileFlag=process.argv.indexOf('--credentials-file');
  if(fileFlag!==-1){
    const file=process.argv[fileFlag+1];if(!file||file.startsWith('--'))throw new Error('Missing credentials file path.');
    const content=(await readFile(resolve(file),'utf8')).trim();
    if(content.startsWith('{')){const values=JSON.parse(content);token=values.CLOUDFLARE_API_TOKEN||values.CF_API_TOKEN||values.api_token;}
    else if(/^(?:export\s+)?(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*=/m.test(content)){
      token=content.match(/^(?:export\s+)?(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*=\s*(.+)$/m)[1].trim().replace(/^(['"])(.*)\1$/,'$2');
    }else token=content;
  }
  if(typeof token!=='string'||!token.trim()||/\s/.test(token.trim()))throw new Error('No local Cloudflare API credential available. Provide its file path or environment variable; do not paste the token into chat.');
  async function api(path){
    let response;
    try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+token.trim()},signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw new Error('Could not reach the official Cloudflare API. No local config changed.');}
    if(!response.ok)throw new Error(`Cloudflare API HTTP ${response.status}. A token with Access: Apps and Policies Read is required. No local config changed.`);
    let data;try{data=await response.json();}catch{throw new Error('Invalid API response. No local config changed.');}
    if(data.success!==true)throw new Error('Cloudflare API did not confirm success. No local config changed.');
    return data;
  }
  const apps=[];
  for(let page=1;page<=100;page++){
    const data=await api(`/accounts/${account}/access/apps?page=${page}&per_page=100`);
    if(!Array.isArray(data.result))throw new Error('Unexpected application list response.');
    apps.push(...data.result);
    const totalPages=data.result_info?.total_pages;
    if(totalPages? page>=totalPages : data.result.length<100)break;
    if(page===100)throw new Error('Pagination limit exceeded. No local config changed.');
  }
  let app=selectApplication(apps);
  if(!app.aud){
    if(typeof app.id!=='string'||!/^[a-zA-Z0-9-]+$/.test(app.id))throw new Error('Missing application identifier for detail lookup.');
    const detail=await api(`/accounts/${account}/access/apps/${app.id}`);
    app=selectApplication([detail.result]);
  }
  if(typeof app.aud!=='string'||!/^\S{16,256}$/.test(app.aud)||app.aud===app.id)throw new Error('The official application response has no valid aud field. No ID substituted; config unchanged.');
  const result={application:app.name,destinations:expectedDestinations,aud:app.aud,source:'Cloudflare Access application.aud',localConfigUpdated:false};
  if(process.argv.includes('--apply')){
    const path=new URL('../wrangler.toml',import.meta.url);let config=await readFile(path,'utf8');
    const assignment='ACCESS_AUD = '+JSON.stringify(app.aud);
    if(/^ACCESS_AUD\s*=/m.test(config))config=config.replace(/^ACCESS_AUD\s*=.*$/m,assignment);
    else {if(!/^ACCESS_TEAM_DOMAIN\s*=.*$/m.test(config))throw new Error('Local Access team configuration not found.');config=config.replace(/^(ACCESS_TEAM_DOMAIN\s*=.*)$/m,'$1\n'+assignment);}
    config=config.replace(/^# Configure ACCESS_AUD\r?\n# with real values before publishing\. See DEPLOY\.md\.\r?\n/m,'');
    await writeFile(path,config);result.localConfigUpdated=true;
  }
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Access AUD lookup did not complete. Check credential availability, API read permission and exact application destinations. No deployment was attempted.');process.exitCode=1;});
