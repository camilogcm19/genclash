# GenClash: batallas Pokémon por generación

Aplicación web donde eliges una generación (de Kanto a Paldea, o todas juntas), el juego arma dos equipos aleatorios consumiendo la **PokeAPI** y peleas por turnos **contra la computadora o contra otra persona en línea**. Cada jugador entra con usuario y contraseña, y cada resultado se guarda en **Supabase** y alimenta un ranking global que se actualiza en tiempo real.

Versión publicada: https://camilogcm19.github.io/genclash/

## Qué hace

- **Consumo de API (PokeAPI):** por partida se hacen entre 60 y 150 consultas a `/generation`, `/pokemon`, `/pokemon-species` y `/move`. Se usan nombres en español, tipos, estadísticas base, movimientos reales, sprites animados y los gritos de cada Pokémon.
- **Motor de batalla propio:** fórmula oficial de daño, STAB, tabla de 18 tipos, golpes críticos, precisión, prioridad, velocidad, golpes múltiples, absorción y retroceso, cambios de estadísticas (−6 a +6) y estados (quemadura, parálisis, veneno, veneno grave, sueño, congelación y confusión).
- **Login sin correo:** cuentas con usuario y contraseña, cifrada con bcrypt dentro de Supabase (funciones `registrar`, `iniciar_sesion`, `guardar_partida`). Nadie puede escribir en el ranking a nombre de otro.
- **Jugador contra jugador en línea:** Supabase Realtime (Presence + Broadcast) empareja a quienes buscan en la misma generación. Los dos navegadores corren el mismo motor con la misma semilla aleatoria y solo intercambian las acciones de cada turno. Incluye temporizador de 60 s por turno, rendición y victoria por abandono.
- **Efectos 3D hechos en Blender:** `blender/efectos_genclash.py` genera con Cycles una explosión animada para cada uno de los 18 tipos (fuego con humo, relámpagos, salpicaduras, cristales de hielo, nubes fantasma, rocas…) y la guarda como hoja de sprites en `assets/fx/`. El juego la reproduce en el impacto de cada ataque.
- **Sonido original sintetizado (Web Audio):** un efecto distinto por tipo de ataque, sonidos de interfaz, golpes, alarma de PS bajos, música de batalla compuesta para el juego y fanfarrias de victoria y derrota. El botón de bocina alterna entre música y efectos, solo efectos, y silencio.
- **Batallas con más vida:** pantalla VS de entrada, carga de energía, proyectiles 3D (también renderizados en Blender), oscurecimiento del escenario, destello y retroceso al recibir golpes, letreros de súper eficaz y crítico, barra de PS que baja poco a poco con rastro y confeti al ganar.
- **Opción Solo legendarios:** cartucho dorado con 89 legendarios y singulares de todas las generaciones (contra la computadora o en línea).
- **Animaciones por ataque:** motor de partículas en canvas (`js/fx.js`). Cada movimiento se anima según su tipo (18 paletas) y su forma (rayo, proyectil, golpe, mordida, garras, sismo, caída, drenaje, ondas, polvos, sonido, aura, curación).
- **Rival con IA:** calcula el daño esperado de cada movimiento, busca noquear, usa movimientos de estado cuando conviene y cambia de Pokémon si está en desventaja.
- **Niveles balanceados:** como en los combates aleatorios de Showdown, los Pokémon fuertes pelean a menor nivel.
- **Base de datos (Supabase):** tabla `partidas`, vista `ranking`, políticas RLS y suscripción en tiempo real (cuando alguien termina una batalla, aparece al instante en todas las pantallas abiertas).
- **QR funcional:** botón "QR" en la barra superior que genera el código de la URL actual, con opción de descargarlo en alta resolución.
- **Responsivo:** se juega bien en celular, con atajos de teclado (1 a 4) en computadora.

## Estructura

