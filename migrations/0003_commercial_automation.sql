-- Additive CRM migration. Existing leads, events and trigger are preserved.
ALTER TABLE leads ADD COLUMN last_contact_at TEXT;
ALTER TABLE leads ADD COLUMN next_action TEXT CHECK(next_action IS NULL OR length(next_action) <= 500);
ALTER TABLE leads ADD COLUMN next_action_at TEXT;
ALTER TABLE leads ADD COLUMN followup_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN archived_at TEXT;
CREATE INDEX leads_next_action ON leads(next_action_at) WHERE archived_at IS NULL;
CREATE INDEX leads_last_contact ON leads(last_contact_at,created_at) WHERE archived_at IS NULL;

CREATE TABLE automation_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  notify_admin INTEGER NOT NULL DEFAULT 1 CHECK(notify_admin IN (0,1)),
  confirm_customer INTEGER NOT NULL DEFAULT 1 CHECK(confirm_customer IN (0,1)),
  followup_alerts INTEGER NOT NULL DEFAULT 1 CHECK(followup_alerts IN (0,1)),
  daily_summary INTEGER NOT NULL DEFAULT 1 CHECK(daily_summary IN (0,1)),
  daily_time TEXT NOT NULL DEFAULT '09:00',
  stale_days INTEGER NOT NULL DEFAULT 7 CHECK(stale_days BETWEEN 1 AND 365),
  version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO automation_settings(id) VALUES(1);

CREATE TABLE automation_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('new_lead_admin','lead_confirmation','followup','daily_summary')),
  recipient TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','accepted','failed','uncertain','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  locked_until INTEGER,
  lock_token TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  accepted_at TEXT
);
CREATE INDEX automation_due ON automation_outbox(status,available_at);
CREATE INDEX automation_lead ON automation_outbox(lead_id,created_at);
CREATE TABLE automation_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES automation_outbox(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  admin_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX automation_history ON automation_events(lead_id,created_at);
CREATE INDEX automation_job_history ON automation_events(job_id,created_at);
