'use strict';

/**
 * POST /api/audit/run
 * Body: { "clientId": "carrefour-brasil" }
 *
 * Equivalente a AuditFunction en la variante AWS. Solo se invoca
 * server-to-server (desde /api/cron/dispatch, o manualmente por un
 * operador con la key interna) — nunca expuesto para invocación pública.
 * Protegido con x-internal-key (ver lib/auth.js).
 */

const { requireInternalKey } = require('../../lib/auth');
const { auditClient } = require('../../lib/audit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    requireInternalKey(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ message: err.message });
    return;
  }

  const { clientId } = req.body || {};
  if (!clientId) {
    res.status(400).json({ message: 'Falta clientId en el body' });
    return;
  }

  try {
    const result = await auditClient(clientId);
    res.status(200).json(result);
  } catch (err) {
    // Nunca reflejar detalles de credenciales en el error de respuesta.
    res.status(500).json({ message: `Error auditando ${clientId}: ${err.message}` });
  }
};
