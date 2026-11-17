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

  function alturaDe(texto) {
    const primera = String(texto ?? '').split(',')[0];
    const encontrado = primera.match(/(?:^|\s)(\d{1,5})(?=\s|$)/);
    return encontrado ? encontrado[1] : null;
  }

  function conservaAltura(texto, label) {
    const altura = alturaDe(texto);
    if (!altura) return true;
    const patron = new RegExp(`(^|[\\s,])${altura}(?:$|[\\s,])`);
    return patron.test(String(label ?? ''));
  }

  function haversineKm(a, b) {
    if (!a || !b) return null;
    const rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad;
    const dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  // Number(null) y Number('') dan 0: sin este helper, un dato ausente se ve como (0,0).
  function numero(valor) {
    return valor == null || valor === '' ? NaN : Number(valor);
  }

  function posicion(viaje) {
    if (!viaje || !Number.isFinite(numero(viaje.ultimaLat)) || !Number.isFinite(numero(viaje.ultimaLon))) return null;
    return [numero(viaje.ultimaLat), numero(viaje.ultimaLon)];
  }

  function origen(viaje) {
    if (!viaje || !Number.isFinite(numero(viaje.origenLat)) || !Number.isFinite(numero(viaje.origenLon))) return null;
    return [numero(viaje.origenLat), numero(viaje.origenLon)];
  }

  function destino(viaje) {
    if (!viaje || !Number.isFinite(numero(viaje.destinoLat)) || !Number.isFinite(numero(viaje.destinoLon))) return null;
    return [numero(viaje.destinoLat), numero(viaje.destinoLon)];
  }

  /** Una posición a miles de km es GPS inválido: se descarta en vez de arruinar el ETA. */
  function posicionConfiable(viaje) {
    const actual = posicion(viaje);
    if (!actual) return null;
    const referencias = [origen(viaje), destino(viaje)].filter(Boolean);
    if (!referencias.length) return actual;
    const kmRuta = Number(viaje.ruta?.distanciaMetros) / 1000 || Number(viaje.distanciaKm) || 0;
    const limite = Math.max(kmRuta * 2, 25);
    return referencias.some((ref) => haversineKm(actual, ref) <= limite) ? actual : null;
  }

  function textoEta(viaje) {
    if (!viaje) return '';
    const dur = Number(viaje.ruta?.duracionSegundos);
    const dist = Number(viaje.ruta?.distanciaMetros);
    const actual = posicionConfiable(viaje);
    const fin = destino(viaje);
    if (actual && fin) {
      const km = haversineKm(actual, fin);
      const velocidad = dist > 0 && dur > 0 ? (dist / 1000) / (dur / 3600) : 25;
      const estimado = Math.max(1, Math.round((km / velocidad) * 60));
      const tope = dur > 0 ? Math.ceil(dur / 60) * 2 : estimado;
      const min = Math.min(estimado, tope);
      return `Chofer a ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(km)} km · llega en ~${min} min`;
    }
    const estimadoRuta = dur > 0
      ? Math.round(dur / 60)
      : Math.max(1, Math.round(((Number(viaje.ruta?.distanciaMetros) / 1000 || Number(viaje.distanciaKm) || 5) / 25) * 60));
    const sufijo = posicion(viaje) ? 'Ubicación del chofer sin señal · ' : '';
    return `${sufijo}ETA estimado: ${Math.max(1, estimadoRuta)} min`;
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
      const latlng = posicionConfiable(v);
      if (!latlng) {
        if (marcadorChofer) {
          mapa.removeLayer(marcadorChofer);
          capas = capas.filter((capa) => capa !== marcadorChofer);
          marcadorChofer = null;
        }
        return;
      }
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
      const escrito = input.value.trim();
      const sugerido = opcion.dataset.label;
      const dato = {
        label: conservaAltura(escrito, sugerido) ? sugerido : escrito,
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
      if (!res.data) return null;
      return { ...res.data, label: conservaAltura(texto, res.data.label) ? res.data.label : texto.trim().slice(0, 180) };
    } catch (err) {
      return null;
    }
  }

  window.RemixGeo = { crear, observarCampo, geocodificar, textoEta };
})();
