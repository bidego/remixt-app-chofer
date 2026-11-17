/* ============================================================
   REMIXT · Frontend de gestión y despacho
   Todo el estado se carga desde la API (PostgreSQL / JSON).
   No hay datos mock: si la API no está disponible se muestran
   estados vacíos y se informa el problema.
   ============================================================ */

/* ---------- CONFIG ---------- */
const Auth = window.RemixtAuth;
const ROL = 'operador';
// Sin sesión de operador vigente, `exigir` redirige al login y la app no arranca.
const SESION = Auth.exigir(ROL);
const API_BASE = Auth.API_BASE;
const WS_URL = Auth.WS_URL.replace(/\/ws$/, '');
const WS_PATH = '/ws';
const WS_NO_AUTORIZADO = 4401;
const PAGE_SIZE = 10;

const ESTADOS_CHOFER = [
  { value: 'disponible', label: 'Disponible' },
  { value: 'en_viaje', label: 'En viaje' },
  { value: 'desconectado', label: 'Desconectado' },
];
const ESTADOS_VEHICULO = [
  { value: 'activo', label: 'Activo' },
  { value: 'en_viaje', label: 'En viaje' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
];
const TIPOS_CLIENTE = [
  { value: 'particular', label: 'Particular' },
  { value: 'corporativo', label: 'Corporativo' },
  { value: 'reservas', label: 'Reservas' },
];
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const estadoLabel = {
  pendiente: { txt: 'Pendiente', cls: 'tag--amber' },
  asignado: { txt: 'Asignado', cls: 'tag--blue' },
  en_curso: { txt: 'En curso', cls: 'tag--green' },
  finalizado: { txt: 'Finalizado', cls: 'tag--gray' },
  cancelado: { txt: 'Cancelado', cls: 'tag--red' },
  // Sólo aparecen en el historial del viaje (acciones del chofer desde su app).
  aceptado: { txt: 'Aceptado', cls: 'tag--blue' },
  rechazado: { txt: 'Rechazado', cls: 'tag--red' },
};
const reservaEstadoLabel = {
  pendiente: { txt: 'Pendiente', cls: 'tag--amber' },
  confirmada: { txt: 'Confirmada', cls: 'tag--green' },
  cancelada: { txt: 'Cancelada', cls: 'tag--red' },
  completada: { txt: 'Completada', cls: 'tag--gray' },
};
const choferEstadoLabel = {
  disponible: { txt: 'disponible', cls: 'tag--green' },
  en_viaje: { txt: 'en viaje', cls: 'tag--blue' },
  desconectado: { txt: 'desconectado', cls: 'tag--gray' },
};

const DEFAULT_PREFS = { autoAssign: true, whatsapp: true, corporate: false, gps: true };

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('remixt:prefs') || '{}') };
  } catch (err) {
    return { ...DEFAULT_PREFS };
  }
}

const state = {
  apiOnline: false,
  wsOnline: false,
  view: 'operaciones',
  adminTab: 'resumen',
  configTab: 'tarifas',
  filter: 'todos',
  search: '',
  page: 1,
  viajes: [],
  viajesMeta: { page: 1, limit: PAGE_SIZE, total: 0, pages: 0, counts: {} },
  allViajes: [],
  allViajesLoaded: false,
  choferes: [],
  vehiculos: [],
  clientes: [],
  reservas: [],
  liquidaciones: [],
  tarifas: [],
  dashboard: null,
  selectedViajeId: null,
  selectedViaje: null,
  prefs: loadPrefs(),
};

let ws = null;
let wsRetry = null;
let wsAttempts = 0;
const mutedRealtime = {};
let toastTimer = null;
let refreshTimer = null;
let searchTimer = null;
let modalSubmit = null;

/* ---------- HELPERS ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function money(value) { return `$ ${new Intl.NumberFormat('es-AR').format(Number(value || 0))}`; }
function num(value) { return new Intl.NumberFormat('es-AR').format(Number(value || 0)); }
function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '—';
}
function debounce(fn, ms) {
  return (...args) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => fn(...args), ms);
  };
}
function tag(text, cls = 'tag--gray') {
  return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}
function estadoTag(estado) {
  const s = estadoLabel[estado] || { txt: estado || '—', cls: 'tag--gray' };
  return tag(s.txt, s.cls);
}
function reservaTag(estado) {
  const s = reservaEstadoLabel[estado] || { txt: estado || '—', cls: 'tag--gray' };
  return tag(s.txt, s.cls);
}
function choferTag(estado) {
  const s = choferEstadoLabel[estado] || { txt: estado || '—', cls: 'tag--gray' };
  return tag(s.txt, s.cls);
}
function tipoTag(tipo) {
  const cls = tipo === 'corporativo' ? 'tag--blue' : tipo === 'reservas' ? 'tag--amber' : 'tag--gray';
  return tag(tipo || '—', cls);
}
function persona(nombre) {
  return `<div style="display:flex;align-items:center;gap:9px"><div class="person__avatar" style="width:30px;height:30px;flex:0 0 30px;font-size:10px">${escapeHtml(initials(nombre))}</div><span class="pax-name">${escapeHtml(nombre || '—')}</span></div>`;
}
function routeHtml(origen, destino) {
  return `<span class="route"><span class="dot dot--origin"></span>${escapeHtml(origen || '—')}<span class="arrow">→</span><span class="dot dot--dest"></span>${escapeHtml(destino || '—')}</span>`;
}
function clockTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function todayLong() {
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
}
function toast(message, tone = 'info') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast is-visible${tone === 'error' ? ' toast--error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3600);
}
function actionToast(message) {
  /* Si el WebSocket está activo, el evento emitido por la API muestra el aviso.
     Si no, mostramos uno local para que la acción nunca quede sin feedback. */
  if (!state.wsOnline) toast(message);
}
function confirmar(message) {
  return window.confirm(message);
}
function muteRealtime(prefix, ms = 1800) {
  mutedRealtime[prefix] = Date.now() + ms;
}
function isRealtimeMuted(prefix) {
  return (mutedRealtime[prefix] || 0) > Date.now();
}

function setApiBadge(mode) {
  const badge = $('#apiBadge');
  if (!badge) return;
  badge.className = `api-badge api-badge--${mode}`;
  badge.textContent = mode === 'live' ? 'API · En vivo'
    : mode === 'online' ? 'API conectada'
      : mode === 'loading' ? 'Conectando…' : 'API sin conexión';
}
function refreshBadge() {
  setApiBadge(state.wsOnline ? 'live' : state.apiOnline ? 'online' : 'offline');
  const status = $('#systemStatus');
  if (status) {
    status.textContent = state.wsOnline ? 'Sistema en vivo'
      : state.apiOnline ? 'Sistema conectado' : 'Sistema sin conexión';
  }
}
function tickClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  const time = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const clock = $('#systemClock');
  if (clock) clock.textContent = `${date} · ${time}`;
  const adminDate = $('#adminDate');
  if (adminDate) adminDate.textContent = date;
}

/* ---------- API ---------- */
function sesionVencida() {
  Auth.borrar(ROL);
  Auth.irALogin(ROL);
}

function api(method, path, body) {
  return Auth.api(method, path, body, { rol: ROL, onUnauthorized: sesionVencida, timeout: 7000 });
}

function withParams(path, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, v);
  });
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

async function fetchAll(path) {
  const first = await api('GET', withParams(path, { page: 1, limit: 100 }));
  const pages = Number(first.meta?.pages || 1);
  let data = Array.isArray(first.data) ? first.data : [];
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => api('GET', withParams(path, { page: i + 2, limit: 100 })))
    );
    rest.forEach((r) => { if (Array.isArray(r.data)) data = data.concat(r.data); });
  }
  return data;
}

/* ---------- CARGA DE DATOS ---------- */
async function loadDashboard() {
  state.dashboard = await api('GET', '/api/dashboard');
}

async function loadViajes() {
  const params = { page: state.page, limit: PAGE_SIZE };
  if (state.filter !== 'todos') params.estado = state.filter === 'curso' ? 'en_curso' : state.filter;
  if (state.search) params.q = state.search;
  const res = await api('GET', withParams('/api/viajes', params));
  state.viajes = Array.isArray(res.data) ? res.data : [];
  state.viajesMeta = res.meta || state.viajesMeta;
  const pages = Number(state.viajesMeta.pages || 0);
  if (pages > 0 && state.page > pages) {
    state.page = pages;
    return loadViajes();
  }
}

async function loadAllViajes() {
  state.allViajes = await fetchAll('/api/viajes');
  state.allViajesLoaded = true;
}

async function loadChoferes() {
  state.choferes = await fetchAll('/api/choferes');
}
async function loadVehiculos() {
  state.vehiculos = await fetchAll('/api/vehiculos');
}
async function loadClientes() {
  state.clientes = await fetchAll('/api/clientes');
}
async function loadReservas() {
  state.reservas = await fetchAll('/api/reservas');
}
async function loadLiquidaciones() {
  state.liquidaciones = await fetchAll('/api/liquidaciones');
}
async function loadTarifas() {
  state.tarifas = await fetchAll('/api/tarifas');
}

async function refreshData(showToast = false) {
  const results = await Promise.allSettled([
    loadDashboard(), loadViajes(), loadChoferes(), loadVehiculos(),
    loadClientes(), loadReservas(), loadLiquidaciones(), loadTarifas(), loadAllViajes(),
  ]);
  state.apiOnline = results.some((r) => r.status === 'fulfilled');
  refreshBadge();
  renderAll();
  if (state.selectedViajeId) renderDetail(findViaje(state.selectedViajeId));
  if (showToast) toast(state.apiOnline ? 'Datos sincronizados con la API' : 'No se pudo conectar con la API', state.apiOnline ? 'info' : 'error');
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshData(false); }, 400);
}

async function ensureAllViajes() {
  if (state.allViajesLoaded) return;
  try {
    await loadAllViajes();
  } catch (err) {
    toast(`No se pudieron cargar los viajes: ${err.message}`, 'error');
  }
}

function findViaje(id) {
  return state.viajes.find((v) => v.id === id)
    || state.allViajes.find((v) => v.id === id)
    || (state.selectedViaje?.id === id ? state.selectedViaje : null);
}

function ensureSelection() {
  if (state.selectedViajeId) {
    const actual = findViaje(state.selectedViajeId);
    if (actual) { renderDetail(actual); return; }
  }
  const first = state.viajes[0] || state.allViajes[0];
  if (first) {
    state.selectedViajeId = first.id;
    state.selectedViaje = first;
    renderDetail(first);
  } else {
    renderDetail(null);
  }
}

async function openViaje(id) {
  let viaje = findViaje(id);
  if (!viaje) {
    try {
      const res = await api('GET', `/api/viajes/${id}`);
      viaje = res.data;
    } catch (err) {
      toast(`No se pudo abrir el viaje ${id}: ${err.message}`, 'error');
      return;
    }
  }
  state.selectedViajeId = id;
  state.selectedViaje = viaje;
  setView('operaciones', { silent: true });
  renderDetail(viaje);
  renderViajes();
}

/* ---------- RENDER GENERAL ---------- */
function renderAll() {
  renderKpis();
  renderChart();
  renderDistribution();
  renderViajes();
  renderPagination();
  renderBadges();
  renderNotifications();
  renderChoferes();
  renderVehiculos();
  renderClientes();
  renderLiquidaciones();
  renderTarifas();
  renderReservas();
  renderInformes();
  renderReportCards($('#reportGrid'));
  if (state.view === 'liquidaciones' && state.adminTab !== 'resumen') renderAdminTab(state.adminTab);
}

