# Plan de despliegue — OMS Capability Auditor

Este documento resume qué se crea, en qué orden y con qué permisos, para
revisar antes de correr `sam deploy` contra cualquier cuenta de AWS real.
**No se ejecutó ningún deploy** — este repo solo contiene código e IaC.

## 1. Qué se crea (por stack, un stack por ambiente: dev / qa / prod)

| # | Recurso | Tipo | Notas |
|---|---|---|---|
| 1 | `AuditResultsTable` | DynamoDB | PK `clientId`, SK `sk` = `capabilityId#auditedAt`. SSE + PITR habilitados, TTL de 180 días (parametrizable) para no acumular configuración de clientes indefinidamente. |
| 2 | `AuditFunction` (`oms-auditor-audit-{stage}`) | Lambda | Evalúa `capabilities/oms-capabilities.json` contra oms/dom/delivery/picking/tms para un `clientId` y persiste en (1). |
| 3 | `QueryFunction` (`oms-auditor-query-{stage}`) | Lambda | Solo lectura de (1). Expuesta vía (5). |
| 4 | `DispatcherFunction` (`oms-auditor-dispatcher-{stage}`) | Lambda | Disparado por (6), invoca (2) de forma asincrónica por cada cliente activo. |
| 5 | `AuditResultsApi` | API Gateway (REST, SAM) | `GET /audit-results/{clientId}` → (3). Auth `AWS_IAM` por defecto (ver sección 4). |
| 6 | `DailySchedule` | EventBridge Rule | 1x/día, horario configurable (`AuditScheduleExpression`, default 06:00 UTC). |
| 7 | `ActiveClientsParameter` | SSM Parameter | Placeholder (`REEMPLAZAR-CON-CLIENTES-REALES...`) — ver sección 3. |
| 8 | `AuditResultsApiAccessLogs` | CloudWatch Log Group | Solo metadata de request (método/path/status/latencia), nunca body ni headers de auth. Retención 90 días. |

Fuera de este stack (no gestionado por IaC, a propósito):
- Los secrets `janis/clients/{clientId}/app-credentials` en Secrets Manager — se cargan manualmente por cliente, nunca vía CloudFormation/SAM (evita que credenciales de cliente pasen por un pipeline de IaC o por state de Terraform/CFN).
- El valor real del parámetro `ActiveClientsParameter` (sección 3).

## 2. Orden de despliegue sugerido

1. `sam build`
2. `sam deploy --guided` en el ambiente **dev** primero, sin datos reales — solo para validar que el stack completo levanta.
3. Cargar en Secrets Manager (fuera de IaC) el secret de **un cliente de prueba en QA**: `janis/clients/{qa-test-client}/app-credentials`.
4. Correr `npm run test:integration:qa` (ver sección 7) contra ese cliente de prueba, apuntando `JANIS_*_API_BASE_URL` a `*.janisqa.in`.
5. Recién con (4) en verde, repetir el deploy apuntando a **prod** (`Stage=prod`), con las URLs por defecto (`*.janis.in`).
6. Cargar en Secrets Manager los secrets de los clientes reales que se quieran auditar.
7. Actualizar `ActiveClientsParameter` con la lista real de `clientId`s (`aws ssm put-parameter --overwrite ...`) — ver sección 3 sobre por qué esto es manual.
8. Confirmar en CloudWatch (Dispatcher + Audit) que la primera corrida diaria salió bien, antes de considerarlo "en régimen".

**No se corre nada de esto sin tu confirmación explícita — este documento es el "mostrame el plan antes de aplicar nada" pedido.**

## 3. Pendiente: maestro de clientes activos

No se encontró (ni estaba entre los openapi confirmados) un endpoint de
`commerce`/`accounts` para leer automáticamente qué clientes de Janis están
activos. Mientras tanto:

- La lista vive en el parámetro SSM `ActiveClientsParameterName`
  (default `/oms-auditor/active-clients`), como CSV de `clientId`s.
- El stack **crea el parámetro con un placeholder**, nunca con clientes
  reales — se actualiza manualmente por un operador autorizado después del
  deploy.
- Si en el futuro se confirma un endpoint de `commerce`/`accounts` con la
  lista real, `DispatcherFunction` es el único lugar que hay que tocar
  (reemplazar la lectura de SSM por una llamada a ese endpoint).

## 4. Decisión pendiente: autenticación del dashboard

