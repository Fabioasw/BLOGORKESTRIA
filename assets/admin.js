(() => {
  'use strict';
  const statuses = {novo:'Novo',em_analise:'Em análise',qualificado:'Qualificado',reuniao_agendada:'Reunião agendada',proposta_enviada:'Proposta enviada',convertido:'Convertido',descartado:'Descartado'};
  const $ = id => document.getElementById(id);
  const dialog=$('lead-dialog'), filters=$('filters');
  let page=1,total=0,sequence=0,selected=null,saving=false,loading=false,ready=false;
  const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  function node(tag,text,className) {const element=document.createElement(tag);if(text!==undefined) element.textContent=text;if(className) element.className=className;return element;}
  function message(target,text,error=false) {target.textContent=text;target.dataset.error=String(error);}
  function option(value,label) {const element=node('option',label);element.value=value;return element;}
  for(const [value,label] of Object.entries(statuses)) { $('status-filter').append(option(value,label));$('lead-status').append(option(value,label)); }
  async function api(path,options={}) {
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),...options,headers:{'Content-Type':'application/json',...options.headers}});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.ok) {
      if(response.status===401) ready=false;
      throw new Error(result?.error?.message || (response.status===401?'Sessão expirada. Entre novamente pelo Cloudflare Access.':'Não foi possível concluir. Verifique sua conexão.'));
    }
    return result.data;
  }
  async function stats() {
    const data=await api('/api/admin/stats');
    $('metrics').replaceChildren();
    for(const [label,value] of [['Total de leads',data.total],...Object.entries(statuses).map(([key,label])=>[label,data.counts[key]])]) {
      const card=node('div',undefined,'metric');card.append(node('span',label),node('strong',String(value)));$('metrics').append(card);
    }
    const previous=$('source-filter').value;
    $('source-filter').replaceChildren(option('','Todas'));
    for(const value of data.sources) $('source-filter').append(option(value,value));
    $('source-filter').value=data.sources.includes(previous)?previous:'';
  }
  function paginate() {$('previous-page').disabled=loading||page<=1;$('next-page').disabled=loading||page*20>=total;}
  async function list() {
    if(!ready)return;
    const current=++sequence;loading=true;paginate();
    message($('page-status'),'Carregando oportunidades…');
    const values=Object.fromEntries(new FormData(filters));
    try {
      const data=await api('/api/admin/leads/search',{method:'POST',body:JSON.stringify({...values,page,pageSize:20})});
      if(current!==sequence)return;
      total=data.total;
      $('leads-body').replaceChildren();
      for(const lead of data.items) {
        const row=node('tr');
        for(const value of [date(lead.created_at),lead.name,lead.company,lead.email,lead.job_title,lead.service_type,lead.utm_source||lead.source]) row.append(node('td',value));
        const state=node('td');state.append(node('span',statuses[lead.status]||lead.status,'badge'));row.append(state);
        const action=node('td'),button=node('button','Abrir','row-button');button.type='button';button.setAttribute('aria-label',`Abrir oportunidade de ${lead.name}`);button.addEventListener('click',()=>open(lead.id));action.append(button);row.append(action);$('leads-body').append(row);
      }
      $('empty-state').hidden=data.items.length>0;
      $('page-label').textContent=`Página ${page} de ${Math.max(1,Math.ceil(total/20))} · ${total} oportunidades`;
      message($('page-status'),'');
    } catch(error) { if(current===sequence){$('leads-body').replaceChildren();message($('page-status'),error.message,true);} }
    finally {if(current===sequence){loading=false;paginate();}}
  }
  async function open(id) {
    if(saving)return;
    selected=null;$('lead-details').replaceChildren();$('lead-history').replaceChildren();$('update-lead').hidden=true;$('delete-confirmation').value='';$('lead-note').value='';
    dialog.querySelector('.delete-area').open=false;
    if(!dialog.open) dialog.showModal();
    message($('detail-status'),'Carregando detalhes…');
    try {
      const data=await api(`/api/admin/leads/${id}`);selected=data.lead;
      $('detail-heading').textContent=selected.company;
      const fields=[['Nome',selected.name],['E-mail',selected.email],['Empresa',selected.company],['Cargo ou área',selected.job_title],['Necessidade',selected.service_type],['Status',statuses[selected.status]],['Criado em',date(selected.created_at)],['Atualizado em',date(selected.updated_at)],['Origem',selected.source],['UTM source',selected.utm_source||'—'],['UTM medium',selected.utm_medium||'—'],['UTM campaign',selected.utm_campaign||'—'],['UTM content',selected.utm_content||'—'],['UTM term',selected.utm_term||'—'],['gclid',selected.gclid||'—'],['Landing page',selected.landing_page],['Aviso de privacidade',selected.privacy_notice_version],['Marketing opcional',selected.marketing_consent?'Autorizado':'Não autorizado'],['Descrição',selected.description]];
      for(const [label,value] of fields){const block=node('div',undefined,label==='Descrição'?'full':'');block.append(node('dt',label),node('dd',value));$('lead-details').append(block);}
      $('lead-status').value=selected.status;
      for(const event of data.events){const item=node('li');const title=event.event_type==='created'?'Solicitação recebida':event.event_type==='note'?'Observação interna':`${statuses[event.previous_status]} → ${statuses[event.new_status]}`;item.append(node('strong',title),node('small',`${date(event.created_at)}${event.admin_id?' · Administrador: '+event.admin_id:''}`));if(event.note)item.append(node('p',event.note));$('lead-history').append(item);}
      $('update-lead').hidden=false;message($('detail-status'),'');
    } catch(error){message($('detail-status'),error.message,true);}
  }
  filters.addEventListener('submit',event=>{event.preventDefault();page=1;list();});
  $('clear-filters').addEventListener('click',()=>{filters.reset();page=1;list();});
  $('previous-page').addEventListener('click',()=>{if(page>1&&!loading){page--;list();}});
  $('next-page').addEventListener('click',()=>{if(page*20<total&&!loading){page++;list();}});
  $('close-dialog').addEventListener('click',()=>{if(!saving)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  $('reload-detail').addEventListener('click',()=>{if(selected&&!saving)open(selected.id);});
  $('update-lead').addEventListener('submit',async event=>{
    event.preventDefault();if(!selected||saving)return;
    const id=selected.id;saving=true;$('save-lead').disabled=true;message($('detail-status'),'Salvando acompanhamento…');
    try {
      await api(`/api/admin/leads/${id}`,{method:'PATCH',body:JSON.stringify({version:selected.version,status:$('lead-status').value,note:$('lead-note').value})});
      saving=false;await open(id);message($('detail-status'),'Acompanhamento salvo.');await stats();await list();
    } catch(error){message($('detail-status'),error.message,true);}
    finally{saving=false;$('save-lead').disabled=false;}
  });
  $('delete-lead').addEventListener('click',async()=>{
    if(!selected||saving)return;
    if($('delete-confirmation').value!=='EXCLUIR'){message($('detail-status'),'Digite EXCLUIR para confirmar a exclusão permanente.',true);return;}
    saving=true;$('delete-lead').disabled=true;
    try{await api(`/api/admin/leads/${selected.id}`,{method:'DELETE',body:JSON.stringify({version:selected.version,confirmation:selected.id})});selected=null;dialog.close();page=1;await stats();await list();message($('page-status'),'Oportunidade e histórico excluídos.');}
    catch(error){message($('detail-status'),error.message,true);}
    finally{saving=false;$('delete-lead').disabled=false;}
  });
  async function initialize(){
    try{const session=await api('/api/admin/session');$('session-label').textContent=`Sessão de ${session.email} · Datas da tabela em Brasília`;ready=true;await stats();await list();}
    catch(error){message($('page-status'),error.message,true);$('session-label').textContent='Não foi possível validar o acesso.';}
  }
  $('refresh').addEventListener('click',()=>{if(!loading)initialize();});
  initialize();
})();
