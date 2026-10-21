-- Additive: existing leads and history are not reclassified or deleted.
ALTER TABLE leads ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1));
CREATE TABLE measurement_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL,
 raw_retention_days INTEGER NOT NULL DEFAULT 30, aggregate_retention_days INTEGER NOT NULL DEFAULT 90
);
INSERT INTO measurement_settings(id,started_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE measurement_days (
 day TEXT PRIMARY KEY, accepted INTEGER NOT NULL DEFAULT 0, last_batch TEXT
);
CREATE TABLE measurement_events (
 id TEXT PRIMARY KEY, page_id TEXT NOT NULL, event TEXT NOT NULL,
 service TEXT, code TEXT, day TEXT NOT NULL, created_at TEXT NOT NULL,
 consent_version TEXT NOT NULL
);
CREATE INDEX measurement_event_date ON measurement_events(day,event);
CREATE INDEX measurement_page ON measurement_events(page_id);
CREATE TABLE measurement_totals (
 day TEXT NOT NULL, event TEXT NOT NULL, total INTEGER NOT NULL,
 PRIMARY KEY(day,event)
);
CREATE TRIGGER measurement_aggregate AFTER INSERT ON measurement_events BEGIN
 INSERT INTO measurement_totals(day,event,total) VALUES(NEW.day,NEW.event,1)
 ON CONFLICT(day,event) DO UPDATE SET total=total+1;
END;
CREATE TABLE operational_events (
 id TEXT PRIMARY KEY, operation TEXT NOT NULL, code TEXT NOT NULL,
 request_id TEXT, status INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX operational_date ON operational_events(created_at);
-- Separate nullable contact fields: do not rebuild the existing leads table or
-- fabricate email addresses to satisfy its historical NOT NULL constraint.
CREATE TABLE manual_contacts (
 id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
 name TEXT NOT NULL, company TEXT NOT NULL, email TEXT, phone TEXT,
 service_type TEXT NOT NULL, note TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'whatsapp',
 status TEXT NOT NULL DEFAULT 'novo', next_action TEXT NOT NULL, next_action_at TEXT NOT NULL,
 is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1)), version INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE manual_contact_events (
 id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES manual_contacts(id),
 previous_status TEXT, new_status TEXT NOT NULL, note TEXT NOT NULL,
 admin_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX manual_contact_history ON manual_contact_events(contact_id,created_at);
