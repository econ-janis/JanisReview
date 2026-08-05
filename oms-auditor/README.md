# OMS Capability Auditor

Audita si un cliente de Janis tiene configuradas las capacidades que
**debería** tener para operar sin desvíos atribuibles a configuración, a
través de 5 microservicios confirmados: **oms, dom, delivery, picking,
tms**. El resultado se presenta en lenguaje de negocio — "Lo usa" / "No lo
usa" — nunca "ok"/"pendiente".

> ⚠️ Este repo contiene infraestructura como código y no fue desplegado
> contra ninguna cuenta de AWS. Ver **[docs/DEPLOYMENT_PLAN.md](docs/DEPLOYMENT_PLAN.md)**
> antes de correr `sam deploy`.

## Estructura

```
capabilities/oms-capabilities.json   # 10 capacidades, confirmadas contra openapi real (fuente de verdad)
reference/*-openapi.json             # los 5 openapi originales
template.yaml                        # infraestructura completa (AWS SAM)
lambda/
  audit/index.js                     # evalúa capacidades para un clientId y persiste en DynamoDB
  query/index.js                     # GET /audit-results/{clientId} — lee la última auditoría por capacidad
  dispatcher/index.js                # disparado por EventBridge 1x/día, invoca audit para cada cliente activo
  shared/                            # extractActualValue, evaluateCapability, paginación, Secrets Manager, DynamoDB
dashboard/                           # dashboard estático (HTML/CSS/JS), con la identidad visual de Janis
tests/
  unit/                              # 16 tests sin red ni AWS — npm run test:unit
  integration/                       # contra QA con un cliente de prueba real — npm run test:integration:qa
scripts/run-local-test.js            # correr la auditoría local sin desplegar
docs/DEPLOYMENT_PLAN.md              # qué se crea, en qué orden, IAM, decisiones pendientes
```

## Los 5 microservicios confirmados

| Servicio | Host (prod) | Capacidades en el spec |
|---|---|---|
| `oms` | `oms.janis.in/api` | audit-rule, setting/order (geo), order-hook, order-import-profile |
| `dom` | `dom.janis.in/api` | fulfillment-profile, setting/fulfillmentplan |
| `delivery` | `delivery.janis.in/api` | setting/app (Google Maps key), carrier (cobertura) |
| `picking` | `picking.janis.in/api` | zone (límites de capacidad) |
| `tms` | `tms.janis.in/api` | vehicle (flota) |

Dos servicios más aparecen **mencionados** en las referencias de estos
openapi pero no llegaron confirmados: `commerce` (Account, Location) y
`catalog` (Category, Sku). Si se consiguen sus openapi, se les puede sumar
capacidades igual que a los otros 5.

## Cómo correr los tests

```bash
cd oms-auditor
npm run test:unit                 # 16/16, sin red ni AWS
npm run test:integration:qa       # requiere QA_CLIENT_ID + credenciales AWS, ver el archivo de test
```

## Cómo correr una auditoría local (contra un stack ya desplegado)

```bash
CLIENT_ID=cliente-de-prueba-qa \
AUDIT_RESULTS_TABLE_NAME=oms-capability-audit-results \
JANIS_OMS_API_BASE_URL=https://oms.janisqa.in/api \
node scripts/run-local-test.js
```

## Dashboard

`dashboard/index.html` (+ `app.js`, `styles.css`) es un dashboard estático
sin build step, con la paleta y tipografía de la skin real de Janis
(navy `#1b2a4d` de sidebar, azul primario `#2f6fed`, tipografía Inter,
pills de estado redondeadas). Muestra:

- 3 tarjetas de resumen (capacidades evaluadas / lo usa / no lo usa).
- Una fila por capacidad con ícono ✓/✕, nombre, módulo, endpoint, valor
  actual detectado, y la etiqueta **"Lo usa"** / **"No lo usa"**.
- Fecha de la última auditoría y `clientId` al pie.

Se abre con `?clientId=<id>` en la URL y llama a `GET /api/audit-results/{clientId}`
(ruta relativa configurable vía `window.OMS_AUDITOR_CONFIG.apiBaseUrl`).

**No desplegar como sitio público que llame directamente a API Gateway con
credenciales embebidas.** Ver "Decisión pendiente: autenticación del
dashboard" en `docs/DEPLOYMENT_PLAN.md`.

## Por qué arrancar así y no con una matriz manual

Como se discutió en Slack: cualquier versión manual "fracasa con éxito"
porque el cliente puede cambiar configuraciones en cualquier momento. La
idea de este auditor es que el spec (`oms-capabilities.json`) sea la única
fuente de verdad de "qué debería estar" y el Lambda la reevalúe on-demand
contra el estado real, sin necesidad de que alguien la actualice a mano.

## Privacidad y seguridad (obligatorio, no opcional)

- Las credenciales de cada cliente **nunca** van hardcodeadas ni en el
  repo — siempre en Secrets Manager, leídas en runtime, nunca logueadas.
- El resultado de la auditoría es información de configuración de clientes
  reales: se persiste en DynamoDB con acceso restringido (IAM mínimo, sin
  exposición pública) y la API de consulta requiere autorización — nunca
  se comparte fuera de canales internos de Janis.
- Detalle completo de permisos IAM por Lambda: `docs/DEPLOYMENT_PLAN.md`,
  sección 5.

## Pendiente / próximos pasos

Ver `docs/DEPLOYMENT_PLAN.md`, secciones 3, 4 y 8: maestro de clientes
activos (hoy manual vía SSM), decisión de auth del dashboard, y el test de
integración contra QA (no se pudo correr en este entorno de trabajo por
falta de credenciales de AWS y de un cliente de prueba real).
