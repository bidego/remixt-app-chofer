# REMIXT Chofer (Android)

App nativa para choferes: empaqueta `chofer.html` y `login.html` de
[remixt-web](https://github.com/bidego/remixt-web) con Capacitor. No tiene datos
mockeados: consume la API de [remixt-api](https://github.com/bidego/remixt-api).

## Descargar e instalar

1. Entrar a **Releases** de este repo y descargar `remixt-app-chofer.apk`.
2. En el celular, habilitar *Instalar aplicaciones desconocidas* para el navegador
   o el administrador de archivos usado.
3. Instalar el APK e ingresar con el teléfono del chofer y su clave
   (`chofer123` si todavía no la cambió).

La URL de la API viene compilada en el APK y se muestra abajo del login.

## URL de la API

El build lee la variable `REMIXT_API_URL` (o el secreto del mismo nombre) y
genera `www/config.js` con:

```js
window.REMIXT_API_URL = 'https://api-remixt.vyronxt.com';
```

En GitHub está cargada en **Settings → Secrets and variables → Actions →
Variables → `REMIXT_API_URL`**. Si querés apuntar a otro servidor, cambiá esa
variable y volvé a correr el workflow *Build Android APK* (o pusheá un tag `v*`).

La WebSocket se deriva sola de la URL (`ws://…/ws` o `wss://…/ws`). Si el
servidor la expone en otro lugar, se puede setear también `REMIXT_WS_URL`.

Para desarrollo local podés escribirla como variable de entorno:

```bash
REMIXT_API_URL=http://localhost:3001 npm run build
```

En el emulador de Android, `localhost` es el propio emulador: usá
`http://10.0.2.2:3001`. En un celular físico, la IP de la máquina donde corre
la API dentro de la misma red (o una URL pública con HTTPS).

## Build local

Requiere Node 20+, JDK 21 y Android SDK con platform 36 y build-tools 36.0.0.

```bash
npm ci
npm run build          # build:web + cap sync + gradle assembleDebug
ls -lh dist/remixt-app-chofer.apk
```

Para development con recarga automática:

```bash
npm run dev
```

## Estructura

```
web/                 # copia de los archivos web del chofer (fuente)
scripts/build-web.js # copia web/ → www/ y genera config.js
www/                 # generado (no versionado)
android/             # proyecto Capacitor
.github/workflows/   # CI y Release con APK
dist/                # APK generado (no versionado)
```

Si cambiás la app web en `remixt-web`, actualizá `web/` con:

```bash
cp ../remixt-web/{chofer.html,login.html,auth.js,portal.js,chofer.js,login.js,styles.css,portal.css} web/
```

El build inyecta `config.js` y `app-config.js` antes de `auth.js`, así que los
archivos copiados no necesitan modificaciones.

## Permisos y comportamiento

- Permiso `INTERNET` (REST + WebSocket). Sin GPS ni permisos de ubicación: los
  botones de mapa abren Google Maps en el navegador del sistema.
- `usesCleartextTraffic="true"` para permitir APIs HTTP durante el development;
  en producción conviene usar HTTPS.
- La sesión del chofer se guarda en `localStorage` del WebView (`remixt:sesion:chofer`).
- El apk es un **debug build**: se puede instalar por sideload, pero no está
  firmado con una clave de release ni es apto para Google Play.

## Reproducir el Release

Los tags `v*` disparan `.github/workflows/release.yml`, que buildea con la
variable de GitHub, sube el APK como artefacto y lo publica en un Release.

```bash
git tag v0.1.1 && git push origin v0.1.1
```
