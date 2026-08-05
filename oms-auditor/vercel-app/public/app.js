/**
 * Dashboard estático — variante Vercel, on-demand.
 *
 * El usuario tipea appKey/appSecret/janisClient acá y se mandan una única
 * vez a /api/audit/run (HTTPS, mismo origen) para correr la auditoría en
 * vivo. Nada se guarda: ni en este archivo, ni en el servidor. Antes de
 * pedir nada, verifica sesión contra /api/session; si no hay sesión
 * válida, redirige a /login.html. Eso es defensa en profundidad — el
 * control principal debe ser Deployment Protection de Vercel (ver
 * docs/DEPLOYMENT_PLAN_VERCEL.md).
 */

(function () {
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatValue(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return iso;
    }
  }

  function redirectToLogin() {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?redirect=${redirect}`;
  }

  function renderSummary(resumen) {
    return `
      <div class="summary-row">
        <div class="summary-card total">
          <div><div class="label">Capacidades evaluadas</div><div class="value">${resumen.total}</div></div>
          <div class="summary-icon">Σ</div>
        </div>
        <div class="summary-card lo-usa">
          <div><div class="label">Lo usa</div><div class="value">${resumen.loUsa}</div></div>
          <div class="summary-icon">✓</div>
        </div>
        <div class="summary-card no-lo-usa">
          <div><div class="label">No lo usa</div><div class="value">${resumen.noLoUsa}</div></div>
          <div class="summary-icon">✕</div>
        </div>
      </div>
    `;
  }

  function renderRow(item) {
    const statusClass = item.loUsa ? 'ok' : 'fail';
    const icon = item.loUsa ? '✓' : '✕';
    const label = item.loUsa ? 'Lo usa' : 'No lo usa';
    return `
      <div class="capability-row">
        <div class="status-icon ${statusClass}">${icon}</div>
        <div class="capability-info">
          <div class="capability-name">${escapeHtml(item.nombre)}</div>
          <div class="capability-sub">
            <span class="pill">${escapeHtml(item.modulo)}</span>
            <span>${escapeHtml(item.endpoint)}</span>
            <span class="capability-value">valor actual: ${escapeHtml(formatValue(item.valorActual))}</span>
          </div>
        </div>
        <div class="status-label ${statusClass}">${label}</div>
      </div>
    `;
  }

  function renderList(resultados) {
    if (resultados.length === 0) return '<div class="state-message">No hay capacidades para mostrar.</div>';
    return `<div class="capability-list">${resultados.map(renderRow).join('')}</div>`;
  }

  function renderState(message) {
    document.getElementById('content').innerHTML = `<div class="state-message">${escapeHtml(message)}</div>`;
  }

  // El backend devuelve "resultados" en lenguaje de negocio (loUsa/noLoUsa);
  // acá simplemente lo pasamos tal cual a las funciones de render.
  function renderResult(clientId, data) {
    const resultados = data.results.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      modulo: r.modulo,
      endpoint: r.endpoint,
      valorActual: r.actual,
      loUsa: Boolean(r.ok),
    })).sort((a, b) => a.id.localeCompare(b.id));

    const resumen = {
      total: resultados.length,
      loUsa: resultados.filter((r) => r.loUsa).length,
      noLoUsa: resultados.filter((r) => !r.loUsa).length,
    };

    document.getElementById('content').innerHTML = `
      ${renderSummary(resumen)}
      ${renderList(resultados)}
      <div class="footer-meta">
        <span>Auditoría corrida: ${formatDate(data.auditedAt)} (no se guardó)</span>
        <span>clientId: ${escapeHtml(clientId)}</span>
      </div>
    `;
  }

  function clearCredentialInputs() {
    document.getElementById('input-appKey').value = '';
    document.getElementById('input-appSecret').value = '';
    document.getElementById('input-janisClient').value = '';
  }

  document.getElementById('clear-btn').addEventListener('click', () => {
    clearCredentialInputs();
    document.getElementById('input-clientId').value = '';
  });

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/login.html';
  });

  document.getElementById('audit-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const clientId = document.getElementById('input-clientId').value.trim();
    const appKey = document.getElementById('input-appKey').value;
    const appSecret = document.getElementById('input-appSecret').value;
    const janisClient = document.getElementById('input-janisClient').value.trim();

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Auditando…';
    renderState('Corriendo la auditoría en vivo contra oms/dom/delivery/picking/tms…');

    try {
      const response = await fetch('/api/audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ clientId, appKey, appSecret, janisClient }),
      });

      if (response.status === 401) {
        redirectToLogin();
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        renderState(data.message || `No se pudo correr la auditoría (HTTP ${response.status}).`);
        return;
      }

      renderResult(clientId, data);
    } catch (err) {
      renderState(`Error inesperado corriendo la auditoría: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Auditar ahora';
      // Las credenciales ya se usaron — no queda razón para dejarlas en pantalla.
      clearCredentialInputs();
    }
  });

  async function init() {
    const sessionCheck = await fetch('/api/session', { credentials: 'same-origin' });
    if (!sessionCheck.ok) {
      redirectToLogin();
    }
  }

  init();
})();
