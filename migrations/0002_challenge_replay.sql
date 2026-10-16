-- Store only SHA-256 fingerprints, never raw Turnstile tokens.
CREATE TABLE used_challenges (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX used_challenges_expiration ON used_challenges(expires_at);
