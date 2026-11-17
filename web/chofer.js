/* ============================================================
   REMIXT · App Chofer
   Viajes asignados (aceptar / rechazar / iniciar / finalizar),
   disponibilidad y perfil del chofer autenticado.
   ============================================================ */
(function () {
  const Auth = window.RemixtAuth;
  const Geo = window.RemixGeo;
  const {
    $, escapeHtml, money, iniciales, telHref, mapaHref, estadoTag, toast, conBoton,
  } = window.RemixtUI;
  const ROL = 'chofer';
  const POLL_MS = 15000;
  const ESTADO_CHOFER = { disponible: 'Disponible', en_viaje: 'En viaje', desconectado: 'Desconectado' };

  if (!Auth.exigir(ROL)) return;

  const state = { chofer: null, viajes: [], tab: 'viajes', firma: '', vistos: null, error: '' };
  const geoMapa = Geo ? Geo.crear() : null;
  let watchId = null;

  const api = (method, path, body) => Auth.api(method, path, body, { rol: ROL, onUnauthorized: () => Auth.irALogin(ROL) });
  const km = (v) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(v.distanciaKm || 0));
  const minutos = (v) => Math.max(1, Math.round(Number(v.distanciaKm || 0) * 2));
  const viajeActual = () => state.viajes.find((v) => v.estado === 'en_curso')
    || state.viajes.find((v) => v.estado === 'asignado') || null;
  const viajeEnCurso = () => state.viajes.find((v) => v.estado === 'en_curso') || null;
  let idRastreando = null;
  let ultimoEnvio = 0;

  /* ---------- Datos ---------- */
  async function cargar({ forzar = false } = {}) {
    let chofer;
    let viajes;
    try {
      [chofer, viajes] = await Promise.all([
        api('GET', '/api/mi/chofer').then((r) => r.data),
        api('GET', '/api/mi/viajes').then((r) => r.data || []),
      ]);
      state.error = '';
    } catch (err) {
      if (err.status === 401) return;
      state.error = err.message;
      if (!state.chofer) render();
      return;
    }

    const ofertas = viajes.filter((v) => v.estado === 'asignado' && !v.aceptado).map((v) => v.id);
    if (state.vistos && ofertas.some((id) => !state.vistos.has(id))) {
      toast('Tenés un nuevo viaje asignado');
      if (navigator.vibrate) navigator.vibrate(200);
    }
    state.vistos = new Set(ofertas);

    state.chofer = chofer;
    state.viajes = viajes;
    if (geoMapa) geoMapa.actualizar(viajeActual());
    actualizarTracking();
    const firma = JSON.stringify([chofer.estado, chofer.viajesHoy, chofer.rating, viajes.map((v) => [v.id, v.estado, v.aceptado])]);
    if (!forzar && firma === state.firma) return;
    state.firma = firma;
    render();
  }

  /* ---------- Vistas ---------- */
  function rutaHtml(v, chica = false) {
    return `<div class="stops${chica ? ' stops--sm' : ''}">
      <div class="stops__item"><span class="stops__dot"></span><div><strong>${escapeHtml(v.origen)}</strong><span>Origen</span></div></div>
      <div class="stops__item stops__item--dest"><span class="stops__dot"></span><div><strong>${escapeHtml(v.destino)}</strong><span>Destino</span></div></div>
    </div>`;
  }

  function pasajeroHtml(v) {
    return `<div class="pax">
      <div class="avatar">${escapeHtml(iniciales(v.pasajero))}</div>
      <div class="pax__meta"><strong>${escapeHtml(v.pasajero)}</strong><span>${escapeHtml(v.telefono || 'Sin teléfono')}${v.notas ? ` · ${escapeHtml(v.notas)}` : ''}</span></div>
      ${v.telefono ? `<a class="btn btn--outline btn--sm" href="${escapeHtml(telHref(v.telefono))}">Llamar</a>` : ''}
    </div>`;
  }

  function datosHtml(v) {
    return `<div class="driver-screen__facts">
      <span>Distancia: ${km(v)} km</span><span>Tiempo: ${minutos(v)} min</span><span>${money(v.precio)}</span>
    </div>`;
  }

  function viajeHtml(v) {
    if (v.estado === 'en_curso') {
      return `<h1>Viaje en curso</h1>${rutaHtml(v)}${pasajeroHtml(v)}${datosHtml(v)}
        <div class="driver-screen__actions">
          <button class="btn btn--success btn--block" type="button" data-accion="finalizar" data-id="${escapeHtml(v.id)}">Finalizar viaje</button>
          <button class="btn btn--outline btn--block" type="button" data-accion="verMapa">● Ver recorrido en vivo</button>
        </div>`;
    }
    if (v.aceptado) {
      return `<h1>Pasajero esperando</h1>${rutaHtml(v)}${pasajeroHtml(v)}${datosHtml(v)}
        <div class="driver-screen__actions">
          <button class="btn btn--success btn--block" type="button" data-accion="iniciar" data-id="${escapeHtml(v.id)}">Iniciar viaje</button>
          <button class="btn btn--outline btn--block" type="button" data-accion="verMapa">Ver recorrido</button>
          <button class="link-btn" type="button" data-accion="rechazar" data-id="${escapeHtml(v.id)}">No puedo realizarlo</button>
        </div>`;
    }
    return `<h1>Nuevo viaje</h1>${rutaHtml(v)}${datosHtml(v)}
      <div class="driver-screen__actions">
        <button class="btn btn--success btn--block" type="button" data-accion="aceptar" data-id="${escapeHtml(v.id)}">✓ Aceptar</button>
        <button class="btn btn--outline btn--block" type="button" data-accion="rechazar" data-id="${escapeHtml(v.id)}">✕ Rechazar</button>
      </div>`;
  }

  function sinViajeHtml() {
    const desconectado = state.chofer.estado === 'desconectado';
    return `<h1>${desconectado ? 'Estás desconectado' : 'Sin viajes por ahora'}</h1>
      <p class="driver-screen__empty">${desconectado
        ? 'Tocá tu estado para volver a recibir viajes.'
        : 'Cuando la central te asigne un viaje va a aparecer acá.'}</p>`;
  }

  function historialHtml() {
    const actual = viajeActual();
    const otros = state.viajes.filter((v) => v.id !== actual?.id);
    if (!otros.length) return '';
    return `<section class="pcard" style="margin-top:22px">
      <h2>Mis viajes</h2>
      <ul class="trip-list">${otros.slice(0, 15).map((v) => `<li>
        <div class="trip-list__info"><strong>${escapeHtml(v.origen)} → ${escapeHtml(v.destino)}</strong>
          <span>${escapeHtml(v.id)} · ${escapeHtml(v.pasajero)} · ${escapeHtml(v.hora || '—')} · ${money(v.precio)}</span></div>
        ${estadoTag(v.estado, true)}</li>`).join('')}</ul>
    </section>`;
  }

  function viajesTabHtml() {
    const c = state.chofer;
    const actual = viajeActual();
    // Con un viaje ofrecido que todavía no aceptó, el chofer sigue figurando disponible.
    const oferta = actual?.estado === 'asignado' && !actual.aceptado;
    const visible = oferta && c.estado === 'en_viaje' ? 'disponible' : c.estado;
    return `<div class="driver-screen">
        <button class="status-pill is-${escapeHtml(visible)}" type="button" data-accion="estado"
          ${c.estado === 'en_viaje' ? 'disabled' : ''} aria-label="Cambiar disponibilidad">${escapeHtml(ESTADO_CHOFER[visible] || visible)}</button>
        ${actual ? viajeHtml(actual) : sinViajeHtml()}
      </div>${historialHtml()}`;
  }

  function mapaTabHtml() {
    const actual = viajeActual();
    if (!actual) {
      return '<div class="driver-screen"><h1>Mapa</h1><p class="driver-screen__empty">No tenés un viaje activo. Cuando aceptes uno vas a poder abrir el recorrido desde acá.</p></div>';
    }
    return `<div class="driver-screen"><h1>Recorrido</h1>${rutaHtml(actual)}${datosHtml(actual)}
      <div class="driver-screen__actions">
        <button class="btn btn--primary btn--block" type="button" data-accion="verMapa">Abrir mapa en vivo</button>
        <a class="btn btn--outline btn--block" target="_blank" rel="noopener" href="${escapeHtml(mapaHref(actual.origen, actual.destino))}">Abrir en Google Maps</a>
      </div></div>`;
  }

  function perfilTabHtml() {
    const c = state.chofer;
    const finalizados = state.viajes.filter((v) => v.estado === 'finalizado').length;
    return `<section class="pcard" style="margin-top:8px">
        <div class="pax" style="margin:0 0 14px;border:0;padding:0;background:none">
          <div class="avatar">${escapeHtml(c.iniciales || iniciales(c.nombre))}</div>
          <div class="pax__meta"><strong>${escapeHtml(c.nombre)}</strong><span>${escapeHtml(c.vehiculo || '—')} · ${escapeHtml(c.patente || '—')}</span></div>
        </div>
        <div class="stat-trio">
          <div><strong>${escapeHtml(c.viajesHoy ?? 0)}</strong><span>Viajes hoy</span></div>
          <div><strong>★ ${escapeHtml(c.rating ?? '—')}</strong><span>Rating</span></div>
          <div><strong>${finalizados}</strong><span>Finalizados</span></div>
        </div>
      </section>
      <section class="pcard">
        <h2>Cambiar clave</h2>
        <p class="pcard__sub">Si todavía usás la clave inicial, cambiala por una propia.</p>
        <form class="pform" id="claveForm">
          <div class="pfield"><label for="cActual">Clave actual</label>
            <input id="cActual" name="actual" type="password" autocomplete="current-password" required /></div>
          <div class="pfield"><label for="cNueva">Clave nueva</label>
            <input id="cNueva" name="nueva" type="password" autocomplete="new-password" minlength="6" required />
            <small>Mínimo 6 caracteres.</small></div>
          <p class="pform__error" id="claveError" role="alert" hidden></p>
          <button class="btn btn--primary btn--block" type="submit">Guardar clave</button>
        </form>
      </section>
      <button class="btn btn--outline btn--block" type="button" data-accion="salir">Cerrar sesión</button>`;
  }

  function render() {
    const main = $('#main');
    if (!state.chofer) {
      main.innerHTML = `<div class="driver-screen"><h1>${state.error ? 'Sin conexión' : 'Cargando…'}</h1>
        <p class="driver-screen__empty">${escapeHtml(state.error || '')}</p></div>`;
      return;
    }
    if (state.tab === 'perfil') {
      const form = $('#claveForm');
      if (form && Array.from(form.elements).some((el) => el.value)) return;
    }
    main.innerHTML = state.tab === 'mapa' ? mapaTabHtml()
      : state.tab === 'perfil' ? perfilTabHtml() : viajesTabHtml();
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    const form = $('#claveForm');
    if (form) form.reset();
    render();
    $('#main').scrollTop = 0;
  }

  /* ---------- Seguimiento GPS (sólo mientras el viaje está en curso) ---------- */
  function detenerGps() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    idRastreando = null;
  }

  function actualizarTracking() {
    const viaje = viajeEnCurso();
    if (!viaje) { if (watchId !== null) detenerGps(); return; }
    if (watchId !== null && idRastreando === viaje.id) return;
    if (watchId !== null) detenerGps();
    if (!navigator.geolocation) {
      toast('Este dispositivo no puede informar tu ubicación', 'error');
      return;
    }
    idRastreando = viaje.id;
    ultimoEnvio = 0;
    watchId = navigator.geolocation.watchPosition(async (pos) => {
      const ahora = Date.now();
      if (ahora - ultimoEnvio < 5000) return;
      ultimoEnvio = ahora;
      const viajeId = idRastreando;
      try {
        await api('POST', `/api/mi/viajes/${viajeId}/ubicacion`, {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precision: pos.coords.accuracy,
        });
      } catch (err) {
        // Si el viaje terminó, el próximo ciclo detiene el watcher.
      }
    }, (err) => {
      detenerGps();
      toast(err.code === 1 ? 'Activá el permiso de ubicación para el seguimiento' : 'No se pudo obtener tu ubicación', 'error');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
  }

  /* ---------- Acciones ---------- */
  const ACCIONES = {
    aceptar: { texto: 'Aceptando…', run: (id) => api('POST', `/api/mi/viajes/${id}/aceptar`), ok: '✓ Viaje aceptado' },
    rechazar: { texto: 'Rechazando…', run: (id) => api('POST', `/api/mi/viajes/${id}/rechazar`), ok: 'Viaje rechazado', confirmar: '¿Rechazar este viaje? Se le asignará a otro chofer.' },
    iniciar: { texto: 'Iniciando…', run: (id) => api('PATCH', `/api/mi/viajes/${id}/estado`, { estado: 'en_curso' }), ok: '✓ Viaje iniciado' },
    finalizar: { texto: 'Finalizando…', run: (id) => api('PATCH', `/api/mi/viajes/${id}/estado`, { estado: 'finalizado' }), ok: '✓ Viaje finalizado', confirmar: '¿Finalizar el viaje?' },
    estado: {
      texto: 'Actualizando…',
      run: () => api('PATCH', '/api/mi/estado', { estado: state.chofer.estado === 'desconectado' ? 'disponible' : 'desconectado' }),
      ok: 'Estado actualizado',
    },
  };

  async function ejecutar(boton) {
    const accion = ACCIONES[boton.dataset.accion];
    if (!accion) return;
    if (accion.confirmar && !window.confirm(accion.confirmar)) return;
    await conBoton(boton, accion.texto, async () => {
      try {
        await accion.run(boton.dataset.id);
        toast(accion.ok);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    await cargar({ forzar: true });
  }

  async function cambiarClave(form) {
    const error = $('#claveError');
    error.hidden = true;
    await conBoton(form.querySelector('button[type="submit"]'), 'Guardando…', async () => {
      try {
        const res = await api('POST', '/api/auth/password', Object.fromEntries(new FormData(form)));
        Auth.guardar(res.data);
        form.reset();
        socket.reiniciar();
        toast('✓ Clave actualizada');
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  }

  /* ---------- Eventos ---------- */
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('#tabbar button[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    const boton = event.target.closest('[data-accion]');
    if (boton?.dataset.accion === 'verMapa') {
      const v = viajeActual();
      if (v && geoMapa) geoMapa.abrir(v);
      else toast('Todavía no hay un recorrido para mostrar', 'error');
      return;
    }
    if (event.target.closest('[data-geo="cerrar"]') && geoMapa) { geoMapa.cerrar(); return; }
    if (!boton) return;
    if (boton.dataset.accion === 'salir') { Auth.salir(ROL); return; }
    ejecutar(boton);
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'claveForm') return;
    event.preventDefault();
    cambiarClave(event.target);
  });

  const socket = Auth.conectar(ROL, {
    onMensaje: (msg) => {
      if (msg.type === 'viaje:ubicacion') return;
      if (msg.type !== 'hello') cargar();
    },
    onEstado: (enVivo) => {
      const conn = $('#conn');
      conn.classList.toggle('is-live', enVivo);
      conn.querySelector('span').textContent = enVivo ? 'En vivo' : 'Reconectando…';
    },
    onExpirada: () => Auth.irALogin(ROL),
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
  setInterval(() => { if (!document.hidden) cargar(); }, POLL_MS);

  render();
  cargar({ forzar: true });
})();
