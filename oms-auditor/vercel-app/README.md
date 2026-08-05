# OMS Capability Auditor — variante Vercel

Misma auditoría que la variante AWS (`../lambda`, `../template.yaml`), pero
sobre Serverless Functions de Vercel + Postgres (Neon) en vez de
Lambda/DynamoDB/API Gateway. Ver **[../docs/DEPLOYMENT_PLAN_VERCEL.md](../docs/DEPLOYMENT_PLAN_VERCEL.md)**
antes de desplegar — no se corrió ningún deploy contra una cuenta real.

## Estructura

```
api/
  audit/run.js                # POST — corre la auditoría de un clientId (x-internal-key)
  audit-results/[clientId].js # GET — última auditoría por capacidad (sesión o x-internal-key)
  cron/dispatch.js            # GET — disparado por Vercel Cron 1x/día (CRON_SECRET)
  login.js / logout.js / session.js
lib/
  capability-engine.js        # idéntico a la variante AWS
  secrets.js                  # idéntico — sigue siendo AWS Secrets Manager (ver plan, sección 2)
  db.js                       # Postgres/Neon en vez de DynamoDB
  audit.js                    # auditClient(), igual lógica que lambda/audit
  auth.js                     # sesión de dashboard + keys internas (defensa en profundidad)
public/                       # dashboard estático (mismo HTML/CSS/JS que la variante AWS)
sql/schema.sql                # correr una vez contra la DB antes del primer deploy
capabilities/oms-capabilities.json  # copia de la fuente de verdad
tests/                        # 22 tests, node --test, sin red ni AWS
```

## Correr tests

```bash
npm install
npm test
```

## Desarrollo local

```bash
cp .env.example .env.local   # completar con tus propios valores de dev/QA
npm install -g vercel        # o usar npx vercel
vercel dev
```

## No negociable (seguridad)

- Los secretos de cliente (`appKey`/`appSecret`/`janisClient`) nunca se
  loguean ni se persisten — solo se usan para armar headers de request.
- `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, `SESSION_SECRET`, etc. viven
  únicamente en las Environment Variables del proyecto de Vercel, nunca en
  el repo ni en `.env` commiteado (`.env.local` está en `.gitignore`).
- Antes de cargar cualquier dato de un cliente real, **Deployment
  Protection tiene que estar habilitado** en el proyecto de Vercel — ver
  sección 4 del plan de despliegue.
