# 🕹️ Arcade HTML — 56 juegos en un solo repo

Colección de **56 juegos completos escritos en HTML + CSS + JavaScript puro**.
Sin frameworks, sin `npm install`, sin build: cada juego es **un único archivo `.html`** que
funciona abriéndolo directamente en el navegador.

👉 Abre **[`index.html`](index.html)** para el hub con buscador y filtros por categoría.

```bash
# opción 1: abrir el archivo directamente
xdg-open index.html      # o simplemente doble clic

# opción 2: servirlo (recomendado, para que carguen los estilos compartidos)
python3 -m http.server 8000
# -> http://localhost:8000
```

## Los destacados

| Juego | Qué tiene |
|---|---|
| [Ajedrez](games/chess.html) ♛ | Reglas completas (enroque, al paso, coronación, jaque mate y ahogado) + IA minimax con poda alfa-beta y tablas posicionales. Generación de jugadas **verificada con perft** hasta profundidad 4 (20 / 400 / 8902 / 197281). |
| [Granny](games/granny.html) 👵 | Escape en primera persona con **raycaster propio**, mapa 15×15, llaves, trampas de ruido, minimapa y una IA que te persigue por BFS según cuánto ruido haces. |
| [Five Nights](games/fnaf.html) 🐻 | Turno de noche de 12 AM a 6 AM: energía que se agota, dos puertas, luces, panel de 8 cámaras, 4 animatrónicos con niveles de IA por noche y Foxy corriendo si dejas de vigilarlo. |
| [Las 8 páginas](games/slender.html) 🌲 | Bosque nocturno, linterna con batería, barra de cordura y un acechador que se acerca cuando lo miras. |
| [Pac-Man](games/pacman.html) 👻 | Laberinto de 220 puntos (validado: todos alcanzables), 4 fantasmas con casa y puerta propia, píldoras de poder y niveles. |
| [Sokoban](games/sokoban.html) 📦 | 8 niveles, **todos verificados como resolubles con un solver BFS** antes de publicarlos. |

## Todos los juegos por categoría

- **👻 Terror** — Granny, Five Nights, Las 8 páginas
- **♟️ Tablero** — Ajedrez, Damas, Reversi, Conecta 4, Tres en raya, Puntos y cajas, Hundir la flota
- **🕹️ Arcade** — Pac-Man, Snake, Space Invaders, Asteroids, Breakout, Pong, Frogger, Missile Command, Alunizaje, Pinball, Flappy, Salta que salta, Runner, Helicóptero, Carrera, Shooter espacial
- **🧩 Puzzle** — Tetris, 2048, Buscaminas, Sudoku, Sokoban, Laberinto, Puzzle 15, Memoria, Bubble Shooter
- **🔤 Palabras** — Adivina la palabra, Ahorcado, Sopa de letras, Mecanografía
- **🧠 Estrategia** — Tower Defense, Duelo de tanques
- **🎰 Casino** — Blackjack, Video Poker, Dados (Generala)
- **⚽ Deportes** — Minigolf, Air Hockey
- **⚡ Reflejos** — Golpea al topo, Test de reflejos, Simón dice, Color Match, Corta frutas, Cálculo rápido, Torre de bloques, Piedra papel o tijera
- **🏃 Plataformas** — Plataformas
- **🎲 Familiar** — Serpientes y escaleras

## Estructura

```
index.html          hub con buscador y filtros
games.json          manifiesto legible por máquina (id, título, categoría, tags, ruta)
games/*.html        un archivo por juego, autocontenido
assets/arcade.css   estilos compartidos (cabecera, HUD, botones, tema oscuro)
assets/arcade.js    utilidades opcionales: beep sintetizado, bucle de render, récords
```

`games.json` está pensado para automatizar cosas encima de la colección
(generar páginas, torneos, lanzadores, estadísticas…).

## Detalles técnicos

- **Sin dependencias externas.** Ni una sola petición de red: todo es canvas, DOM y Web Audio.
- **Móvil incluido.** Deslizamientos, arrastres y pads táctiles en los juegos que lo permiten.
- **Récords locales** por juego en `localStorage` (`arcade-best-<id>`).
- **Sonido** generado con osciladores de Web Audio (nada de ficheros de audio).
- Probado cargando los 56 juegos en Chromium (Playwright) verificando que no lanzan errores de JS.

## 📦 Extra: Archivador offline

En [`offline/`](offline/) hay una herramienta aparte: pegas una URL y guarda la web entera
(CSS, imágenes, fuentes, scripts) como **un único `.html` autocontenido** que funciona sin conexión.

```bash
node offline/server.js   # -> http://localhost:7777
```

Sin dependencias, solo Node 18+. Detalles y límites en [`offline/README.md`](offline/README.md).

## Licencia

Código propio escrito para este repositorio. Los juegos son reinterpretaciones originales
de mecánicas clásicas; no incluyen assets, marcas ni código de terceros.