El prompt original deja abierto Cognito vs IAM para no exponer el Lambda a
internet. Se implementó **AWS_IAM (SigV4)** en `AuditResultsApi` por ser lo
más simple de expresar en IaC sin asumir de más sobre el front interno de
Janis. Esto asume que:

- El dashboard estático (`dashboard/`) **no** llama directamente a API
  Gateway desde el navegador con credenciales embebidas (eso sería
  inseguro).
- Se sirve detrás de un backend/BFF interno de Janis ya autenticado (SSO),
  que firma o reenvía la llamada a `GET /audit-results/{clientId}`.

Si Janis prefiere que el propio navegador llame a la API (sin BFF
intermedio), la alternativa es reemplazar el authorizer por un **Cognito
User Pool** (o federar el SSO existente de Janis como identity provider de
ese User Pool) — es un cambio acotado a `AuditResultsApi.Auth` en
`template.yaml`, pero **necesita tu confirmación** antes de implementarlo
porque implica crear infraestructura de identidad nueva.

También se agregó, como capa adicional, una condición de `ResourcePolicy`
que restringe la API a principals de tu AWS Organization
(`AllowedPrincipalOrgId`) — opcional, recomendado, vacío por defecto.

## 5. IAM — permisos mínimos por rol

| Función | Acción | Recurso | Por qué |
|---|---|---|---|
| `AuditFunction` | `secretsmanager:GetSecretValue` | `arn:aws:secretsmanager:{region}:{account}:secret:janis/clients/*/app-credentials-*` | Nunca `*` — solo el naming convention de credenciales de cliente. |
| `AuditFunction` | `dynamodb:PutItem`, `dynamodb:BatchWriteItem` | ARN de `AuditResultsTable` | Solo puede escribir resultados, no leer los de otros ni tocar otras tablas. |
| `QueryFunction` | `dynamodb:Query` | ARN de `AuditResultsTable` | Solo lectura, ni siquiera puede escribir. |
| `DispatcherFunction` | `ssm:GetParameter` | ARN del parámetro `ActiveClientsParameterName` específico | No lee ningún otro parámetro de la cuenta. |
| `DispatcherFunction` | `lambda:InvokeFunction` | ARN de `AuditFunction` | No puede invocar ningún otro Lambda de la cuenta. |

Ninguna función tiene permisos de administración (crear/borrar secrets,
tablas, usuarios IAM, etc.) ni acceso a otros servicios de Janis.

## 6. Seguridad y privacidad — cómo se cumplió cada punto del encargo

- **Nunca se loguea `appKey`/`appSecret`/`janisClient`**: `lambda/shared/secrets.js` solo devuelve el objeto al caller para armar headers; ningún `console.log` en el codebase referencia esas keys. El access log de API Gateway (`AuditResultsApiAccessLogs`) solo registra metadata de request, no headers de auth ni body.
- **Acceso restringido a los resultados**: DynamoDB sin acceso público, API Gateway con `AWS_IAM` (nunca `NONE`), sin Lambda Function URLs, sin exposición directa a internet.
- **Secrets de cliente solo en Secrets Manager**: no hay secrets en variables de entorno del Lambda ni en el repo (`ActiveClientsParameter` es una lista de IDs de cliente, no una credencial).
- **Minimización de datos**: TTL de 180 días en DynamoDB — no se retiene configuración de clientes indefinidamente.

## 7. Tests

- `npm run test:unit` — 16 tests sobre `extractActualValue`, `evaluateCapability` (los 3 tipos de extracción + `>=N` / `not:` / igualdad) y paginación (`callJanisEndpointPaginated`), sin red ni AWS. Ya corridos en este entorno: **16/16 OK**.
- `npm run test:integration:qa` — contra un cliente de prueba real en QA (`oms.janisqa.in`, etc.). Se salta automáticamente si no está `QA_CLIENT_ID` seteado, así nunca corre por accidente. **Pendiente de correr** (necesita credenciales de AWS + un cliente de prueba en QA que no está disponible en este entorno de trabajo).

## 8. Qué falta antes de auditar clientes reales en prod

1. Correr (7) `test:integration:qa` en verde con un cliente de prueba real.
2. Definir la decisión de la sección 4 (auth del dashboard).
3. Cargar los secrets de los clientes reales a auditar.
4. Completar `ActiveClientsParameter` con la lista real (sección 3).
5. Tu confirmación explícita para el primer `sam deploy` contra la cuenta de prod.