```
genclash/
├── index.html            Estructura de todas las pantallas
├── css/styles.css        Estilos y animaciones
├── js/
│   ├── config.js         ← Aquí van tus llaves de Supabase
│   ├── main.js           Interfaz y flujo del juego
│   ├── api.js            Consumo de la PokeAPI (caché, reintentos, armado de equipos)
│   ├── battle.js         Motor de batalla (lógica pura)
│   ├── ai.js             Inteligencia del rival
│   ├── db.js             Supabase (login, partidas, ranking, tiempo real)
│   ├── online.js         Emparejamiento y salas en línea (Realtime)
│   ├── fx.js             Animaciones de ataques (canvas)
│   ├── data.js           Tabla de tipos, traducciones, generaciones
│   └── audio.js          Efectos de sonido y gritos
└── supabase/schema.sql   Script para crear la base de datos
```

No necesita `npm install` ni compilación: es HTML, CSS y JavaScript con módulos.

## 1. Abrirlo en Visual Studio Code

1. Abre la carpeta `genclash` en VS Code.
2. Instala la extensión **Live Server** (VS Code te la sugerirá automáticamente).
3. Clic derecho en `index.html` → **Open with Live Server**.

> Importante: no abras el `index.html` con doble clic. Los módulos de JavaScript necesitan un servidor, por eso se usa Live Server.

Sin configurar Supabase el juego ya funciona en **modo local** (guarda el historial en el navegador).

## 2. Conectar Supabase (5 minutos)

1. Entra a [supabase.com](https://supabase.com), crea una cuenta y un proyecto nuevo.
2. Ve a **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**.
3. Ve a **Project Settings → API** (o **Data API**) y copia:
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - La llave **anon / public** (o **publishable**)
4. Pégalas en `js/config.js`:

```js
export const SUPABASE_URL = 'https://abcd1234.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

5. Recarga la página: arriba a la derecha debe decir **"Supabase en línea"** con un punto verde.

La llave anónima es pública por diseño: la tabla está protegida con RLS, así que desde la app solo se puede leer e insertar, nunca editar ni borrar.

## 3. Publicarlo en la nube

### Opción A: Netlify Drop (la más rápida, sin cuenta de GitHub)
1. Entra a [app.netlify.com/drop](https://app.netlify.com/drop).
2. Arrastra la carpeta `genclash` completa.
3. En segundos tendrás una URL tipo `https://nombre-raro.netlify.app`. Puedes cambiar el nombre en *Site configuration → Change site name*.

### Opción B: Vercel con GitHub (recomendada si van a seguir editando)
1. Sube la carpeta a un repositorio de GitHub (desde VS Code: *Source Control → Publish to GitHub*).
2. Entra a [vercel.com](https://vercel.com) → **Add New → Project** → importa el repositorio.
3. Framework Preset: **Other**. No cambies nada más y dale **Deploy**.
4. Cada vez que hagas *push*, Vercel actualiza la página sola.

### Opción C: GitHub Pages
Repositorio → **Settings → Pages** → Source: *Deploy from a branch* → rama `main`, carpeta `/root`.

## 4. El código QR

Ya publicado, abre tu página y presiona **QR** en la barra superior. El código apunta a la URL de tu despliegue; descárgalo con **Descargar QR** para ponerlo en la presentación o imprimirlo. También aparece un QR pequeño en la pantalla de inicio.

Si quieres fijar la URL (por ejemplo, para generar el QR desde tu computadora), escríbela en `URL_PUBLICA` dentro de `js/config.js`.

## Ideas para la presentación

- Pide al grupo que escanee el QR y juegue al mismo tiempo: las batallas aparecen en vivo en "Batallas recientes" y en el ranking.
- Muestra en la consola del navegador (pestaña *Network*) las peticiones a `pokeapi.co` mientras se arma un equipo.
- Muestra la tabla `partidas` en el *Table Editor* de Supabase llenándose en tiempo real.

## Créditos

Datos, sprites y gritos: [PokeAPI](https://pokeapi.co). Base de datos: [Supabase](https://supabase.com). Código QR: [goqr.me API](https://goqr.me/api/). Proyecto escolar sin fines de lucro; Pokémon y sus nombres son marcas de Nintendo, Game Freak y The Pokémon Company.
