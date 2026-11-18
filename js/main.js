// ============================================================
//  GenClash · Interfaz y flujo del juego
// ============================================================
import { GENERACIONES, TODAS, TIPOS, ESTADOS, STATS_ES, STATS_CORTO, CATEGORIAS, NOMBRES_RIVALES, TITULOS_RIVALES, efectividad } from './data.js';
import { armarEquipo, sprites, aleatorio, contadorPeticiones } from './api.js';
import { crearBatalla, ejecutarTurno, cambioForzado, activo, vivos, opcionesCambio, FORCEJEO, N } from './battle.js';
import { decidirAccion, mejorReemplazo } from './ai.js';
import * as db from './db.js';
import { sfx, grito, alternarSonido, estaSilenciado } from './audio.js';
import { URL_PUBLICA } from './config.js';

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BALL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png';
const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const estado = {
  nombre: localStorage.getItem('gc:nombre') || '',
  gen: Number(localStorage.getItem('gc:gen') ?? 1),
  tamano: Number(localStorage.getItem('gc:tamano') || 6),
  vel: Number(localStorage.getItem('gc:vel') || 1),
  batalla: null,
  equipos: null,
  rival: null,
  busqueda: 0,
  ocupado: false,
  mostrado: { player: null, rival: null },
  caidos: { player: new Set(), rival: new Set() },
};

const genActual = () => (estado.gen === 0 ? TODAS : GENERACIONES.find((g) => g.id === estado.gen) || GENERACIONES[0]);
const etiquetaGen = (g) => (g.id === 0 ? 'Todas las generaciones' : `Gen ${g.romano} (${g.region})`);

// Espera que se puede saltar tocando la caja de texto o la arena
let saltar = null;
function espera(ms) {
  return new Promise((ok) => {
    const t = setTimeout(fin, reducido ? Math.min(ms, 250) : ms / estado.vel);
    function fin() { clearTimeout(t); if (saltar === fin) saltar = null; ok(); }
    saltar = fin;
  });
}
const anim = (el, frames, opts) => (reducido || !el?.animate ? Promise.resolve() : el.animate(frames, { duration: 400, easing: 'ease-out', ...opts, duration: (opts?.duration ?? 400) / estado.vel }).finished.catch(() => {}));

function toast(texto, ms = 3800) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = texto;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function colorTexto(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.68 ? '#1b1f3f' : '#fff';
}
const badgeTipo = (t) => `<span class="tipo" style="--c:${TIPOS[t]?.color}">${TIPOS[t]?.es ?? t}</span>`;
const haceCuanto = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso)) / 1000));
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};

function mostrar(pantalla) {
  $$('.pantalla').forEach((p) => p.classList.toggle('activa', p.id === `pantalla-${pantalla}`));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// ============================================================
//  INICIO
// ============================================================
function renderEstante() {
  const cont = $('#estante');
  cont.innerHTML = '';
  for (const g of [...GENERACIONES, TODAS]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cartucho${g.id === 0 ? ' todas' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(g.id === estado.gen));
    b.setAttribute('aria-label', etiquetaGen(g));
    b.style.setProperty('--c1', g.tema[0]);
    b.style.setProperty('--c2', g.tema[1]);
    b.innerHTML = `
      <div class="etiqueta">
        <span class="romano">${g.romano}</span>
        ${g.destacados.map((id) => `<img src="${sprites(id).frenteFijo}" alt="" loading="lazy" width="96" height="96" />`).join('')}
      </div>
      <span class="region">${g.id === 0 ? 'Todas' : g.region}</span>
      <span class="anio">${g.id === 0 ? '1,025 Pokémon' : g.año}</span>`;
    b.addEventListener('click', () => elegirGen(g.id));
    cont.append(b);
  }
  actualizarCTA();
}

function elegirGen(id) {
  estado.gen = id;
  localStorage.setItem('gc:gen', id);
  $$('.cartucho').forEach((c, i) => c.setAttribute('aria-checked', String([...GENERACIONES, TODAS][i].id === id)));
  sfx.click();
  actualizarCTA();
}

function actualizarCTA() {
  const g = genActual();
  $('#txtBuscar').textContent = g.id === 0 ? 'Buscar partida con todas las generaciones' : `Buscar partida en ${g.region}`;
}

// Navegación con flechas dentro del estante (radiogroup)
$('#estante').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const lista = [...GENERACIONES, TODAS];
  const i = lista.findIndex((g) => g.id === estado.gen);
  const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + lista.length) % lista.length;
  elegirGen(lista[j].id);
  $$('.cartucho')[j].focus();
  e.preventDefault();
});

let tRecord;
async function actualizarRecord() {
  const r = await db.recordDe(estado.nombre).catch(() => null);
  $('#record').textContent = r && (r.victorias || r.derrotas) ? `Tu récord: ${r.victorias} victorias, ${r.derrotas} derrotas` : '';
}

