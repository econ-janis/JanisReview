'use strict';

/** GET /api/session — usado por el dashboard estático para saber si redirigir a /login.html */

const { requireDashboardSession } = require('../lib/auth');

module.exports = async (req, res) => {
  try {
    requireDashboardSession(req);
    res.status(200).json({ authenticated: true });
  } catch (_err) {
    res.status(401).json({ authenticated: false });
  }
};
