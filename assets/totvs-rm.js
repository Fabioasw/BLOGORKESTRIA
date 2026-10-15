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
  let consent = store.get('localStorage', 'orkestria-measurement') === 'granted';
  let campaign = {};
  let busy = false, complete = false, available = false, token = '', widgetId;
  let requestId = crypto.randomUUID(), lastPayload = null;
  let began = false;
  const emitted = new Set();

  function track(event, parameters = {}, once = false) {
    if (!consent || (once && emitted.has(event))) return;
    if (once) emitted.add(event);
    // Integration point for a future consent-configured GTM container. No tags are installed.
    window.dataLayer = window.dataLayer || [];
    const detail = { event, page_path: '/totvs-rm', page_location: 'https://orkestriaplatform.com/totvs-rm', ...parameters };
    window.dataLayer.push(detail);
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
      ? 'Medição opcional permitida. Você pode revogar a escolha a qualquer momento; isso não altera sua solicitação.'
      : 'A medição opcional está desativada. Você pode permitir eventos de navegação e atribuição de campanhas. O formulário funciona independentemente dessa escolha.';
  }
  document.getElementById('consent-accept').addEventListener('click', () => {
    consent = true;
    store.set('localStorage', 'orkestria-measurement', 'granted');
    captureCampaign(); showConsent();
    track('page_view', {}, true); track('view_totvs_rm', {}, true);
  });
  document.getElementById('consent-reject').addEventListener('click', () => {
    consent = false; campaign = {};
    store.set('localStorage', 'orkestria-measurement', 'denied');
    store.remove('sessionStorage', 'orkestria-rm-campaign');
    showConsent();
  });
  captureCampaign(); showConsent();
  track('page_view', {}, true); track('view_totvs_rm', {}, true);
  form.addEventListener('focusin', () => { if (!began) { began = true; track('begin_lead_form', {}, true); } });
  document.querySelectorAll('[data-service]').forEach(link => link.addEventListener('click', () => {
    if (!complete && !busy) form.elements.necessidade.value = link.dataset.service;
    track('select_service', { service: link.dataset.service });
  }));

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
  }
  function updateSubmit() { submit.disabled = !available || !token || busy || complete; }
  function resetChallenge() {
    token = '';
    if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    updateSubmit();
  }
  function clearErrors() {
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach(error => { error.textContent = ''; });
  }
  function fieldErrors(fields) {
    for (const [name, error] of Object.entries(fields || {})) {
      const input = form.elements.namedItem(name);
      const hint = document.getElementById(`${name}-error`);
      if (input && hint && typeof error === 'string') { input.setAttribute('aria-invalid', 'true'); hint.textContent = error; }
    }
    form.querySelector('[aria-invalid=true]')?.focus();
  }
  form.addEventListener('input', event => {
    const input = event.target;
    input.removeAttribute('aria-invalid');
    const hint = document.getElementById(`${input.name}-error`);
    if (hint) hint.textContent = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || complete || !available) return;
    if (!form.reportValidity()) return;
    if (!token) { message('Conclua a verificação de segurança.', true); return; }
    clearErrors();
    const values = Object.fromEntries(new FormData(form));
    const payload = Object.fromEntries(['nome', 'email', 'empresa', 'cargo', 'necessidade', 'descricao', 'website'].map(key => [key, String(values[key] || '').trim()]));
    payload.campaign = consent ? campaign : {};
    const snapshot = JSON.stringify(payload);
    if (lastPayload !== null && lastPayload !== snapshot) requestId = crypto.randomUUID();
    lastPayload = snapshot;
    busy = true; updateSubmit(); form.setAttribute('aria-busy', 'true');
    submit.textContent = 'Enviando solicitação…'; message('Registrando sua solicitação com segurança…');
    try {
      const response = await fetch('/api/leads/totvs-rm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, token, requestId }), signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true) {
        fieldErrors(body.fields);
        message(body.error || 'Não foi possível registrar. Tente novamente.', true);
        resetChallenge();
        return;
      }
      complete = true;
      track('generate_lead', {}, true);
      form.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = true; });
      message('Solicitação registrada. Nossa equipe poderá entrar em contato pelo e-mail informado.');
      status.tabIndex = -1; status.focus();
    } catch {
      message('Não conseguimos confirmar o recebimento. Verifique a conexão e tente novamente; uma repetição do mesmo envio não duplica o registro.', true);
      resetChallenge();
    } finally {
      busy = false; form.removeAttribute('aria-busy');
      submit.textContent = complete ? 'Solicitação registrada ✓' : 'Solicitar avaliação do projeto ↗';
      updateSubmit();
    }
  });

  async function initialize() {
    try {
      const response = await fetch('/api/leads/config', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('config');
      const config = await response.json();
      if (!config.available || !config.siteKey) {
        message('A captação pelo formulário ainda não está disponível. Tente novamente mais tarde.', true);
        return;
      }
      window.orkestriaTurnstileReady = () => {
        widgetId = window.turnstile.render('#turnstile-widget', {
          sitekey: config.siteKey, action: 'totvs_rm_lead', theme: 'dark', size: window.matchMedia('(max-width: 520px)').matches ? 'compact' : 'flexible',
          callback(value) { token = value; if (status.dataset.error !== 'true') message('Formulário pronto para envio.'); updateSubmit(); },
          'expired-callback'() { token = ''; message('A verificação expirou. Conclua-a novamente.', true); updateSubmit(); },
          'error-callback'() { token = ''; message('A verificação não carregou. Verifique a conexão e recarregue a página.', true); updateSubmit(); },
        });
        available = true; updateSubmit();
      };
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=orkestriaTurnstileReady&render=explicit';
      script.async = true;
      script.onerror = () => message('Não foi possível carregar a proteção. Verifique a conexão e recarregue a página.', true);
      document.head.append(script);
      message('Conclua a verificação de segurança para enviar.');
    } catch { message('Não foi possível verificar a disponibilidade. Recarregue a página para tentar novamente.', true); }
  }
  initialize();
})();