async function cargarTablero() {
  const conexion = $('#conexion');
  conexion.classList.toggle('online', db.enLinea());
  conexion.textContent = db.enLinea() ? 'Supabase en línea' : 'Modo local';

  try {
    const r = await db.obtenerRanking();
    $('#ranking').innerHTML = r.length ? r.map((x, i) => `
      <li class="${x.jugador === estado.nombre ? 'yo' : ''}">
        <span class="pos">${i + 1}</span>
        <span class="nom">${esc(x.jugador)}</span>
        <span class="vd">${x.victorias}–${x.derrotas}</span>
        <span class="pct">${Math.round(x.porcentaje)}%</span>
      </li>`).join('') : '<li class="vacio">Nadie ha peleado todavía. La primera victoria es tuya.</li>';
  } catch (e) { $('#ranking').innerHTML = `<li class="vacio">No se pudo leer el ranking: ${esc(e.message)}</li>`; }

  try {
    const lista = await db.obtenerRecientes();
    $('#recientes').innerHTML = lista.length ? lista.map(itemReciente).join('') : '<li class="vacio">Aquí aparecerán las batallas en cuanto alguien termine una.</li>';
  } catch { $('#recientes').innerHTML = '<li class="vacio">No se pudieron leer las batallas recientes.</li>'; }

  try {
    const s = await db.obtenerEstadisticas();
    const mvp = s.topMvp[0];
    $('#stats').innerHTML = `
      <div><dt>Batallas</dt><dd>${s.total}</dd></div>
      <div><dt>Entrenadores</dt><dd>${s.jugadores}</dd></div>
      <div><dt>Victorias humanas</dt><dd>${s.porcentajeGlobal}%</dd></div>
      <div><dt>Pokémon más valioso</dt><dd>${mvp ? `<img src="${sprites(mvp.id).icono}" alt="" />${esc(mvp.nombre)}` : '—'}</dd></div>`;
  } catch { $('#stats').innerHTML = ''; }
}

function itemReciente(p, nuevo = false) {
  const icono = p.mvp_id ? sprites(p.mvp_id).icono : BALL;
  const verbo = p.resultado === 'victoria' ? 'venció a' : 'perdió contra';
  return `<li class="${nuevo ? 'nuevo' : ''}">
    <img src="${icono}" alt="" loading="lazy" />
    <span class="linea"><strong>${esc(p.jugador)}</strong> ${verbo} ${esc(p.rival_nombre || 'un rival')}
      <small>${esc(p.generacion)}, ${p.turnos} turnos, ${haceCuanto(p.creado_en)}</small></span>
    <span class="res ${p.resultado}">${p.resultado === 'victoria' ? 'V' : 'D'}</span>
  </li>`;
}

// ============================================================
//  QR
// ============================================================
const urlJuego = () => URL_PUBLICA || `${location.origin}${location.pathname}`;
const qrSrc = (tam) => `https://api.qrserver.com/v1/create-qr-code/?size=${tam}x${tam}&margin=10&color=1d2142&bgcolor=ffffff&data=${encodeURIComponent(urlJuego())}`;

function prepararQR() {
  $('#qrMini').src = qrSrc(200);
  const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) || location.protocol === 'file:';
  const aviso = $('#qrAviso');
  aviso.hidden = !(local && !URL_PUBLICA);
  aviso.textContent = 'Estás abriendo el juego desde tu computadora: este QR apunta aquí y no abrirá en otros teléfonos. Publica el proyecto en Vercel o Netlify, o escribe la URL pública en js/config.js.';
}

$('#btnQR').addEventListener('click', () => {
  $('#qrGrande').src = qrSrc(560);
  $('#qrUrl').textContent = urlJuego();
  $('#modalQR').showModal();
});
$('#btnCopiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(urlJuego()); toast('Enlace copiado.'); }
  catch { toast(urlJuego()); }
});
$('#btnDescargarQR').addEventListener('click', async () => {
  try {
    const r = await fetch(qrSrc(1000));
    const blob = await r.blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'genclash-qr.png' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch { window.open(qrSrc(1000), '_blank', 'noopener'); }
});

// ============================================================
//  BÚSQUEDA DE PARTIDA
// ============================================================
const TIPS = [
  'Los ataques del mismo tipo que el Pokémon que los usa hacen 50% más de daño.',
  'Un ataque súper eficaz contra un Pokémon de doble tipo puede hacer hasta 4 veces el daño.',
  'La parálisis reduce la velocidad a la mitad y a veces impide moverse.',
  'La quemadura reduce a la mitad el daño de los ataques físicos.',
  'Cambiar de Pokémon gasta tu turno, pero puede salvar a uno que está en desventaja.',
  'Los niveles se balancean como en los combates aleatorios: los legendarios pelean a menor nivel.',
  'Pulsa 1, 2, 3 o 4 para atacar rápido desde el teclado.',
  'Toca la caja de texto para adelantar los mensajes.',
];

$('#formJugar').addEventListener('submit', (e) => {
  e.preventDefault();
  const nombre = $('#inputNombre').value.trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) { $('#inputNombre').focus(); toast('Escribe un nombre de entrenador de al menos 2 letras.'); return; }
  estado.nombre = nombre.slice(0, 20);
  localStorage.setItem('gc:nombre', estado.nombre);
  estado.tamano = Number(new FormData(e.target).get('tamano')) || 6;
  localStorage.setItem('gc:tamano', estado.tamano);
  buscarPartida();
});

