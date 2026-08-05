'use strict';

const capabilitiesSpec = require('../capabilities/oms-capabilities.json');
const { getClientCredentials } = require('./secrets');
const { extractActualValue, evaluateCapability, callJanisEndpointPaginated } = require('./capability-engine');
const { saveAuditResults } = require('./db');

const JANIS_API_BASE_URL_BY_MODULE = {
  oms: process.env.JANIS_OMS_API_BASE_URL || 'https://oms.janis.in/api',
  dom: process.env.JANIS_DOM_API_BASE_URL || 'https://dom.janis.in/api',
  delivery: process.env.JANIS_DELIVERY_API_BASE_URL || 'https://delivery.janis.in/api',
  picking: process.env.JANIS_PICKING_API_BASE_URL || 'https://picking.janis.in/api',
  tms: process.env.JANIS_TMS_API_BASE_URL || 'https://tms.janis.in/api',
};

/**
 * Misma lógica que lambda/audit/index.js (variante AWS): evalúa las 10
 * capacidades del spec para un clientId y persiste el resultado. Acá el
 * "persiste" va a Postgres en vez de DynamoDB (ver lib/db.js).
 */
async function auditClient(clientId) {
  const credentials = await getClientCredentials(clientId);
  const results = [];

  for (const capability of capabilitiesSpec.capabilities) {
    let actualValue = null;
    let ok = false;
    let error = null;

    try {
      const data = await callJanisEndpointPaginated(
        capability.endpoint,
        capability.modulo_real,
        credentials,
        { baseUrlByModule: JANIS_API_BASE_URL_BY_MODULE }
      );
      actualValue = extractActualValue(
        data,
        capability.extract || { type: 'field', field: capability.expected.field }
      );
      ok = evaluateCapability(actualValue, capability.expected);
    } catch (err) {
      error = err.message;
    }

    results.push({
      id: capability.id,
      nombre: capability.name,
      modulo: capability.modulo_real,
      endpoint: `${capability.endpoint.method} ${capability.endpoint.path}`,
      severidad: capability.severidad,
      esperado: capability.expected.value,
      actual: actualValue,
      ok,
      error,
    });
  }

  const auditedAt = new Date().toISOString();
  await saveAuditResults(clientId, auditedAt, results);

  return {
    clientId,
    module: capabilitiesSpec.module,
    auditedAt,
    results,
    resumen: {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      pendientes: results.filter((r) => !r.ok).length,
    },
  };
}

module.exports = { auditClient };
