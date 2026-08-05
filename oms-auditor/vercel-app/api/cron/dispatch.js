'use strict';

/**
 * GET /api/cron/dispatch — disparado por Vercel Cron (ver vercel.json,
 * 1x/día en horario de bajo tráfico). Equivalente a DispatcherFunction en
 * la variante AWS.
 *
 * PENDIENTE (igual que en la variante AWS): no hay endpoint confirmado de
 * commerce/accounts para el maestro de clientes activos. Se lee de la env
 * var ACTIVE_CLIENTS (CSV) hasta que se confirme una fuente automática —
 * nunca hardcodeada en código ni en el repo.
 *
 * Protegido por CRON_SECRET (Vercel lo manda automáticamente como
 * `Authorization: Bearer` si la env var está configurada en el proyecto).
 *
 * Límite de tiempo de ejecución de Vercel: si la lista de clientes activos
 * crece mucho, este endpoint puede no alcanzar a auditarlos a todos dentro
 * del timeout de la función (ver docs/DEPLOYMENT_PLAN_VERCEL.md). Con pocos
 * clientes (<~20) y capacidades livianas como las de este spec, no debería
 * ser un problema; si crece, hay que migrar a una cola (ej. Vercel/Upstash
 * QStash) en vez de auditar todo en una sola invocación.
 */

const { requireCronSecret } = require('../../lib/auth');
const { auditClient } = require('../../lib/audit');
const { pruneOldResults } = require('../../lib/db');

const CONCURRENCY = 4;

function getActiveClientIds() {
  const raw = process.env.ACTIVE_CLIENTS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runOne() {
    while (next < items.length) {
      const index = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index]).catch((err) => ({ error: err.message }));
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

module.exports = async (req, res) => {
  try {
    requireCronSecret(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ message: err.message });
    return;
  }

  const clientIds = getActiveClientIds();

  if (clientIds.length === 0) {
    res.status(200).json({
      dispatched: 0,
      warning: 'ACTIVE_CLIENTS está vacío o sin configurar todavía; no se auditó ningún cliente.',
    });
    return;
  }

  const results = await runWithConcurrency(clientIds, CONCURRENCY, (clientId) => auditClient(clientId));
  const prunedCount = await pruneOldResults();

  res.status(200).json({
    dispatched: clientIds.length,
    prunedCount,
    summary: clientIds.map((clientId, i) => ({
      clientId,
      ok: !results[i].error,
      error: results[i].error || null,
    })),
  });
};
