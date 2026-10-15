-- Restricted database role of the Evolution Engine (docs/trading/20-evolution-engine.md).
--
-- Prepared, not executed. Run once, after the evolution migration, as the
-- database owner inside the postgres container:
--
--   docker compose -p signalpilot -f docker-compose.prod.yml exec -T postgres \
--     sh -c 'psql -v ON_ERROR_STOP=1 -v evolution_password="$EVOLUTION_DB_PASSWORD" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < scripts/ops/evolution-db-role.sql
--
-- (EVOLUTION_DB_PASSWORD is passed to the exec environment by the operator,
-- never written into this file or into Git.)
--
-- The role can read and write the Evolution* tables and nothing else: no
-- portfolio, ledger, session, order, position, strategy, arena or user
-- table. It cannot delete research rows and can only append to the audit.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signalpilot_evolution') THEN
    CREATE ROLE signalpilot_evolution LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

ALTER ROLE signalpilot_evolution PASSWORD :'evolution_password';
ALTER ROLE signalpilot_evolution CONNECTION LIMIT 5;
ALTER ROLE signalpilot_evolution SET statement_timeout = '120s';
ALTER ROLE signalpilot_evolution SET idle_in_transaction_session_timeout = '60s';

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM signalpilot_evolution;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM signalpilot_evolution;
REVOKE CREATE ON SCHEMA public FROM signalpilot_evolution;
GRANT USAGE ON SCHEMA public TO signalpilot_evolution;

GRANT SELECT, INSERT, UPDATE ON
  "EvolutionAgentState",
  "EvolutionRun",
  "EvolutionAiCall",
  "EvolutionHypothesis",
  "EvolutionCandidate",
  "EvolutionBacktest",
  "EvolutionDataExposure"
TO signalpilot_evolution;

-- Append-only audit chain.
GRANT SELECT, INSERT ON "EvolutionAuditEvent" TO signalpilot_evolution;
