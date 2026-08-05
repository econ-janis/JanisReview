'use strict';

/**
 * Prueba local del handler de auditoría sin desplegar a AWS.
 *
 * Requiere que el cliente exista como secret real en Secrets Manager
 * (janis/clients/{clientId}/app-credentials) y que tengas credenciales de
 * AWS configuradas localmente (aws sso login / aws configure) con permiso
 * de lectura sobre ese secret. También requiere AUDIT_RESULTS_TABLE_NAME
 * (una tabla DynamoDB ya desplegada) porque el handler persiste el
 * resultado además de devolverlo.
 *
 * Uso:
 *   CLIENT_ID=cliente-de-prueba-qa \
 *   AUDIT_RESULTS_TABLE_NAME=oms-capability-audit-results \
 *   JANIS_OMS_API_BASE_URL=https://oms.janisqa.in/api \
 *   node scripts/run-local-test.js
 */

const { handler } = require('../lambda/audit/index.js');

async function main() {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    console.error('Definí CLIENT_ID como variable de entorno');
    process.exit(1);
  }

  const result = await handler({ clientId });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Error corriendo la auditoría:', err);
  process.exit(1);
});
