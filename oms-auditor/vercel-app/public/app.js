/**
 * Dashboard estático — variante Vercel.
 *
 * Antes de pedir datos, verifica sesión contra /api/session; si no hay
 * sesión válida, redirige a /login.html. Esto es defensa en profundidad:
 * el control principal debe ser Deployment Protection de Vercel (ver
 * docs/DEPLOYMENT_PLAN_VERCEL.md) — este guard de cliente NO reemplaza esa
 * protección a nivel de edge, solo evita que alguien con la URL directa
 * pero sin sesión vea el contenido servido de este HTML estático.
 */

(function () {
  const apiBaseUrl = '/api';

  function getClientIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('clientId');
  }

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

  function renderError(message) {
    document.getElementById('content').innerHTML = `<div class="state-message">${escapeHtml(message)}</div>`;
  }

  async function loadAudit(clientId) {
    document.getElementById('topbar-client').textContent = clientId;
    document.getElementById('sidebar-client').textContent = clientId;

    const response = await fetch(`${apiBaseUrl}/audit-results/${encodeURIComponent(clientId)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (response.status === 404) {
      renderError(`Todavía no hay auditorías registradas para "${clientId}".`);
      return;
    }

    if (!response.ok) {
      renderError(`No se pudo cargar la auditoría (HTTP ${response.status}).`);
      return;
    }

    const data = await response.json();
    document.getElementById('content').innerHTML = `
      ${renderSummary(data.resumen)}
      ${renderList(data.resultados)}
      <div class="footer-meta">
        <span>Última auditoría: ${formatDate(data.auditedAt)}</span>
        <span>clientId: ${escapeHtml(data.clientId)}</span>
      </div>
    `;
  }

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/login.html';
  });

  async function init() {
    const sessionCheck = await fetch('/api/session', { credentials: 'same-origin' });
    if (!sessionCheck.ok) {
      redirectToLogin();
      return;
    }

    const clientId = getClientIdFromUrl();
    if (!clientId) {
      renderError('Falta el parámetro ?clientId=<id> en la URL.');
      return;
    }

    loadAudit(clientId).catch((err) => {
      renderError(`Error inesperado cargando la auditoría: ${err.message}`);
    });
  }

  init();
})();
