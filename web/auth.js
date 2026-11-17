/* ============================================================
   REMIXT · Sesión compartida por todas las páginas
   Guarda una sesión por rol (operador, chofer, pasajero), agrega
   el token a cada request y autentica el WebSocket.
   ============================================================ */
(function () {
  const API_BASE = (window.REMIXT_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const WS_URL = `${(window.REMIXT_WS_URL || API_BASE.replace(/^http/, 'ws')).replace(/\/$/, '')}/ws`;
  const HOME = { operador: 'index.html', chofer: 'chofer.html', pasajero: 'pasajero.html' };
  const WS_NO_AUTORIZADO = 4401;
  const clave = (rol) => `remixt:sesion:${rol}`;

  class ApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details || {};
    }
  }

  function leer(rol) {
    try {
      const sesion = JSON.parse(localStorage.getItem(clave(rol)));
      if (!sesion?.token || sesion.usuario?.rol !== rol) return null;
      if (sesion.expiraEn && Date.parse(sesion.expiraEn) <= Date.now()) {
        borrar(rol);
        return null;
      }
      return sesion;
    } catch (err) {
      return null;
    }
  }

  function guardar(data) {
    const sesion = { token: data.token, expiraEn: data.expiraEn, usuario: data.usuario, laxo: Boolean(data.laxo) };
    localStorage.setItem(clave(sesion.usuario.rol), JSON.stringify(sesion));
    return sesion;
  }

  function borrar(rol) {
    try { localStorage.removeItem(clave(rol)); } catch (err) { /* sin almacenamiento */ }
  }

  /** Request a la API. Con `rol` agrega el token de esa sesión y avisa si venció. */
  async function api(method, path, body, { rol = null, onUnauthorized = null, timeout = 8000 } = {}) {
    const sesion = rol ? leer(rol) : null;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (sesion) headers.Authorization = `Bearer ${sesion.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (err) { json = {}; }
      if (!res.ok) {
        // Sólo se descarta la sesión si sigue siendo la misma que usó este request.
        if (res.status === 401 && sesion && leer(rol)?.token === sesion.token) {
          borrar(rol);
          if (onUnauthorized) onUnauthorized();
        }
        throw new ApiError(json.error || `HTTP ${res.status}`, res.status, json.details);
      }
      return json;
    } catch (err) {
      if (err.name === 'AbortError') throw new ApiError('Tiempo de espera agotado', 0);
      if (err instanceof TypeError) throw new ApiError('No se pudo conectar con la API', 0);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function irALogin(rol) {
    const destino = rol === 'pasajero' ? HOME.pasajero : `login.html${rol === 'chofer' ? '?rol=chofer' : ''}`;
    window.location.replace(destino);
  }

  /** Devuelve la sesión del rol o redirige al login si no hay una vigente. */
  function exigir(rol) {
    const sesion = leer(rol);
    if (!sesion) irALogin(rol);
    return sesion;
  }

  function salir(rol) {
    borrar(rol);
    irALogin(rol);
  }

  /**
   * WebSocket autenticado con reconexión. `onEstado(true|false)` informa la
   * conexión y `onExpirada()` se llama si el servidor rechaza la sesión.
   */
  function conectar(rol, { onMensaje, onEstado = () => {}, onExpirada = () => {} } = {}) {
    let ws = null;
    let reintento = null;
    let intentos = 0;
    let cerrado = false;

    function programar() {
      if (cerrado) return;
      intentos += 1;
      reintento = setTimeout(abrir, Math.min(1000 * 2 ** (intentos - 1), 15000));
    }

    function abrir() {
      if (cerrado || typeof WebSocket === 'undefined') return;
      const sesion = leer(rol);
      if (!sesion) return;
      try { ws = new WebSocket(WS_URL); } catch (err) { programar(); return; }

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: sesion.token }));
      });
      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        let msg;
        try { msg = JSON.parse(event.data); } catch (err) { return; }
        if (msg.type === 'hello') { intentos = 0; onEstado(true); }
        if (onMensaje) onMensaje(msg);
      });
      ws.addEventListener('close', (event) => {
        ws = null;
        onEstado(false);
        if (event.code === WS_NO_AUTORIZADO) {
          if (leer(rol)?.token === sesion.token) { borrar(rol); onExpirada(); }
          else programar();
          return;
        }
        programar();
      });
      ws.addEventListener('error', () => {
        try { ws.close(); } catch (err) { /* el close programa el reintento */ }
      });
    }

    abrir();
    return {
      reiniciar() {
        clearTimeout(reintento);
        intentos = 0;
        if (ws) { try { ws.close(); } catch (err) { /* ya cerrado */ } } else abrir();
      },
      cerrar() {
        cerrado = true;
        clearTimeout(reintento);
        if (ws) { try { ws.close(); } catch (err) { /* ya cerrado */ } }
      },
    };
  }

  window.RemixtAuth = {
    API_BASE, WS_URL, HOME, ApiError,
    leer, guardar, borrar, api, exigir, salir, irALogin, conectar,
  };
})();
