(() => {
  'use strict';
  if (window.OrkestriaAds) return;
  const VERSION = '2026-10-16-ads-v1', KEY = 'orkestria-advertising-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const AGE = 180 * 86400000;
  let choice, config, loading, initialized = false, realLoaded = false;
  const sent = new Set();
  try { choice = JSON.parse(localStorage.getItem(KEY)); } catch { /* Optional storage. */ }
  const granted = () => choice?.version === VERSION && choice.granted === true &&
    Number.isFinite(choice.at) && choice.at <= Date.now() && Date.now() - choice.at < AGE;
  function diagnostic(event) {
    // No lead fields or IDs in preview diagnostics.
    window.dispatchEvent(new CustomEvent('orkestria:ads-preview', { detail: { event } }));
  }
  function command() { window.dataLayer.push(arguments); }
  function cleanAddress() {
    // Do not expose free-form URL parameters/referrers to the advertising SDK.
    const url = new URL(location.href), click = url.searchParams.get('gclid');
    url.search = ''; url.hash = '';
    if (click && /^[A-Za-z0-9_-]{20,250}$/.test(click)) url.searchParams.set('gclid', click);
    history.replaceState(history.state, '', url.pathname + url.search);
  }
  async function load() {
    if (!granted() || !config?.enabled || config.tagId !== 'AW-18517368821' || config.consentVersion !== VERSION) return false;
    if (initialized) return true;
    if (loading) return loading;
    if (config.testMode !== false) { initialized = true; diagnostic('tag_simulated'); return true; }
    loading = (async () => {
      // Never install alongside an existing Google/GTM integration.
      if (document.querySelector('script[src*="googletagmanager.com/"]')) return false;
      cleanAddress();
      window.dataLayer = window.dataLayer || [];
      window.gtag = command;
      command('consent', 'default', { ad_storage:'denied', analytics_storage:'denied', ad_user_data:'denied', ad_personalization:'denied' });
      command('set', 'ads_data_redaction', true);
      command('set', 'url_passthrough', false);
      command('consent', 'update', { ad_storage:'granted', ad_user_data:'granted', ad_personalization:'denied', analytics_storage:'denied' });
      command('js', new Date());
      command('config', config.tagId, { page_location:'https://orkestriaplatform.com/totvs-rm', page_referrer:'', allow_ad_personalization_signals:false, allow_enhanced_conversions:false });
      const script = document.createElement('script');
      script.id = 'orkestria-google-tag'; script.async = true; script.referrerPolicy = 'no-referrer';
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.tagId;
      return await new Promise(resolve => {
        script.onload = () => { initialized = granted(); resolve(initialized); };
        script.onerror = () => { script.remove(); resolve(false); };
        realLoaded = true; document.head.append(script);
      });
    })();
    return loading;
  }
  function setConsent(value) {
    choice = { version:VERSION, granted:value === true, at:Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* Session choice only. */ }
    if (value === true) { void load().catch(() => {}); return; }
    try { sessionStorage.removeItem('orkestria-rm-campaign'); localStorage.removeItem('orkestria-measurement'); } catch { /* Optional. */ }
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.trim().split('=')[0];
      if (!/^_gcl_/.test(name)) continue;
      document.cookie = name + '=; Max-Age=0; Path=/';
      const parts = location.hostname.split('.');
      for (let i=0;i<parts.length-1;i++) document.cookie = name + '=; Max-Age=0; Path=/; Domain=.' + parts.slice(i).join('.');
    }
    if (realLoaded) {
      command('consent', 'update', { ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied', analytics_storage:'denied' });
      // Unloading is necessary to stop a previously loaded SDK, including timers.
      location.reload();
    }
    window.dispatchEvent(new CustomEvent('orkestria:ads-consent'));
  }
  async function acceptLead(response, result) {
    const id = result?.data?.conversionId;
    if (!response.ok || ![200,201].includes(response.status) || result?.ok !== true ||
        !UUID.test(result?.data?.id || '') || !UUID.test(id || '') || !granted() ||
        !config?.enabled || !/^[A-Za-z0-9_-]{1,100}$/.test(config.conversionLabel || '')) return false;
    if (!(await load()) || !granted()) return false;
    const deliver = () => {
      if (!granted() || sent.has(id)) return false;
      const key = 'orkestria-ads-sent-v1:' + id;
      // Fail closed if persistent deduplication is unavailable; the lead is safe.
      try {
        if (localStorage.getItem(key)) return false;
        localStorage.setItem(key, '1');
        if (localStorage.getItem(key) !== '1') return false;
      } catch { return false; }
      sent.add(id);
      if (config.testMode !== false) diagnostic('conversion_simulated');
      else command('event', 'conversion', {
        send_to:config.tagId + '/' + config.conversionLabel, transaction_id:id,
        page_location:'https://orkestriaplatform.com/totvs-rm', page_referrer:'',
      });
      return true;
    };
    if (navigator.locks) return navigator.locks.request('orkestria-ads-' + id, deliver);
    return deliver(); // Google also deduplicates the stable transaction_id across tabs.
  }
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    try { choice = JSON.parse(event.newValue); } catch { choice = null; }
    if (!granted() && realLoaded) location.reload();
    window.dispatchEvent(new CustomEvent('orkestria:ads-consent'));
  });
  window.OrkestriaAds = Object.freeze({
    version:VERSION, granted, setConsent, acceptLead,
    configure(value) {
      if (config) return;
      config = Object.freeze({ enabled:value?.enabled === true, testMode:value?.testMode !== false,
        tagId:value?.tagId, conversionLabel:value?.conversionLabel, consentVersion:value?.consentVersion });
      void load().catch(() => {});
    },
  });
})();
