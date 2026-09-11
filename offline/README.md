# 📦 Archivador offline

Pega una URL y guarda la página entera — CSS, imágenes, fuentes, iconos y scripts —
dentro de **un único fichero `.html` autocontenido** que se abre sin conexión,
aunque el sitio original cambie o desaparezca.

```bash
node offline/server.js          # -> http://localhost:7777
node offline/server.js --port 8080
```

Sin `npm install`: solo necesita **Node 18 o superior**. Cero dependencias.

## Por qué es una app local y no una web

Una página web **no puede descargar otras páginas web**. El navegador bloquea la lectura de
respuestas de otro dominio (política de mismo origen / CORS), así que un archivador que viviera
solo dentro del navegador únicamente funcionaría con la minoría de sitios que envían cabeceras
CORS permisivas, y aun así no podría bajar sus imágenes ni sus CSS.

Por eso quien descarga es un pequeño servidor Node en tu máquina: ahí no hay CORS.
La interfaz web es solo el mando a distancia.

## Qué hace exactamente

- Descarga el HTML y **incrusta todos los recursos como `data:` URI**: hojas de estilo
  (resolviendo `@import` y `url()` de forma recursiva), imágenes, `srcset`, fuentes,
  favicon, vídeo/audio y estilos escritos en el atributo `style`.
- Inlinea el JavaScript del sitio (se puede desactivar con la casilla).
- **Rastreo opcional**: además de la página, sus enlaces del mismo dominio hasta 2 niveles,
  con tope de páginas. Los enlaces entre páginas archivadas se reescriben a rutas locales;
  los externos quedan absolutos.
- Añade una franja discreta al pie indicando de dónde y cuándo se archivó.
- Si escribes el dominio sin `http`, prueba `https` y cae a `http` si hace falta.

## Qué obtienes

```
offline/archive/<id>/index.html        ← la copia; ábrela con doble clic
offline/archive/index.json             ← catálogo de la biblioteca
```

Esos `.html` son portables: cópialos a un USB, mándalos por correo o súbelos a cualquier sitio.
No necesitan este programa para verse. La biblioteca de la interfaz sí necesita el servidor
encendido, pero solo para listar, abrir y borrar.

## Límites honestos

- **Sitios que se dibujan con JavaScript** (SPAs tipo React/Vue que piden los datos al cargar):
  se guarda el HTML tal y como lo envía el servidor. Si el contenido real llega después por una
  llamada a una API, esa llamada fallará offline y verás el armazón vacío.
- **Contenido tras iniciar sesión o tras un muro de pago**: el archivador no lleva tus cookies,
  así que verá lo mismo que un visitante anónimo.
- **Vídeos en streaming** (HLS/DASH, YouTube) no se archivan: son fragmentos pedidos en directo.
- **`<iframe>`** se dejan apuntando a la URL original: offline saldrán en blanco.
- Topes por defecto: 4 MB por recurso, 60 MB por copia, 25 páginas. Se ajustan en
  `lib/archive.js` (`DEFAULTS`) y desde la interfaz.
- Respeta lo que descargas: es para tu uso personal, no para republicar material ajeno.

## Uso desde código

```js
const { archive } = require('./offline/lib/archive');
const { pages, stats } = await archive('https://ejemplo.com', { depth: 1, maxPages: 10 });
require('fs').writeFileSync('copia.html', pages[0].html);
```

## Probado

Contra un sitio local con CSS enlazado, `@import`, imágenes, fondo por CSS, `style` en atributo,
script externo y subpáginas: la copia resultante se abre desde `file://` con **la red
completamente cortada** y renderiza idéntica — 0 peticiones salientes, imágenes visibles,
estilos aplicados, JS ejecutado y navegación entre páginas archivadas funcionando.