async function buscarPartida() {
  const id = ++estado.busqueda;
  const g = genActual();
  const tam = estado.tamano;
  estado.rival = `${aleatorio(TITULOS_RIVALES)} ${aleatorio(NOMBRES_RIVALES)}`;
  mostrar('busqueda');
  $('#busquedaTitulo').textContent = g.id === 0 ? 'Buscando rival en todas las generaciones…' : `Buscando rival en ${g.region}…`;
  $('#busquedaDetalle').textContent = 'Conectando con la PokeAPI';
  $('#desfile').innerHTML = '';
  const barra = $('#barraProgreso');
  barra.firstElementChild.style.width = '0%';
  let tipI = Math.floor(Math.random() * TIPS.length);
  $('#tip').textContent = TIPS[tipI];
  const rotar = setInterval(() => { tipI = (tipI + 1) % TIPS.length; $('#tip').textContent = TIPS[tipI]; }, 3200);

  const listos = { player: 0, rival: 0 };
  const total = tam * 2;
  const progreso = (side) => ({ ultimo }) => {
    if (id !== estado.busqueda) return;
    listos[side]++;
    const n = listos.player + listos.rival;
    barra.firstElementChild.style.width = `${(n / total) * 100}%`;
    barra.setAttribute('aria-valuenow', Math.round((n / total) * 100));
    $('#busquedaDetalle').textContent = `Preparando equipos: ${n} de ${total} Pokémon (${contadorPeticiones()} consultas a la API)`;
    if (ultimo) {
      const img = new Image(64, 64);
      img.src = ultimo.sprites.frenteFijo; img.alt = '';
      $('#desfile').append(img);
    }
  };

  const inicio = performance.now();
  try {
    const [eqJ, eqR] = await Promise.all([
      armarEquipo(g.id, tam, progreso('player')),
      armarEquipo(g.id, tam, progreso('rival')),
    ]);
    if (id !== estado.busqueda) return;
    const minimo = 1400 - (performance.now() - inicio);
    if (minimo > 0) await new Promise((ok) => setTimeout(ok, minimo));
    if (id !== estado.busqueda) return;
    $('#busquedaTitulo').textContent = `¡Rival encontrado: ${estado.rival}!`;
    sfx.encontrado();
    await new Promise((ok) => setTimeout(ok, 900));
    if (id !== estado.busqueda) return;
    estado.equipos = { player: eqJ, rival: eqR };
    mostrarPreview();
  } catch (err) {
    console.error(err);
    if (id !== estado.busqueda) return;
    toast(err.message || 'No se pudo armar la partida. Revisa tu conexión e inténtalo otra vez.', 6000);
    mostrar('inicio');
  } finally {
    clearInterval(rotar);
  }
}

$('#btnCancelarBusqueda').addEventListener('click', () => { estado.busqueda++; mostrar('inicio'); });

// ============================================================
//  VISTA PREVIA DE EQUIPOS
// ============================================================
function tarjetaPreview(p, side, i) {
  return `<li><button type="button" data-side="${side}" data-i="${i}" style="animation-delay:${i * 60}ms">
    <img src="${p.sprites.frenteFijo}" alt="" width="56" height="56" />
    <span><span class="n">${esc(p.nombre)}</span><span class="lv">Nv. ${p.level}</span>
    <span class="tipos">${p.types.map(badgeTipo).join('')}</span></span>
  </button></li>`;
}

function mostrarPreview() {
  const g = genActual();
  $('#pvJugador').textContent = estado.nombre;
  $('#pvRival').textContent = estado.rival;
  $('#pvGen').textContent = `${etiquetaGen(g)}, ${estado.tamano} contra ${estado.tamano}`;
  $('#pvEquipoJ').innerHTML = estado.equipos.player.map((p, i) => tarjetaPreview(p, 'player', i)).join('');
  $('#pvEquipoR').innerHTML = estado.equipos.rival.map((p, i) => tarjetaPreview(p, 'rival', i)).join('');
  $('#pvTituloRival').textContent = `Equipo de ${estado.rival}`;
  mostrar('preview');
  $('#btnComenzar').focus();
}

$('#pantalla-preview').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-side]');
  if (!b) return;
  abrirInfo(estado.equipos[b.dataset.side][Number(b.dataset.i)], b.dataset.side === 'player');
});
$('#btnRearmar').addEventListener('click', buscarPartida);
$('#btnComenzar').addEventListener('click', iniciarBatalla);

function abrirInfo(p, verMovs) {
  const color = (v) => (v >= 120 ? '#52d273' : v >= 90 ? '#a6e05b' : v >= 60 ? '#f5c518' : '#ff8a5b');
  const movs = verMovs ? p.moves.map((m) => `
      <div style="--c:${TIPOS[m.type]?.color}">
        <strong>${esc(m.nombre)}</strong>
        <small>${TIPOS[m.type]?.es}, ${CATEGORIAS[m.category]?.es}${m.power ? `, potencia ${m.power}` : ''}${m.accuracy ? `, precisión ${m.accuracy}%` : ''}, ${m.pp} PP</small>
        ${m.desc ? `<small>${esc(m.desc)}</small>` : ''}
      </div>`).join('') : '<div style="--c:#555"><strong>Movimientos ocultos</strong><small>Los descubrirás durante la batalla.</small></div>';
  $('#infoContenido').innerHTML = `
    <div class="info-cab">
      <img src="${p.sprites.arte}" alt="${esc(p.nombre)}" onerror="this.src='${p.sprites.frenteFijo}'" />
      <div>
        <h2 id="t-info">${esc(p.nombre)} <small style="color:var(--gris);font-size:.6em">#${p.id}</small></h2>
        <p class="cat">${esc(p.categoria)}${p.legendario ? ' (legendario)' : ''}</p>
        <div class="tipos">${p.types.map(badgeTipo).join('')}</div>
        <p class="cat">Nivel ${p.level}, ${p.altura} m, ${p.peso} kg</p>
      </div>
    </div>
    ${p.descripcion ? `<p class="info-desc">${esc(p.descripcion)}</p>` : ''}
    <div class="barras">
      ${Object.entries(p.base).map(([k, v]) => `<div><span>${STATS_ES[k]}</span><span>${v}</span><i><b style="width:${Math.min(100, v / 1.8)}%;background:${color(v)}"></b></i></div>`).join('')}
      <div><span>Total</span><span>${p.total}</span><i></i></div>
    </div>
    <div class="info-movs">${movs}</div>`;
  $('#modalInfo').showModal();
}

