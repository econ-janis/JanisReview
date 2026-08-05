-- Ejecutar una vez contra la base de Vercel Postgres antes del primer
-- deploy (Vercel dashboard -> Storage -> tu DB -> Query, o vía `vercel env
-- pull` + psql/cliente de tu preferencia).

CREATE TABLE IF NOT EXISTS audit_results (
  client_id      TEXT NOT NULL,
  capability_id  TEXT NOT NULL,
  audited_at     TIMESTAMPTZ NOT NULL,
  nombre         TEXT,
  modulo         TEXT,
  endpoint       TEXT,
  severidad      TEXT,
  valor_actual   JSONB,
  esperado       JSONB,
  ok             BOOLEAN NOT NULL,
  error          TEXT,
  PRIMARY KEY (client_id, capability_id, audited_at)
);

-- Acelera tanto "histórico por cliente y capacidad" como el DISTINCT ON
-- de "última por capacidad" que usa lib/db.js.
CREATE INDEX IF NOT EXISTS idx_audit_results_client_capability_date
  ON audit_results (client_id, capability_id, audited_at DESC);

COMMENT ON TABLE audit_results IS
  'Resultados de auditoría de capacidades de configuración de clientes reales de Janis. Acceso restringido a personal interno autorizado — nunca público.';