function renderKpis() {
  const k = state.dashboard?.kpis || {};
  $('#kpiViajes').textContent = num(k.viajesHoy || 0);
  $('#kpiChoferes').textContent = num(k.choferesDisponibles || 0);
  $('#kpiTotalChoferes').textContent = num(k.totalChoferes || 0);
  $('#kpiFacturacion').textContent = money(k.facturacionHoy || 0);
  $('#kpiPendientes').textContent = num(k.solicitudesPendientes || 0);

  $('#kpiViajesDelta').textContent = `${num(k.viajesEnCurso || 0)} en curso`;
  $('#kpiFacturacionDelta').textContent = `${num(k.viajesFinalizados || 0)} finalizados`;
  $('#kpiPendientesDelta').textContent = (k.solicitudesPendientes || 0) > 0 ? 'requieren atención' : 'todo al día';
  $('#kpiPendientesDelta').className = `kpi-card__delta ${(k.solicitudesPendientes || 0) > 0 ? 'kpi-card__delta--down' : 'kpi-card__delta--muted'}`;

  const tagEl = $('#requestTag');
  if (tagEl) {
    tagEl.textContent = `${num(k.solicitudesPendientes || 0)} pendientes`;
    tagEl.className = 'tag tag--amber';
  }

  const btn = $('#autoAssignBtn');
  const hayPendientes = state.allViajes.some((v) => v.estado === 'pendiente') || state.viajes.some((v) => v.estado === 'pendiente');
  if (btn) btn.disabled = !state.apiOnline || !hayPendientes;
  const solicitar = $('#solicitarBtn');
  if (solicitar) solicitar.disabled = !state.apiOnline;
}

function renderChart() {
  const series = state.dashboard?.series;
  const labels = series?.labels || [];
  const values = series?.hoy || [];
  const max = Math.max(...values, 1) * 1.12;
  const el = $('#barChart');
  if (!el) return;
  if (!labels.length) {
    el.innerHTML = '<div class="empty-state"><strong>Sin datos</strong>La API todavía no devolvió viajes.</div>';
    return;
  }
  el.innerHTML = labels.map((label, i) => `<div class="bar-group" title="${num(values[i] || 0)} viajes">
    <div class="bar" style="height:${Math.max(2, ((values[i] || 0) / max) * 100)}%"></div>
    <span>${escapeHtml(label)}h</span>
  </div>`).join('');
}

function renderDistribution() {
  const dist = state.dashboard?.distribucion || [];
  const total = dist.reduce((sum, d) => sum + Number(d.cantidad || 0), 0);
  let acc = 0;
  const stops = dist.map((d, i) => {
    const start = acc;
    acc += total ? (Number(d.cantidad || 0) / total) * 100 : 0;
    return `${['#165be5', '#ffb219', '#11b247'][i] || '#8c9ab2'} ${start}% ${acc}%`;
  });
  const donut = $('.donut');
  if (donut) donut.style.background = total ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#24365a 0 100%)';
  $('#donutCenter').textContent = num(total);
  $('#donutParticular').textContent = `${dist.find((d) => d.tipo === 'particular')?.porcentaje || 0}%`;
  $('#donutCorporativo').textContent = `${dist.find((d) => d.tipo === 'corporativo')?.porcentaje || 0}%`;
  $('#donutReservas').textContent = `${dist.find((d) => d.tipo === 'reservas')?.porcentaje || 0}%`;
}

function renderViajes() {
  const body = $('#viajesBody');
  const counts = state.viajesMeta.counts || {};
  $('#cntTodos').textContent = num(counts.todos || 0);
  $('#cntCurso').textContent = num(counts.en_curso || 0);
  $('#cntPendiente').textContent = num(counts.pendiente || 0);
  $('#cntFinalizado').textContent = num(counts.finalizado || 0);

  if (!state.viajes.length) {
    const msg = !state.apiOnline
      ? 'Sin conexión con la API. Iniciá remixt-api en http://localhost:3001.'
      : (state.search || state.filter !== 'todos' ? 'No hay viajes que coincidan con el filtro.' : 'Todavía no hay viajes registrados.');
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><strong>Sin viajes</strong>${escapeHtml(msg)}</div></td></tr>`;
  } else {
    body.innerHTML = state.viajes.map((v) => {
      const chofer = state.choferes.find((c) => c.id === v.choferId);
      return `<tr data-viaje-id="${escapeHtml(v.id)}" class="${v.id === state.selectedViajeId ? 'is-selected' : ''}">
        <td><span class="vj-id">${escapeHtml(v.id)}</span></td>
        <td>${persona(v.pasajero)}</td>
        <td>${routeHtml(v.origen, v.destino)}</td>
        <td><span class="pax-name">${escapeHtml(chofer?.nombre || v.choferNombre || '—')}</span></td>
        <td class="time-cell">${escapeHtml(v.hora || '—')}</td>
        <td>${estadoTag(v.estado)}</td>
        <td><button class="row-more" type="button" aria-label="Ver detalle">•••</button></td>
      </tr>`;
    }).join('');
  }

  const total = Number(state.viajesMeta.total || 0);
  const pages = Math.max(1, Number(state.viajesMeta.pages || 0));
  $('#viajesCount').textContent = state.apiOnline
    ? `Mostrando ${state.viajes.length} de ${total} viajes · Página ${state.viajesMeta.page || 1} de ${pages}`
    : 'Sin datos · API no disponible';
}

function renderPagination() {
  const el = $('#viajesPagination');
  if (!el) return;
  const page = Number(state.viajesMeta.page || 1);
  const pages = Number(state.viajesMeta.pages || 0);
  if (pages <= 1) { el.innerHTML = ''; return; }
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  el.innerHTML = `<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>`
    + nums.map((n) => (n === '…'
      ? '<span class="page-gap">…</span>'
      : `<button class="page-btn ${n === page ? 'is-active' : ''}" data-page="${n}">${n}</button>`)).join('')
    + `<button class="page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Siguiente">›</button>`;
}

function renderDetail(viaje = findViaje(state.selectedViajeId)) {
  const v = viaje;
  const timeline = $('#detailTimeline');
  const actions = ['compartirBtn', 'iniciarBtn', 'finalizarBtn', 'cancelarBtn'];
  if (!v) {
    $('#detailSub').textContent = state.apiOnline ? 'Seleccioná un viaje de la lista' : 'Sin conexión con la API';
    $('#detailTag').className = 'tag tag--gray';
    $('#detailTag').textContent = '—';
    $('#detailPasajero').textContent = '—';
    $('#detailTelefono').textContent = 'Pasajero · —';
    $('#detailPaxAvatar').textContent = '—';
    $('#detailChofer').textContent = 'Sin asignar';
    $('#detailChoferAvatar').textContent = '—';
    $('#detailVehiculo').textContent = '—';
    $('#detailRating').textContent = '—';
    $('#detailPrecio').textContent = '—';
    $('#llamarBtn').disabled = true;
    timeline.innerHTML = '<div class="empty-state"><strong>Sin viaje seleccionado</strong>Elegí un viaje de la tabla para ver su detalle.</div>';
    actions.forEach((id) => { const el = $(`#${id}`); if (el) el.hidden = true; });
    const mapa = $('#mapaBtn');
    if (mapa) mapa.hidden = true;
    return;
  }

  const s = estadoLabel[v.estado] || { txt: v.estado || '—', cls: 'tag--gray' };
  $('#detailSub').textContent = `${v.id} · ${s.txt}`;
  $('#detailTag').className = `tag ${s.cls}`;
  $('#detailTag').textContent = s.txt;
  $('#detailPasajero').textContent = v.pasajero || '—';
  $('#detailTelefono').textContent = `Pasajero · ${v.telefono || '—'}`;
  $('#detailPaxAvatar').textContent = initials(v.pasajero);

  const chofer = state.choferes.find((c) => c.id === v.choferId);
  $('#detailChofer').textContent = chofer?.nombre || v.choferNombre || 'Sin asignar';
  $('#detailChoferAvatar').textContent = chofer ? (chofer.iniciales || initials(chofer.nombre)) : '—';
  $('#detailVehiculo').textContent = chofer ? `${chofer.vehiculo} · ${chofer.patente}` : 'Pendiente de asignación';
  $('#detailRating').textContent = chofer ? `★ ${chofer.rating}` : '—';
  $('#detailPrecio').textContent = money(v.precio);
  $('#llamarBtn').disabled = !v.telefono;

  const hist = Array.isArray(v.historial) && v.historial.length ? v.historial : [{ estado: v.estado, hora: v.hora }];
  const finalizado = ['finalizado', 'cancelado'].includes(v.estado);
  timeline.innerHTML = hist.map((h, i) => {
    const last = i === hist.length - 1;
    let cls = finalizado || !last ? 'is-done' : 'is-current';
    if (h.estado === 'cancelado') cls = 'is-cancelled';
    const label = estadoLabel[h.estado]?.txt || h.estado || '—';
    const detalle = [h.hora, h.texto].filter(Boolean).join(' · ');
    return `<div class="timeline__step ${cls}"><span class="timeline__dot"></span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detalle || '—')}</small></div></div>`;
  }).join('');

  const compartir = $('#compartirBtn');
  const iniciar = $('#iniciarBtn');
  const finalizar = $('#finalizarBtn');
  const cancelar = $('#cancelarBtn');
  if (compartir) { compartir.hidden = false; compartir.disabled = !state.apiOnline; }
  if (iniciar) { iniciar.hidden = v.estado !== 'asignado'; iniciar.disabled = !state.apiOnline; }
  if (finalizar) { finalizar.hidden = v.estado !== 'en_curso'; finalizar.disabled = !state.apiOnline; }
  if (cancelar) { cancelar.hidden = ['finalizado', 'cancelado'].includes(v.estado); cancelar.disabled = !state.apiOnline; }
  const mapa = $('#mapaBtn');
  if (mapa) mapa.hidden = !state.prefs.gps || !v.origen || !v.destino;
}

function renderBadges() {
  const k = state.dashboard?.kpis || {};
  const operaciones = Number(k.viajesEnCurso || 0) || state.viajes.filter((v) => ['asignado', 'en_curso'].includes(v.estado)).length;
  const reservas = Number(k.reservasActivas || 0) || state.reservas.filter((r) => ['pendiente', 'confirmada'].includes(r.estado)).length;
  const op = $('#navOperacionesBadge');
  const res = $('#navReservasBadge');
  if (op) { op.textContent = num(operaciones); op.hidden = operaciones === 0; }
  if (res) { res.textContent = num(reservas); res.hidden = reservas === 0; }
}

function renderNotifications() {
  const list = $('#notifList');
  const items = state.dashboard?.actividadReciente || [];
  $('#notifCount').textContent = `${items.length} eventos`;
  const dot = $('#notifDot');
  if (dot) dot.hidden = items.length === 0;
  if (!items.length) {
    list.innerHTML = `<div class="notif-empty">No hay actividad reciente${state.apiOnline ? '' : ' · API sin conexión'}.</div>`;
    return;
  }
  list.innerHTML = items.map((v) => {
    const s = estadoLabel[v.estado] || { txt: v.estado, cls: 'tag--gray' };
    return `<button class="notif-item" type="button" data-notif-viaje="${escapeHtml(v.id)}">
      <span class="tag ${s.cls}" style="flex:0 0 auto">${escapeHtml(s.txt)}</span>
      <span class="notif-item__body"><strong>${escapeHtml(v.id)} · ${escapeHtml(v.pasajero || '—')}</strong><span>${escapeHtml(v.origen || '—')} → ${escapeHtml(v.destino || '—')} · ${escapeHtml(v.hora || '—')}</span></span>
    </button>`;
  }).join('');
}