// ============================================================
//  BATALLA
// ============================================================
const arena = $('#arena');
const slot = { player: $('#slotJugador'), rival: $('#slotRival') };
const hpbox = { player: $('#hpJugador'), rival: $('#hpRival') };
const spriteDe = (side) => slot[side].querySelector('.sprite');

function iniciarBatalla() {
  const g = genActual();
  arena.style.setProperty('--c1', g.tema[0]);
  arena.style.setProperty('--c2', g.tema[1]);
  estado.batalla = crearBatalla({
    equipoJugador: estado.equipos.player, equipoRival: estado.equipos.rival,
    nombreJugador: estado.nombre, nombreRival: estado.rival, generacion: g.id,
  });
  estado.caidos = { player: new Set(), rival: new Set() };
  estado.mostrado = { player: null, rival: null };
  $('#log').innerHTML = '';
  $('#turnoChip').textContent = 'Turno 1';
  for (const s of ['player', 'rival']) { spriteDe(s).className = 'sprite'; hpbox[s].classList.remove('visible'); }
  mostrar('batalla');
  ajustarEscala();
  bloquear(true);

  const b = estado.batalla;
  const R = activo(b, 'rival'); const P = activo(b, 'player');
  R.vecesUsado = 1; P.vecesUsado = 1;
  reproducir([
    { t: 'msg', texto: `¡${estado.rival} quiere pelear!` },
    { t: 'msg', texto: `¡${estado.rival} envió a ${R.nombre}!` },
    { t: 'entrar', side: 'rival', mon: R, hp: R.hp, maxHp: R.maxHp, estado: null },
    { t: 'msg', texto: `¡Adelante, ${P.nombre}!` },
    { t: 'entrar', side: 'player', mon: P, hp: P.hp, maxHp: P.maxHp, estado: null },
  ]).then(mostrarMenu);
}

// Escala de sprites según el tamaño de la arena
function ajustarEscala() {
  const w = arena.clientWidth || 700;
  arena.style.setProperty('--k', escalaArena().toFixed(2));
  for (const s of ['player', 'rival']) limitarSprite(s);
}
const escalaArena = () => Math.max(1.15, Math.min(2.2, (arena.clientWidth || 700) / 400));
function limitarSprite(side) {
  const img = spriteDe(side);
  const nw = Number(img.dataset.nw || 64);
  const k = escalaArena() * (side === 'player' ? 1.3 : 1);
  const max = arena.clientWidth * (side === 'player' ? 0.46 : 0.38);
  img.style.width = `${Math.min(nw * k, max)}px`;
}
new ResizeObserver(ajustarEscala).observe(arena);

/** Carga el sprite animado con respaldos (GIF → PNG → arte oficial). */
function cargarSprite(side, mon) {
  const img = spriteDe(side);
  const s = mon.sprites;
  const opciones = side === 'player'
    ? [[s.espalda, 'gif'], [s.espaldaFija, 'png'], [s.frente, 'gif', true], [s.frenteFijo, 'png', true]]
    : [[s.frente, 'gif'], [s.frenteFijo, 'png'], [s.arte, 'arte']];
  return new Promise((ok) => {
    let i = 0;
    const probar = () => {
      if (i >= opciones.length) { ok(); return; }
      const [src, tipo, espejo] = opciones[i++];
      const prueba = new Image();
      prueba.onload = () => {
        img.className = 'sprite';
        if (tipo !== 'gif') img.classList.add('fijo');
        if (espejo) img.classList.add('espejo');
        const nw = tipo === 'gif' ? prueba.naturalWidth : tipo === 'png' ? prueba.naturalWidth * 0.9 : 82;
        img.dataset.nw = nw;
        img.src = src;
        img.alt = mon.nombre;
        limitarSprite(side);
        ok();
      };
      prueba.onerror = probar;
      prueba.src = src;
    };
    probar();
    setTimeout(ok, 4000);
  });
}

function renderHp(side) {
  const m = estado.mostrado[side];
  if (!m) return;
  const mon = m.mon;
  const pct = Math.max(0, Math.round((m.hp / m.maxHp) * 100));
  const nivel = pct > 50 ? '' : pct > 20 ? 'media' : 'baja';
  const est = m.estado ? `<span class="est" style="background:${ESTADOS[m.estado].color}">${ESTADOS[m.estado].corto}</span>` : '';
  const boosts = Object.entries(m.boosts || {}).filter(([, v]) => v).map(([k, v]) => {
    const mult = v > 0 ? (2 + v) / 2 : 2 / (2 - v);
    return `<span class="boost ${v < 0 ? 'neg' : ''}">${STATS_CORTO[k]} ×${mult.toFixed(mult % 1 ? 2 : 0).replace(/0$/, '')}</span>`;
  }).join('');
  const equipo = estado.batalla.lados[side].equipo;
  const puntos = equipo.map((_, i) => `<img src="${BALL}" alt="" class="${estado.caidos[side].has(i) ? 'caido' : ''}" />`).join('');
  hpbox[side].innerHTML = `
    <div class="hp-top"><span class="nombre">${esc(mon.nombre)}</span><span class="nivel">Nv. ${mon.level}</span></div>
    <div class="tipos">${mon.types.map(badgeTipo).join('')}</div>
    <div class="hp-fila"><b>PS</b><div class="barra-hp"><div class="${nivel}" style="width:${pct}%"></div></div></div>
    <div class="hp-info">${est}<span class="boosts">${boosts}</span><span class="hp-num">${side === 'player' ? `${m.hp}/${m.maxHp}` : `${pct}%`}</span></div>
    <div class="equipo-puntos" aria-label="Pokémon restantes">${puntos}</div>`;
  hpbox[side].setAttribute('aria-label', `${mon.nombre}, ${pct}% de PS`);
}

