export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
  RATE_LIMIT_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  RETENTION_DAYS?: string;
  PRIVACY_NOTICE_VERSION?: string;
  AUTOMATION_MODE?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_CUSTOMER_CONFIRMATIONS?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_ADMIN_TO?: string;
  CRM_PUBLIC_ORIGIN?: string;
  EMAIL_TEST_RECIPIENTS?: string;
  EMAIL?: SendEmail;
}
export interface AdminIdentity { id: string; email: string }
export interface LeadRow {
  id: string; name: string; email: string; company: string; job_title: string;
  service_type: string; description: string; status: string; source: string;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  utm_content: string | null; utm_term: string | null; gclid: string | null;
  landing_page: string; privacy_notice_version: string; marketing_consent: number;
  created_at: string; updated_at: string; version: number;
  last_contact_at: string|null; next_action: string|null; next_action_at: string|null;
  followup_revision: number; archived_at: string|null;
}
