'use strict';

const capabilitiesSpec = require('../capabilities/oms-capabilities.json');
const { extractActualValue, evaluateCapability, callJanisEndpointPaginated } = require('./capability-engine');

const DEFAULT_BASE_URLS = {
  oms: process.env.JANIS_OMS_API_BASE_URL || 'https://oms.janis.in/api',
  dom: process.env.JANIS_DOM_API_BASE_URL || 'https://dom.janis.in/api',
  delivery: process.env.JANIS_DELIVERY_API_BASE_URL || 'https://delivery.janis.in/api',
  picking: process.env.JANIS_PICKING_API_BASE_URL || 'https://picking.janis.in/api',
  tms: process.env.JANIS_TMS_API_BASE_URL || 'https://tms.janis.in/api',
};

/**
 * Corre la auditoría de las 10 capacidades usando credenciales que el
 * usuario tipeó en el formulario del dashboard — NUNCA se leen de Secrets
 * Manager ni de ningún otro lugar, y NUNCA se persisten (ni las
 * credenciales ni el resultado): se usan una sola vez, en memoria, para
 * esta request, y se descartan al responder.
 *
 * `credentials` = { appKey, appSecret, janisClient } — validado por el
 * caller (ver api/audit/run.js) antes de llegar acá.
 */
async function auditClient(clientId, credentials, { baseUrlByModule = DEFAULT_BASE_URLS } = {}) {
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
        { baseUrlByModule }
      );
      actualValue = extractActualValue(
        data,
        capability.extract || { type: 'field', field: capability.expected.field }
      );
      ok = evaluateCapability(actualValue, capability.expected);
    } catch (err) {
      // El mensaje de callJanisEndpointPaginated nunca incluye headers ni
      // credenciales (ver capability-engine.js) — seguro de propagar tal cual.
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

  return {
    clientId,
    module: capabilitiesSpec.module,
    auditedAt: new Date().toISOString(),
    results,
    resumen: {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      pendientes: results.filter((r) => !r.ok).length,
    },
  };
}

module.exports = { auditClient };
