(() => {
 'use strict';
 if(window.OrkestriaMeasure)return;
 const version='2026-10-21-funnel-v1',key='orkestria-funnel-choice',form=document.getElementById('rm-form');
 if(!form)return;
 const mapping={'Customização TOTVS RM':'customization','Fórmula Visual':'formula','Integração de sistemas':'integration','Automação financeira / CNAB':'finance','Compras e recebimento':'purchasing','Relatórios / Power BI':'reports','Desenvolvimento web integrado':'web','Outros':'other'};
 let allowed=false,session=null,opening=null,queue=[],sent=0,started=false,view=false,generation=0,draining=false;
 try{const value=JSON.parse(localStorage.getItem(key));allowed=value?.version===version&&value.allowed===true&&value.expires>Date.now();}catch{/* Optional storage. */}
 const selected=()=>mapping[form.elements.necessidade.value];
 function status(){const el=document.getElementById('measurement-description');if(el)el.textContent=allowed?'Medição própria permitida. Você pode revogar abaixo.':'Medição própria desativada. Recusar não impede seu contato.';}
 async function flush(){
  if(!allowed||!queue.length||draining)return;
  draining=true;
  const current=generation;
  try{
   if(!session){
    opening ||= fetch('/api/measurement/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,version}),signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw Error();return (await r.json()).data;}).finally(()=>{opening=null;});
    const value=await opening;if(!allowed||generation!==current)return;session=value;
   }
   if(!allowed||generation!==current)return;
   if(session.expires*1000<Date.now()){queue=[];return;}
   const batch=queue.splice(0,10);
   const response=await fetch('/api/measurement/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:session.token,events:batch}),keepalive:true,signal:AbortSignal.timeout(5000)});
   // No blind retries: telemetry is best effort and must never delay contact.
   if(response.status===429)queue=[];
  }catch{queue=[];/* No form contents, provider details or tokens in logs. */}
  finally{draining=false;if(allowed&&queue.length)void flush();}
 }
 function event(name,extra={}){if(!allowed||sent>=30)return;queue.push({id:crypto.randomUUID(),event:name,...extra});sent++;void flush();}
 function begin(){if(allowed&&!started){started=true;event('form_start');}}
 function choice(value,persist=true){generation++;allowed=value;queue=[];session=null;opening=null;if(persist)try{localStorage.setItem(key,JSON.stringify({allowed,version,expires:Date.now()+180*86400000}));}catch{}status();if(value&&!view){view=true;event('landing_view');}}
 document.getElementById('measurement-accept')?.addEventListener('click',()=>choice(true));
 document.getElementById('measurement-reject')?.addEventListener('click',()=>choice(false));
 window.addEventListener('storage',e=>{if(e.key===key){let value;try{value=JSON.parse(e.newValue);}catch{}if(value?.allowed!==true||value?.version!==version)choice(false,false);}});
 window.OrkestriaMeasure=Object.freeze({event,granted:()=>allowed,version});
 form.addEventListener('input',begin);form.addEventListener('change',begin);
 form.addEventListener('invalid',()=>event('form_validation_error',{code:'validation'}),true);
 form.elements.necessidade.addEventListener('change',()=>{const service=selected();event('service_category_change',service?{service}:{});updateWhatsApp();});
 document.querySelectorAll('a[href="#avaliacao"]').forEach(a=>a.addEventListener('click',()=>{const service=mapping[a.dataset.service];event(service?'service_cta_click':'primary_cta_click',service?{service}:{});}));
 const whatsapp=[...document.querySelectorAll('a[href^="https://wa.me/5519971541730"]')];
 function updateWhatsApp(){const service=form.elements.necessidade.value;const text=mapping[service]?`Olá! Conheci a Orkestria e gostaria de solicitar uma análise sobre ${service} no TOTVS RM.`:'Olá! Conheci a Orkestria e gostaria de solicitar uma análise de uma necessidade no TOTVS RM.';for(const a of whatsapp)a.href='https://wa.me/5519971541730?text='+encodeURIComponent(text);}
 for(const a of whatsapp)a.addEventListener('click',()=>{updateWhatsApp();const service=selected();event('whatsapp_click',service?{service}:{});});
 window.addEventListener('pagehide',()=>void flush());
 status();updateWhatsApp();if(allowed){view=true;event('landing_view');}
})();