/* ---------- TABLAS DE GESTIÓN ---------- */
function renderChoferes() {
  const disponibles = state.choferes.filter((c) => c.estado === 'disponible').length;
  const enViaje = state.choferes.filter((c) => c.estado === 'en_viaje').length;
  const viajesHoy = state.choferes.reduce((sum, c) => sum + Number(c.viajesHoy || 0), 0);
  $('#chofDisponibles').textContent = num(disponibles);
  $('#chofEnViaje').textContent = num(enViaje);
  $('#chofViajesHoy').textContent = num(viajesHoy);
  $('#choferesSub').textContent = `${state.choferes.length} choferes registrados`;

  const body = $('#choferesBody');
  if (!state.choferes.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><strong>Sin choferes</strong>Creá el primer chofer con el botón de arriba.</div></td></tr>';
    return;
  }
  body.innerHTML = state.choferes.map((c) => `<tr>
    <td>${persona(c.nombre)}</td>
    <td>${escapeHtml(c.vehiculo || '—')}</td>
    <td>${escapeHtml(c.patente || '—')}</td>
    <td>${choferTag(c.estado)}</td>
    <td>${num(c.viajesHoy || 0)}</td>
    <td><span style="color:var(--amber);font-weight:700">★ ${escapeHtml(c.rating ?? '—')}</span></td>
    <td><div class="row-actions">
      <button class="action-btn" type="button" data-action="edit-chofer" data-id="${escapeHtml(c.id)}">Editar</button>
      <button class="action-btn ${c.estado === 'desconectado' ? 'action-btn--ok' : ''}" type="button"
        data-action="toggle-chofer" data-id="${escapeHtml(c.id)}" ${c.estado === 'en_viaje' ? 'disabled' : ''}>
        ${c.estado === 'desconectado' ? 'Conectar' : c.estado === 'en_viaje' ? 'En viaje' : 'Desconectar'}
      </button>
    </div></td>
  </tr>`).join('');
}

