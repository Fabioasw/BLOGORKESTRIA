import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../assets/totvs-rm.js',import.meta.url),'utf8');
function contactPage(reduced=false) {
  const events=new Map<string,Function>(), requests:string[]=[], focus:any[]=[], scroll:any[]=[];
  const field=(name:string)=>({value:'',removeAttribute(key:string){events.set(name+':cleared',()=>key);},focus(options:unknown){focus.push({name,options});},scrollIntoView(options:unknown){scroll.push({name,options});}});
  const fields={nome:field('nome'),necessidade:field('necessidade')};
  const elements:any={
    'rm-form':{elements:fields,addEventListener(name:string,fn:Function){events.set('form:'+name,fn);}},
    'lead-submit':{},'form-status':{dataset:{}},'consent-description':{},'necessidade-error':{textContent:'Erro anterior'},'service-selection':{},
    'consent-accept':{addEventListener(){}},'consent-reject':{addEventListener(){}},
  };
  const service={dataset:{service:'Customização TOTVS RM'},addEventListener(_name:string,fn:Function){events.set('service',fn);}};
  const primary={dataset:{},addEventListener(_name:string,fn:Function){events.set('primary',fn);}};
  const location={search:'?utm_source=google&gclid=OpaqueIdentifier#customizacao'};
  const sandbox:any={crypto,AbortSignal,URLSearchParams,location,matchMedia:()=>({matches:reduced}),
    document:{getElementById:(id:string)=>elements[id],querySelectorAll:(selector:string)=>selector==='a[href="#avaliacao"]'?[service,primary]:[]},
    addEventListener(){},fetch:async(path:string)=>{requests.push(path);return {ok:true,json:async()=>({ok:true,data:{available:false}})};},
  };
  sandbox.window=sandbox;runInNewContext(source,sandbox);
  return {events,fields,elements,focus,scroll,requests,location};
}

test('contato por serviço seleciona necessidade, limpa erro e move foco sem envio ou alteração da campanha',async()=>{
  const page=contactPage();let prevented=false;
  page.events.get('service')!({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(page.fields.necessidade.value,'Customização TOTVS RM');
  assert.equal(page.elements['necessidade-error'].textContent,'');
  assert.match(page.elements['service-selection'].textContent,/Customização TOTVS RM/);
  assert.equal(page.focus[0].name,'necessidade');assert.equal(page.scroll[0].options.behavior,'smooth');
  assert.equal(page.location.search,'?utm_source=google&gclid=OpaqueIdentifier#customizacao');
  assert.deepEqual(page.requests,['/api/leads/config']);
});

test('CTA geral preserva seleção, respeita movimento reduzido e não intercepta abertura em nova aba',()=>{
  const page=contactPage(true);page.fields.necessidade.value='Fórmula Visual';
  page.events.get('primary')!({preventDefault(){}});
  assert.equal(page.fields.necessidade.value,'Fórmula Visual');
  assert.equal(page.focus[0].name,'nome');assert.equal(page.scroll[0].options.behavior,'auto');
  page.events.get('service')!({ctrlKey:true,preventDefault(){assert.fail('Não deve interceptar Ctrl+clique');}});
  assert.equal(page.fields.necessidade.value,'Fórmula Visual');assert.equal(page.focus.length,1);
});
