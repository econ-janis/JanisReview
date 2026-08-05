'use strict';

/**
 * GET /api/audit-results/:clientId
 *
 * Equivalente a QueryFunction en la variante AWS. Devuelve el JSON que
 * consume el dashboard en lenguaje de negocio ("loUsa"/"noLoUsa").
 *
 * Auth: sesión de dashboard (cookie) O x-internal-key (para scripts/tests
 * internos) — nunca sin ninguna de las dos. Ver lib/auth.js sobre por qué
 * esto es defensa en profundidad y no el control principal (Deployment
 * Protection de Vercel lo es).
 */

const { requireDashboardSession, requireInternalKey } = require('../../lib/auth');
const { getLatestResultsByClient } = require('../../lib/db');

function isAuthorized(req) {
  try {
    requireDashboardSession(req);
    return true;
  } catch (_sessionErr) {
    try {
      requireInternalKey(req);
      return true;
    } catch (_keyErr) {
      return false;
    }
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ message: 'No autenticado' });
    return;
  }

  const { clientId } = req.query;
  if (!clientId) {
    res.status(400).json({ message: 'Falta clientId en el path' });
    return;
  }

  const latest = await getLatestResultsByClient(clientId);

  if (latest.length === 0) {
    res.status(404).json({ message: `No hay auditorías registradas para el cliente ${clientId}` });
    return;
  }

  const resultados = latest
    .map((item) => ({
      id: item.capability_id,
      nombre: item.nombre,
      modulo: item.modulo,
      endpoint: item.endpoint,
      valorActual: item.valor_actual,
      loUsa: Boolean(item.ok),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const auditedAt = latest.reduce(
    (max, item) => (item.audited_at > max ? item.audited_at : max),
    latest[0].audited_at
  );

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    clientId,
    auditedAt,
    resumen: {
      total: resultados.length,
      loUsa: resultados.filter((r) => r.loUsa).length,
      noLoUsa: resultados.filter((r) => !r.loUsa).length,
    },
    resultados,
  });
};