function renderVehiculos() {
  $('#vehiculosSub').textContent = `${state.vehiculos.length} vehículos en la flota`;
  const body = $('#vehiculosBody');
  if (!state.vehiculos.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><strong>Sin vehículos</strong>Agregá un vehículo o creá un chofer con su unidad.</div></td></tr>';
    return;
  }
  body.innerHTML = state.vehiculos.map((v) => {
    const chofer = state.choferes.find((c) => c.patente === v.patente);
    const estado = chofer?.estado === 'en_viaje' ? 'en_viaje' : (v.estado || 'activo');
    const cls = estado === 'en_viaje' ? 'tag--blue' : estado === 'mantenimiento' ? 'tag--amber' : 'tag--green';
    return `<tr>
      <td><span class="pax-name">${escapeHtml(v.modelo || '—')}</span></td>
      <td>${escapeHtml(v.patente || '—')}</td>
      <td>${escapeHtml(chofer?.nombre || '—')}</td>
      <td>${tag(estado.replace('_', ' '), cls)}</td>
      <td class="time-cell">${escapeHtml(v.ultimoServicio || '—')}</td>
      <td><div class="row-actions">
        <button class="action-btn" type="button" data-action="edit-vehiculo" data-id="${escapeHtml(v.id)}">Editar</button>
        <button class="action-btn action-btn--danger" type="button" data-action="delete-vehiculo" data-id="${escapeHtml(v.id)}"
          ${chofer ? `disabled title="Asignado a ${escapeHtml(chofer.nombre)}"` : ''}>Eliminar</button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderClientes() {
  $('#clientesSub').textContent = `${state.clientes.length} clientes registrados`;
  const body = $('#clientesBody');
  if (!state.clientes.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><strong>Sin clientes</strong>Creá el primer cliente con el botón de arriba.</div></td></tr>';
    return;
  }
  body.innerHTML = state.clientes.map((c) => `<tr>
    <td><span class="pax-name">${escapeHtml(c.nombre || '—')}</span></td>
    <td>${escapeHtml(c.telefono || '—')}</td>
    <td>${tipoTag(c.tipo)}</td>
    <td>${num(c.viajes || 0)}</td>
    <td class="time-cell">${escapeHtml(c.ultimoViaje || '—')}</td>
    <td><div class="row-actions">
      <button class="action-btn" type="button" data-action="edit-cliente" data-id="${escapeHtml(c.id)}">Editar</button>
      <button class="action-btn action-btn--danger" type="button" data-action="delete-cliente" data-id="${escapeHtml(c.id)}">Eliminar</button>
    </div></td>
  </tr>`).join('');
}

function renderLiquidaciones() {
  const body = $('#liquidacionesBody');
  const pendientes = state.liquidaciones.filter((l) => l.estado !== 'pagado').length;
  const sub = $('#liquidacionesSub');
  if (sub) sub.textContent = `${state.liquidaciones.length} registros · ${pendientes} pendientes`;
  if (!body) return;
  if (!state.liquidaciones.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><strong>Sin liquidaciones</strong>La API todavía no devolvió liquidaciones.</div></td></tr>';
    return;
  }
  body.innerHTML = state.liquidaciones.map((l) => `<tr>
    <td><span class="pax-name">${escapeHtml(l.chofer || '—')}</span></td>
    <td>${num(l.viajes || 0)}</td>
    <td>${money(l.ingresos)}</td>
    <td>${money(l.comision)}</td>
    <td><strong style="color:var(--ink)">${money(l.total)}</strong></td>
    <td>${tag(l.estado || '—', l.estado === 'pagado' ? 'tag--green' : 'tag--amber')}</td>
    <td>${l.estado === 'pagado'
      ? '<span class="time-cell">—</span>'
      : `<button class="action-btn action-btn--ok" type="button" data-action="pay-liquidacion" data-id="${escapeHtml(l.id)}">Pagar</button>`}</td>
  </tr>`).join('');
}

function renderTarifas() {
  const body = $('#tarifasBody');
  if (!body) return;
  if (state.configTab === 'zonas') {
    $('#tarifasTitle').textContent = 'Zonas disponibles';
    $('#tarifasSub').textContent = 'Zonas activas y su tarifa vigente';
  } else {
    $('#tarifasTitle').textContent = 'Tarifas por zona';
    $('#tarifasSub').textContent = 'Los cambios aplican desde el próximo viaje';
  }
  if (!state.tarifas.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><strong>Sin tarifas</strong>Creá una zona con el botón “Nueva Zona”.</div></td></tr>';
    return;
  }
  body.innerHTML = state.tarifas.map((t) => `<tr>
    <td><span class="pax-name">${escapeHtml(t.zona || '—')}</span></td>
    <td>${money(t.base)}</td>
    <td>${money(t.porKm)}</td>
    <td>${money(t.minimo)}</td>
    <td>${tag(t.activa === false ? 'Inactiva' : 'Activa', t.activa === false ? 'tag--gray' : 'tag--green')}</td>
    <td><div class="row-actions">
      <button class="action-btn" type="button" data-action="edit-tarifa" data-id="${escapeHtml(t.id)}">Editar</button>
      <button class="action-btn action-btn--danger" type="button" data-action="delete-tarifa" data-id="${escapeHtml(t.id)}">Eliminar</button>
    </div></td>
  </tr>`).join('');
}

/* ---------- RESERVAS ---------- */
function reservaFecha(fecha = '') {
  const s = String(fecha);
  const m = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m) return { day: m[1].padStart(2, '0'), month: MESES[(Number(m[2]) - 1 + 12) % 12] || '—' };
  const d = new Date();
  if (/mañana/i.test(s)) {
    d.setDate(d.getDate() + 1);
    return { day: String(d.getDate()).padStart(2, '0'), month: MESES[d.getMonth()] };
  }
  if (/hoy/i.test(s)) return { day: String(d.getDate()).padStart(2, '0'), month: MESES[d.getMonth()] };
  return { day: '—', month: '—' };
}
function reservaHora(fecha = '') {
  const m = String(fecha).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(fecha).trim() || '—';
}

function renderReservas() {
  const total = state.reservas.length;
  const confirmadas = state.reservas.filter((r) => r.estado === 'confirmada').length;
  const pendientes = state.reservas.filter((r) => r.estado === 'pendiente').length;
  $('#reservasMes').textContent = num(total);
  $('#reservasConfirmadasPct').textContent = total ? `${Math.round((confirmadas / total) * 100)}%` : '0%';
  $('#reservasPendientes').textContent = num(pendientes);

  const list = $('#reservasList');
  if (!list) return;
  const activas = state.reservas.filter((r) => ['pendiente', 'confirmada'].includes(r.estado));
  if (!activas.length) {
    list.innerHTML = `<div class="empty-state"><strong>Sin reservas activas</strong>${state.apiOnline ? 'Escribí en el chat para crear una reserva.' : 'La API no está disponible.'}</div>`;
    return;
  }
  list.innerHTML = activas.map((r) => {
    const f = reservaFecha(r.fecha);
    return `<button class="reserva-item" type="button" data-reserva-id="${escapeHtml(r.id)}">
      <span class="reserva-item__date">${f.day}<span>${f.month}</span></span>
      <span class="reserva-item__info"><strong>${escapeHtml(r.id)}</strong><span>${escapeHtml(reservaHora(r.fecha))} · ${escapeHtml(r.origen || '—')} → ${escapeHtml(r.destino || '—')}</span></span>
      ${reservaTag(r.estado)}
    </button>`;
  }).join('');
}

/* ---------- INFORMES ---------- */
function renderInformes() {
  const viajes = state.allViajes;
  const finalizados = viajes.filter((v) => v.estado === 'finalizado');
  const pendientes = viajes.filter((v) => v.estado === 'pendiente');
  const facturacion = finalizados.reduce((sum, v) => sum + Number(v.precio || 0), 0);
  const ticket = finalizados.length ? facturacion / finalizados.length : 0;
  const ratings = state.choferes.map((c) => Number(c.rating || 0)).filter((n) => n > 0);
  const satisfaccion = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

  $('#infViajes').textContent = state.allViajesLoaded ? num(viajes.length) : '—';
  $('#infFacturacion').textContent = state.allViajesLoaded ? money(facturacion) : '—';
  $('#infTicket').textContent = state.allViajesLoaded ? money(ticket) : '—';
  $('#infSatisfaccion').textContent = ratings.length ? `${satisfaccion.toFixed(1)} / 5` : '—';
  $('#infViajesTrend').textContent = `${num(pendientes.length)} pendientes`;
  $('#infFacturacionTrend').textContent = `${num(finalizados.length)} finalizados`;
  $('#infTicketTrend').textContent = `${num(finalizados.length)} viajes cobrados`;
  $('#infSatisfaccionTrend').textContent = `★ ${num(ratings.length)} choferes`;
}

/* ---------- ADMINISTRACIÓN ---------- */
function renderAdminStats() {
  const viajes = state.allViajes;
  const finalizados = viajes.filter((v) => v.estado === 'finalizado');
  const facturacion = finalizados.reduce((sum, v) => sum + Number(v.precio || 0), 0);
  const k = state.dashboard?.kpis || {};
  const clientesUnicos = new Set(viajes.map((v) => v.telefono || v.pasajero).filter(Boolean)).size;
  $('#adminViajes').textContent = state.allViajesLoaded ? num(finalizados.length) : '—';
  $('#adminFacturacion').textContent = state.allViajesLoaded ? money(facturacion) : '—';
  $('#adminClientes').textContent = num(clientesUnicos || state.clientes.length);
  $('#adminOcupacion').textContent = `${num(k.ocupacionFlota || 0)}%`;
  $('#adminViajesTrend').textContent = `${num(viajes.length)} viajes totales`;
  $('#adminFacturacionTrend').textContent = `${num(finalizados.length)} finalizados`;
  $('#adminClientesTrend').textContent = `${num(state.clientes.length)} registrados`;
  $('#adminOcupacionTrend').textContent = `${num(k.choferesEnViaje || 0)} choferes en viaje`;
}

function liquidacionesPanelHtml() {
  const totalPendiente = state.liquidaciones
    .filter((l) => l.estado !== 'pagado')
    .reduce((sum, l) => sum + Number(l.total || 0), 0);
  const rows = state.liquidaciones.map((l) => `<tr>
    <td><span class="pax-name">${escapeHtml(l.chofer || '—')}</span></td>
    <td>${num(l.viajes || 0)}</td><td>${money(l.ingresos)}</td><td>${money(l.comision)}</td>
    <td><strong style="color:var(--ink)">${money(l.total)}</strong></td>
    <td>${tag(l.estado || '—', l.estado === 'pagado' ? 'tag--green' : 'tag--amber')}</td>
    <td>${l.estado === 'pagado' ? '<span class="time-cell">—</span>'
      : `<button class="action-btn action-btn--ok" type="button" data-action="pay-liquidacion" data-id="${escapeHtml(l.id)}">Pagar</button>`}</td>
  </tr>`).join('');
  return `<article class="panel panel--light">
    <div class="panel__head panel__head--tight"><div><h2>Liquidaciones</h2><p class="panel__sub">${state.liquidaciones.length} registros · ${money(totalPendiente)} pendientes de pago</p></div></div>
    <div class="table-wrap"><table class="data-table data-table--light">
      <thead><tr><th>Chofer</th><th>Viajes</th><th>Ingresos</th><th>Comisión</th><th>A pagar</th><th>Estado</th><th>Acción</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7"><div class="empty-state"><strong>Sin liquidaciones</strong>No hay registros para mostrar.</div></td></tr>'}</tbody>
    </table></div>
  </article>`;
}

function facturacionPanelHtml() {
  const finalizados = state.allViajes
    .filter((v) => v.estado === 'finalizado')
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const total = finalizados.reduce((sum, v) => sum + Number(v.precio || 0), 0);
  const rows = finalizados.map((v) => `<tr>
    <td><span class="vj-id">${escapeHtml(v.id)}</span></td>
    <td><span class="pax-name">${escapeHtml(v.pasajero || '—')}</span></td>
    <td>${routeHtml(v.origen, v.destino)}</td>
    <td class="time-cell">${escapeHtml(v.hora || '—')}</td>
    <td><strong style="color:var(--ink)">${money(v.precio)}</strong></td>
  </tr>`).join('');
  return `<article class="panel panel--light">
    <div class="panel__head panel__head--tight"><div><h2>Facturación</h2><p class="panel__sub">${finalizados.length} viajes finalizados · ${money(total)} facturados</p></div></div>
    <div class="table-wrap"><table class="data-table data-table--light">
      <thead><tr><th>Viaje</th><th>Pasajero</th><th>Ruta</th><th>Hora</th><th>Importe</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5"><div class="empty-state"><strong>Sin facturación</strong>Todavía no hay viajes finalizados.</div></td></tr>'}</tbody>
    </table></div>
  </article>`;
}

function clientesPanelHtml() {
  const map = new Map();
  state.allViajes.forEach((v) => {
    const key = v.telefono || String(v.pasajero || '').toLowerCase();
    if (!key) return;
    const row = map.get(key) || { nombre: v.pasajero || '—', telefono: v.telefono || '—', viajes: 0, total: 0, ultimo: '—' };
    row.viajes += 1;
    if (v.estado === 'finalizado') row.total += Number(v.precio || 0);
    if (v.hora) row.ultimo = v.hora;
    map.set(key, row);
  });
  const rows = Array.from(map.values()).sort((a, b) => b.total - a.total || b.viajes - a.viajes);
  return `<article class="panel panel--light">
    <div class="panel__head panel__head--tight"><div><h2>Clientes con actividad</h2><p class="panel__sub">${rows.length} clientes detectados en viajes</p></div></div>
    <div class="table-wrap"><table class="data-table data-table--light">
      <thead><tr><th>Cliente</th><th>Teléfono</th><th>Viajes</th><th>Facturado</th><th>Último</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><span class="pax-name">${escapeHtml(r.nombre)}</span></td>
        <td>${escapeHtml(r.telefono)}</td><td>${num(r.viajes)}</td><td>${money(r.total)}</td>
        <td class="time-cell">${escapeHtml(r.ultimo)}</td>
      </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><strong>Sin actividad</strong>No hay viajes asociados a clientes.</div></td></tr>'}</tbody>
    </table></div>
  </article>`;
}

async function renderAdminTab(tab = state.adminTab) {
  const box = $('#adminDetalle');
  if (!box) return;
  if (tab === 'resumen') {
    $('#adminResumen').hidden = false;
    box.hidden = true;
    box.innerHTML = '';
    renderAdminStats();
    renderChart();
    renderDistribution();
    renderLiquidaciones();
    return;
  }
  $('#adminResumen').hidden = true;
  box.hidden = false;
  await ensureAllViajes();
  renderAdminStats();
  if (tab === 'liquidaciones') {
    box.innerHTML = liquidacionesPanelHtml();
    return;
  }
  if (tab === 'reportes') {
    box.innerHTML = `<article class="panel panel--light">
      <div class="panel__head"><div><h2>Reportes</h2><p class="panel__sub">Exportá los datos reales del sistema en CSV</p></div></div>
      <div class="report-grid" id="reportGridAdmin"></div>
    </article>`;
    renderReportCards($('#reportGridAdmin'));
    return;
  }
  if (tab === 'facturacion') box.innerHTML = facturacionPanelHtml();
  else if (tab === 'clientes') box.innerHTML = clientesPanelHtml();
}

/* ---------- REPORTES CSV ---------- */
const REPORTS = {
  viajes: {
    title: 'Viajes por período',
    desc: 'Detalle completo de viajes',
    filename: 'viajes',
    needsAll: true,
    columns: [
      { key: 'id', label: 'Viaje' }, { key: 'pasajero', label: 'Pasajero' },
      { key: 'telefono', label: 'Teléfono' }, { key: 'origen', label: 'Origen' },
      { key: 'destino', label: 'Destino' }, { key: 'tipo', label: 'Tipo' },
      { key: 'estado', label: 'Estado' }, { key: 'hora', label: 'Hora' },
      { key: 'choferNombre', label: 'Chofer' }, { key: 'precio', label: 'Precio' },
    ],
    rows: () => state.allViajes,
  },
  facturacion: {
    title: 'Facturación detallada',
    desc: 'Viajes finalizados e ingresos',
    filename: 'facturacion',
    needsAll: true,
    columns: [
      { key: 'id', label: 'Viaje' }, { key: 'pasajero', label: 'Pasajero' },
      { key: 'origen', label: 'Origen' }, { key: 'destino', label: 'Destino' },
      { key: 'hora', label: 'Hora' }, { key: 'precio', label: 'Importe' },
    ],
    rows: () => state.allViajes.filter((v) => v.estado === 'finalizado'),
  },
  choferes: {
    title: 'Rendimiento de choferes',
    desc: 'Estado, viajes y rating',
    filename: 'choferes',
    columns: [
      { key: 'id', label: 'ID' }, { key: 'nombre', label: 'Chofer' },
      { key: 'telefono', label: 'Teléfono' }, { key: 'vehiculo', label: 'Vehículo' },
      { key: 'patente', label: 'Patente' }, { key: 'estado', label: 'Estado' },
      { key: 'viajesHoy', label: 'Viajes hoy' }, { key: 'rating', label: 'Rating' },
    ],
    rows: () => state.choferes,
  },
  flota: {
    title: 'Ocupación de flota',
    desc: 'Vehículos y chofer asignado',
    filename: 'flota',
    columns: [
      { key: 'id', label: 'ID' }, { key: 'modelo', label: 'Vehículo' },
      { key: 'patente', label: 'Patente' }, { key: 'chofer', label: 'Chofer' },
      { key: 'estado', label: 'Estado' }, { key: 'ultimoServicio', label: 'Último servicio' },
    ],
    rows: () => state.vehiculos.map((v) => ({
      ...v, chofer: state.choferes.find((c) => c.patente === v.patente)?.nombre || '',
    })),
  },
  corporativos: {
    title: 'Clientes corporativos',
    desc: 'Cuentas de empresa registradas',
    filename: 'clientes-corporativos',
    columns: [
      { key: 'id', label: 'ID' }, { key: 'nombre', label: 'Cliente' },
      { key: 'telefono', label: 'Teléfono' }, { key: 'tipo', label: 'Tipo' },
      { key: 'viajes', label: 'Viajes' }, { key: 'ultimoViaje', label: 'Último viaje' },
    ],
    rows: () => state.clientes.filter((c) => c.tipo === 'corporativo'),
  },
  reservas: {
    title: 'Reservas WhatsApp',
    desc: 'Historial de reservas y estados',
    filename: 'reservas',
    columns: [
      { key: 'id', label: 'Reserva' }, { key: 'cliente', label: 'Cliente' },
      { key: 'telefono', label: 'Teléfono' }, { key: 'fecha', label: 'Fecha' },
      { key: 'origen', label: 'Origen' }, { key: 'destino', label: 'Destino' },
      { key: 'estado', label: 'Estado' }, { key: 'canal', label: 'Canal' },
    ],
    rows: () => state.reservas,
  },
};

function renderReportCards(container) {
  if (!container) return;
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  container.innerHTML = Object.entries(REPORTS).map(([key, def]) => `<div class="report-card" role="button" tabindex="0" data-action="report" data-report="${key}">
    <div class="report-card__icon">${icon}</div>
    <div><strong>${escapeHtml(def.title)}</strong><span>${escapeHtml(def.desc)} · CSV</span></div>
  </div>`).join('');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function downloadCsv(filename, rows, columns) {
  const header = columns.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const lines = rows.map((row) => columns.map((c) => {
    const value = typeof c.value === 'function' ? c.value(row) : row[c.key];
    return `"${csvCell(value).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob([`\uFEFF${[header, ...lines].join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${todayLong().replace(/\//g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadReport(key) {
  const def = REPORTS[key];
  if (!def) return;
  try {
    if (def.needsAll) await ensureAllViajes();
    const rows = def.rows() || [];
    if (!rows.length) {
      toast('No hay datos para exportar', 'error');
      return;
    }
    downloadCsv(def.filename, rows, def.columns);
    toast(`Reporte “${def.title}” descargado`);
  } catch (err) {
    toast(`No se pudo generar el reporte: ${err.message}`, 'error');
  }
}

/* ---------- MODALES ---------- */
function fieldHtml(f) {
  const name = escapeHtml(f.name);
  const label = escapeHtml(f.label);
  const full = f.full ? ' form-field--full' : '';
  if (f.type === 'checkbox') {
    return `<label class="form-check${full}"><input type="checkbox" name="${name}" ${f.value ? 'checked' : ''} /> ${label}</label>`;
  }
  if (f.type === 'select') {
    return `<div class="form-field${full}"><label for="mf-${name}">${label}</label>
      <select id="mf-${name}" name="${name}" ${f.required ? 'required' : ''}>
        ${(f.options || []).map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select></div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="form-field${full}"><label for="mf-${name}">${label}</label>
      <textarea id="mf-${name}" name="${name}" rows="${f.rows || 3}" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''}>${escapeHtml(f.value ?? '')}</textarea></div>`;
  }
  return `<div class="form-field${full}"><label for="mf-${name}">${label}</label>
    <input id="mf-${name}" name="${name}" type="${f.type || 'text'}" value="${escapeHtml(f.value ?? '')}"
      placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''}
      ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} /></div>`;
}

function openModal({ title, subtitle = '', fields = [], bodyHtml = '', submitLabel = 'Guardar', onSubmit = null, footerHtml = '' }) {
  const modal = $('#modal');
  const form = $('#modalForm');
  $('#modalTitle').textContent = title;
  $('#modalSub').textContent = subtitle;
  $('#modalBody').innerHTML = bodyHtml || (fields.length ? `<div class="form-grid">${fields.map(fieldHtml).join('')}</div>` : '');
  $('#modalFoot').innerHTML = onSubmit
    ? '<button type="button" class="btn btn--ghost" data-modal-close>Cancelar</button>'
      + `<button type="submit" class="btn btn--primary">${escapeHtml(submitLabel)}</button>`
    : (footerHtml || '<button type="button" class="btn btn--ghost" data-modal-close>Cerrar</button>');

  modalSubmit = onSubmit;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!modalSubmit) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const submit = form.querySelector('button[type="submit"]');
    const original = submit ? submit.textContent : '';
    if (submit) { submit.disabled = true; submit.textContent = 'Guardando…'; }
    try {
      const data = {};
      fields.forEach((f) => {
        const el = form.elements[f.name];
        if (!el) return;
        if (f.type === 'checkbox') data[f.name] = el.checked;
        else if (f.type === 'number') data[f.name] = el.value === '' ? null : Number(el.value);
        else data[f.name] = el.value.trim();
      });
      const result = await modalSubmit(data);
      if (result !== false) closeModal();
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = original; }
    }
  };

  modal.hidden = false;
  document.body.classList.add('modal-open');
  setTimeout(() => {
    const first = fields[0] && form.elements[fields[0].name];
    if (first) first.focus();
  }, 60);
}

