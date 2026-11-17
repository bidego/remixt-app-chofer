/**
 * Copia los archivos web de `web/` a `www/` y genera `config.js` con la URL de
 * la API. En CI la URL viene de la variable/secreto REMIXT_API_URL de GitHub.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'web');
const out = path.join(root, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const apiUrl = (process.env.REMIXT_API_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
const wsUrl = (process.env.REMIXT_WS_URL || '').trim().replace(/\/+$/, '');
if (!/^https?:\/\//.test(apiUrl)) throw new Error(`REMIXT_API_URL inválida: ${apiUrl}`);

const config = [
  '/* Generado por scripts/build-web.js. No editar a mano. */',
  `window.REMIXT_API_URL = ${JSON.stringify(apiUrl)};`,
  `window.REMIXT_WS_URL = ${JSON.stringify(wsUrl)};`,
  `window.REMIXT_BUILD = ${JSON.stringify({ version: process.env.npm_package_version || '0.1.0', at: new Date().toISOString() })};`,
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'config.js'), config);

// La versión del APK sale de package.json (el login la muestra abajo).
const version = require('../package.json').version;
fs.writeFileSync(
  path.join(out, 'version.js'),
  `/* Generado por scripts/build-web.js. No editar a mano. */\nwindow.REMIXT_VERSION = ${JSON.stringify(version)};\n`,
);

// Inyectamos la configuración antes de auth.js sin modificar los archivos web
// originales (así se pueden copiar tal cual desde el repo remixt-web).
const inject = '<script src="config.js"></script>\n  <script src="app-config.js"></script>\n  <script src="auth.js"></script>';
for (const file of fs.readdirSync(out).filter((f) => f.endsWith('.html'))) {
  const file_path = path.join(out, file);
  // Si el HTML viene del repo web ya puede traer su config.js: lo sacamos para
  // que no se duplique con el generado desde la variable de GitHub.
  const html = fs.readFileSync(file_path, 'utf8')
    .replace(/^[ \t]*<script src="(?:config|app-config)\.js"><\/script>\r?\n/gm, '');
  if (!html.includes('<script src="auth.js"></script>')) continue;
  fs.writeFileSync(file_path, html.replace('<script src="auth.js"></script>', inject));
}

console.log(`[build:web] API=${apiUrl} WS=${wsUrl || '(derivada)'} → www/`);
