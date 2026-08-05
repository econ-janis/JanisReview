# Plan de despliegue — variante Vercel

Pediste repensar toda la arquitectura para Vercel en vez de AWS. Este
documento es el equivalente de `DEPLOYMENT_PLAN.md` pero para
`vercel-app/`. **No se corrió `vercel deploy` ni se creó ningún proyecto
en Vercel** — no tengo una cuenta/token de Vercel vinculado a este entorno,
así que el primer deploy real lo tenés que hacer vos (o pasarme un
`VERCEL_TOKEN` con permisos acotados si querés que lo dispare yo).

## 0. Por qué esto no es un simple "mover el AWS a Vercel"

Vercel no tiene equivalente directo a tres piezas centrales del diseño AWS:

| Necesidad | AWS | Vercel | Qué se hizo acá |
|---|---|---|---|
| Secretos por cliente (decenas/cientos de credenciales, acceso granular) | Secrets Manager (`GetSecretValue` acotado por ARN) | No existe un servicio equivalente — las env vars de Vercel son globales al proyecto, no por-secreto | **Se mantiene AWS Secrets Manager solo para esto** (ver sección 2) — arquitectura híbrida, no 100% Vercel |
| Auth de API con roles/IAM | API Gateway + `AWS_IAM`/Cognito | No hay authorizer nativo de API en Vercel | Deployment Protection (control principal) + gate propio con cookie firmada (defensa en profundidad) — ver sección 4 |
| Persistencia con TTL nativo | DynamoDB TTL | Postgres no tiene TTL nativo | Cron diario que corre `DELETE ... WHERE audited_at < NOW() - retención` |

Esto es información real que tenías que tener antes de decidir — no es
que "no se pudo", es que una migración honesta a Vercel deja estas tres
piezas como decisiones explícitas, no como detalles de implementación.

## 1. Qué se creó en el repo (`oms-auditor/vercel-app/`)

| Archivo | Reemplaza a (variante AWS) |
|---|---|
| `api/audit/run.js` (POST, `x-internal-key`) | `AuditFunction` |
| `api/audit-results/[clientId].js` (GET, sesión o `x-internal-key`) | `QueryFunction` |
| `api/cron/dispatch.js` (GET, `CRON_SECRET`) | `DispatcherFunction` + su EventBridge rule |
| `vercel.json` (`crons`) | EventBridge Rule |
| `lib/db.js` (Postgres vía Neon) | tabla DynamoDB |
| `lib/secrets.js` (sin cambios, sigue siendo AWS Secrets Manager) | igual |
| `lib/auth.js` + `api/login.js` + `api/logout.js` + `public/login.html` | API Gateway `AWS_IAM`/Cognito |
| `public/*` (dashboard estático) | `dashboard/` de la variante AWS — mismo HTML/CSS/JS, misma identidad visual |
| `sql/schema.sql` | definición de la tabla DynamoDB en `template.yaml` |

La variante AWS (`template.yaml`, `lambda/`, `dashboard/`, `capabilities/`,
`reference/`) **se dejó intacta en el repo**, ya revisada y con sus propios
tests en verde — no se borró nada. Si más adelante confirmás que Vercel es
la única arquitectura que va a producción, se puede retirar esa carpeta en
un commit aparte.

## 2. Secretos de cliente: por qué siguen en AWS Secrets Manager

`lib/secrets.js` es el mismo archivo que usa la variante AWS, sin cambios.
El proyecto de Vercel necesita, como env vars:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