function openInfoModal(title, subtitle, html, footerHtml = '') {
  openModal({ title, subtitle, bodyHtml: html, onSubmit: null, footerHtml });
}

function closeModal() {
  const modal = $('#modal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  const form = $('#modalForm');
  if (form) form.onsubmit = null;
  modalSubmit = null;
}

/* ---------- ALTA / EDICIÓN ---------- */
async function syncVehiculoChofer(chofer, previous = null) {
  const patente = String(chofer.patente || '').trim();
  const modelo = String(chofer.vehiculo || '').trim();
  if (!patente || !modelo) return;
  const vehiculo = state.vehiculos.find((v) => v.patente === patente)
    || (previous?.patente ? state.vehiculos.find((v) => v.patente === previous.patente) : null);
  if (vehiculo && vehiculo.modelo === modelo && vehiculo.patente === patente) return;
  muteRealtime('vehiculos');
  try {
    if (vehiculo) await api('PATCH', `/api/vehiculos/${vehiculo.id}`, { modelo, patente });
    else await api('POST', '/api/vehiculos', { modelo, patente, estado: 'activo', ultimoServicio: '—' });
  } catch (err) {
    console.warn('[REMIXT] No se pudo sincronizar el vehículo:', err.message);
  }
}

function openChoferModal(chofer = null) {
  const edit = Boolean(chofer);
  openModal({
    title: edit ? 'Editar chofer' : 'Nuevo chofer',
    subtitle: edit ? `${chofer.id} · ${chofer.nombre}` : 'Se crea también su vehículo en la flota',
    submitLabel: edit ? 'Guardar cambios' : 'Crear chofer',
    fields: [
      { name: 'nombre', label: 'Nombre y apellido', value: chofer?.nombre || '', required: true, full: true },
      { name: 'telefono', label: 'Teléfono', value: chofer?.telefono || '', placeholder: '711 000 0000' },
      { name: 'rating', label: 'Rating (0 a 5)', type: 'number', step: '0.1', min: 0, max: 5, value: chofer?.rating ?? 4.5 },
      { name: 'vehiculo', label: 'Vehículo', value: chofer?.vehiculo || '', placeholder: 'Toyota Etios', required: true },
      { name: 'patente', label: 'Patente', value: chofer?.patente || '', placeholder: 'A8 123 CD', required: true },
      { name: 'estado', label: 'Estado', type: 'select', value: chofer?.estado || 'disponible', options: ESTADOS_CHOFER },
      {
        name: 'password', label: 'Clave de la app del chofer', type: 'password', full: true,
        placeholder: edit ? 'Dejar vacío para no cambiarla' : 'Opcional · mínimo 6 caracteres',
      },
    ],
    onSubmit: async (data) => {
      if (!data.password) delete data.password;
      const otro = state.choferes.find((c) => c.id !== chofer?.id && c.patente === data.patente);
      if (otro) throw new Error(`La patente ${data.patente} ya está asignada a ${otro.nombre}`);
      const res = edit
        ? await api('PATCH', `/api/choferes/${chofer.id}`, data)
        : await api('POST', '/api/choferes', { ...data, viajesHoy: 0 });
      await syncVehiculoChofer(res.data, chofer);
      actionToast(`✓ Chofer ${res.data.nombre} ${edit ? 'actualizado' : 'creado'}`);
      await refreshData();
    },
  });
}

function openVehiculoModal(vehiculo = null) {
  const edit = Boolean(vehiculo);
  const choferActual = vehiculo ? state.choferes.find((c) => c.patente === vehiculo.patente) : null;
  openModal({
    title: edit ? 'Editar vehículo' : 'Nuevo vehículo',
    subtitle: edit ? vehiculo.id : 'Agregá una unidad a la flota',
    submitLabel: edit ? 'Guardar cambios' : 'Crear vehículo',
    fields: [
      { name: 'modelo', label: 'Modelo', value: vehiculo?.modelo || '', required: true },
      { name: 'patente', label: 'Patente', value: vehiculo?.patente || '', required: true },
      { name: 'estado', label: 'Estado', type: 'select', value: vehiculo?.estado || 'activo', options: ESTADOS_VEHICULO },
      { name: 'ultimoServicio', label: 'Último servicio', value: vehiculo?.ultimoServicio || '', placeholder: 'Hoy / 12/11' },
      {
        name: 'choferId', label: 'Chofer asignado', type: 'select', full: true,
        value: choferActual?.id || '',
        options: [{ value: '', label: 'Sin asignar' }, ...state.choferes.map((c) => ({ value: c.id, label: `${c.nombre} · ${c.patente}` }))],
      },
    ],
    onSubmit: async (data) => {
      const duplicado = state.vehiculos.find((v) => v.patente === data.patente && v.id !== vehiculo?.id);
      if (duplicado) throw new Error(`La patente ${data.patente} ya existe en la flota`);
      const payload = { modelo: data.modelo, patente: data.patente, estado: data.estado, ultimoServicio: data.ultimoServicio };
      muteRealtime('choferes');
      if (edit) await api('PATCH', `/api/vehiculos/${vehiculo.id}`, payload);
      else await api('POST', '/api/vehiculos', payload);

      if (data.choferId) {
        await api('PATCH', `/api/choferes/${data.choferId}`, { vehiculo: data.modelo, patente: data.patente });
      }
      if (choferActual && choferActual.id !== data.choferId) {
        await api('PATCH', `/api/choferes/${choferActual.id}`, { vehiculo: '', patente: '' });
      }
      actionToast(`✓ Vehículo ${data.patente} ${edit ? 'actualizado' : 'creado'}`);
      await refreshData();
    },
  });
}

function openClienteModal(cliente = null) {
  const edit = Boolean(cliente);
  openModal({
    title: edit ? 'Editar cliente' : 'Nuevo cliente',
    subtitle: edit ? cliente.id : 'Alta de cliente particular o corporativo',
    submitLabel: edit ? 'Guardar cambios' : 'Crear cliente',
    fields: [
      { name: 'nombre', label: 'Nombre / empresa', value: cliente?.nombre || '', required: true, full: true },
      { name: 'telefono', label: 'Teléfono', value: cliente?.telefono || '', placeholder: '711 000 0000' },
      { name: 'tipo', label: 'Tipo', type: 'select', value: cliente?.tipo || 'particular', options: TIPOS_CLIENTE },
      { name: 'viajes', label: 'Viajes', type: 'number', min: 0, value: cliente?.viajes ?? 0 },
      { name: 'ultimoViaje', label: 'Último viaje', value: cliente?.ultimoViaje || '', placeholder: 'Hoy / ayer' },
    ],
    onSubmit: async (data) => {
      if (edit) await api('PATCH', `/api/clientes/${cliente.id}`, data);
      else await api('POST', '/api/clientes', data);
      actionToast(`✓ Cliente ${data.nombre} ${edit ? 'actualizado' : 'creado'}`);
      await refreshData();
    },
  });
}

function openPasswordModal() {
  openModal({
    title: 'Cambiar mi clave',
    subtitle: SESION.usuario.email || SESION.usuario.nombre,
    submitLabel: 'Guardar clave',
    fields: [
      { name: 'actual', label: 'Clave actual', type: 'password', required: true, full: true },
      { name: 'nueva', label: 'Clave nueva', type: 'password', required: true, full: true, placeholder: 'Mínimo 6 caracteres' },
    ],
    onSubmit: async (data) => {
      const res = await api('POST', '/api/auth/password', data);
      Auth.guardar(res.data);
      if (ws) ws.close();
      toast('✓ Clave actualizada');
    },
  });
}

function renderUsuario() {
  const { nombre, organizacion } = SESION.usuario;
  $('#userAvatar').textContent = initials(nombre);
  $('#userNombre').textContent = nombre;
  const org = $('#userOrg');
  if (org) org.textContent = organizacion?.nombre || organizacion?.slug || 'Operador';
}

function openTarifaModal(tarifa = null) {
  const edit = Boolean(tarifa);
  openModal({
    title: edit ? 'Editar tarifa' : 'Nueva zona / tarifa',
    subtitle: edit ? tarifa.zona : 'Definí la tarifa base y el valor por kilómetro',
    submitLabel: edit ? 'Guardar cambios' : 'Crear tarifa',
    fields: [
      { name: 'zona', label: 'Zona', value: tarifa?.zona || '', required: true, full: true },
      { name: 'base', label: 'Tarifa base', type: 'number', min: 0, value: tarifa?.base ?? 0, required: true },
      { name: 'porKm', label: 'Valor por km', type: 'number', min: 0, value: tarifa?.porKm ?? 0, required: true },
      { name: 'minimo', label: 'Mínimo', type: 'number', min: 0, value: tarifa?.minimo ?? 0, required: true },
      { name: 'activa', label: 'Tarifa activa', type: 'checkbox', value: tarifa ? tarifa.activa !== false : true },
    ],
    onSubmit: async (data) => {
      if (edit) await api('PATCH', `/api/tarifas/${tarifa.id}`, data);
      else await api('POST', '/api/tarifas', data);
      actionToast(`✓ Tarifa ${data.zona} ${edit ? 'actualizada' : 'creada'}`);
      await refreshData();
    },
  });
}

async function removeEntity(collection, id, label) {
  if (!confirmar(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
  try {
    await api('DELETE', `/api/${collection}/${id}`);
    actionToast(`✓ ${label} eliminado`);
    await refreshData();
  } catch (err) {
    toast(`No se pudo eliminar: ${err.message}`, 'error');
  }
}

async function toggleChofer(id) {
  const chofer = state.choferes.find((c) => c.id === id);
  if (!chofer) return;
  const estado = chofer.estado === 'desconectado' ? 'disponible' : 'desconectado';
  try {
    await api('PATCH', `/api/choferes/${id}/estado`, { estado });
    toast(`✓ ${chofer.nombre} · ${estado}`);
    await refreshData();
  } catch (err) {
    toast(`No se pudo cambiar el estado: ${err.message}`, 'error');
  }
}

async function payLiquidacion(id) {
  try {
    await api('PATCH', `/api/liquidaciones/${id}`, { estado: 'pagado' });
    actionToast('✓ Liquidación marcada como pagada');
    await refreshData();
  } catch (err) {
    toast(`No se pudo pagar la liquidación: ${err.message}`, 'error');
  }
}

function openReservaModal(reserva) {
  const f = reservaFecha(reserva.fecha);
  const html = `<p><strong>${escapeHtml(reserva.id)}</strong> · ${reservaTag(reserva.estado)}</p>
    <p><strong>Cliente:</strong> ${escapeHtml(reserva.cliente || '—')}<br />
    <strong>Teléfono:</strong> ${escapeHtml(reserva.telefono || '—')}<br />
    <strong>Fecha:</strong> ${escapeHtml(reserva.fecha || '—')} (${f.day} ${f.month})<br />
    <strong>Ruta:</strong> ${escapeHtml(reserva.origen || '—')} → ${escapeHtml(reserva.destino || '—')}<br />
    <strong>Canal:</strong> ${escapeHtml(reserva.canal || '—')}</p>`;
  const activa = ['pendiente', 'confirmada'].includes(reserva.estado);
  const footer = '<button type="button" class="btn btn--ghost" data-modal-close>Cerrar</button>'
    + (activa ? `<button type="button" class="btn btn--danger-ghost" id="cancelReservaBtn">Cancelar reserva</button>` : '');
  openInfoModal('Detalle de reserva', reserva.id, html, footer);
  const btn = $('#cancelReservaBtn');
  if (btn) {
    btn.onclick = async () => {
      if (!confirmar(`¿Cancelar la reserva ${reserva.id}?`)) return;
      try {
        await api('POST', `/api/reservas/${reserva.id}/cancelar`);
        closeModal();
        actionToast(`✓ Reserva ${reserva.id} cancelada`);
        await refreshData();
      } catch (err) {
        toast(`No se pudo cancelar: ${err.message}`, 'error');
      }
    };
  }
}

/* ---------- CHAT DE RESERVAS ---------- */
function addBubble(text, out = false) {
  const body = $('#chatBody');
  if (!body) return null;
  const bubble = document.createElement('div');
  bubble.className = `bubble ${out ? 'bubble--out' : 'bubble--in'}`;
  bubble.innerHTML = `<p>${escapeHtml(text).replace(/\n/g, '<br />')}</p><span class="bubble__time">${clockTime()} ✓✓</span>`;
  body.appendChild(bubble);
  body.scrollTop = body.scrollHeight;
  return bubble;
}

function showTyping() {
  const body = $('#chatBody');
  const el = document.createElement('div');
  el.className = 'bubble bubble--in bubble--typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

function initChat() {
  const body = $('#chatBody');
  if (!body) return;
  body.innerHTML = '<div class="chat-day">HOY</div>';
  addBubble('Hola 👋 Soy el asistente de REMIXT. Escribí «reservar» para agendar un remis, «tarifas» para ver precios, «estado RES-0000» para seguir una reserva o «ayuda» para ver las opciones.', true);
}

function tarifasResumen() {
  const activas = state.tarifas.filter((t) => t.activa !== false);
  if (!activas.length) return 'No hay tarifas activas cargadas en este momento.';
  return `Tarifas vigentes:\n${activas.map((t) => `• ${t.zona}: base ${money(t.base)} + ${money(t.porKm)}/km · mínimo ${money(t.minimo)}`).join('\n')}`;
}

function parseReserva(texto) {
  let text = String(texto);
  const telefono = text.match(/\b(?:\+?54\s?)?(?:11|15|7\d{2})\s?\d{3,4}[\s-]?\d{4}\b/)?.[0]?.trim() || '';
  if (telefono) text = text.replace(telefono, ' ');
  const clienteMatch = text.match(/(?:a nombre de|cliente\s*:?)\s+([^,.;]+)/i);
  const cliente = clienteMatch?.[1]?.trim() || 'Cliente WhatsApp';
  if (clienteMatch) text = text.replace(clienteMatch[0], ' ');
  const fecha = text.match(/((?:pasado\s+)?mañana|hoy|\d{1,2}\s*\/\s*\d{1,2})(?:\s+(?:a\s+)?(?:las?\s+)?\d{1,2}(?::\d{2})?\s*(?:hs\.?|horas?)?)?/i)?.[0]?.trim() || '';
  const origen = text.match(/desde\s+(.+?)(?=\s+hasta\b|\s+(?:a nombre de|cliente|tel[eé]fono)\b|,|\.|$)/i)?.[1]?.trim()
    || text.match(/origen\s*:?\s*([^,.;]+)/i)?.[1]?.trim() || '';
  const destino = text.match(/hasta\s+(.+?)(?=\s+(?:a nombre de|cliente|tel[eé]fono)\b|,|\.|$)/i)?.[1]?.trim()
    || text.match(/destino\s*:?\s*([^,.;]+)/i)?.[1]?.trim() || '';
  return { cliente, fecha, origen, destino, telefono };
}

async function handleChat(texto) {
  const text = String(texto).trim();
  const lower = text.toLowerCase();

  if (/^(hola|buenas|buen d[ií]a|buenas tardes|buenas noches)/.test(lower)) {
    return 'Hola 👋 Puedo reservar un remis, consultar tarifas o revisar el estado de una reserva. Probá con: «Reservar para mañana a las 09:00 desde Palermo hasta Aeroparque».';
  }
  if (/tarifa|precio|cu[aá]nto|cuanto/.test(lower)) return tarifasResumen();
  if (/ayuda|opciones|qu[eé] pod[eé]s|comandos/.test(lower)) {
    return 'Opciones:\n• «reservar» + fecha + «desde» origen + «hasta» destino\n• «tarifas» para ver precios\n• «estado RES-0000» para seguir una reserva\n• «hola» para saludar\n\nEjemplo: «Reservar para mañana a las 09:00 desde Av. Santa Fe 1200 hasta Aeroparque».';
  }
  if (/estado|seguimiento|seguir/.test(lower)) {
    const id = text.match(/RES-\d+/i)?.[0]?.toUpperCase();
    if (!id) return 'Indicame el código de reserva, por ejemplo: «estado RES-5847».';
    let reserva = state.reservas.find((r) => r.id.toUpperCase() === id);
    if (!reserva) {
      try {
        await loadReservas();
        renderReservas();
        reserva = state.reservas.find((r) => r.id.toUpperCase() === id);
      } catch (err) { /* se informa abajo */ }
    }
    if (!reserva) return `No encontré la reserva ${id}.`;
    return `La reserva ${reserva.id} está ${reserva.estado}. Fecha: ${reserva.fecha}. Ruta: ${reserva.origen} → ${reserva.destino}.`;
  }
  if (/reserv/.test(lower)) {
    const parsed = parseReserva(text);
    const faltan = [];
    if (!parsed.fecha) faltan.push('la fecha y hora (ej. «mañana 09:00»)');
    if (!parsed.origen) faltan.push('el origen (ej. «desde Palermo»)');
    if (!parsed.destino) faltan.push('el destino (ej. «hasta Aeroparque»)');
    if (faltan.length) return `Para confirmar la reserva necesito ${faltan.join(', ')}.`;
    if (!state.apiOnline) throw new Error('la API no está disponible');
    const res = await api('POST', '/api/reservas', { ...parsed, canal: 'whatsapp' });
    try {
      await loadReservas();
      renderReservas();
      await loadDashboard();
      renderKpis();
      renderBadges();
      renderNotifications();
    } catch (err) { /* el evento WebSocket también refresca */ }
    const extra = state.prefs.whatsapp ? '' : ' (Los avisos automáticos están desactivados en Configuración).';
    return `${res.respuesta}${extra}`;
  }
  return 'Puedo ayudarte a reservar un remis, consultar tarifas o revisar el estado de una reserva. Escribí «ayuda» para ver los comandos.';
}

/* ---------- PREFERENCIAS ---------- */
function savePrefs() {
  try { localStorage.setItem('remixt:prefs', JSON.stringify(state.prefs)); } catch (err) { /* sin persistencia */ }
}

function applyPrefs() {
  const map = {
    prefAutoAssign: 'autoAssign', prefWhatsapp: 'whatsapp', prefCorporate: 'corporate', prefGps: 'gps',
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = $(`#${id}`);
    if (el) el.checked = Boolean(state.prefs[key]);
  });

  const corporativo = $('#segCorporativo');
  if (corporativo) corporativo.hidden = !state.prefs.corporate;
  if (!state.prefs.corporate) {
    const activo = $('#requestType .seg.is-active');
    if (activo?.dataset.tipo === 'corporativo') setRequestType('inmediata');
  }

  const status = $('#chatStatus');
  if (status) status.innerHTML = `<i class="online-dot"></i> En línea${state.prefs.whatsapp ? '' : ' · sin avisos'}`;
  const mapa = $('#mapaBtn');
  if (mapa && !state.prefs.gps) mapa.hidden = true;
  if (state.selectedViajeId) renderDetail(findViaje(state.selectedViajeId));
}

function setRequestType(tipo) {
  $$('#requestType .seg').forEach((b) => b.classList.toggle('is-active', b.dataset.tipo === tipo));
}

/* ---------- VISTAS ---------- */
const VIEW_META = {
  operaciones: ['Operaciones', 'Gestión y despacho en tiempo real'],
  reservas: ['Reservas', 'Reservas por WhatsApp y agenda'],
  choferes: ['Choferes', 'Estado y disponibilidad de la flota'],
  vehiculos: ['Vehículos', 'Flota registrada y asignaciones'],
  clientes: ['Clientes', 'Base de pasajeros y cuentas corporativas'],
  liquidaciones: ['Administración', 'Liquidaciones, facturación y reportes'],
  informes: ['Informes', 'Métricas y reportes del sistema'],
  configuracion: ['Configuración', 'Tarifas, zonas y preferencias'],
};

function setMenu(open) {
  $('#sidebar')?.classList.toggle('is-open', open);
  $('#sidebarBackdrop')?.classList.toggle('is-visible', open);
  document.body.classList.toggle('menu-open', open);
  const toggle = $('#menuToggle');
  toggle?.setAttribute('aria-expanded', String(open));
  toggle?.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}

function setView(name, { silent = false } = {}) {
  if (!VIEW_META[name]) return;
  state.view = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  const [title, subtitle] = VIEW_META[name];
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = subtitle;
  setMenu(false);
  closeNotif();
  if (!silent) $('.main-wrap')?.scrollTo?.({ top: 0, behavior: 'smooth' });

  if (name === 'liquidaciones') {
    renderAdminStats();
    renderChart();
    renderDistribution();
    renderLiquidaciones();
    if (state.adminTab !== 'resumen') renderAdminTab(state.adminTab);
  }
  if (name === 'informes') {
    ensureAllViajes().then(() => renderInformes());
  }
  if (name === 'reservas') renderReservas();
  if (name === 'configuracion') { renderTarifas(); applyPrefs(); }
  if (name === 'operaciones') { renderViajes(); ensureSelection(); }
}

function openHelpModal() {
  openInfoModal('Cómo usar REMIXT', 'Guía rápida de la interfaz', `
    <p>La interfaz consume la API en <code>${escapeHtml(API_BASE)}</code> y se actualiza por WebSocket. No hay datos de prueba en el navegador: si la API no responde, las tablas quedan vacías y el badge muestra <strong>API sin conexión</strong>.</p>
    <ul>
      <li><strong>Operaciones:</strong> seleccioná un viaje para ver el detalle, asigná un chofer, iniciá o finalizá el viaje y cancelá si es necesario.</li>
      <li><strong>Nueva solicitud:</strong> cargá pasajero, teléfono, origen y destino. Si la asignación automática está activa, se busca un chofer disponible.</li>
      <li><strong>Reservas:</strong> usá el chat para crear reservas reales con el comando <code>reservar</code> y consultá el estado con <code>estado RES-0000</code>.</li>
      <li><strong>Gestión:</strong> choferes, vehículos, clientes y tarifas se crean y editan con los botones de cada tabla.</li>
      <li><strong>Administración:</strong> liquidaciones, facturación, clientes y reportes. Los reportes se descargan en CSV y “Exportar PDF” usa la impresión del navegador.</li>
      <li><strong>Preferencias:</strong> se guardan en este navegador (localStorage) y controlan asignación automática, avisos, modo corporativo y mapa.</li>
    </ul>`);
}

function openDocsModal() {
  openInfoModal('Documentación técnica', 'API REST + WebSocket', `
    <p><strong>API:</strong> <code>${escapeHtml(API_BASE)}</code><br />
    <strong>WebSocket:</strong> <code>${escapeHtml(WS_URL + WS_PATH)}</code><br />
    <strong>Persistencia:</strong> PostgreSQL (o JSON con <code>DB_DRIVER=json</code>).</p>
    <p>Endpoints principales:</p>
    <ul>
      <li><code>POST /api/auth/login</code> · ingreso de operadores y choferes · <code>POST /api/auth/pasajero</code> · ingreso de pasajeros con su teléfono</li>
      <li><code>GET /api/mi/viajes</code> · viajes del chofer o pasajero autenticado</li>
      <li><code>GET /api/dashboard</code> · métricas agregadas</li>
      <li><code>GET/POST /api/viajes</code> · listado paginado y alta</li>
      <li><code>POST /api/viajes/:id/asignar</code> · despacho</li>
      <li><code>PATCH /api/viajes/:id/estado</code> · iniciar/finalizar/cancelar</li>
      <li><code>GET/POST /api/reservas</code> · reservas y confirmación</li>
      <li><code>GET/PATCH/DELETE /api/choferes</code>, <code>/vehiculos</code>, <code>/clientes</code>, <code>/tarifas</code>, <code>/liquidaciones</code></li>
    </ul>
    <p>El WebSocket envía un snapshot inicial (<code>hello</code>) y eventos como <code>viaje:creado</code>, <code>viaje:asignado</code>, <code>reserva:creada</code> y <code>cliente:actualizado</code>.</p>`);
}

function setNotif(open) {
  const panel = $('#notifPanel');
  const btn = $('#notifBtn');
  if (!panel) return;
  panel.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', String(open));
}
function closeNotif() { setNotif(false); }

/* ---------- ACCIONES DE OPERACIÓN ---------- */
function resetViajeFilters() {
  state.filter = 'todos';
  state.search = '';
  state.page = 1;
  const input = $('#viajeSearch');
  if (input) input.value = '';
  $$('#viajeTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.filter === 'todos'));
}

async function crearSolicitud() {
  if (!state.apiOnline) {
    toast('La API no está disponible. Iniciá remixt-api para crear viajes.', 'error');
    return;
  }
  const pasajero = $('#reqPasajero').value.trim();
  const telefono = $('#reqTelefono').value.trim();
  const origen = $('#reqOrigen').value.trim();
  const destino = $('#reqDestino').value.trim();
  const tipo = $('#requestType .seg.is-active')?.dataset.tipo || 'inmediata';
  if (!pasajero || !origen || !destino) {
    toast('Completá pasajero, origen y destino', 'error');
    return;
  }
  try {
    let viaje = (await api('POST', '/api/viajes', { pasajero, telefono, origen, destino, tipo })).data;
    let asignado = false;
    if (state.prefs.autoAssign) {
      try {
        const res = await api('POST', `/api/viajes/${viaje.id}/asignar`);
        viaje = res.data?.viaje || res.data || viaje;
        asignado = true;
      } catch (err) {
        toast(`Solicitud ${viaje.id} creada, pero no se pudo asignar: ${err.message}`, 'error');
      }
    }
    actionToast(`✓ ${viaje.id} ${asignado ? 'creado y asignado' : 'creado'}`);
    $('#reqPasajero').value = '';
    $('#reqTelefono').value = '';
    $('#reqOrigen').value = '';
    $('#reqDestino').value = '';
    resetViajeFilters();
    await refreshData();
    state.selectedViajeId = viaje.id;
    state.selectedViaje = findViaje(viaje.id) || viaje;
    renderDetail(state.selectedViaje);
    renderViajes();
  } catch (err) {
    toast(`No se pudo crear la solicitud: ${err.message}`, 'error');
  }
}

async function asignarSeleccionado() {
  if (!state.apiOnline) {
    toast('La API no está disponible para asignar viajes.', 'error');
    return;
  }
  const selected = findViaje(state.selectedViajeId);
  const pendiente = selected?.estado === 'pendiente'
    ? selected
    : state.allViajes.find((v) => v.estado === 'pendiente') || state.viajes.find((v) => v.estado === 'pendiente');
  if (!pendiente) {
    toast('No hay viajes pendientes para asignar', 'error');
    return;
  }
  try {
    const res = await api('POST', `/api/viajes/${pendiente.id}/asignar`);
    const viaje = res.data?.viaje || res.data;
    const chofer = res.data?.chofer;
    actionToast(`✓ ${pendiente.id} asignado${chofer?.nombre ? ` a ${chofer.nombre}` : ''}`);
    state.selectedViajeId = viaje.id;
    state.selectedViaje = viaje;
    await refreshData();
    renderDetail(findViaje(viaje.id) || viaje);
    renderViajes();
  } catch (err) {
    toast(`No se pudo asignar el viaje: ${err.message}`, 'error');
  }
}

async function cambiarEstadoViaje(id, estado) {
  const viajeId = id || state.selectedViajeId;
  if (!viajeId) { toast('Seleccioná un viaje primero', 'error'); return; }
  if (!state.apiOnline) { toast('La API no está disponible.', 'error'); return; }
  try {
    const res = await api('PATCH', `/api/viajes/${viajeId}/estado`, { estado });
    const viaje = res.data;
    actionToast(`✓ ${viajeId} · ${estadoLabel[estado]?.txt || estado}`);
    state.selectedViajeId = viajeId;
    state.selectedViaje = viaje;
    await refreshData();
    renderDetail(findViaje(viajeId) || viaje);
    renderViajes();
  } catch (err) {
    toast(`No se pudo cambiar el estado: ${err.message}`, 'error');
  }
}

async function cancelarViaje() {
  const viajeId = state.selectedViajeId;
  if (!viajeId) { toast('Seleccioná un viaje primero', 'error'); return; }
  if (!state.apiOnline) { toast('La API no está disponible.', 'error'); return; }
  if (!confirmar(`¿Cancelar el viaje ${viajeId}?`)) return;
  try {
    const res = await api('POST', `/api/viajes/${viajeId}/cancelar`);
    actionToast(`✓ ${viajeId} cancelado`);
    state.selectedViajeId = viajeId;
    state.selectedViaje = res.data;
    await refreshData();
    renderDetail(findViaje(viajeId) || res.data);
    renderViajes();
  } catch (err) {
    toast(`No se pudo cancelar el viaje: ${err.message}`, 'error');
  }
}

async function compartirViaje() {
  const viaje = findViaje(state.selectedViajeId);
  if (!viaje) { toast('Seleccioná un viaje primero', 'error'); return; }
  const chofer = state.choferes.find((c) => c.id === viaje.choferId);
  const texto = `REMIXT · Viaje ${viaje.id}\n${viaje.origen} → ${viaje.destino}\nHora: ${viaje.hora || '—'}\nChofer: ${chofer?.nombre || viaje.choferNombre || 'a asignar'}\nTotal: ${money(viaje.precio)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'REMIXT · Detalle del viaje', text: texto });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(texto);
    toast('Detalle del viaje copiado al portapapeles');
  } catch (err) {
    window.prompt('Copiá el detalle del viaje:', texto);
  }
}

function llamarPasajero() {
  const viaje = findViaje(state.selectedViajeId);
  if (!viaje?.telefono) { toast('El viaje no tiene teléfono de contacto', 'error'); return; }
  window.location.href = `tel:${String(viaje.telefono).replace(/\s/g, '')}`;
}

function abrirMapa() {
  const viaje = findViaje(state.selectedViajeId);
  if (!viaje) { toast('Seleccioná un viaje primero', 'error'); return; }
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(viaje.origen || '')}&destination=${encodeURIComponent(viaje.destino || '')}`;
  window.open(url, '_blank', 'noopener');
}

/* ---------- EVENTOS ---------- */
function bindEvents() {
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $('#menuToggle')?.addEventListener('click', () => setMenu(!$('#sidebar')?.classList.contains('is-open')));
  $('#sidebarBackdrop')?.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setMenu(false); });
  $('#refreshBtn')?.addEventListener('click', () => refreshData(true));

  const buscar = debounce(async (value) => {
    state.search = value.trim();
    state.page = 1;
    try {
      await loadViajes();
      renderViajes();
      renderPagination();
    } catch (err) {
      toast(`No se pudo buscar: ${err.message}`, 'error');
    }
  }, 320);
  $('#viajeSearch')?.addEventListener('input', (e) => buscar(e.target.value));

  $('#viajeTabs')?.addEventListener('click', async (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    state.filter = tab.dataset.filter;
    state.page = 1;
    $$('#viajeTabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    try {
      await loadViajes();
      renderViajes();
      renderPagination();
    } catch (err) {
      toast(`No se pudo filtrar: ${err.message}`, 'error');
    }
  });

  $('#viajesBody')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-viaje-id]');
    if (!row) return;
    const viaje = findViaje(row.dataset.viajeId);
    if (!viaje) return;
    state.selectedViajeId = viaje.id;
    state.selectedViaje = viaje;
    renderDetail(viaje);
    renderViajes();
  });

  $('#viajesPagination')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    const page = Number(btn.dataset.page);
    if (!page || page === Number(state.viajesMeta.page)) return;
    state.page = page;
    try {
      await loadViajes();
      renderViajes();
      renderPagination();
    } catch (err) {
      toast(`No se pudo cambiar de página: ${err.message}`, 'error');
    }
  });

  $('#requestType')?.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg || seg.hidden) return;
    setRequestType(seg.dataset.tipo);
  });
  $('#autoAssignBtn')?.addEventListener('click', asignarSeleccionado);
  $('#solicitarBtn')?.addEventListener('click', crearSolicitud);

  $('#iniciarBtn')?.addEventListener('click', () => cambiarEstadoViaje(state.selectedViajeId, 'en_curso'));
  $('#finalizarBtn')?.addEventListener('click', () => cambiarEstadoViaje(state.selectedViajeId, 'finalizado'));
  $('#cancelarBtn')?.addEventListener('click', cancelarViaje);
  $('#compartirBtn')?.addEventListener('click', compartirViaje);
  $('#llamarBtn')?.addEventListener('click', llamarPasajero);
  $('#mapaBtn')?.addEventListener('click', abrirMapa);

  $('#nuevoChoferBtn')?.addEventListener('click', () => openChoferModal());
  $('#nuevoVehiculoBtn')?.addEventListener('click', () => openVehiculoModal());
  $('#nuevoClienteBtn')?.addEventListener('click', () => openClienteModal());
  $('#nuevaTarifaBtn')?.addEventListener('click', () => {
    state.configTab = 'tarifas';
    $$('#view-configuracion .admin-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.configTab === 'tarifas'));
    renderTarifas();
    openTarifaModal();
  });

  $('#view-liquidaciones')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-admin-tab]');
    if (!tab) return;
    state.adminTab = tab.dataset.adminTab;
    $$('#view-liquidaciones .admin-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    renderAdminTab(state.adminTab).catch((err) => toast(`No se pudo abrir la sección: ${err.message}`, 'error'));
  });

  $('#view-configuracion')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-config-tab]');
    if (!tab) return;
    state.configTab = tab.dataset.configTab;
    $$('#view-configuracion .admin-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    if (state.configTab === 'tarifas' || state.configTab === 'zonas') {
      renderTarifas();
      return;
    }
    if (state.configTab === 'choferes') { setView('choferes'); return; }
    if (state.configTab === 'vehiculos') { setView('vehiculos'); return; }
    if (state.configTab === 'documentacion') { openDocsModal(); return; }
    if (state.configTab === 'notificaciones') {
      const side = $('.config-side');
      if (side) {
        side.scrollIntoView({ behavior: 'smooth', block: 'center' });
        side.style.outline = '2px solid var(--blue)';
        setTimeout(() => { side.style.outline = ''; }, 1600);
      }
      toast('Las preferencias de avisos están en el panel derecho');
    }
  });

  $('#exportPdfBtn')?.addEventListener('click', () => window.print());
  $('#notifBtn')?.addEventListener('click', () => setNotif($('#notifPanel').hidden));
  $('#helpBtn')?.addEventListener('click', openHelpModal);

  $('#reservasList')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-reserva-id]');
    if (!item) return;
    const reserva = state.reservas.find((r) => r.id === item.dataset.reservaId);
    if (reserva) openReservaModal(reserva);
  });

  $('#chatForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chatText');
    const texto = input.value.trim();
    if (!texto) return;
    addBubble(texto, false);
    input.value = '';
    const typing = showTyping();
    try {
      const respuesta = await handleChat(texto);
      typing.remove();
      if (respuesta) addBubble(respuesta, true);
    } catch (err) {
      typing.remove();
      addBubble(`No pude procesar el mensaje: ${err.message}`, true);
    }
  });

  $('#logoutBtn')?.addEventListener('click', () => {
    if (confirmar('¿Cerrar la sesión?')) Auth.salir(ROL);
  });
  $('#passwordBtn')?.addEventListener('click', openPasswordModal);

  $('#chatTemplateBtn')?.addEventListener('click', () => {
    const input = $('#chatText');
    input.value = 'Reservar un remis para mañana a las 09:00 desde Av. Santa Fe 1200 hasta Aeroparque';
    input.focus();
  });
  $('#chatMenuBtn')?.addEventListener('click', () => {
    if (confirmar('¿Vaciar la conversación del chat?')) initChat();
  });

  [
    ['prefAutoAssign', 'autoAssign'], ['prefWhatsapp', 'whatsapp'],
    ['prefCorporate', 'corporate'], ['prefGps', 'gps'],
  ].forEach(([id, key]) => {
    $(`#${id}`)?.addEventListener('change', (e) => {
      state.prefs[key] = e.target.checked;
      savePrefs();
      applyPrefs();
      toast('Preferencia guardada en este navegador');
    });
  });

  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const { action, id, report } = actionEl.dataset;
      if (action === 'report') { downloadReport(report); return; }
      if (action === 'edit-chofer') { const c = state.choferes.find((x) => x.id === id); if (c) openChoferModal(c); return; }
      if (action === 'toggle-chofer') { toggleChofer(id); return; }
      if (action === 'edit-vehiculo') { const v = state.vehiculos.find((x) => x.id === id); if (v) openVehiculoModal(v); return; }
      if (action === 'delete-vehiculo') { const v = state.vehiculos.find((x) => x.id === id); if (v) removeEntity('vehiculos', id, `el vehículo ${v.modelo} (${v.patente})`); return; }
      if (action === 'edit-cliente') { const c = state.clientes.find((x) => x.id === id); if (c) openClienteModal(c); return; }
      if (action === 'delete-cliente') { const c = state.clientes.find((x) => x.id === id); if (c) removeEntity('clientes', id, `el cliente ${c.nombre}`); return; }
      if (action === 'edit-tarifa') { const t = state.tarifas.find((x) => x.id === id); if (t) openTarifaModal(t); return; }
      if (action === 'delete-tarifa') { const t = state.tarifas.find((x) => x.id === id); if (t) removeEntity('tarifas', id, `la tarifa ${t.zona}`); return; }
      if (action === 'pay-liquidacion') { payLiquidacion(id); return; }
      return;
    }

    const notif = e.target.closest('[data-notif-viaje]');
    if (notif) { closeNotif(); openViaje(notif.dataset.notifViaje); return; }

    if (e.target.closest('[data-modal-close]')) { closeModal(); return; }

    if (!e.target.closest('.notif-wrap')) closeNotif();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeNotif(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-report]')) {
      e.preventDefault();
      e.target.click();
    }
  });
}

