'use strict';

/**
 * Test de integración contra QA — NO se ejecuta con `npm test` (usar
 * `npm run test:integration:qa`), y se salta automáticamente si no está
 * configurado, para que nadie lo dispare por accidente contra un ambiente
 * real sin querer.
 *
 * Requiere:
 *  - Credenciales de AWS configuradas localmente (aws sso login / aws
 *    configure) con permiso de lectura sobre
 *    janis/clients/{QA_CLIENT_ID}/app-credentials en Secrets Manager.
 *  - Un secret real de un cliente de prueba en QA (nunca un cliente
 *    productivo real).
 *
 * Uso:
 *   QA_CLIENT_ID=cliente-de-prueba-qa \
 *   JANIS_OMS_API_BASE_URL=https://oms.janisqa.in/api \
 *   JANIS_DOM_API_BASE_URL=https://dom.janisqa.in/api \
 *   JANIS_DELIVERY_API_BASE_URL=https://delivery.janisqa.in/api \
 *   JANIS_PICKING_API_BASE_URL=https://picking.janisqa.in/api \
 *   JANIS_TMS_API_BASE_URL=https://tms.janisqa.in/api \
 *   npm run test:integration:qa
 *
 * IMPORTANTE: correr esto (y validarlo) contra QA es un prerrequisito
 * explícito del encargo antes de habilitar la auditoría contra prod.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const QA_CLIENT_ID = process.env.QA_CLIENT_ID;

test('auditClient contra un cliente real de QA devuelve las 10 capacidades evaluadas', { skip: !QA_CLIENT_ID }, async () => {
  // AUDIT_RESULTS_TABLE_NAME no se define a propósito: si el entorno no la
  // tiene configurada, el handler completo (exports.handler) fallaría al
  // intentar persistir — para este test de integración solo queremos
  // ejercitar la evaluación contra QA, no la escritura en DynamoDB, así que
  // llamamos directamente a auditClient vía _internal.
  const { _internal } = require('../../lambda/audit/index.js');

  const result = await _internal.auditClient(QA_CLIENT_ID);

  assert.equal(result.clientId, QA_CLIENT_ID);
  assert.equal(result.results.length, 10, 'deben evaluarse las 10 capacidades del spec');

  for (const capability of result.results) {
    assert.equal(typeof capability.ok, 'boolean', `capacidad ${capability.id} debe resolver a ok=true/false`);
    // Un error de llamada (ej. 403 por permisos) es una señal real a
    // investigar, no algo que el test deba tragarse en silencio.
    if (capability.error) {
      console.warn(`[qa-integration] ${capability.id} devolvió error: ${capability.error}`);
    }
  }

  // No debe haber quedado ninguna referencia a credenciales en el resultado.
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /appKey|appSecret|janisClient/);
});
