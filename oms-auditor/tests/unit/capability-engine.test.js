'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractActualValue,
  evaluateCapability,
  callJanisEndpointPaginated,
} = require('../../lambda/shared/capability-engine');

describe('extractActualValue', () => {
  test('type "field": lee un campo simple de un objeto (ej. settings)', () => {
    const data = { addressGeolocationBehaviour: 'mustBeComplete' };
    const value = extractActualValue(data, { type: 'field', field: 'addressGeolocationBehaviour' });
    assert.equal(value, 'mustBeComplete');
  });

  test('type "field": devuelve undefined si el campo no existe', () => {
    const value = extractActualValue({}, { type: 'field', field: 'googleMapsApiKey' });
    assert.equal(value, undefined);
  });

  test('type "countArrayWhere": cuenta elementos de un array plano que matchean equals', () => {
    const data = [{ status: 'active' }, { status: 'inactive' }, { status: 'active' }];
    const value = extractActualValue(data, { type: 'countArrayWhere', field: 'status', equals: 'active' });
    assert.equal(value, 2);
  });

  test('type "countArrayWhere": soporta respuesta envuelta en {items: [...]}', () => {
    const data = { items: [{ status: 'active' }, { status: 'active' }] };
    const value = extractActualValue(data, { type: 'countArrayWhere', field: 'status', equals: 'active' });
    assert.equal(value, 2);
  });

  test('type "countArrayWhere": soporta respuesta envuelta en {results: [...]}', () => {
    const data = { results: [{ allowSync: true }, { allowSync: false }, { allowSync: true }] };
    const value = extractActualValue(data, { type: 'countArrayWhere', field: 'allowSync', equals: true });
    assert.equal(value, 2);
  });

  test('type "countArrayWhere": devuelve 0 si no hay array reconocible', () => {
    const value = extractActualValue({ foo: 'bar' }, { type: 'countArrayWhere', field: 'status', equals: 'active' });
    assert.equal(value, 0);
  });

  test('type "countArrayWhereNotNull": cuenta elementos con el campo definido (no null/undefined)', () => {
    const data = [
      { maxQuantityOrders: 50 },
      { maxQuantityOrders: null },
      { maxQuantityOrders: undefined },
      { maxQuantityOrders: 0 },
    ];
    const value = extractActualValue(data, { type: 'countArrayWhereNotNull', field: 'maxQuantityOrders' });
    // 0 cuenta como "definido" (no es null/undefined) — solo null/undefined excluyen.
    assert.equal(value, 2);
  });

  test('tipo de extracción desconocido lanza error explícito', () => {
    assert.throws(
      () => extractActualValue([], { type: 'nope', field: 'x' }),
      /Tipo de extracción desconocido/
    );
  });
});

describe('evaluateCapability', () => {
  test('igualdad directa', () => {
    assert.equal(evaluateCapability('advanced', { value: 'advanced' }), true);
    assert.equal(evaluateCapability('basic', { value: 'advanced' }), false);
  });

  test('">=N": cumple con el mínimo exacto', () => {
    assert.equal(evaluateCapability(1, { value: '>=1' }), true);
    assert.equal(evaluateCapability(0, { value: '>=1' }), false);
    assert.equal(evaluateCapability(5, { value: '>=1' }), true);
  });

  test('"not:valor": cumple si el valor real es distinto del prohibido', () => {
    assert.equal(evaluateCapability('tryButDoNotFail', { value: 'not:mustBeComplete' }), true);
    assert.equal(evaluateCapability('mustBeComplete', { value: 'not:mustBeComplete' }), false);
  });

  test('"not:null": exige presencia del valor', () => {
    assert.equal(evaluateCapability('basic', { value: 'not:null' }), true);
    assert.equal(evaluateCapability(null, { value: 'not:null' }), false);
    assert.equal(evaluateCapability(undefined, { value: 'not:null' }), false);
  });

  test('"not:" vacío: exige no-vacío (ej. una API key configurada)', () => {
    assert.equal(evaluateCapability('AIzaSyABC123', { value: 'not:' }), true);
    assert.equal(evaluateCapability('', { value: 'not:' }), false);
    assert.equal(evaluateCapability(null, { value: 'not:' }), false);
    assert.equal(evaluateCapability(undefined, { value: 'not:' }), false);
  });
});

describe('callJanisEndpointPaginated', () => {
  function fakeFetch(pagesByPageNumber) {
    return async (url, options) => {
      const page = Number(options.headers['x-janis-page'] || 1);
      const body = pagesByPageNumber[page] || [];
      return {
        ok: true,
        headers: { get: (name) => (name === 'x-janis-total' ? String(pagesByPageNumber.total) : null) },
        json: async () => body,
      };
    };
  }

  test('junta todas las páginas hasta que la página no viene completa', async () => {
    const pageSize = 2;
    const pages = {
      1: [{ id: 'a' }, { id: 'b' }],
      2: [{ id: 'c' }],
      total: 3,
    };
    const result = await callJanisEndpointPaginated(
      { method: 'GET', path: '/audit-rule' },
      'oms',
      { appKey: 'k', appSecret: 's', janisClient: 'c' },
      { baseUrlByModule: { oms: 'https://oms.janis.in/api' }, fetchImpl: fakeFetch(pages), pageSize }
    );
    assert.deepEqual(result, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  test('endpoints que no son lista (settings) devuelven el objeto sin paginar', async () => {
    const fetchImpl = async () => ({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ addressGeolocationBehaviour: 'skip' }),
    });
    const result = await callJanisEndpointPaginated(
      { method: 'GET', path: '/setting/order' },
      'oms',
      { appKey: 'k', appSecret: 's', janisClient: 'c' },
      { baseUrlByModule: { oms: 'https://oms.janis.in/api' }, fetchImpl }
    );
    assert.deepEqual(result, { addressGeolocationBehaviour: 'skip' });
  });

  test('propaga el error si la respuesta no es ok', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403 });
    await assert.rejects(
      () =>
        callJanisEndpointPaginated(
          { method: 'GET', path: '/carrier' },
          'delivery',
          { appKey: 'k', appSecret: 's', janisClient: 'c' },
          { baseUrlByModule: { delivery: 'https://delivery.janis.in/api' }, fetchImpl }
        ),
      /Error 403/
    );
  });
});
