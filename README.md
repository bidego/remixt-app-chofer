# REMIXT Chofer (Android + iPhone)

App del chofer: empaqueta `chofer.html` y `login.html` de
[remixt-web](https://github.com/bidego/remixt-web) con Capacitor. No tiene datos
mockeados: consume la API de [remixt-api](https://github.com/bidego/remixt-api).

En Android se instala el APK de abajo. En iPhone se puede usar **sin pagar Apple
Developer** de dos formas: como PWA instalada desde Safari (recomendado, no vence)
o con el proyecto Xcode de `ios/` (para probar nativo con un Apple ID gratis,
vence a los 7 días).

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
cp ../remixt-web/{manifest.webmanifest,apple-touch-icon.png,icon-192.png,icon-512.png,pwa.js,sw.js} web/
```

El build inyecta `config.js` y `app-config.js` antes de `auth.js`, así que los
archivos copiados no necesitan modificaciones. **No copiar `config.js` desde
`remixt-web`**: ese archivo apunta al hosting web; el APK genera el suyo desde
la variable de GitHub y el build quita cualquier `config.js` previo.

## Permisos y comportamiento

- Permiso `INTERNET` (REST + WebSocket). Sin GPS ni permisos de ubicación: los
  botones de mapa abren Google Maps en el navegador del sistema.
- `usesCleartextTraffic="true"` para permitir APIs HTTP durante el development;
  en producción conviene usar HTTPS.
- La sesión del chofer se guarda en `localStorage` del WebView (`remixt:sesion:chofer`).
- El apk es un **debug build**: se puede instalar por sideload, pero no está
  firmado con una clave de release ni es apto para Google Play.

## iPhone sin Apple Developer: PWA

La web de [remixt.vyronxt.com](https://remixt.vyronxt.com) es instalable desde
Safari. No requiere cuenta de desarrollador ni CAD, y **no vence**:

1. Abrir `https://remixt.vyronxt.com/chofer.html` en Safari.
2. Tocar **Compartir** → **Agregar a la pantalla de inicio**.
3. Confirmar el nombre `REMIXT`. Se abre a pantalla completa con el icono propio.

Los archivos que hacen posible la instalación son `manifest.webmanifest`,
`apple-touch-icon.png`, `icon-192.png`, `icon-512.png` y los meta tags
`apple-mobile-web-app-capable` / `theme-color` presentes en todos los HTML.

Limitaciones de una PWA en iOS: el websocket se mantiene mientras la app está
abierta y las notificaciones push quedan para una versión futura con certificados.

## iPhone nativo con Apple ID gratis (7 días)

El scaffold Capacitor ya está en `ios/`. En una Mac con Xcode:

```bash
npm ci
npm run build:web        # genera www/ con la API de REMIXT_API_URL
npx cap sync ios
open ios/App/App.xcodeproj
```

En Xcode:

1. Seleccionar el target **App** → *Signing* → marcar *Automatically manage signing*.
2. Elegir tu **Personal Team** (Apple ID gratuito, sin Apple Developer Program).
3. Conectar el iPhone por USB y seleccionarlo como destino.
4. *Run* (⌘R). Si el bundle identifier ya está registrado, cambiarlo en
   *General → Identity → Bundle Identifier*.

El perfil gratuito **expira a los 7 días**: pasado ese tiempo hay que volver a
correr desde Xcode (o borrar y reinstalar la app). Para TestFlight o App Store
sí hace falta el programa de pago; esta vía es solo para prueba local.

Si preferís no instalar Xcode, usá directamente la PWA de la sección anterior.

## Reproducir el Release

Los tags `v*` disparan `.github/workflows/release.yml`, que buildea con la
variable de GitHub, sube el APK como artefacto y lo publica en un Release.

```bash
git tag v0.1.1 && git push origin v0.1.1
```
