'use strict';

/**
 * Motor de evaluación de capacidades, compartido por el Lambda de auditoría
 * y por los tests unitarios. Aislado de AWS SDK / red para que sea 100%
 * testeable sin mocks pesados.
 *
 * Convención de paginación CONFIRMADA en los 5 openapi (reference/*.json):
 *   - request:  headers x-janis-page (default 1), x-janis-page-size (default 60)
 *   - response: header x-janis-total con el total de registros
 */

const DEFAULT_PAGE_SIZE = 60;

/**
 * Extrae el "actualValue" de la respuesta de Janis según el tipo de
 * extracción declarado en la capacidad. Distintos endpoints devuelven
 * objetos simples (settings) o listas (audit-rule, order-hook, etc.).
 */
function extractActualValue(data, extract) {
  if (!extract || !extract.type) {
    throw new Error('extract.type es requerido');
  }

  if (extract.type === 'field') {
    return data ? data[extract.field] : undefined;
  }

  const list = Array.isArray(data) ? data : (data && (data.items || data.results)) || [];

  if (extract.type === 'countArrayWhere') {
    return list.filter((item) => item[extract.field] === extract.equals).length;
  }

  if (extract.type === 'countArrayWhereNotNull') {
    return list.filter(
      (item) => item[extract.field] !== null && item[extract.field] !== undefined
    ).length;
  }

  throw new Error(`Tipo de extracción desconocido: ${extract.type}`);
}

/**
 * Evalúa si el valor real cumple lo esperado. Soporta:
 *  - igualdad directa
 *  - ">=N" (mínimo)
 *  - "not:valor" (cualquier cosa que no sea ese valor; "not:null" exige
 *    presencia, "not:" vacío exige no-vacío)
 */
function evaluateCapability(actualValue, expected) {
  if (!expected) {
    throw new Error('expected es requerido');
  }

  if (typeof expected.value === 'string' && expected.value.startsWith('>=')) {
    const threshold = Number(expected.value.slice(2));
    return Number(actualValue) >= threshold;
  }

  if (typeof expected.value === 'string' && expected.value.startsWith('not:')) {
    const forbidden = expected.value.slice(4);
    if (forbidden === 'null') {
      return actualValue !== null && actualValue !== undefined;
    }
    if (forbidden === '') {
      return actualValue !== null && actualValue !== undefined && actualValue !== '';
    }
    return actualValue !== forbidden;
  }

  return actualValue === expected.value;
}

/**
 * Llama a un endpoint de Janis paginando hasta traer todos los registros,
 * usando la convención confirmada x-janis-page / x-janis-page-size /
 * x-janis-total. Para endpoints que no devuelven una lista (ej. settings),
 * devuelve la respuesta tal cual en la primera página.
 *
 * fetchImpl se inyecta para poder testear sin red real.
 */
async function callJanisEndpointPaginated(
  { method, path },
  moduloReal,
  credentials,
  { baseUrlByModule, fetchImpl = fetch, pageSize = DEFAULT_PAGE_SIZE, maxPages = 50 } = {}
) {
  const baseUrl = baseUrlByModule[moduloReal];
  if (!baseUrl) {
    throw new Error(`No hay base URL configurada para el módulo '${moduloReal}'`);
  }

  const url = `${baseUrl}${path}`;
  const isListEndpoint = method === 'GET' && !path.includes('{');

  let page = 1;
  let aggregated = null;
  let total = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        'janis-api-key': credentials.appKey,
        'janis-api-secret': credentials.appSecret,
        'janis-client': credentials.janisClient,
        'Content-Type': 'application/json',
        ...(isListEndpoint
          ? { 'x-janis-page': String(page), 'x-janis-page-size': String(pageSize) }
          : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status} llamando a ${path}`);
    }

    const body = await response.json();

    if (!Array.isArray(body)) {
      // Endpoint no-lista (settings, get by id): no hay nada que paginar.
      return body;
    }

    aggregated = aggregated ? aggregated.concat(body) : body;

    const totalHeader = response.headers && response.headers.get
      ? response.headers.get('x-janis-total')
      : null;
    total = totalHeader !== null ? Number(totalHeader) : aggregated.length < pageSize ? aggregated.length : null;

    const gotFullPage = body.length === pageSize;
    const reachedTotal = total !== null && aggregated.length >= total;
    const reachedMaxPages = page >= maxPages;

    if (!gotFullPage || reachedTotal || reachedMaxPages) {
      break;
    }

    page += 1;
  }

  return aggregated;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  extractActualValue,
  evaluateCapability,
  callJanisEndpointPaginated,
};
