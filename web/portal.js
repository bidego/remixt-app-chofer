/* ============================================================
   REMIXT · Utilidades de interfaz para login, chofer y pasajero
   ============================================================ */
(function () {
  const ESTADOS = {
    pendiente: { txt: 'Buscando chofer', corto: 'Pendiente', cls: 'tag--amber' },
    asignado: { txt: 'Chofer asignado', corto: 'Asignado', cls: 'tag--blue' },
    en_curso: { txt: 'En viaje', corto: 'En curso', cls: 'tag--green' },
    finalizado: { txt: 'Finalizado', corto: 'Finalizado', cls: 'tag--gray' },
    cancelado: { txt: 'Cancelado', corto: 'Cancelado', cls: 'tag--red' },
  };
  const ACTIVOS = ['pendiente', 'asignado', 'en_curso'];
  let toastTimer = null;

  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const money = (value) => `$ ${new Intl.NumberFormat('es-AR').format(Number(value || 0))}`;
  const iniciales = (nombre) => String(nombre || '').trim().split(/\s+/).slice(0, 2)
    .map((p) => p[0] || '').join('').toUpperCase() || '—';
  const telHref = (telefono) => `tel:${String(telefono || '').replace(/[^\d+]/g, '')}`;
  const mapaHref = (origen, destino) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origen)}&destination=${encodeURIComponent(destino)}`;

  function estadoTag(estado, corto = false) {
    const e = ESTADOS[estado] || { txt: estado || '—', corto: estado || '—', cls: 'tag--gray' };
    return `<span class="tag ${e.cls}">${escapeHtml(corto ? e.corto : e.txt)}</span>`;
  }

  function rutaHtml(viaje) {
    return `<div class="trip-route">
      <div><span class="dot dot--origin"></span><span>${escapeHtml(viaje.origen || '—')}</span></div>
      <div><span class="dot dot--dest"></span><span>${escapeHtml(viaje.destino || '—')}</span></div>
    </div>`;
  }

  function toast(message, tone = 'info') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast is-visible${tone === 'error' ? ' toast--error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
  }

  /** Deshabilita el botón mientras corre la acción y muestra el error si falla. */
  async function conBoton(boton, texto, accion) {
    const original = boton ? boton.textContent : '';
    if (boton) { boton.disabled = true; boton.textContent = texto; }
    try {
      return await accion();
    } finally {
      if (boton && boton.isConnected) { boton.disabled = false; boton.textContent = original; }
    }
  }

  window.RemixtUI = {
    ESTADOS, ACTIVOS, $, escapeHtml, money, iniciales, telHref, mapaHref, estadoTag, rutaHtml, toast, conBoton,
  };
})();
