'use strict';

/**
 * Autenticación para la variante Vercel.
 *
 * Esta variante no persiste credenciales de cliente ni resultados (el
 * usuario tipea appKey/appSecret/janisClient en el formulario y se usan
 * una sola vez — ver lib/audit.js). Lo único que hay que proteger es
 * quién puede *entrar* a tirar auditorías on-demand contra producción de
 * Janis con las credenciales que traiga.
 *
 * Vercel no tiene un equivalente directo a Cognito/IAM auth de API
 * Gateway. Esta capa es DEFENSA EN PROFUNDIDAD, no el control principal:
 * el control principal recomendado es "Deployment Protection" de Vercel
 * (Vercel Authentication / Password Protection), que se habilita en el
 * dashboard del proyecto y bloquea requests a nivel de edge, antes de que
 * lleguen a este código. Ver docs/DEPLOYMENT_PLAN_VERCEL.md.
 *
 * Sesión de dashboard: cookie HttpOnly firmada (HMAC-SHA256), para el
 * humano que entra a /dashboard vía /login. NUNCA reemplaza SSO real —
 * ver "Decisión pendiente: auth del dashboard" en el plan.
 */

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'oms_auditor_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12hs

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la env var ${name}`);
  }
  return value;
}

/** Firma un token de sesión: `${expiresAt}.${hmac}` */
function createSessionToken(secret, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  const hmac = crypto.createHmac('sha256', secret).update(String(expiresAt)).digest('hex');
  return `${expiresAt}.${hmac}`;
}

/** Verifica firma y expiración. Devuelve true/false, nunca lanza. */
function verifySessionToken(token, secret, now = Date.now()) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [expiresAtStr, hmac] = token.split('.');
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;

  const expectedHmac = crypto.createHmac('sha256', secret).update(expiresAtStr).digest('hex');
  return timingSafeEqual(hmac, expectedHmac);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        return [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  const isProd = process.env.VERCEL_ENV === 'production';
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProd) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
}

function requireDashboardSession(req) {
  const secret = requireEnv('SESSION_SECRET');
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!verifySessionToken(token, secret)) {
    const err = new Error('Sesión inválida o expirada');
    err.statusCode = 401;
    throw err;
  }
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireDashboardSession,
  timingSafeEqual,
};