/** Actualiza solo la barra (para que la transición CSS se vea). */
function actualizarBarra(side) {
  const m = estado.mostrado[side];
  const pct = Math.max(0, (m.hp / m.maxHp) * 100);
  const barra = hpbox[side].querySelector('.barra-hp div');
  if (!barra) return renderHp(side);
  barra.style.width = `${pct}%`;
  barra.className = pct > 50 ? '' : pct > 20 ? 'media' : 'baja';
  const num = hpbox[side].querySelector('.hp-num');
  num.textContent = side === 'player' ? `${m.hp}/${m.maxHp}` : `${Math.round(pct)}%`;
}

function centro(side) {
  const a = arena.getBoundingClientRect();
  const r = (spriteDe(side).classList.contains('visible') ? spriteDe(side) : slot[side]).getBoundingClientRect();
  return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height * 0.55, w: r.width, h: r.height };
}

function particula(cls, x, y, color, html = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  if (color) el.style.setProperty('--c', color);
  el.innerHTML = html;
  $('#fx').append(el);
  return el;
}

function flotante(side, texto, cls) {
  const c = centro(side);
  const el = particula(`flotante ${cls}`, c.x, c.y - c.h * 0.35);
  el.textContent = texto;
  anim(el, [{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-110%) scale(1.1)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%,-220%)', opacity: 0 }], { duration: 1100 })
    .then(() => el.remove());
  if (reducido) setTimeout(() => el.remove(), 800);
}

function chispas(side, color, n = 10, sube = false) {
  const c = centro(side);
  for (let i = 0; i < n; i++) {
    const el = particula('chispa', c.x + (Math.random() - 0.5) * c.w * 0.5, c.y + (Math.random() - 0.5) * c.h * 0.4, color);
    const ang = Math.random() * Math.PI * 2; const d = 30 + Math.random() * 50;
    const dx = sube ? (Math.random() - 0.5) * 30 : Math.cos(ang) * d;
    const dy = sube ? -(40 + Math.random() * 60) : Math.sin(ang) * d;
    anim(el, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.2) rotate(${Math.random() * 360}deg)`, opacity: 0 }], { duration: 600 + Math.random() * 300 })
      .then(() => el.remove());
    if (reducido) el.remove();
  }
}

async function animAtaque(side, move) {
  const img = spriteDe(side);
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  const dir = side === 'player' ? [1, -1] : [-1, 1];
  const fisico = move.category === 'physical';
  const dist = fisico ? 26 : 10;
  const color = TIPOS[move.type]?.color || '#fff';
  const ida = anim(img, [
    { transform: `translate(0,0)${espejo}` },
    { transform: `translate(${dir[0] * dist}%, ${dir[1] * dist * 0.5}%)${espejo}`, offset: 0.4 },
    { transform: `translate(0,0)${espejo}` },
  ], { duration: fisico ? 380 : 300 });

  if (move.category === 'status') {
    const haciaMi = ['user', 'users-field', 'user-and-allies'].includes(move.target);
    if (haciaMi) { chispas(side, color, 12, true); await ida; await espera(200); return; }
  }
  if (!fisico) {
    sfx.disparo();
    const a = centro(side); const b = centro(side === 'player' ? 'rival' : 'player');
    const orbe = particula('orbe', a.x, a.y, color);
    await anim(orbe, [{ transform: `translate(0,0) scale(.4)` }, { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(1.2)` }], { duration: 380, easing: 'ease-in' });
    orbe.remove();
  } else {
    await ida;
  }
}

