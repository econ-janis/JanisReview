# Plan de despliegue — variante Vercel (on-demand, sin persistencia)

Pediste que el usuario tipee su propia `janis-api-key`/`janis-api-secret`
en el front. Eso cambió el diseño de fondo respecto a la primera versión
de esta variante (la que tenía Secrets Manager + Postgres + cron diario):

- **No hay más auditoría automática diaria.** Sin una credencial guardada
  en ningún lado, no hay con qué correr un cron desatendido. Esta
  herramienta pasó a ser 100% on-demand: alguien entra, tipea las
  credenciales del cliente que quiere chequear, ve el resultado al toque.
- **No se persiste nada.** Ni la credencial ni el resultado de la
  auditoría tocan disco — se usan una vez, en memoria, para esa request, y
  se descartan al responder.
- **Como consecuencia, ya no hace falta AWS para nada.** Se cayeron
  Secrets Manager, Postgres/Neon, y el usuario IAM dedicado que iba a leer
  secretos desde Vercel — todo lo que estaba documentado como "híbrido
  AWS+Vercel" en la versión anterior de este plan ya no aplica. Esto es
  una mejora real de superficie de ataque: no queda ningún secreto de
  cliente viviendo en ningún sistema de forma permanente.

**No se corrió `vercel deploy` ni se creó ningún proyecto en Vercel** — no
tengo cuenta/token de Vercel en este entorno. Validé todo localmente (ver
sección 4).

## 1. Qué hay en el repo (`oms-auditor/vercel-app/`)

| Archivo | Qué hace |
|---|---|
| `public/index.html` + `public/app.js` | Dashboard con un formulario (nombre del cliente + `janis-api-key` + `janis-api-secret` + `janis-client`) que llama a `/api/audit/run` y renderiza el resultado en la misma pantalla. Limpia los campos de credenciales apenas termina la auditoría. |
| `api/audit/run.js` | POST, recibe las 4 credenciales en el body, corre `auditClient` y devuelve el resultado. No persiste nada. Protegido por sesión de dashboard. |
| `lib/audit.js` | Misma lógica de evaluación que las otras dos variantes (motor `capability-engine.js` sin cambios), ahora recibe las credenciales por parámetro en vez de buscarlas. |
| `lib/auth.js` + `api/login.js` / `logout.js` / `session.js` + `public/login.html` | Gate de acceso al dashboard (ver sección 3) — sigue siendo necesario aunque no haya secretos persistidos, porque este endpoint de todas formas ejecuta llamadas reales a producción de Janis con lo que le pasen. |

Ya no hay: `lib/db.js`, `lib/secrets.js`, `sql/schema.sql`, `api/cron/`,
`api/audit-results/`, `vercel.json` (crons) — se borraron porque dejaron
de tener sentido con este diseño. Las variantes AWS SAM y "Vercel +
Postgres" (la primera versión de esta carpeta) quedan documentadas en
`docs/DEPLOYMENT_PLAN.md` si en algún momento se necesita volver a un
modelo con auditoría programada.

## 2. Por qué el gate de login sigue siendo necesario

Aunque no se guarda nada, `/api/audit/run` sigue siendo un endpoint que,
con las credenciales correctas, **hace requests reales contra
oms.janis.in/dom.janis.in/etc. de producción**. Dejarlo público sin
ningún control equivaldría a ofrecer un proxy anónimo hacia las APIs de
Janis: cualquiera con una credencial robada podría usarlo para probarla
sin dejar rastro en sus propios logs, o alguien podría intentar
credenciales al voleo contra él. Por eso:

- **Control principal (no negociable):** habilitar **Deployment
  Protection** (Vercel Authentication o Password Protection) en Project
  Settings antes de que este proyecto sea alcanzable por nadie.
- **Defensa en profundidad (ya en el código):** `api/login.js` con una
  passphrase compartida (`DASHBOARD_ACCESS_PASSWORD_HASH`) + cookie de
  sesión firmada de 12hs. Esto es un gate de equipo, no login individual
  — si más adelante Janis quiere auditoría de "quién corrió qué auditoría
  para qué cliente", hace falta SSO real (NextAuth + el proveedor que use
  Janis internamente) en vez de esta passphrase compartida. Pendiente de
  tu decisión, no lo armé por no saber qué proveedor usan.

## 3. Las credenciales tipeadas — qué garantías tiene el código

- Viajan del navegador al backend por HTTPS, en el body de un POST — nunca
  por query string ni headers logueables por intermediarios.
- `lib/audit.js` las recibe como parámetro, las usa exclusivamente para
  armar los headers de las 10 llamadas a Janis, y no las guarda en ninguna
  variable de módulo ni las pasa a ningún sistema de logging.
- `capability-engine.js` (sin cambios respecto a las otras variantes)
  nunca incluye headers ni body de request en los mensajes de error que
  arma — si una llamada a Janis falla, el mensaje es del estilo
  `Error 403 llamando a /audit-rule`, nunca vuelca la credencial usada.
- El test `tests/audit.test.js` corre `auditClient` con una credencial de
  prueba y confirma que no aparece en el resultado serializado.
- El frontend (`public/app.js`) limpia los 3 campos de credenciales del
  formulario apenas la request termina (éxito o error).

Lo que el código **no** puede garantizar: qué hace el navegador del
usuario con esos valores mientras están tipeados (extensiones, autofill,
etc.) — los inputs son `type="password"` y `autocomplete="off"`, que es el
máximo control razonable del lado del cliente.

## 4. Qué se validó en este entorno (sin cuenta de Vercel)

Corrí un servidor Node local que sirve `public/` y monta los mismos
handlers de `api/` (con `fetch` global mockeado para no pegarle a
producción), y validé con Playwright el flujo completo:

1. Login con passphrase → cookie de sesión.
2. `GET /api/session` con la cookie → autenticado.
3. Formulario completo → `POST /api/audit/run` → las 10 capacidades
   evaluadas se muestran con ✓/✕ y "Lo usa"/"No lo usa".
4. Los campos de credenciales quedan vacíos después de la respuesta.

`npm test` (23 tests: `capability-engine`, `auth`, `audit`) — **23/23 en
verde**, sin red ni AWS.

## 5. Orden de despliegue sugerido (lo tenés que ejecutar vos)

```bash
cd oms-auditor/vercel-app
vercel login
vercel link
vercel env add SESSION_SECRET
vercel env add DASHBOARD_ACCESS_PASSWORD_HASH   # sha256 hex de la passphrase, ver .env.example
vercel deploy                     # preview
# Habilitar Deployment Protection ANTES de compartir la URL con nadie
vercel deploy --prod              # con tu confirmación explícita
```

No hay paso de base de datos, no hay usuario IAM, no hay secrets que
cargar de antemano — es el deploy más simple de las tres variantes que
armamos.

## 6. Confirmación pendiente antes de producción

1. Habilitar Deployment Protection antes de que la URL sea alcanzable por nadie fuera del equipo.
2. Definir si el gate de passphrase compartida es aceptable o si hace falta SSO individual (sección 2).
3. Tu `vercel deploy --prod` (o pasarme un `VERCEL_TOKEN` acotado si querés que lo dispare yo).
