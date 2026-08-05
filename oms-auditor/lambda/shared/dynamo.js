'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

const RETENTION_DAYS = Number(process.env.AUDIT_RESULTS_RETENTION_DAYS || 180);
const BATCH_SIZE = 25; // límite de BatchWriteItem

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Persiste un item histórico por capacidad auditada.
 * PK = clientId, SK = `${capabilityId}#${auditedAt}` (auditedAt en ISO8601,
 * lexicográficamente ordenable).
 *
 * IMPORTANTE: no persistir nunca appKey/appSecret/janisClient acá; solo el
 * resultado de configuración evaluado.
 */
async function saveAuditResults(tableName, clientId, auditedAt, results) {
  const expiresAt = Math.floor(Date.parse(auditedAt) / 1000) + RETENTION_DAYS * 24 * 60 * 60;

  const items = results.map((r) => ({
    PutRequest: {
      Item: {
        clientId,
        sk: `${r.id}#${auditedAt}`,
        capabilityId: r.id,
        auditedAt,
        nombre: r.nombre,
        modulo: r.modulo,
        endpoint: r.endpoint,
        severidad: r.severidad,
        valorActual: r.actual,
        esperado: r.esperado,
        ok: r.ok,
        error: r.error || null,
        expiresAt,
      },
    },
  }));

  for (const batch of chunk(items, BATCH_SIZE)) {
    // eslint-disable-next-line no-await-in-loop
    await doc.send(
      new BatchWriteCommand({
        RequestItems: { [tableName]: batch },
      })
    );
  }
}

/**
 * Trae todos los items históricos de un cliente (acotados por TTL) y
 * devuelve solo el más reciente por capacidad.
 */
async function getLatestResultsByClient(tableName, clientId) {
  const items = [];
  let ExclusiveStartKey;

  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'clientId = :cid',
        ExpressionAttributeValues: { ':cid': clientId },
        ExclusiveStartKey,
      })
    );
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const latestByCapability = new Map();
  for (const item of items) {
    const current = latestByCapability.get(item.capabilityId);
    if (!current || item.auditedAt > current.auditedAt) {
      latestByCapability.set(item.capabilityId, item);
    }
  }

  return [...latestByCapability.values()];
}

module.exports = { saveAuditResults, getLatestResultsByClient };
