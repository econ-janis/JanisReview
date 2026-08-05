'use strict';

/**
 * OMS Capability Auditor - Lambda de consulta
 *
 * GET /audit-results/{clientId}
 *
 * Lee de DynamoDB la última auditoría de cada capacidad para un cliente y
 * devuelve el JSON que consume el dashboard, en lenguaje de negocio
 * ("loUsa": true/false) — nunca "ok"/"pendiente", que es lenguaje interno.
 *
 * Este Lambda solo lee (dynamodb:Query) — nunca llama a los servicios de
 * Janis ni toca Secrets Manager. La ruta debe estar protegida por el
 * authorizer configurado en API Gateway (ver template.yaml); este código no
 * es responsable de autenticar, solo de no exponer nada que no deba.
 */

const { getLatestResultsByClient } = require('../shared/dynamo');

exports.handler = async (event) => {
  const clientId = event.pathParameters && event.pathParameters.clientId;

  if (!clientId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Falta clientId en el path' }),
    };
  }

  const tableName = process.env.AUDIT_RESULTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('Falta AUDIT_RESULTS_TABLE_NAME en el entorno del Lambda');
  }

  const latest = await getLatestResultsByClient(tableName, clientId);

  if (latest.length === 0) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `No hay auditorías registradas para el cliente ${clientId}` }),
    };
  }

  const resultados = latest
    .map((item) => ({
      id: item.capabilityId,
      nombre: item.nombre,
      modulo: item.modulo,
      endpoint: item.endpoint,
      valorActual: item.valorActual,
      loUsa: Boolean(item.ok),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const auditedAt = latest.reduce(
    (max, item) => (item.auditedAt > max ? item.auditedAt : max),
    latest[0].auditedAt
  );

  const body = {
    clientId,
    auditedAt,
    resumen: {
      total: resultados.length,
      loUsa: resultados.filter((r) => r.loUsa).length,
      noLoUsa: resultados.filter((r) => !r.loUsa).length,
    },
    resultados,
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // Nunca cachear en capas públicas/CDN: esta data es de configuración
      // de clientes reales y solo debe llegar a consumidores autorizados.
      'Cache-Control': 'private, no-store',
    },
    body: JSON.stringify(body),
  };
};
