export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMIT_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  RETENTION_DAYS?: string;
  PRIVACY_NOTICE_VERSION?: string;
}
export interface AdminIdentity { id: string; email: string }
export interface LeadRow {
  id: string; name: string; email: string; company: string; job_title: string;
  service_type: string; description: string; status: string; source: string;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  utm_content: string | null; utm_term: string | null; gclid: string | null;
  landing_page: string; privacy_notice_version: string; marketing_consent: number;
  created_at: string; updated_at: string; version: number;
}