async function animDanio(e) {
  const m = estado.mostrado[e.side];
  m.hp = e.hp;
  const img = spriteDe(e.side);
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  const color = TIPOS[e.tipo]?.color || '#fff';
  if (!e.residual) {
    const c = centro(e.side);
    const est = particula('estallido', c.x, c.y, color);
    anim(est, [{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(5)', opacity: 0 }], { duration: 450 }).then(() => est.remove());
    if (reducido) est.remove();
    chispas(e.side, color, e.eff > 1 ? 16 : 9);
    sfx.golpe(e.eff ?? 1);
  } else {
    chispas(e.side, ESTADOS[e.estado]?.color || '#a33ea1', 8, true);
    sfx.golpe(0.5);
  }
  if (e.critico) {
    const f = document.createElement('div'); f.className = 'destello'; arena.append(f); setTimeout(() => f.remove(), 350);
  }
  if ((e.eff > 1 || e.critico) && !reducido) { arena.classList.remove('sacudir'); void arena.offsetWidth; arena.classList.add('sacudir'); }
  anim(img, [{ opacity: 1, transform: `translateX(0)${espejo}` }, { opacity: 0.2, transform: `translateX(-4%)${espejo}` }, { opacity: 1, transform: `translateX(4%)${espejo}` }, { opacity: 0.2 }, { opacity: 1, transform: `translateX(0)${espejo}` }], { duration: 420 });
  actualizarBarra(e.side);
  const pct = Math.max(1, Math.round((e.cantidad / m.maxHp) * 100));
  flotante(e.side, e.critico ? `¡Crítico! −${pct}%` : `−${pct}%`, e.critico ? 'crit' : 'dano');
  await espera(720);
}

async function animCurar(e) {
  estado.mostrado[e.side].hp = e.hp;
  chispas(e.side, '#7dffa6', 14, true);
  sfx.curar();
  actualizarBarra(e.side);
  flotante(e.side, `+${Math.max(1, Math.round((e.cantidad / e.maxHp) * 100))}%`, 'cura');
  await espera(650);
}

async function animEntrar(e) {
  const side = e.side;
  estado.mostrado[side] = { mon: e.mon, hp: e.hp, maxHp: e.maxHp, estado: e.estado, boosts: {} };
  const img = spriteDe(side);
  img.classList.remove('visible');
  await cargarSprite(side, e.mon);
  renderHp(side);
  hpbox[side].classList.add('visible');
  // la Poké Ball cae y se abre
  const c = centro(side);
  const ball = particula('', c.x, c.y);
  ball.style.cssText += 'position:absolute;width:32px;height:32px;margin:-16px 0 0 -16px;';
  ball.innerHTML = `<img src="${BALL}" alt="" style="width:32px;image-rendering:pixelated" />`;
  sfx.entrar();
  await anim(ball, [{ transform: 'translateY(-90px) rotate(-200deg)', opacity: 0 }, { transform: 'translateY(0) rotate(0)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.3,1.6,.6,1)' });
  ball.remove();
  const f = particula('estallido', c.x, c.y, '#ffffff');
  anim(f, [{ transform: 'scale(.5)', opacity: 1 }, { transform: 'scale(6)', opacity: 0 }], { duration: 380 }).then(() => f.remove());
  if (reducido) f.remove();
  img.classList.add('visible');
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  grito(e.mon.grito);
  await anim(img, [{ transform: `scale(0)${espejo}`, filter: 'brightness(4)' }, { transform: `scale(1.08)${espejo}`, filter: 'brightness(2)', offset: 0.7 }, { transform: `scale(1)${espejo}`, filter: 'brightness(1)' }], { duration: 450 });
  await espera(250);
}

async function animRetirar(side) {
  const img = spriteDe(side);
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  sfx.entrar();
  await anim(img, [{ transform: `scale(1)${espejo}`, filter: 'none' }, { transform: `scale(0)${espejo}`, filter: 'brightness(.6) sepia(1) hue-rotate(-50deg) saturate(6)' }], { duration: 380, easing: 'ease-in' });
  img.classList.remove('visible');
  hpbox[side].classList.remove('visible');
}

async function animDebil(side) {
  const img = spriteDe(side);
  const m = estado.mostrado[side];
  m.hp = 0; m.estado = null;
  estado.caidos[side].add(estado.batalla.lados[side].equipo.indexOf(m.mon));
  grito(m.mon.grito, { velocidad: 0.75, volumen: 0.3 });
  sfx.debilitado();
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  await anim(img, [{ transform: `translateY(0)${espejo}`, opacity: 1 }, { transform: `translateY(45%)${espejo}`, opacity: 0 }], { duration: 650, easing: 'ease-in' });
  img.classList.remove('visible');
  renderHp(side);
  await espera(300);
  hpbox[side].classList.remove('visible');
}

async function animStat(e) {
  const m = estado.mostrado[e.side];
  m.boosts = e.boosts;
  renderHp(e.side);
  const sube = e.cambio > 0;
  (sube ? sfx.subir : sfx.bajar)();
  const c = centro(e.side);
  for (let i = 0; i < 6; i++) {
    const el = particula(`flotante ${sube ? 'sube' : 'baja'}`, c.x + (i - 2.5) * c.w * 0.14, c.y);
    el.textContent = sube ? '▲' : '▼';
    anim(el, [{ transform: `translate(-50%, ${sube ? 40 : -60}%)`, opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: `translate(-50%, ${sube ? -160 : 120}%)`, opacity: 0 }], { duration: 800, delay: i * 50 }).then(() => el.remove());
    if (reducido) el.remove();
  }
  await espera(500);
}

async function animMini(e) {
  if (e.tipo === 'dormir') flotante(e.side, 'Z z z', 'baja');
  if (e.tipo === 'paralisis') chispas(e.side, '#F7D02C', 14);
  if (e.tipo === 'confuso') flotante(e.side, '? ? ?', 'crit');
  await espera(350);
}

const lcd = $('#lcd');
function decir(texto, cls = '') {
  if (cls !== 'detalle') $('#lcdTexto').textContent = texto;
  const li = document.createElement('li');
  li.textContent = texto;
  if (cls) li.className = cls;
  const log = $('#log'); log.append(li); log.scrollTop = log.scrollHeight;
}
lcd.addEventListener('click', () => saltar?.());
arena.addEventListener('click', () => saltar?.());

async function reproducir(eventos) {
  lcd.classList.add('espera');
  for (let i = 0; i < eventos.length; i++) {
    const e = eventos[i];
    switch (e.t) {
      case 'turno': {
        const li = document.createElement('li'); li.className = 'turno'; li.textContent = `Turno ${e.n}`;
        $('#log').append(li);
        $('#turnoChip').textContent = `Turno ${e.n}`;
        break;
      }
      case 'msg':
        decir(e.texto, e.cls);
        if (e.cls !== 'detalle') await espera(Math.min(1500, 620 + e.texto.length * 14));
        break;
      case 'mover': {
        const sig = eventos[i + 1];
        if (sig?.t === 'msg') { decir(sig.texto, sig.cls); i++; }
        await espera(380);
        await animAtaque(e.side, e.move);
        break;
      }
      case 'danio': await animDanio(e); break;
      case 'curar': await animCurar(e); break;
      case 'estado':
        estado.mostrado[e.side].estado = e.estado;
        renderHp(e.side);
        if (e.estado) { sfx.estado(); chispas(e.side, ESTADOS[e.estado].color, 12, true); }
        break;
      case 'stat': await animStat(e); break;
      case 'debilitado': await animDebil(e.side); break;
      case 'fallo': sfx.fallo(); flotante(e.side, 'Falló', 'baja'); await espera(300); break;
      case 'retirar': await animRetirar(e.side); break;
      case 'entrar': await animEntrar(e); break;
      case 'anim': await animMini(e); break;
      default: break;
    }
  }
  lcd.classList.remove('espera');
}

// ---------- Menú del jugador ----------
function bloquear(si) {
  estado.ocupado = si;
  $('#controles').classList.toggle('bloqueado', si);
}

function mostrarMenu() {
  const b = estado.batalla;
  if (!b || b.terminada) return;
  const yo = activo(b, 'player');
  const foe = activo(b, 'rival');
  $('#lcdTexto').textContent = `¿Qué debería hacer ${yo.nombre}?`;
  $('#controles').classList.remove('forzar');
  $('.cambios-titulo').classList.remove('forzado');
  $('#cambiosTitulo').textContent = 'Cambiar de Pokémon';

  const sinPP = !yo.moves.some((m) => m.ppLeft > 0);
  const lista = sinPP ? [{ ...FORCEJEO, ppLeft: 1, idx: -1 }] : yo.moves.map((m, i) => ({ ...m, idx: i }));
  $('#movs').innerHTML = lista.map((m, n) => {
    const c = TIPOS[m.type]?.color || '#888';
    const ef = m.category === 'status' || !m.power ? null : m.type === 'typeless' ? 1 : efectividad(m.type, foe.types);
    const efTxt = ef == null ? '' : ef === 0 ? '<span class="ef x0">Sin efecto</span>' : ef > 1 ? `<span class="ef x2">×${ef}</span>` : ef < 1 ? `<span class="ef xm">×${ef}</span>` : '';
    const titulo = `${m.nombre}: ${TIPOS[m.type]?.es}, ${CATEGORIAS[m.category]?.es}${m.power ? `, potencia ${m.power}` : ''}${m.accuracy ? `, precisión ${m.accuracy}%` : ''}. ${m.desc || ''}`;
    return `<button class="mov" data-mov="${m.idx}" style="--c:${c};--t:${colorTexto(c)}" ${m.ppLeft <= 0 ? 'disabled' : ''} title="${esc(titulo)}">
      <span class="mn">${esc(m.nombre)}</span>
      <span class="md"><span>${TIPOS[m.type]?.es}</span><span>${CATEGORIAS[m.category]?.icono} ${CATEGORIAS[m.category]?.es}</span>${m.power ? `<span>Pot. ${m.power}</span>` : ''}<span class="kbd">[${n + 1}]</span></span>
      <span class="pp">${m.idx === -1 ? '' : `${m.ppLeft}/${m.pp}`}</span>${efTxt}
    </button>`;
  }).join('');
  renderCambios(false);
  bloquear(false);
}

function renderCambios(forzado) {
  const b = estado.batalla;
  const lado = b.lados.player;
  $('#cambios').innerHTML = lado.equipo.map((p, i) => {
    const pct = Math.round((p.hp / p.maxHp) * 100);
    const act = i === lado.activo && p.hp > 0;
    const dis = p.hp <= 0 || act;
    return `<button class="cambio ${act ? 'activo' : ''} ${p.hp <= 0 ? 'caido' : ''}" data-cambio="${i}" ${dis ? 'disabled' : ''}
      title="${esc(`${p.nombre} (${p.hp}/${p.maxHp} PS)${p.status ? ', ' + ESTADOS[p.status].es : ''}. ${p.moves.map((m) => m.nombre).join(', ')}`)}">
      <img src="${p.sprites.icono}" alt="" onerror="this.onerror=null;this.src='${p.sprites.frenteFijo}'" />
      <span class="cn">${esc(p.nombre)}</span>
      <span class="mini"><div class="${pct > 50 ? '' : pct > 20 ? 'media' : 'baja'}" style="width:${pct}%"></div></span>
    </button>`;
  }).join('');
  $('#controles').classList.toggle('forzar', forzado);
}

async function accionJugador(accion) {
  const b = estado.batalla;
  if (estado.ocupado || !b || b.terminada) return;
  sfx.click();
  bloquear(true);
  const accR = decidirAccion(b, 'rival');
  const ev = ejecutarTurno(b, accion, accR);
  await reproducir(ev);
  await despuesDelTurno();
}

async function despuesDelTurno() {
  const b = estado.batalla;
  if (b.terminada) return finalizar();
  if (activo(b, 'rival').hp <= 0) {
    await reproducir(cambioForzado(b, 'rival', mejorReemplazo(b, 'rival')));
  }
  if (b.pendiente === 'player') {
    $('#lcdTexto').textContent = '¿Qué Pokémon vas a enviar?';
    $('.cambios-titulo').classList.add('forzado');
    $('#cambiosTitulo').textContent = 'Elige a tu siguiente Pokémon';
    renderCambios(true);
    bloquear(false);
    return;
  }
  mostrarMenu();
}

$('#movs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mov]');
  if (btn && !btn.disabled) accionJugador({ tipo: 'mover', indice: Number(btn.dataset.mov) });
});

$('#cambios').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cambio]');
  if (!btn || btn.disabled || estado.ocupado) return;
  const i = Number(btn.dataset.cambio);
  const b = estado.batalla;
  if (b.pendiente === 'player') {
    sfx.click(); bloquear(true);
    await reproducir(cambioForzado(b, 'player', i));
    mostrarMenu();
  } else {
    accionJugador({ tipo: 'cambiar', indice: i });
  }
});

