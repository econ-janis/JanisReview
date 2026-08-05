'use strict';

/**
 * OMS Capability Auditor - Lambda de auditoría
 *
 * Flujo:
 *  1. Recibe { clientId } (invocación directa desde el dispatcher, o de prueba)
 *  2. Obtiene appKey/appSecret/janisClient del cliente desde Secrets Manager
 *  3. Carga capabilities/oms-capabilities.json (única fuente de verdad de
 *     "qué debería estar configurado")
 *  4. Para cada capacidad, llama al endpoint correspondiente (paginando si
 *     hace falta) y compara el valor real contra el esperado
 *  5. Persiste el resultado en DynamoDB y lo devuelve
 *
 * IMPORTANTE (seguridad / privacidad — no negociable):
 *  - Las credenciales del cliente se leen de Secrets Manager en runtime,
 *    nunca se loguean, nunca se devuelven en la respuesta ni se persisten.
 *  - El resultado de la auditoría es información de configuración de un
 *    cliente real: se persiste en DynamoDB con acceso restringido (ver
 *    template.yaml) y no debe exponerse fuera de canales internos.
 */

const capabilitiesSpec = require('../../capabilities/oms-capabilities.json');
const { getClientCredentials } = require('../shared/secrets');
const { extractActualValue, evaluateCapability, callJanisEndpointPaginated } = require('../shared/capability-engine');
const { saveAuditResults } = require('../shared/dynamo');

// Los 5 microservicios están CONFIRMADOS contra sus openapi reales (ver
// reference/). Lo que no se confirmó (commerce, catalog) no tiene
// capacidades en el spec todavía — ver capabilities/oms-capabilities.json.
const JANIS_API_BASE_URL_BY_MODULE = {
  oms: process.env.JANIS_OMS_API_BASE_URL || 'https://oms.janis.in/api',
  dom: process.env.JANIS_DOM_API_BASE_URL || 'https://dom.janis.in/api',
  delivery: process.env.JANIS_DELIVERY_API_BASE_URL || 'https://delivery.janis.in/api',
  picking: process.env.JANIS_PICKING_API_BASE_URL || 'https://picking.janis.in/api',
  tms: process.env.JANIS_TMS_API_BASE_URL || 'https://tms.janis.in/api',
};

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
      // Nunca incluir headers/credentials en el mensaje de error persistido.
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

exports.handler = async (event) => {
  const { clientId } = event;
  if (!clientId) {
    throw new Error('Falta clientId en el evento');
  }

  const auditResult = await auditClient(clientId);

  const tableName = process.env.AUDIT_RESULTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('Falta AUDIT_RESULTS_TABLE_NAME en el entorno del Lambda');
  }
  await saveAuditResults(tableName, clientId, auditResult.auditedAt, auditResult.results);

  return auditResult;
};

// Export para testing local / unitario
exports._internal = { auditClient };
