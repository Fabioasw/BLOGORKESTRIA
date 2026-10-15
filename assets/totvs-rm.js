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
  let opening = false;
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
    if (!opening) form.elements.necessidade.value = link.dataset.service;
    track('select_service', { service: link.dataset.service });
  }));

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
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
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (opening || !form.reportValidity()) return;
    clearErrors();
    const data = Object.fromEntries(new FormData(form));
    const fields = [
      ['nome', 'Nome', 2, 120], ['email', 'E-mail', 5, 254],
      ['empresa', 'Empresa', 2, 160], ['cargo', 'Cargo ou área', 2, 120],
      ['necessidade', 'Necessidade', 2, 80], ['descricao', 'Descrição', 20, 4000],
    ];
    let invalid = false;
    for (const [name, , min, max] of fields) {
      data[name] = String(data[name] || '').trim();
      if (data[name].length < min || data[name].length > max) {
        form.elements[name].setAttribute('aria-invalid', 'true');
        document.getElementById(`${name}-error`).textContent = `Use entre ${min} e ${max} caracteres.`;
        invalid = true;
      }
    }
    if (invalid) {
      form.querySelector('[aria-invalid=true]')?.focus();
      message('Revise os campos indicados antes de continuar.', true);
      return;
    }
    const lines = [
      'Olá, Orkestria. Quero solicitar uma avaliação de projeto TOTVS RM.', '',
      ...fields.map(([name, label]) => `${label}: ${data[name]}`),
    ];
    if (consent && Object.keys(campaign).length) {
      lines.push('', 'Origem da campanha:');
      for (const key of campaignKeys) if (campaign[key]) lines.push(`${key}: ${campaign[key]}`);
    }
    const url = `https://wa.me/5519971541730?text=${encodeURIComponent(lines.join('\n'))}`;
    const fallback = document.getElementById('whatsapp-fallback');
    fallback.href = url;
    fallback.hidden = false;
    opening = true;
    submit.disabled = true;
    track('open_whatsapp', {}, false);
    window.open(url, '_blank', 'noopener,noreferrer');
    message('Mensagem preparada. Confirme o envio no WhatsApp. Se a janela não abriu, use o link abaixo.');
    setTimeout(() => { opening = false; submit.disabled = false; }, 1500);
  });
  submit.disabled = false;
})();
