'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// auditClient usa capabilities/oms-capabilities.json real (10 capacidades) y
// llama a callJanisEndpointPaginated con fetch global — lo mockeamos acá
// para no pegarle a producción, y para confirmar que las credenciales
// pasadas nunca terminan en el resultado devuelto.
const { auditClient } = require('../lib/audit');

test('auditClient evalúa las 10 capacidades y nunca expone las credenciales en el resultado', async (t) => {
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    // Cualquier capacidad que espere lista o campo va a fallar su
    // evaluación con este body genérico — no nos importa el resultado
    // exacto de "ok", solo que el flujo completo corra sin explotar y sin
    // filtrar credenciales.
    json: async () => ({}),
  });

  const credentials = { appKey: 'clave-secreta', appSecret: 'secreto-secreto', janisClient: 'cliente-x' };
  const result = await auditClient('cliente-de-prueba', credentials);

  assert.equal(result.clientId, 'cliente-de-prueba');
  assert.equal(result.results.length, 10);
  assert.equal(typeof result.resumen.total, 'number');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /clave-secreta|secreto-secreto/);
});
