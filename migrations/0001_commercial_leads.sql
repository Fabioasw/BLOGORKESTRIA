PRAGMA foreign_keys = ON;

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 5 AND 254),
  company TEXT NOT NULL CHECK(length(company) BETWEEN 2 AND 160),
  job_title TEXT NOT NULL CHECK(length(job_title) BETWEEN 2 AND 120),
  service_type TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(description) BETWEEN 20 AND 4000),
  status TEXT NOT NULL DEFAULT 'novo' CHECK(status IN ('novo','em_analise','qualificado','reuniao_agendada','proposta_enviada','convertido','descartado')),
  source TEXT NOT NULL DEFAULT 'totvs-rm',
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, gclid TEXT,
  landing_page TEXT NOT NULL DEFAULT '/totvs-rm',
  privacy_notice_version TEXT NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK(marketing_consent IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version INTEGER NOT NULL DEFAULT 0,
  last_mutation_id TEXT
);
CREATE INDEX leads_created_at ON leads(created_at DESC);
CREATE INDEX leads_status_created ON leads(status, created_at DESC);
CREATE INDEX leads_company ON leads(company COLLATE NOCASE);
CREATE INDEX leads_campaign ON leads(utm_source, utm_campaign, created_at DESC);
CREATE INDEX leads_retention ON leads(updated_at);

CREATE TABLE lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('created','status_changed','note')),
  previous_status TEXT,
  new_status TEXT,
  note TEXT CHECK(note IS NULL OR length(note) <= 2000),
  admin_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX lead_events_history ON lead_events(lead_id, created_at, id);
CREATE TRIGGER lead_created AFTER INSERT ON leads
BEGIN
  INSERT INTO lead_events(id, lead_id, event_type, new_status)
  VALUES (lower(hex(randomblob(16))), NEW.id, 'created', NEW.status);
END;

CREATE TABLE request_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX request_limits_expiration ON request_limits(expires_at);
