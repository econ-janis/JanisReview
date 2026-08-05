'use strict';

/**
 * POST /api/login  { password }
 *
 * Gate mínimo propio, pensado como defensa en profundidad — el control
 * principal debe ser "Deployment Protection" de Vercel (Vercel
 * Authentication / Password Protection), habilitado en el dashboard del
 * proyecto. Este login NO reemplaza SSO real; ver "Decisión pendiente:
 * auth del dashboard" en docs/DEPLOYMENT_PLAN_VERCEL.md.
 *
 * DASHBOARD_ACCESS_PASSWORD_HASH: hash SHA-256 hex de la passphrase
 * interna (nunca la passphrase en texto plano en env vars). Generarlo con:
 *   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "la-passphrase"
 */

const crypto = require('crypto');
const { createSessionToken, setSessionCookie, timingSafeEqual } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const expectedHash = process.env.DASHBOARD_ACCESS_PASSWORD_HASH;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!expectedHash || !sessionSecret) {
    res.status(500).json({ message: 'Auth no configurada (faltan env vars en el servidor)' });
    return;
  }

  const { password } = req.body || {};
  if (!password) {
    res.status(400).json({ message: 'Falta password' });
    return;
  }

  const providedHash = crypto.createHash('sha256').update(password).digest('hex');
  if (!timingSafeEqual(providedHash, expectedHash)) {
    // Mensaje genérico — no dar pistas de si el usuario/servicio existe.
    res.status(401).json({ message: 'Credenciales inválidas' });
    return;
  }

  const token = createSessionToken(sessionSecret);
  setSessionCookie(res, token);
  res.status(200).json({ ok: true });
};
