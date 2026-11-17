/* ============================================================
   REMIXT · Geo compartido (sin build)
   Mapa Leaflet/OSM, autocomplete Nominatim y seguimiento en vivo.
   ============================================================ */
(function () {
  const L = window.L;
  const Auth = window.RemixtAuth;
  if (!L || !Auth) return;

  const API_BASE = (window.REMIXT_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const COLORES = { origen: '#16a34a', destino: '#dc2626', chofer: '#165be5' };
  const escapeHtml = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function haversineKm(a, b) {
    if (!a || !b) return null;
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function posicion(viaje) {
    if (!viaje || !Number.isFinite(Number(viaje.ultimaLat)) || !Number.isFinite(Number(viaje.ultimaLon))) return null;
    return [Number(viaje.ultimaLat), Number(viaje.ultimaLon)];
  }

  function destino(viaje) {
    if (!viaje || !Number.isFinite(Number(viaje.destinoLat)) || !Number.isFinite(Number(viaje.destinoLon))) return null;
    return [Number(viaje.destinoLat), Number(viaje.destinoLon)];
  }

  function textoEta(viaje) {
    if (!viaje) return '';
    const dur = Number(viaje.ruta?.duracionSegundos);
    const dist = Number(viaje.ruta?.distanciaMetros);
    const actual = posicion(viaje);
    const fin = destino(viaje);
    if (actual && fin) {
      const km = haversineKm(actual, fin);
      const velocidad = dist > 0 && dur > 0 ? (dist / 1000) / (dur / 3600) : 25;
      const min = Math.max(1, Math.round((km / velocidad) * 60));
      return `Chofer a ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(km)} km · llega en ~${min} min`;
    }
    if (dur > 0) return `Recorrido estimado: ${Math.max(1, Math.round(dur / 60))} min`;
    return 'Recorrido en vivo';
  }

  function icono(texto, color) {
    return L.divIcon({
      className: 'geo-pin',
      html: `<span style="background:${color}">${texto}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  /** Crea un panel de mapa persistente (sobrevive a los re-renders de #main). */
  function crear() {
    const panel = document.getElementById('geoPanel');
    const contenedor = document.getElementById('geoMap');
    const eta = document.getElementById('geoEta');
    const enlace = document.getElementById('geoMaps');
    if (!panel || !contenedor) return { abrir() {}, actualizar() {}, cerrar() {} };

    let mapa = null;
    let capas = [];
    let marcadorChofer = null;
    let firmaRuta = '';
    let viaje = null;

    function inicializar() {
      if (mapa) return;
      mapa = L.map(contenedor, { zoomControl: false, scrollWheelZoom: false }).setView([-34.6037, -58.3816], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        subdomains: 'abc', maxZoom: 19, attribution: ATTRIBUTION,
      }).addTo(mapa);
      L.control.zoom({ position: 'bottomright' }).addTo(mapa);
    }

    function limpiar() {
      capas.forEach((capa) => mapa.removeLayer(capa));
      capas = [];
      marcadorChofer = null;
    }

    function actualizarPosicion(v) {
      if (!mapa || !v) return;
      if (eta) eta.textContent = textoEta(v);
      if (enlace) {
        enlace.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(v.origen || '')}&destination=${encodeURIComponent(v.destino || '')}`;
      }
      const latlng = posicion(v);
      if (!latlng) return;
      if (!marcadorChofer) {
        marcadorChofer = L.marker(latlng, { icon: icono('R', COLORES.chofer), zIndexOffset: 1000 }).addTo(mapa);
        capas.push(marcadorChofer);
      } else {
        marcadorChofer.setLatLng(latlng);
      }
    }

    function dibujar(v) {
      if (!mapa || !v) return;
      const puntosRuta = Array.isArray(v.ruta?.puntos) ? v.ruta.puntos : [];
      const firma = JSON.stringify([v.id, puntosRuta.length, v.origenLat, v.origenLon, v.destinoLat, v.destinoLon]);
      if (firma === firmaRuta) { actualizarPosicion(v); return; }
      firmaRuta = firma;
      limpiar();

      const limites = [];
      const origen = Number.isFinite(Number(v.origenLat)) && Number.isFinite(Number(v.origenLon))
        ? [Number(v.origenLat), Number(v.origenLon)] : null;
      const fin = destino(v);

      if (puntosRuta.length > 1) {
        const linea = puntosRuta
          .filter((p) => Array.isArray(p) && p.length >= 2)
          .map((p) => [Number(p[1]), Number(p[0])])
          .filter((p) => p.every(Number.isFinite));
        if (linea.length > 1) {
          capas.push(L.polyline(linea, { color: COLORES.chofer, weight: 5, opacity: 0.85 }).addTo(mapa));
          limites.push(...linea);
        }
      } else if (origen && fin) {
        capas.push(L.polyline([origen, fin], {
          color: COLORES.chofer, weight: 3, dashArray: '6 8', opacity: 0.6,
        }).addTo(mapa));
        limites.push(origen, fin);
      }
      if (origen) {
        capas.push(L.marker(origen, { icon: icono('O', COLORES.origen) }).addTo(mapa));
        limites.push(origen);
      }
      if (fin) {
        capas.push(L.marker(fin, { icon: icono('D', COLORES.destino) }).addTo(mapa));
        limites.push(fin);
      }
      if (limites.length > 1) mapa.fitBounds(L.latLngBounds(limites).pad(0.15), { padding: [24, 24] });
      else if (limites.length === 1) mapa.setView(limites[0], 13);
      actualizarPosicion(v);
    }

    return {
      abrir(v) {
        if (v) viaje = v;
        panel.hidden = false;
        inicializar();
        setTimeout(() => {
          mapa.invalidateSize();
          dibujar(viaje);
        }, 60);
      },
      actualizar(v) {
        if (!v) return;
        viaje = v;
        if (!panel.hidden && mapa) dibujar(v);
      },
      cerrar() { panel.hidden = true; },
    };
  }

  /** Autocomplete live de direcciones con Nominatim proxeado por la API. */
  function observarCampo(input, lista, alSeleccionar) {
    if (!input || !lista) return;
    let temporizador = null;
    let ultimaConsulta = '';

    function ocultar() { lista.hidden = true; lista.innerHTML = ''; }
    function mostrar(items) {
      if (!items.length) return ocultar();
      lista.innerHTML = items.map((item) => `<button type="button" class="geo-sug__item"
        data-label="${escapeHtml(item.label)}" data-lat="${Number(item.lat)}" data-lon="${Number(item.lon)}">
        ${escapeHtml(item.label)}</button>`).join('');
      lista.hidden = false;
    }

    input.addEventListener('input', () => {
      clearTimeout(temporizador);
      const q = input.value.trim();
      if (q.length < 3) { ultimaConsulta = ''; return ocultar(); }
      temporizador = setTimeout(async () => {
        if (q === ultimaConsulta) return;
        ultimaConsulta = q;
        try {
          const res = await Auth.api('GET', `/api/geo/sugerencias?q=${encodeURIComponent(q)}&limit=5`);
          if (input.value.trim() === q) mostrar(res.data || []);
        } catch (err) {
          ocultar();
        }
      }, 320);
    });
    input.addEventListener('blur', () => setTimeout(ocultar, 180));
    lista.addEventListener('click', (event) => {
      const opcion = event.target.closest('[data-label]');
      if (!opcion) return;
      const dato = {
        label: opcion.dataset.label,
        lat: Number(opcion.dataset.lat),
        lon: Number(opcion.dataset.lon),
      };
      input.value = dato.label;
      ultimaConsulta = dato.label;
      alSeleccionar(dato);
      ocultar();
    });
  }

  async function geocodificar(texto) {
    if (!texto || texto.trim().length < 3) return null;
    try {
      const res = await Auth.api('GET', `/api/geo/geocode?q=${encodeURIComponent(texto.trim())}`);
      return res.data || null;
    } catch (err) {
      return null;
    }
  }

  window.RemixGeo = { crear, observarCampo, geocodificar, textoEta };
})();
