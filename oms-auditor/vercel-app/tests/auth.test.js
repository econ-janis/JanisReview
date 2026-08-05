'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createSessionToken, verifySessionToken, timingSafeEqual } = require('../lib/auth');

describe('createSessionToken / verifySessionToken', () => {
  test('un token recién creado es válido', () => {
    const now = 1_700_000_000_000;
    const token = createSessionToken('secreto-de-test', now);
    assert.equal(verifySessionToken(token, 'secreto-de-test', now), true);
  });

  test('un token expirado (más allá del TTL) es inválido', () => {
    const now = 1_700_000_000_000;
    const token = createSessionToken('secreto-de-test', now);
    const muchoMasTarde = now + 13 * 60 * 60 * 1000; // TTL es 12hs
    assert.equal(verifySessionToken(token, 'secreto-de-test', muchoMasTarde), false);
  });

  test('un token firmado con otro secreto es inválido', () => {
    const now = 1_700_000_000_000;
    const token = createSessionToken('secreto-A', now);
    assert.equal(verifySessionToken(token, 'secreto-B', now), false);
  });

  test('un token manipulado (expiresAt distinto al firmado) es inválido', () => {
    const now = 1_700_000_000_000;
    const token = createSessionToken('secreto-de-test', now);
    const [, hmac] = token.split('.');
    const tokenManipulado = `${now + 999999}.${hmac}`;
    assert.equal(verifySessionToken(tokenManipulado, 'secreto-de-test', now), false);
  });

  test('valores vacíos o mal formados nunca lanzan, solo devuelven false', () => {
    assert.equal(verifySessionToken(undefined, 'x'), false);
    assert.equal(verifySessionToken('', 'x'), false);
    assert.equal(verifySessionToken('sin-punto', 'x'), false);
  });
});

describe('timingSafeEqual', () => {
  test('compara igualdad correctamente sin lanzar por longitudes distintas', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('abc', 'abcd'), false);
    assert.equal(timingSafeEqual('abc', 'xyz'), false);
  });
});