de un **usuario IAM dedicado** (no el mismo rol que usan los Lambdas) con
una policy de mínimo privilegio:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:*:*:secret:janis/clients/*/app-credentials-*"
}
```

Esto es honesto sobre un trade-off: esas dos env vars de Vercel *son* en sí
mismas una credencial sensible (dan acceso a leer todos los secrets de
clientes). Vercel encripta las env vars en reposo y no las expone en
logs/build output, pero no tiene el mismo modelo de auditoría por-recurso
que Secrets Manager. Si esto no es aceptable para el equipo de seguridad,
la alternativa es no migrar la lectura de secretos a Vercel y mantener
*solo* esa pieza como una AWS Lambda liviana que Vercel invoca por HTTP —
avisame si preferís esa variante intermedia.

## 3. Maestro de clientes activos — mismo pendiente que en AWS

`ACTIVE_CLIENTS` (env var, CSV de `clientId`s) — placeholder, nunca
clientes reales commiteados. Mismo motivo que en la variante AWS: no hay
endpoint confirmado de `commerce`/`accounts`. Actualizar en Vercel Project
Settings -> Environment Variables después del deploy.

## 4. Autenticación del dashboard — control principal + defensa en profundidad

**Control principal (no negociable, hacelo vos en el dashboard de Vercel
antes de cargar cualquier dato real):**

> Project Settings -> Deployment Protection -> **Vercel Authentication**
> (o **Password Protection** si tu plan no incluye SSO por rol). Esto
> bloquea *toda* request a nivel de edge antes de que llegue al código —
> incluida la API.

**Defensa en profundidad (ya implementada en el código):**
`api/login.js` compara un hash SHA-256 de una passphrase interna
(`DASHBOARD_ACCESS_PASSWORD_HASH`) y, si matchea, setea una cookie
HttpOnly firmada (HMAC, `SESSION_SECRET`) que `api/audit-results/*`
exige para servir datos. Esto es un gate compartido (una sola
passphrase para todo el staff), **no reemplaza SSO real por persona** —
si más adelante Janis quiere login individual (para tener quién-vio-qué
auditable), la alternativa es reemplazar `lib/auth.js` por NextAuth con
el proveedor SSO que use Janis internamente — pendiente de tu decisión,
no lo armé porque no sé qué proveedor usan.

`INTERNAL_API_KEY` y `CRON_SECRET` son para llamadas server-to-server
(nunca las usa un navegador): el cron de Vercel manda `CRON_SECRET`
automáticamente si la env var está configurada en el proyecto.

## 5. Orden de despliegue sugerido (lo tenés que ejecutar vos)

```bash
cd oms-auditor/vercel-app
vercel login                      # tu cuenta, no la mía
vercel link                       # crea/vincula el proyecto
# Agregar la integración de Postgres (Neon) desde Vercel Marketplace
# en el dashboard del proyecto -> Storage -> Connect Database.
# Correr sql/schema.sql contra esa base (Vercel dashboard -> Query, o psql).

vercel env add AWS_ACCESS_KEY_ID
vercel env add AWS_SECRET_ACCESS_KEY
vercel env add AWS_REGION
vercel env add INTERNAL_API_KEY
vercel env add CRON_SECRET
vercel env add SESSION_SECRET
vercel env add DASHBOARD_ACCESS_PASSWORD_HASH
vercel env add ACTIVE_CLIENTS        # placeholder al principio

vercel deploy                     # preview, para validar
# Habilitar Deployment Protection ANTES de cargar cualquier secret real de cliente
# Cargar secrets de un cliente de prueba en Secrets Manager (fuera de Vercel)
npm run test:integration:qa       # (ver oms-auditor/tests/integration, mismo test que la variante AWS)

vercel deploy --prod              # recién acá, con tu confirmación explícita
```

## 6. Límites a tener en cuenta

- **Timeout de función**: `api/cron/dispatch.js` audita clientes con
  concurrencia 4 en la misma invocación. Con pocos clientes (<~20) y las
  10 capacidades actuales, no debería acercarse al límite del plan
  (10s Hobby / hasta 300s+ Pro con Fluid Compute), pero si la lista de
  clientes activos crece mucho, hay que migrar a una cola (Upstash QStash
  u otra) en vez de auditar todo en una sola invocación — quedó anotado
  como comentario en el propio archivo.
- **Sin TTL nativo**: la limpieza de histórico depende de que el cron
  corra (una vez por día); si el cron se desactiva por mucho tiempo, la
  tabla crece sin el corte automático que sí tenía DynamoDB.

## 7. Tests

- `npm test` en `vercel-app/` — 22/22 en verde (`capability-engine` +
  `auth`), corridos en este entorno, sin red ni AWS.
- El test de integración contra QA es el mismo de la variante AWS
  (`oms-auditor/tests/integration/qa-audit.integration.test.js`) — la
  lógica de `auditClient` es la misma, solo cambia dónde persiste.
  Sigue pendiente de correr por falta de credenciales AWS + cliente de
  prueba real en este entorno de trabajo.

## 8. Confirmación pendiente antes de producción

1. Tu decisión sobre la sección 2 (secretos vía AWS desde Vercel, sí/no).
2. Habilitar Deployment Protection antes de cargar cualquier dato real.
3. Correr el test de integración contra QA en verde.
4. Completar `ACTIVE_CLIENTS` con la lista real.
5. Tu `vercel deploy --prod` (o pasarme un `VERCEL_TOKEN` acotado si querés que lo dispare yo).