document.addEventListener('keydown', (e) => {
  if (!$('#pantalla-batalla').classList.contains('activa') || estado.ocupado) return;
  if (document.querySelector('dialog[open]')) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 4) $$('#movs .mov')[n - 1]?.click();
});

$('#btnVelocidad').addEventListener('click', (e) => {
  estado.vel = estado.vel === 1 ? 2 : estado.vel === 2 ? 3 : 1;
  localStorage.setItem('gc:vel', estado.vel);
  e.currentTarget.textContent = `${estado.vel}×`;
  document.documentElement.style.setProperty('--vel', estado.vel);
});

$('#btnRendirse').addEventListener('click', () => {
  const b = estado.batalla;
  if (!b || b.terminada) return;
  if (!confirm('¿Seguro que quieres rendirte? Contará como derrota.')) return;
  b.terminada = true; b.ganador = 'rival'; b.rendicion = true;
  finalizar();
});

// ---------- Fin de la batalla ----------
async function finalizar() {
  const b = estado.batalla;
  bloquear(true);
  const gano = b.ganador === 'player';
  const equipo = b.lados.player.equipo;
  const mvp = [...equipo].sort((a, z) => z.kos - a.kos || z.danioHecho - a.danioHecho)[0];
  const restantes = vivos(b, 'player').length;
  const kos = equipo.reduce((s, p) => s + p.kos, 0);
  const g = genActual();
  $('#lcdTexto').textContent = gano ? `¡Derrotaste a ${estado.rival}!` : b.rendicion ? 'Te rendiste.' : `${estado.rival} ganó la batalla.`;
  (gano ? sfx.victoria : sfx.derrota)();

  $('#resultadoContenido').innerHTML = `
    <h2 id="t-res" class="res-titulo ${gano ? 'victoria' : 'derrota'}">${gano ? '¡Victoria!' : 'Derrota'}</h2>
    <p class="res-sub">${gano ? `Venciste a ${esc(estado.rival)}` : `${esc(estado.rival)} se llevó esta`} en ${etiquetaGen(g)}.</p>
    <div class="res-mvp">
      <img src="${mvp.sprites.frente}" alt="" onerror="this.onerror=null;this.src='${mvp.sprites.frenteFijo}'" />
      <p><small>Tu Pokémon más valioso</small><strong>${esc(mvp.nombre)}</strong><small>${mvp.kos} KO, ${mvp.danioHecho} de daño causado</small></p>
    </div>
    <dl class="res-datos">
      <div><dt>Turnos</dt><dd>${b.turno}</dd></div>
      <div><dt>Rivales noqueados</dt><dd>${kos}/${b.lados.rival.equipo.length}</dd></div>
      <div><dt>Te quedaron</dt><dd>${restantes}/${equipo.length}</dd></div>
    </dl>
    <p class="res-guardado" id="resGuardado">Guardando resultado…</p>`;
  setTimeout(() => $('#modalResultado').showModal(), 700);

  const r = await db.guardarPartida({
    jugador: estado.nombre,
    rival_nombre: estado.rival,
    generacion: g.id === 0 ? 'Todas' : `Gen ${g.romano} (${g.region})`,
    resultado: gano ? 'victoria' : 'derrota',
    turnos: b.turno,
    restantes,
    tamano: estado.tamano,
    mvp_id: mvp.id,
    mvp_nombre: mvp.nombre,
    equipo: equipo.map((p) => p.nombre),
    rival: b.lados.rival.equipo.map((p) => p.nombre),
  }).catch((e) => ({ ok: false, error: e.message }));
  const guardado = $('#resGuardado');
  if (guardado) guardado.textContent = r.ok ? (r.remoto ? 'Resultado guardado en el ranking global.' : 'Resultado guardado en este navegador (modo local).') : `No se pudo guardar en Supabase: ${r.error}`;
  cargarTablero();
  actualizarRecord();
}

