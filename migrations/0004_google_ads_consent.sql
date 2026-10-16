-- Incremental: existing leads/history unchanged; no retroactive conversions.
ALTER TABLE leads ADD COLUMN advertising_consent INTEGER NOT NULL DEFAULT 0 CHECK (advertising_consent IN (0,1));
ALTER TABLE leads ADD COLUMN advertising_consent_version TEXT;
ALTER TABLE leads ADD COLUMN ads_conversion_id TEXT;
CREATE UNIQUE INDEX leads_ads_conversion_id ON leads(ads_conversion_id) WHERE ads_conversion_id IS NOT NULL;
