CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  empresa TEXT NOT NULL,
  cargo TEXT NOT NULL,
  necessidade TEXT NOT NULL,
  descricao TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'totvs-rm',
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, gclid TEXT,
  fingerprint TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_contato', 'encerrado')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_status_data ON leads(status, criado_em);
CREATE TRIGGER IF NOT EXISTS leads_updated AFTER UPDATE ON leads
WHEN NEW.atualizado_em = OLD.atualizado_em
BEGIN
  UPDATE leads SET atualizado_em = datetime('now') WHERE id = NEW.id;
END;
CREATE TABLE IF NOT EXISTS lead_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_rate_expiry ON lead_rate_limits(expires_at);