/* ---------- WEBSOCKET ---------- */
function scheduleWsReconnect() {
  clearTimeout(wsRetry);
  wsAttempts += 1;
  const delay = Math.min(1000 * 2 ** (wsAttempts - 1), 15000);
  wsRetry = setTimeout(connectWebSocket, delay);
}

function connectWebSocket() {
  if (typeof WebSocket === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = `${WS_URL}${WS_PATH}`;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    scheduleWsReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    // El servidor responde con `hello` recién cuando valida la sesión.
    ws.send(JSON.stringify({ type: 'auth', token: Auth.leer(ROL)?.token }));
    wsAttempts = 0;
    console.info('[REMIXT] WebSocket conectado:', url);
  });

  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(event.data); } catch (err) { return; }
    handleRealtime(msg);
  });

  ws.addEventListener('close', (event) => {
    state.wsOnline = false;
    ws = null;
    refreshBadge();
    if (event.code === WS_NO_AUTORIZADO) { sesionVencida(); return; }
    scheduleWsReconnect();
  });

  ws.addEventListener('error', () => {
    try { ws.close(); } catch (err) { /* el close programa el reintento */ }
  });
}

function handleRealtime(msg = {}) {
  const { type, payload = {} } = msg;
  if (!type) return;
  if (type === 'hello') {
    state.wsOnline = true;
    refreshBadge();
    scheduleRefresh();
    return;
  }

  const viaje = payload.viaje || (String(payload.id || '').startsWith('VJ-') ? payload : null);
  if (type.startsWith('viaje:')) {
    if (viaje?.id) {
      if (type === 'viaje:creado') toast(`✓ Nueva solicitud ${viaje.id} · ${viaje.pasajero || ''}`);
      else if (type === 'viaje:asignado') toast(`✓ ${viaje.id} asignado${payload.chofer?.nombre ? ` a ${payload.chofer.nombre}` : ''}`);
      else if (type === 'viaje:en_curso') toast(`✓ ${viaje.id} en curso`);
      else if (type === 'viaje:finalizado') toast(`✓ ${viaje.id} finalizado`);
      else if (type === 'viaje:cancelado') toast(`✓ ${viaje.id} cancelado`);
      else if (type === 'viaje:eliminado') toast(`✓ ${viaje.id} eliminado`);
      else if (type === 'viaje:aceptado') toast(`✓ ${viaje.choferNombre || 'El chofer'} aceptó ${viaje.id}`);
      else if (type === 'viaje:rechazado') toast(`${viaje.id} fue rechazado por el chofer`, 'error');
      else if (type === 'viaje:actualizado') toast(`✓ ${viaje.id} actualizado`);
    }
    scheduleRefresh();
    return;
  }

  if (type.startsWith('chofer:')) {
    if (isRealtimeMuted('choferes')) { scheduleRefresh(); return; }
    if (type === 'chofer:creado') { toast(`✓ Chofer ${payload.nombre || ''} creado`); scheduleRefresh(); return; }
    if (type === 'chofer:actualizado') { toast(`✓ Chofer ${payload.nombre || ''} actualizado`); scheduleRefresh(); return; }
    scheduleRefresh();
    return;
  }

  if (type === 'reserva:creada') {
    const reserva = payload.data || payload;
    toast(`✓ Reserva ${reserva.id || ''} confirmada`);
    scheduleRefresh();
    return;
  }
  if (type === 'reserva:estado') { toast(`✓ Reserva ${payload.id || ''} · ${payload.estado || ''}`); scheduleRefresh(); return; }
  if (type.startsWith('reserva:')) { scheduleRefresh(); return; }

  if (type.startsWith('vehiculos:')) {
    if (isRealtimeMuted('vehiculos')) { scheduleRefresh(); return; }
    if (type === 'vehiculos:creado') { toast(`✓ Vehículo ${payload.patente || ''} creado`); scheduleRefresh(); return; }
    if (type === 'vehiculos:actualizado') { toast(`✓ Vehículo ${payload.patente || ''} actualizado`); scheduleRefresh(); return; }
    if (type === 'vehiculos:eliminado') { toast(`✓ Vehículo ${payload.id || ''} eliminado`); scheduleRefresh(); return; }
    scheduleRefresh();
    return;
  }
  if (type === 'clientes:creado') { toast(`✓ Cliente ${payload.nombre || ''} creado`); scheduleRefresh(); return; }
  if (type === 'clientes:actualizado') { toast(`✓ Cliente ${payload.nombre || ''} actualizado`); scheduleRefresh(); return; }
  if (type === 'clientes:eliminado') { toast(`✓ Cliente ${payload.id || ''} eliminado`); scheduleRefresh(); return; }
  if (type.startsWith('clientes:')) { scheduleRefresh(); return; }
  if (type === 'tarifas:creado') { toast(`✓ Tarifa ${payload.zona || ''} creada`); scheduleRefresh(); return; }
  if (type === 'tarifas:actualizado') { toast(`✓ Tarifa ${payload.zona || ''} actualizada`); scheduleRefresh(); return; }
  if (type === 'tarifas:eliminado') { toast(`✓ Tarifa ${payload.id || ''} eliminada`); scheduleRefresh(); return; }
  if (type.startsWith('tarifas:')) { scheduleRefresh(); return; }
  if (type.startsWith('liquidacion')) { toast('✓ Liquidación actualizada'); scheduleRefresh(); return; }
  if (type === 'cliente:actualizado') { scheduleRefresh(); return; }

  scheduleRefresh();
}

/* ---------- INICIO ---------- */
async function init() {
  if (!SESION) return;
  try {
    renderUsuario();
    bindEvents();
    tickClock();
    setInterval(tickClock, 1000);
    applyPrefs();
    initChat();
    renderAll();
    renderDetail(null);
    connectWebSocket();
    setApiBadge('loading');

    const results = await Promise.allSettled([
      loadDashboard(), loadViajes(), loadChoferes(), loadVehiculos(),
      loadClientes(), loadReservas(), loadLiquidaciones(), loadTarifas(), loadAllViajes(),
    ]);
    state.apiOnline = results.some((r) => r.status === 'fulfilled');
    refreshBadge();
    renderAll();
    ensureSelection();
    if (!state.apiOnline) {
      toast('No se pudo conectar con la API. Verificá remixt-api en http://localhost:3001.', 'error');
    }
  } catch (err) {
    console.error('[REMIXT] Error de inicio:', err);
    toast(`Error de inicio: ${err.message}`, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
