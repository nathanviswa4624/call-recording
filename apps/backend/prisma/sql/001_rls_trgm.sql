-- Applied after `prisma migrate deploy` by scripts/apply-sql.mjs (idempotent).
-- docs/02 §1 (RLS), §5 (indexes), docs/08 §7 (append-only audit).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Partial-number search on caller/destination.
CREATE INDEX IF NOT EXISTS calls_caller_trgm ON app.calls USING gin (caller_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS calls_destination_trgm ON app.calls USING gin (destination_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS calls_start_brin ON app.calls USING brin (start_time);
CREATE INDEX IF NOT EXISTS cdr_calldate_brin ON app.cdr_records USING brin (calldate);

-- Row-Level Security on tenant tables. The backend sets app.org_id per transaction
-- (SET LOCAL via set_config(..., true)); when it is not set (system jobs running
-- as the owner role) policies are bypassed only for the table owner.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sites','users','pbxs','sip_trunks','sip_transports','sip_endpoints','sip_aors','sip_auths','sip_identifies',
    'sip_registrations','sip_domain_aliases','sip_globals','routes','route_patterns','call_types','classification_rules',
    'recording_policies','dialplan_contexts','extensions_dir','cdr_records','cel_records','calls','recordings',
    'storage_locations','retention_policies','retention_runs','configuration_versions','backups','asterisk_servers'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE: echelons_app owns the tables (it runs migrations); owners are exempt without it.
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON app.%I
      USING (current_setting('app.org_id', true) IS NULL OR current_setting('app.org_id', true) = ''
             OR organization_id = current_setting('app.org_id', true)::uuid)
      WITH CHECK (current_setting('app.org_id', true) IS NULL OR current_setting('app.org_id', true) = ''
             OR organization_id = current_setting('app.org_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- Append-only audit log.
CREATE OR REPLACE FUNCTION app.audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_logs_no_update ON app.audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON app.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.audit_logs_immutable();
