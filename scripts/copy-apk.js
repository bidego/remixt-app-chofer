/** Copia el APK generado a dist/ con un nombre estable para el Release. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const from = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const dir = path.join(root, 'dist');
const to = path.join(dir, 'remixt-app-chofer.apk');
if (!fs.existsSync(from)) throw new Error(`No se encontró el APK: ${from}`);

fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(from, to);
const bytes = fs.readFileSync(to);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
console.log(`[apk] ${path.relative(root, to)} · ${(bytes.length / 1048576).toFixed(1)} MB · sha256 ${sha}`);
