(() => {
  'use strict';
  const statuses = {novo:'Novo',em_analise:'Em análise',qualificado:'Qualificado',reuniao_agendada:'Reunião agendada',proposta_enviada:'Proposta enviada',convertido:'Convertido',descartado:'Descartado'};
  const $ = id => document.getElementById(id);
  const dialog=$('lead-dialog'), filters=$('filters');
  let page=1,total=0,sequence=0,selected=null,saving=false,loading=false,ready=false;
  const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  let automationConfig=null,deepLinkOpened=false;
  const autoLabels={pending:'Pendente',processing:'Em processamento',accepted:'Aceito pelo serviço',failed:'Falhou',uncertain:'Resultado desconhecido',cancelled:'Cancelado'};
  const kindLabels={new_lead_admin:'Aviso de novo lead',lead_confirmation:'Confirmação ao cliente',followup:'Lembrete de retorno',daily_summary:'Resumo diário'};
  function localInput(value){if(!value)return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
  function fromBrasilia(value){if(!value)return null;const wanted=Date.parse(value+'Z');let guess=wanted;for(let i=0;i<3;i++){const represented=Date.parse(localInput(new Date(guess).toISOString())+'Z');guess+=wanted-represented;}if(localInput(new Date(guess).toISOString())!==value)throw new Error('Data de Brasília inválida.');return new Date(guess).toISOString();}
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
        for(const value of [date(lead.created_at),lead.name,lead.company,lead.email,lead.job_title,lead.service_type,lead.utm_source||lead.source,lead.next_action_at?date(lead.next_action_at):'Sem próxima ação']) row.append(node('td',value));
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
      $('next-action').value=selected.next_action||'';$('next-action-at').value=localInput(selected.next_action_at);$('last-contact-at').value=localInput(selected.last_contact_at);$('record-contact').checked=false;$('lead-archived').checked=Boolean(selected.archived_at);
      const timeline=[...data.events.map(event=>({...event,commercial:true})),...(data.automationEvents||[])].sort((a,b)=>a.created_at.localeCompare(b.created_at));
      for(const event of timeline.filter(event=>event.commercial)){const item=node('li');item.dataset.createdAt=event.created_at;const title=event.event_type==='created'?'Solicitação recebida':event.event_type==='note'?'Observação interna':`${statuses[event.previous_status]} → ${statuses[event.new_status]}`;item.append(node('strong',title),node('small',`${date(event.created_at)}${event.admin_id?' · Administrador: '+event.admin_id:''}`));if(event.note)item.append(node('p',event.note));$('lead-history').append(item);}
      const eventNames={email_queued:'Notificação agendada',email_pending:'Nova tentativa agendada',email_accepted:'E-mail aceito pelo serviço',email_failed:'Falha no envio',email_uncertain:'Envio precisa de conferência',email_cancelled:'Notificação cancelada',contact_recorded:'Último contato registrado',followup_updated:'Próxima ação atualizada',archived:'Oportunidade arquivada',restored:'Oportunidade restaurada',manual_retry:'Reprocessamento solicitado'};
      for(const event of timeline.filter(event=>!event.commercial)){const item=node('li');item.dataset.createdAt=event.created_at;item.append(node('strong',eventNames[event.event_type]||'Evento de automação'),node('small',date(event.created_at)));const detail=JSON.parse(event.detail_json||'{}');if(detail.action)item.append(node('p',detail.action));if(detail.date)item.append(node('p',date(detail.date)));$('lead-history').append(item);}
      $('lead-history').append(...[...$('lead-history').children].sort((a,b)=>a.dataset.createdAt.localeCompare(b.dataset.createdAt)));
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
      await api(`/api/admin/leads/${id}`,{method:'PATCH',body:JSON.stringify({version:selected.version,status:$('lead-status').value,note:$('lead-note').value,next_action:$('next-action').value,next_action_at:$('next-action-at').value===localInput(selected.next_action_at)?undefined:fromBrasilia($('next-action-at').value),last_contact_at:$('last-contact-at').value===localInput(selected.last_contact_at)?undefined:fromBrasilia($('last-contact-at').value),record_contact:$('record-contact').checked,archived:$('lead-archived').checked})});
      saving=false;await open(id);message($('detail-status'),'Acompanhamento salvo.');await stats();await list();await crm();await loadAutomation();
    } catch(error){message($('detail-status'),error.message,true);}
    finally{saving=false;$('save-lead').disabled=false;}
  });
  $('delete-lead').addEventListener('click',async()=>{
    if(!selected||saving)return;
    if($('delete-confirmation').value!=='EXCLUIR'){message($('detail-status'),'Digite EXCLUIR para confirmar a exclusão permanente.',true);return;}
    saving=true;$('delete-lead').disabled=true;
    try{await api(`/api/admin/leads/${selected.id}`,{method:'DELETE',body:JSON.stringify({version:selected.version,confirmation:selected.id})});selected=null;dialog.close();page=1;await stats();await list();await crm();await loadAutomation();message($('page-status'),'Oportunidade e histórico excluídos.');}
    catch(error){message($('detail-status'),error.message,true);}
    finally{saving=false;$('delete-lead').disabled=false;}
  });
  async function initialize(){
    try{const session=await api('/api/admin/session');$('session-label').textContent=`Sessão de ${session.email} · Datas da tabela em Brasília`;ready=true;const params=new URLSearchParams(location.search),view=params.get('view');if(['active','overdue','no_action','stale','archived','all'].includes(view))$('view-filter').value=view;await stats();await list();await crm();await loadAutomation();const lead=params.get('lead');if(!deepLinkOpened&&lead&&/^[0-9a-f-]{36}$/i.test(lead)){deepLinkOpened=true;await open(lead);}}
    catch(error){message($('page-status'),error.message,true);$('session-label').textContent='Não foi possível validar o acesso.';}
  }
  $('refresh').addEventListener('click',()=>{if(!loading)initialize();});
  async function crm(){try{const data=await api('/api/admin/crm');$('crm-overview').textContent=`${data.overdue} retornos vencidos · ${data.noAction} sem próxima ação · ${data.stale} sem contato há ${data.staleDays} dias · ${data.archived} arquivados`;}catch(error){$('crm-overview').textContent=error.message;}}
  async function loadAutomation(){
    try{const data=await api('/api/admin/automation');automationConfig=data.settings;for(const key of ['enabled','notify_admin','confirm_customer','followup_alerts','daily_summary'])$('auto-'+key).checked=Boolean(data.settings[key]);$('auto-daily_time').value=data.settings.daily_time;$('auto-stale_days').value=data.settings.stale_days;$('auto-enabled').disabled=!data.deliveryAvailable;$('auto-confirm_customer').disabled=!data.customerConfirmationsAvailable;if(!data.customerConfirmationsAvailable)$('auto-confirm_customer').checked=false;$('customer-email-availability').hidden=data.customerConfirmationsAvailable;$('automation-status').textContent=data.deliveryAvailable?(data.settings.enabled?'Envios ativos.':'Envios pausados.'):'Envios desativados: falta configurar remetente, binding de e-mail e ambiente.';$('automation-counts').textContent=data.counts.map(c=>`${autoLabels[c.status]}: ${c.total}`).join(' · ');$('automation-jobs').replaceChildren();
      for(const job of data.jobs){const item=node('li');item.append(node('strong',kindLabels[job.kind]),node('small',`${autoLabels[job.status]} · ${job.attempts} tentativas · ${date(job.created_at)}`));if(job.lead_id){const a=node('a','Abrir oportunidade');a.href='/admin/leads?lead='+encodeURIComponent(job.lead_id);item.append(a);}if(['failed','uncertain'].includes(job.status)){const button=node('button','Tentar novamente','row-button');button.type='button';button.addEventListener('click',async()=>{if(job.status==='uncertain'&&!window.confirm('Conferiu o Activity Log do provedor e confirmou que este e-mail não foi aceito? Repetir sem conferir pode duplicar a mensagem.'))return;button.disabled=true;try{await api(`/api/admin/automation/${job.id}/retry`,{method:'POST',body:JSON.stringify({confirmed_not_delivered:job.status==='uncertain'})});await loadAutomation();}catch(error){message($('automation-status'),error.message,true);button.disabled=false;}});item.append(button);}$('automation-jobs').append(item);}
    }catch(error){message($('automation-status'),error.message,true);}
  }
  $('automation-settings').addEventListener('submit',async event=>{event.preventDefault();if(!automationConfig)return;if($('auto-enabled').checked&&!automationConfig.enabled&&!window.confirm('Ativar enviará também as notificações pendentes. Deseja ativar?'))return;const data={version:automationConfig.version,daily_time:$('auto-daily_time').value,stale_days:Number($('auto-stale_days').value)};for(const key of ['enabled','notify_admin','confirm_customer','followup_alerts','daily_summary'])data[key]=$('auto-'+key).checked;$('save-automation').disabled=true;try{await api('/api/admin/automation',{method:'PATCH',body:JSON.stringify(data)});await loadAutomation();await crm();message($('automation-status'),'Preferências salvas.');}catch(error){message($('automation-status'),error.message,true);}finally{$('save-automation').disabled=false;}});
  initialize();
})();
