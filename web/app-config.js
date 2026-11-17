/* Ajustes del entorno nativo: links externos y cartel del servidor configurado. */
(function () {
  const api = window.REMIXT_API_URL || 'http://localhost:3001';

  // En el WebView, target="_blank" no abre el navegador del sistema: _system sí.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const externo = link.target === '_blank' || /^https?:\/\//.test(href);
    if (!externo && !/^tel:/.test(href)) return;
    event.preventDefault();
    if (window.Capacitor?.isNativePlatform?.()) window.open(href, '_system');
    else window.open(href, '_blank', 'noopener');
  });

  // El login muestra a qué servidor apunta el APK (útil al probar builds).
  window.addEventListener('DOMContentLoaded', () => {
    const login = document.querySelector('.login');
    if (!login) return;
    const aviso = document.createElement('p');
    aviso.textContent = `Servidor: ${new URL(api).host}`;
    aviso.style.cssText = 'text-align:center;font-size:11px;color:#93a4bd;margin:14px 0 0;';
    login.appendChild(aviso);
  });
})();
