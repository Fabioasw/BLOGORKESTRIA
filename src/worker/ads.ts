import type { Env } from './types.ts';
export const ADS_CONSENT_VERSION = '2026-10-16-ads-v1';
export function adsConfig(env: Env) {
  const label=env.GOOGLE_ADS_CONVERSION_LABEL?.trim() || '';
  return {
    tagId:'AW-18517368821', enabled:env.GOOGLE_ADS_ENABLED==='true',
    // Fail closed: only explicitly designated production may use the real transport.
    testMode:env.AUTOMATION_MODE!=='production',
    conversionLabel:/^[A-Za-z0-9_-]{1,100}$/.test(label)?label:null,
    consentVersion:ADS_CONSENT_VERSION,
  };
}
