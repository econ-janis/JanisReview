'use strict';

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({});

/**
 * Obtiene appKey/appSecret/janisClient del cliente desde Secrets Manager.
 * Convención de nombre: janis/clients/{clientId}/app-credentials
 *
 * IMPORTANTE: nunca loguear el resultado de esta función ni ningún objeto
 * que lo contenga. El caller solo debe usarlo para armar headers de request.
 */
async function getClientCredentials(clientId) {
  const secretId = `janis/clients/${clientId}/app-credentials`;
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  const parsed = JSON.parse(result.SecretString);

  if (!parsed.appKey || !parsed.appSecret || !parsed.janisClient) {
    throw new Error(
      `Secret ${secretId} debe tener appKey, appSecret y janisClient (header janis-client)`
    );
  }

  return parsed;
}

module.exports = { getClientCredentials };
