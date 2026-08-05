/**
 * Dashboard estático del Auditor de Capacidades.
 *
 * SEGURIDAD: esta página NO debe desplegarse como sitio público (S3/CloudFront
 * abierto) llamando directamente a la API Gateway con credenciales embebidas
 * en el navegador. La API de consulta usa autorización IAM (SigV4) — este
 * archivo asume que se sirve detrás de un backend/BFF interno de Janis ya
 * autenticado (SSO), que firma o reenvía la llamada a
 * GET /audit-results/{clientId}. Ver docs/DEPLOYMENT_PLAN.md,
 * "Decisión pendiente: auth del dashboard".
 *
 * Configuración: definir window.OMS_AUDITOR_CONFIG = { apiBaseUrl: '...' }
 * antes de cargar este script si el proxy no vive en la misma ruta relativa
 * '/api'. Por defecto usa esa ruta relativa.
 */

(function () {
  const config = window.OMS_AUDITOR_CONFIG || {};
  const apiBaseUrl = config.apiBaseUrl || '/api';

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
      return new Date(iso).toLocaleString('es-AR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (e) {
      return iso;
    }
  }

  function renderSummary(resumen) {
    return `
      <div class="summary-row">
        <div class="summary-card total">
          <div>
            <div class="label">Capacidades evaluadas</div>
            <div class="value">${resumen.total}</div>
          </div>
          <div class="summary-icon">Σ</div>
        </div>
        <div class="summary-card lo-usa">
          <div>
            <div class="label">Lo usa</div>
            <div class="value">${resumen.loUsa}</div>
          </div>
          <div class="summary-icon">✓</div>
        </div>
        <div class="summary-card no-lo-usa">
          <div>
            <div class="label">No lo usa</div>
            <div class="value">${resumen.noLoUsa}</div>
          </div>
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
    if (resultados.length === 0) {
      return '<div class="state-message">No hay capacidades para mostrar.</div>';
    }
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

    if (response.status === 404) {
      renderError(`Todavía no hay auditorías registradas para "${clientId}".`);
      return;
    }

    if (!response.ok) {
      renderError(`No se pudo cargar la auditoría (HTTP ${response.status}). Verificá que tu sesión interna esté activa.`);
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

  const clientId = getClientIdFromUrl();
  if (!clientId) {
    renderError('Falta el parámetro ?clientId=<id> en la URL.');
  } else {
    loadAudit(clientId).catch((err) => {
      renderError(`Error inesperado cargando la auditoría: ${err.message}`);
    });
  }
})();
