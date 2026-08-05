'use strict';

/**
 * POST /api/audit/run
 * Body: { "clientId": "carrefour-brasil", "appKey": "...", "appSecret": "...", "janisClient": "..." }
 *
 * El usuario tipea las credenciales del cliente en el formulario del
 * dashboard (ver public/index.html) — no hay Secrets Manager ni ningún
 * otro almacenamiento de credenciales en esta variante. Se usan una sola
 * vez, en memoria, para llamar a oms/dom/delivery/picking/tms, y se
 * descartan al responder. Ni la credencial ni el resultado se persisten.
 *
 * Protegido por sesión de dashboard (cookie), igual que la lectura —
 * este endpoint también hace requests reales a producción de Janis con
 * lo que el usuario mande, así que no puede quedar público.
 */

const { requireDashboardSession } = require('../../lib/auth');
const { auditClient } = require('../../lib/audit');

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    requireDashboardSession(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ message: err.message });
    return;
  }

  const { clientId, appKey, appSecret, janisClient } = req.body || {};

  if (isBlank(clientId) || isBlank(appKey) || isBlank(appSecret) || isBlank(janisClient)) {
    res.status(400).json({ message: 'Faltan campos: clientId, appKey, appSecret y janisClient son requeridos' });
    return;
  }

  try {
    const result = await auditClient(clientId, { appKey, appSecret, janisClient });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json(result);
  } catch (err) {
    // Nunca reflejar la credencial en el mensaje de error.
    res.status(500).json({ message: `Error auditando ${clientId}: ${err.message}` });
  }
};
