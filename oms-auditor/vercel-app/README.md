# OMS Capability Auditor — variante Vercel (on-demand, sin persistencia)

El usuario tipea `janis-api-key` / `janis-api-secret` / `janis-client` del
cliente a auditar directamente en el dashboard. La auditoría corre en vivo
contra oms/dom/delivery/picking/tms y el resultado se muestra al toque —
**nada se guarda**: ni la credencial, ni el resultado. Ver
**[../docs/DEPLOYMENT_PLAN_VERCEL.md](../docs/DEPLOYMENT_PLAN_VERCEL.md)**
antes de desplegar.

## Estructura

```
api/
  audit/run.js     # POST { clientId, appKey, appSecret, janisClient } — corre la auditoría, no persiste nada
  login.js / logout.js / session.js
lib/
  capability-engine.js  # motor de evaluación (idéntico a las otras variantes)
  audit.js               # auditClient(clientId, credentials) — credenciales por parámetro, no por lookup
  auth.js                 # sesión de dashboard (defensa en profundidad)
public/                  # dashboard estático: formulario de credenciales + resultado
capabilities/oms-capabilities.json
tests/                   # 23 tests, node --test, sin red ni AWS
```

## Correr tests

```bash
npm test
```

## Desarrollo local

```bash
cp .env.example .env.local
npx vercel dev
```

## No negociable (seguridad)

- Las credenciales tipeadas se usan una única vez, en memoria, para esa
  auditoría — nunca se persisten ni se loguean (ver
  `docs/DEPLOYMENT_PLAN_VERCEL.md`, sección 3).
- El dashboard **tiene que** estar detrás de Deployment Protection de
  Vercel antes de ser alcanzable por nadie — este endpoint ejecuta
  llamadas reales a producción de Janis con lo que le manden.
- `SESSION_SECRET` y `DASHBOARD_ACCESS_PASSWORD_HASH` viven únicamente en
  las Environment Variables del proyecto de Vercel, nunca en el repo.
