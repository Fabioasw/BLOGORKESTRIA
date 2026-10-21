(() => {
  'use strict';
  const form = document.getElementById('rm-form');
  if (!form) return;
  const submit = document.getElementById('lead-submit');
  const status = document.getElementById('form-status');
  const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid'];
  const store = {
    get(storage, key) { try { return window[storage].getItem(key); } catch { return null; } },
    set(storage, key, value) { try { window[storage].setItem(key, value); } catch { /* Storage is optional. */ } },
    remove(storage, key) { try { window[storage].removeItem(key); } catch { /* Storage is optional. */ } },
  };
  const ads = window.OrkestriaAds;
  let consent = ads?.granted() === true;
  let campaign = {};
  let busy = false, complete = false, available = false, token = '', widgetId, noticeVersion = '';
  let requestKey = crypto.randomUUID(), lastPayload = null;
  let began = false;
  let statusSource = 'form';
  const emitted = new Set();

  function track(event, parameters = {}, once = false) {
    if (!consent || (once && emitted.has(event))) return;
    if (once) emitted.add(event);
    // Local events only: advertising conversions use the explicit API success gate below.
    const detail = { event, page_path: '/totvs-rm', page_location: 'https://orkestriaplatform.com/totvs-rm', ...parameters };
    window.dispatchEvent(new CustomEvent('orkestria:analytics', { detail }));
  }
  function captureCampaign() {
    if (!consent) return;
    try { campaign = JSON.parse(store.get('sessionStorage', 'orkestria-rm-campaign') || '{}') || {}; } catch { campaign = {}; }
    const params = new URLSearchParams(location.search);
    for (const key of campaignKeys) {
      if (params.has(key)) campaign[key] = params.get(key).slice(0, 250).replace(/[\u0000-\u001f\u007f]/g, '');
    }
    campaign = Object.fromEntries(campaignKeys.filter(key => typeof campaign[key] === 'string').map(key => [key, campaign[key]]));
    store.set('sessionStorage', 'orkestria-rm-campaign', JSON.stringify(campaign));
  }
  function showConsent() {
    document.getElementById('consent-description').textContent = consent
      ? 'Medição de publicidade permitida. Google Ads pode usar cookies e identificadores técnicos. Os campos do formulário não são enviados ao Google. Você pode revogar abaixo sem alterar sua solicitação.'
      : 'Publicidade opcional desativada. Você pode permitir o Google Ads para medir campanhas e cadastros, com cookies e identificadores técnicos. Não enviamos os campos do formulário ao Google. Recusar não impede seu contato.';
  }
  document.getElementById('consent-accept').addEventListener('click', () => {
    consent = !!ads;
    // Capture campaign before the SDK loader sanitizes the URL.
    captureCampaign();
    ads?.setConsent(true);
    showConsent();
    track('page_view', {}, true); track('view_totvs_rm', {}, true);
  });
  document.getElementById('consent-reject').addEventListener('click', () => {
    consent = false; campaign = {};
    ads?.setConsent(false);
    store.remove('sessionStorage', 'orkestria-rm-campaign');
    showConsent();
  });
  window.addEventListener('orkestria:ads-consent', () => {
    consent = ads?.granted() === true;
    if (!consent) { campaign = {}; store.remove('sessionStorage', 'orkestria-rm-campaign'); }
    showConsent();
  });
  captureCampaign(); showConsent();
  track('page_view', {}, true); track('view_totvs_rm', {}, true);
  form.addEventListener('focusin', () => { if (consent && !began) { began = true; track('begin_lead_form', {}, true); } });
  document.querySelectorAll('a[href="#avaliacao"]').forEach(link => link.addEventListener('click', event => {
    if (busy || complete || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const service = link.dataset.service;
    if (service) {
      form.elements.necessidade.value = service;
      form.elements.necessidade.removeAttribute('aria-invalid');
      document.getElementById('necessidade-error').textContent = '';
      const selection = document.getElementById('service-selection');
      if (selection) selection.textContent = `Necessidade selecionada: ${service}. Você pode alterar abaixo.`;
      track('select_service', { service });
    }
    const target = service ? form.elements.necessidade : form.elements.nome;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    // Same-document navigation leaves campaign parameters and consent untouched.
  }));

  function message(text, error = false, source = 'form') {
    status.textContent = text;
    status.dataset.error = String(error);
    statusSource = source;
  }
  function clearErrors() {
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(error => { error.textContent = ''; });
  }
  form.addEventListener('input', event => {
    const input = event.target;
    input.removeAttribute('aria-invalid');
    const hint = document.getElementById(`${input.name}-error`);
    if (hint) hint.textContent = '';
  });
  // Reveal an invalid optional field before the browser attempts to focus it.
  form.addEventListener('invalid', event => event.target.closest('details')?.setAttribute('open', ''), true);
  const names = { nome: 'name', email: 'email', empresa: 'company', cargo: 'job_title', necessidade: 'service_type', descricao: 'description' };
  function updateSubmit() { submit.disabled = !available || !token || busy || complete; }
  function resetChallenge() { token = ''; if (widgetId !== undefined) window.turnstile?.reset(widgetId); updateSubmit(); }
  function renderErrors(fields) {
    for (const [local, remote] of Object.entries(names)) {
      if (typeof fields?.[remote] === 'string') {
        form.elements[local].setAttribute('aria-invalid', 'true');
        form.elements[local].closest?.('details')?.setAttribute('open', '');
        document.getElementById(`${local}-error`).textContent = fields[remote];
      }
    }
    form.querySelector('[aria-invalid=true]')?.focus();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || complete || !available || !form.reportValidity()) return;
    if (!token) { message('Conclua a verificação de segurança.', true); return; }
    clearErrors();
    const values = Object.fromEntries(new FormData(form));
    const payload = Object.fromEntries(Object.entries(names).map(([local,remote]) => [remote, String(values[local] || '').trim()]));
    payload.marketing_consent = form.elements.marketing_consent.checked;
    consent = ads?.granted() === true;
    payload.measurement_consent = consent;
    payload.advertising_consent = consent;
    payload.advertising_consent_version = consent ? ads.version : null;
    payload.privacy_notice_version = noticeVersion;
    payload.website = values.website || '';
    payload.campaign = consent ? campaign : {};
    payload.funnel_consent = window.OrkestriaMeasure?.granted() === true;
    payload.funnel_consent_version = payload.funnel_consent ? window.OrkestriaMeasure.version : null;
    const snapshot = JSON.stringify(payload);
    if (lastPayload !== null && lastPayload !== snapshot) requestKey = crypto.randomUUID();
    lastPayload = snapshot;
    busy = true; updateSubmit(); form.setAttribute('aria-busy','true');
    submit.textContent = 'Enviando solicitação…'; message('Registrando sua solicitação com segurança…');
    try {
      const response = await fetch('/api/leads/totvs-rm', {
        method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},
        body:JSON.stringify({...payload,token}), signal:AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !result.data?.id) {
        window.OrkestriaMeasure?.event('form_submit_failed',{code:response.status===503?'unavailable':'rejected'});
        renderErrors(result.error?.fields);
        message(result.error?.message || 'Não foi possível registrar sua solicitação. Tente novamente.', true);
        resetChallenge(); return;
      }
      complete = true;
      // Correlate an API-confirmed receipt without retaining form contents.
      form.setAttribute('data-confirmed-lead',result.data.id);
      form.setAttribute('data-response-status',String(response.status));
      track('generate_lead',{},true);
      // Ads failures never invalidate an already confirmed lead.
      void ads?.acceptLead(response,result).catch(() => {});
      form.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = true; });
      message('Recebemos sua solicitação! Analisaremos as informações e entraremos em contato pelo e-mail informado.');
      status.tabIndex = -1; status.focus();
    } catch {
      window.OrkestriaMeasure?.event('form_submit_failed',{code:'network'});
      message('Não conseguimos confirmar o recebimento. Verifique sua conexão. Tente novamente nesta página; se recarregar, confira antes com nosso atendimento.',true);
      resetChallenge();
    } finally {
      busy = false; form.removeAttribute('aria-busy');
      submit.textContent = complete ? 'Solicitação recebida ✓' : 'Solicitar análise técnica';
      updateSubmit();
    }
  });
  async function initialize() {
    try {
      const response = await fetch('/api/leads/config',{signal:AbortSignal.timeout(10000)});
      const result = await response.json();
      const config = result.data;
      if (!response.ok || !result.ok || !config?.available || !config.siteKey) {
        message('O formulário ainda não está disponível. Tente mais tarde ou use o contato alternativo por WhatsApp.',true); return;
      }
      noticeVersion = config.privacyNoticeVersion;
      ads?.configure(config.ads);
      window.orkestriaTurnstileReady = () => {
        widgetId = window.turnstile.render('#turnstile-widget',{
          sitekey:config.siteKey, action:'totvs_rm_lead', theme:form.dataset?.theme || 'dark', size:matchMedia('(max-width:520px)').matches?'compact':'flexible',
          callback(value) {
            token=value;
            // Renewed challenges clear only their own errors, never a submission result.
            if(!busy && !complete && (statusSource==='challenge' || status.dataset.error!=='true')) message('Formulário pronto para envio.');
            updateSubmit();
          },
          'expired-callback'() {
            token='';
            if(!busy && !complete) message('A verificação expirou. Conclua-a novamente.',true,'challenge');
            updateSubmit();
          },
          'error-callback'() {
            token='';
            if(!busy && !complete) message('Falha ao carregar a verificação. Verifique sua conexão e recarregue a página.',true,'challenge');
            updateSubmit();
          },
        });
        available=true; updateSubmit();
      };
      const script=document.createElement('script');
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=orkestriaTurnstileReady&render=explicit';
      script.async=true;
      script.onerror=()=>message('Não foi possível carregar a proteção. Recarregue a página para tentar novamente.',true);
      document.head.append(script);
      message('Conclua a verificação de segurança para enviar.');
    } catch {message('Não foi possível verificar a disponibilidade. Recarregue a página ou utilize o contato alternativo.',true);}
  }
  initialize();
})();
