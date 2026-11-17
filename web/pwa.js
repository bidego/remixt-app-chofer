/* Registro del Service Worker sólo en HTTPS (en el WebView de Capacitor no aplica). */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https:$/.test(window.location.protocol)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* PWA opcional */ });
  });
})();
