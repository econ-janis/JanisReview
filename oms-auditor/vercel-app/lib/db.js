'use strict';

/**
 * Capa de persistencia — Postgres vía Neon (la integración de base de
 * datos recomendada hoy por Vercel Marketplace; @vercel/postgres está
 * deprecado). Reemplaza la tabla DynamoDB de la variante AWS. Mismo modelo
 * conceptual: histórico por cliente y por capacidad, + lectura de "la
 * última por capacidad" para el endpoint de consulta.
 *
 * Requiere la env var DATABASE_URL (o POSTGRES_URL, según cómo la
 * integración de Neon la haya nombrado al vincular el proyecto). Ver
 * sql/schema.sql para crear la tabla antes del primer deploy.
 */

const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('Falta DATABASE_URL (o POSTGRES_URL) en el entorno');
}
// fullResults:true para tener { rows, rowCount } (igual forma que usaba
// @vercel/postgres) en vez del array de filas "pelado" que devuelve neon()
// por default.
const sql = neon(connectionString, { fullResults: true });

const RETENTION_DAYS = Number(process.env.AUDIT_RESULTS_RETENTION_DAYS || 180);

/**
 * Persiste un item por capacidad auditada. No usa transacción explícita:
 * cada INSERT es independiente y el conjunto es idempotente por
 * (client_id, capability_id, audited_at).
 *
 * IMPORTANTE: nunca persistir acá appKey/appSecret/janisClient — solo el
 * resultado de configuración evaluado.
 */
async function saveAuditResults(clientId, auditedAt, results) {
  for (const r of results) {
    // eslint-disable-next-line no-await-in-loop
    await sql`
      INSERT INTO audit_results (
        client_id, capability_id, audited_at, nombre, modulo, endpoint,
        severidad, valor_actual, esperado, ok, error
      ) VALUES (
        ${clientId}, ${r.id}, ${auditedAt}, ${r.nombre}, ${r.modulo}, ${r.endpoint},
        ${r.severidad}, ${JSON.stringify(r.actual)}, ${JSON.stringify(r.esperado)},
        ${r.ok}, ${r.error || null}
      )
      ON CONFLICT (client_id, capability_id, audited_at) DO NOTHING
    `;
  }
}

/**
 * Trae la última auditoría de cada capacidad para un cliente, usando
 * DISTINCT ON (nativo de Postgres) en vez de traer todo el histórico y
 * reducir en memoria como hacía la variante DynamoDB.
 */
async function getLatestResultsByClient(clientId) {
  const { rows } = await sql`
    SELECT DISTINCT ON (capability_id)
      client_id, capability_id, audited_at, nombre, modulo, endpoint,
      severidad, valor_actual, esperado, ok, error
    FROM audit_results
    WHERE client_id = ${clientId}
    ORDER BY capability_id, audited_at DESC
  `;
  return rows;
}

/**
 * Borra auditorías más viejas que la retención configurada. Se llama desde
 * el cron diario (no hay TTL nativo como en DynamoDB) — minimización de
 * datos: no retener configuración de clientes indefinidamente.
 */
async function pruneOldResults() {
  const { rowCount } = await sql`
    DELETE FROM audit_results
    WHERE audited_at < NOW() - make_interval(days => ${RETENTION_DAYS})
  `;
  return rowCount;
}

module.exports = { saveAuditResults, getLatestResultsByClient, pruneOldResults };
