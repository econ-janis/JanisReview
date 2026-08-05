'use strict';

/**
 * OMS Capability Auditor - Dispatcher
 *
 * Disparado 1 vez por día por EventBridge (ver template.yaml). Lee la lista
 * de clientes activos y dispara una invocación asincrónica del Lambda de
 * auditoría por cada uno.
 *
 * PENDIENTE (ver README y docs/DEPLOYMENT_PLAN.md): no se encontró un
 * endpoint confirmado de `commerce`/`accounts` para el maestro de clientes
 * activos de Janis. Hasta que se confirme, la lista se lee de un parámetro
 * de SSM Parameter Store (`ACTIVE_CLIENTS_PARAMETER_NAME`) que un operador
 * actualiza manualmente — nunca hardcodeada en código ni en el repo.
 */

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const ssm = new SSMClient({});
const lambda = new LambdaClient({});

async function getActiveClientIds() {
  const parameterName = process.env.ACTIVE_CLIENTS_PARAMETER_NAME;
  if (!parameterName) {
    throw new Error('Falta ACTIVE_CLIENTS_PARAMETER_NAME en el entorno del Lambda');
  }

  const result = await ssm.send(new GetParameterCommand({ Name: parameterName }));
  const raw = (result.Parameter && result.Parameter.Value) || '';

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

exports.handler = async () => {
  const auditFunctionName = process.env.AUDIT_FUNCTION_NAME;
  if (!auditFunctionName) {
    throw new Error('Falta AUDIT_FUNCTION_NAME en el entorno del Lambda');
  }

  const clientIds = await getActiveClientIds();

  if (clientIds.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('ACTIVE_CLIENTS_PARAMETER_NAME está vacío o sin configurar todavía; no se disparó ninguna auditoría.');
    return { dispatched: 0 };
  }

  await Promise.all(
    clientIds.map((clientId) =>
      lambda.send(
        new InvokeCommand({
          FunctionName: auditFunctionName,
          InvocationType: 'Event', // asincrónico: el dispatcher no espera el resultado
          Payload: Buffer.from(JSON.stringify({ clientId })),
        })
      )
    )
  );

  return { dispatched: clientIds.length };
};
