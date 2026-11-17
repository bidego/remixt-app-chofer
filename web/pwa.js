/* Registro del Service Worker y recarga automática cuando hay una versión nueva. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https:$/.test(window.location.protocol)) return; // en Capacitor no aplica

  const teniaControlador = Boolean(navigator.serviceWorker.controller);
  let recargado = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!teniaControlador || recargado) return; // no recargar en la primer instalación
    recargado = true;
    window.location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(function (reg) {
        function activar(worker) {
          if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
        }
        activar(reg.waiting);
        reg.addEventListener('updatefound', function () {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', function () {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) activar(nuevo);
          });
        });
        return reg.update();
      })
      .catch(function () { /* la PWA es opcional */ });
  });
})();