$('#btnRevancha').addEventListener('click', () => { $('#modalResultado').close(); buscarPartida(); });
$('#btnMenu').addEventListener('click', () => { $('#modalResultado').close(); mostrar('inicio'); });

// ============================================================
//  ARRANQUE
// ============================================================
function arrancar() {
  $('#inputNombre').value = estado.nombre;
  $$('input[name=tamano]').forEach((r) => { r.checked = Number(r.value) === estado.tamano; });
  $('#inputNombre').addEventListener('input', (e) => {
    estado.nombre = e.target.value.trim();
    clearTimeout(tRecord); tRecord = setTimeout(actualizarRecord, 500);
  });
  $('#btnVelocidad').textContent = `${estado.vel}×`;
  document.documentElement.style.setProperty('--vel', estado.vel);
  $('#btnSonido').classList.toggle('mute', estaSilenciado());
  $('#btnSonido').addEventListener('click', (e) => { e.currentTarget.classList.toggle('mute', alternarSonido()); sfx.click(); });
  $$('[data-ir=inicio]').forEach((b) => b.addEventListener('click', () => {
    if ($('#pantalla-batalla').classList.contains('activa') && estado.batalla && !estado.batalla.terminada && !confirm('Si sales ahora, la batalla no se guardará. ¿Salir?')) return;
    estado.busqueda++;
    mostrar('inicio');
  }));
  renderEstante();
  prepararQR();
  cargarTablero();
  actualizarRecord();
  db.escucharPartidas((p) => {
    const ul = $('#recientes');
    ul.querySelector('.vacio')?.remove();
    ul.insertAdjacentHTML('afterbegin', itemReciente(p, true));
    while (ul.children.length > 8) ul.lastElementChild.remove();
    if (p.jugador !== estado.nombre) toast(`${p.jugador} ${p.resultado === 'victoria' ? 'acaba de ganar' : 'acaba de perder'} en ${p.generacion}.`);
    cargarTablero();
  });
}
arrancar();
