// ============================================================
//  GenClash · Interfaz y flujo del juego
//  - Login (usuario y contraseña)
//  - Modo contra la computadora y modo en línea (jugador vs jugador)
//  - Batalla animada, ranking y QR
// ============================================================
import { GENERACIONES, TODAS, LEGENDARIOS, TIPOS, ESTADOS, STATS_ES, STATS_CORTO, CATEGORIAS, NOMBRES_RIVALES, TITULOS_RIVALES, efectividad } from './data.js';
import { armarEquipo, sprites, aleatorio, contadorPeticiones, cargarPokemon, cargarMovimiento, listaEspecies, movimientosDe, elegirMovimientos, nivelPara, calcularStats, armarEquipoPersonalizado } from './api.js';
import { crearBatalla, ejecutarTurno, cambioForzado, activo, vivos, opcionesCambio, otro, FORCEJEO, RECARGA, fmt, rngConSemilla, rangoDanio, rangoVelocidad, accionForzada, poderNominal, multEtapa, CLIMA_ES, campoDe } from './battle.js';
import { decidirAccion, mejorReemplazo } from './ai.js';
import * as db from './db.js';
import { sfx, grito, alternarSonido, modoSonido, iniciarMusica, detenerMusica } from './audio.js';
import { Efectos, precargarHojas } from './fx.js';
import { buscarRival, conectarPresencia } from './online.js';
import { URL_PUBLICA } from './config.js';

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BALL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png';
const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const estado = {
  usuario: null,
  gen: Number(localStorage.getItem('gc:gen') ?? 1),
  tamano: Number(localStorage.getItem('gc:tamano') || 6),
  modo: localStorage.getItem('gc:modo') || 'cpu',
  equipoModo: localStorage.getItem('gc:equipoModo') || 'azar', // 'azar' | 'mio'
  miEquipo: [],
  vel: Number(localStorage.getItem('gc:vel') || 1),
  batalla: null,
  miLado: 'player',      // en línea, el invitado juega del lado 'rival' del motor
  rival: null,           // nombre del rival
  busqueda: 0,
  ocupado: false,
  mostrado: { player: null, rival: null }, // por lado de PANTALLA
  caidos: { player: new Set(), rival: new Set() },
  sala: null,
  pvp: null,
  desconectarPresencia: () => {},
};

const LISTA_GENS = [...GENERACIONES, TODAS, LEGENDARIOS];
const genPorId = (id) => LISTA_GENS.find((g) => g.id === id) || GENERACIONES[0];
const genActual = () => genPorId(estado.gen);
const etiquetaGen = (g) => (g.id === 0 ? 'Todas las generaciones' : g.id === LEGENDARIOS.id ? 'Solo legendarios' : `Gen ${g.romano} (${g.region})`);
const etiquetaCorta = (g) => (g.id === 0 ? 'Todas' : g.id === LEGENDARIOS.id ? 'Legendarios' : `Gen ${g.romano} (${g.region})`);
const enPvp = () => estado.modoBatalla === 'pvp';

/** Lado del motor → lado de la pantalla (tu Pokémon siempre abajo a la izquierda). */
const pantalla = (side) => (side === estado.miLado ? 'player' : 'rival');
/** Lado de la pantalla → lado del motor. */
const motor = (lado) => (lado === 'player' ? estado.miLado : otro(estado.miLado));

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

/** Tema musical de la batalla: épico si hay legendarios, si no, el de combate. */
function temaBatalla() {
  const b = estado.batalla;
  if (!b) return 'batalla';
  const hayLegendario = ['player', 'rival'].some((s) => b.lados[s].equipo.some((m) => m.legendario));
  return b.generacion === LEGENDARIOS.id || hayLegendario ? 'legendaria' : 'batalla';
}
function musicaDe(p) {
  if (modoSonido() !== 'todo') return;
  if (p === 'batalla') { if (estado.batalla && !estado.batalla.terminada) iniciarMusica(temaBatalla()); } else iniciarMusica('menu');
}

function mostrar(p) {
  if (p !== 'batalla') musicaDe(p);
  $$('.pantalla').forEach((x) => x.classList.toggle('activa', x.id === `pantalla-${p}`));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// ============================================================
//  LOGIN
// ============================================================
let modoLogin = 'entrar';
function cambiarModoLogin(m) {
  modoLogin = m;
  $('#tabEntrar').classList.toggle('activa', m === 'entrar');
  $('#tabCrear').classList.toggle('activa', m === 'crear');
  $('#tabEntrar').setAttribute('aria-selected', String(m === 'entrar'));
  $('#tabCrear').setAttribute('aria-selected', String(m === 'crear'));
  $('#campoConfirmar').hidden = m !== 'crear';
  $('#btnLogin').textContent = m === 'crear' ? 'Crear cuenta' : 'Entrar';
  $('#loginPassword').autocomplete = m === 'crear' ? 'new-password' : 'current-password';
  $('#loginNota').textContent = m === 'crear'
    ? 'Usuario de 3 a 16 letras o números. Contraseña de al menos 4 caracteres.'
    : 'Sin correo: solo usuario y contraseña.';
  $('#loginError').textContent = '';
}
$('#tabEntrar').addEventListener('click', () => cambiarModoLogin('entrar'));
$('#tabCrear').addEventListener('click', () => cambiarModoLogin('crear'));

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = $('#loginUsuario').value; const p = $('#loginPassword').value;
  const err = $('#loginError');
  err.textContent = '';
  if (modoLogin === 'crear' && p !== $('#loginConfirmar').value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
  const btn = $('#btnLogin'); btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Un momento…';
  try {
    const s = modoLogin === 'crear' ? await db.registrar(u, p) : await db.iniciarSesion(u, p);
    sfx.encontrado();
    $('#loginPassword').value = ''; $('#loginConfirmar').value = '';
    entrarAlJuego(s.usuario);
    if (modoLogin === 'crear') toast(`¡Bienvenido, ${s.usuario}! Tu cuenta quedó creada.`);
  } catch (ex) {
    err.textContent = ex.message;
  } finally { btn.disabled = false; btn.textContent = txt; }
});

function mostrarLogin() {
  const d = $('#loginDesfile');
  if (!d.childElementCount) {
    const ids = Array.from({ length: 8 }, () => 1 + Math.floor(Math.random() * 1025));
    d.innerHTML = ids.map((id, i) => `<img src="${sprites(id).frente}" alt="" style="animation-delay:${i * 80}ms" onerror="this.onerror=null;this.src='${sprites(id).frenteFijo}'" />`).join('');
  }
  $('#usuarioChip').hidden = true;
  mostrar('login');
  setTimeout(() => $('#loginUsuario').focus(), 50);
}

function entrarAlJuego(usuario) {
  estado.usuario = usuario;
  $('#usuarioNombre').textContent = usuario;
  $('#saludoUsuario').textContent = usuario;
  $('#usuarioChip').hidden = false;
  mostrar('inicio');
  cargarTablero();
  actualizarRecord();
  db.cargarEquipo().then((e) => { estado.miEquipo = e; resumenEquipo(); }).catch(() => {});
  estado.desconectarPresencia();
  estado.desconectarPresencia = conectarPresencia(usuario, (n) => {
    $('#enLineaTxt').textContent = n > 1 ? `${n} entrenadores en línea` : 'Contra otra persona';
  });
}

$('#btnSalir').addEventListener('click', async () => {
  if (estado.batalla && !estado.batalla.terminada && $('#pantalla-batalla').classList.contains('activa')) {
    if (!confirm('Si sales ahora, la batalla cuenta como derrota. ¿Salir?')) return;
    rendirse(true);
  }
  estado.busqueda++;
  estado.cancelarBusqueda?.();
  estado.desconectarPresencia(); estado.desconectarPresencia = () => {};
  await db.cerrarSesion();
  estado.usuario = null;
  mostrarLogin();
});

// ============================================================
//  INICIO
// ============================================================
function renderEstante() {
  const cont = $('#estante');
  cont.innerHTML = '';
  for (const g of LISTA_GENS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cartucho${g.id === 0 ? ' todas' : ''}${g.id === LEGENDARIOS.id ? ' legendario' : ''}`;
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
      <span class="anio">${g.id === 0 ? '1,025 Pokémon' : g.id === LEGENDARIOS.id ? `${LEGENDARIOS.lista.length} Pokémon` : g.año}</span>`;
    b.addEventListener('click', () => elegirGen(g.id));
    cont.append(b);
  }
  actualizarCTA();
}

function elegirGen(id) {
  estado.gen = id;
  localStorage.setItem('gc:gen', id);
  $$('.cartucho').forEach((c, i) => c.setAttribute('aria-checked', String(LISTA_GENS[i].id === id)));
  sfx.seleccion();
  actualizarCTA();
}

function actualizarCTA() {
  const g = genActual();
  const donde = g.id === 0 ? 'con todas las generaciones' : g.id === LEGENDARIOS.id ? 'solo con legendarios' : `en ${g.region}`;
  const conMio = estado.equipoModo === 'mio' && estado.miEquipo.some((x) => x?.id);
  if (conMio) $('#txtBuscar').textContent = estado.modo === 'pvp' ? 'Buscar rival en línea con mi equipo' : `Jugar con mi equipo contra un rival ${donde}`;
  else $('#txtBuscar').textContent = estado.modo === 'pvp' ? `Buscar rival en línea ${donde}` : `Buscar partida ${donde}`;
}

$$('input[name=modo]').forEach((r) => r.addEventListener('change', () => {
  estado.modo = r.value; localStorage.setItem('gc:modo', r.value); sfx.click(); actualizarCTA();
}));

// Navegación con flechas dentro del estante (radiogroup)
$('#estante').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const lista = LISTA_GENS;
  const i = lista.findIndex((g) => g.id === estado.gen);
  const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + lista.length) % lista.length;
  elegirGen(lista[j].id);
  $$('.cartucho')[j].focus();
  e.preventDefault();
});

async function actualizarRecord() {
  const r = await db.recordDe(estado.usuario).catch(() => null);
  $('#record').textContent = r && (r.victorias || r.derrotas) ? `Tu récord: ${r.victorias} victorias, ${r.derrotas} derrotas` : '';
}

async function cargarTablero() {
  const conexion = $('#conexion');
  conexion.classList.toggle('online', db.enLinea());
  conexion.textContent = db.enLinea() ? 'Supabase en línea' : 'Modo local';

  try {
    const r = await db.obtenerRanking();
    $('#ranking').innerHTML = r.length ? r.map((x, i) => `
      <li class="${x.jugador === estado.usuario ? 'yo' : ''}">
        <span class="pos">${i + 1}</span>
        <span class="nom">${esc(x.jugador)}</span>
        <span class="vd">${x.victorias}–${x.derrotas}</span>
        <span class="pct">${Math.round(x.porcentaje)}%</span>
      </li>`).join('') : '<li class="vacio">Nadie ha peleado todavía. La primera victoria es tuya.</li>';
  } catch (e) { $('#ranking').innerHTML = `<li class="vacio">No se pudo leer el ranking: ${esc(e.message)}</li>`; }

  try {
    const lista = await db.obtenerRecientes();
    $('#recientes').innerHTML = lista.length ? lista.map((p) => itemReciente(p)).join('') : '<li class="vacio">Aquí aparecerán las batallas en cuanto alguien termine una.</li>';
  } catch { $('#recientes').innerHTML = '<li class="vacio">No se pudieron leer las batallas recientes.</li>'; }

  try {
    const s = await db.obtenerEstadisticas();
    const mvp = s.topMvp[0];
    $('#stats').innerHTML = `
      <div><dt>Batallas</dt><dd>${s.total}</dd></div>
      <div><dt>Entrenadores</dt><dd>${s.jugadores}</dd></div>
      <div><dt>Duelos en línea</dt><dd>${s.duelos}</dd></div>
      <div><dt>Pokémon más valioso</dt><dd>${mvp ? `<img src="${sprites(mvp.id).icono}" alt="" />${esc(mvp.nombre)}` : '—'}</dd></div>`;
  } catch { $('#stats').innerHTML = ''; }
}

function itemReciente(p, nuevo = false) {
  const icono = p.mvp_id ? sprites(p.mvp_id).icono : BALL;
  const verbo = p.resultado === 'victoria' ? 'venció a' : 'perdió contra';
  const modo = p.modo === 'pvp' ? 'en línea, ' : '';
  return `<li class="${nuevo ? 'nuevo' : ''}">
    <img src="${icono}" alt="" loading="lazy" />
    <span class="linea"><strong>${esc(p.jugador)}</strong> ${verbo} ${esc(p.rival_nombre || 'un rival')}
      <small>${modo}${esc(p.generacion)}, ${p.turnos} turnos, ${haceCuanto(p.creado_en)}</small></span>
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
  aviso.textContent = 'Estás abriendo el juego desde tu computadora: este QR apunta aquí y no abrirá en otros teléfonos. Abre la versión publicada o escribe la URL pública en js/config.js.';
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
  'En línea, cada turno tiene un minuto: si no eliges, se elige solo.',
];

$('#formJugar').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!estado.usuario) { mostrarLogin(); return; }
  estado.tamano = Number(new FormData(e.target).get('tamano')) || 6;
  localStorage.setItem('gc:tamano', estado.tamano);
  if (!equipoListoParaJugar()) return;
  if (estado.modo === 'pvp') buscarPartidaEnLinea(); else buscarPartida();
});

let rotarTips = null;
function pantallaBusqueda(titulo, detalle) {
  mostrar('busqueda');
  $('#busquedaTitulo').textContent = titulo;
  $('#busquedaDetalle').textContent = detalle;
  $('#desfile').innerHTML = '';
  $('#barraProgreso').firstElementChild.style.width = '0%';
  let tipI = Math.floor(Math.random() * TIPS.length);
  $('#tip').textContent = TIPS[tipI];
  clearInterval(rotarTips);
  rotarTips = setInterval(() => { tipI = (tipI + 1) % TIPS.length; $('#tip').textContent = TIPS[tipI]; }, 3200);
}

/** Arma dos equipos con barra de progreso. */
async function armarDosEquipos(g, tam, id) {
  const listos = { a: 0, b: 0 };
  const total = tam * 2;
  const barra = $('#barraProgreso');
  const progreso = (k) => ({ ultimo }) => {
    if (id !== estado.busqueda) return;
    listos[k]++;
    const n = listos.a + listos.b;
    barra.firstElementChild.style.width = `${(n / total) * 100}%`;
    barra.setAttribute('aria-valuenow', Math.round((n / total) * 100));
    $('#busquedaDetalle').textContent = `Preparando equipos: ${n} de ${total} Pokémon (${contadorPeticiones()} consultas a la API)`;
    if (ultimo) {
      const img = new Image(64, 64);
      img.src = ultimo.sprites.frenteFijo; img.alt = '';
      $('#desfile').append(img);
    }
  };
  const mio = armarMiEquipo(g, tam, progreso('a'));
  return Promise.all([mio, armarEquipo(g.id, tam, progreso('b'))]);
}

async function buscarPartida() {
  const id = ++estado.busqueda;
  const g = genActual();
  const tam = estado.tamano;
  estado.rival = `${aleatorio(TITULOS_RIVALES)} ${aleatorio(NOMBRES_RIVALES)}`;
  pantallaBusqueda(g.id === 0 ? 'Buscando rival en todas las generaciones…' : g.id === LEGENDARIOS.id ? 'Buscando rival para un duelo de legendarios…' : `Buscando rival en ${g.region}…`, 'Conectando con la PokeAPI');
  const inicio = performance.now();
  try {
    const [eqJ, eqR] = await armarDosEquipos(g, tam, id);
    if (id !== estado.busqueda) return;
    const minimo = 1400 - (performance.now() - inicio);
    if (minimo > 0) await new Promise((ok) => setTimeout(ok, minimo));
    if (id !== estado.busqueda) return;
    $('#busquedaTitulo').textContent = `¡Rival encontrado: ${estado.rival}!`;
    sfx.encontrado();
    await new Promise((ok) => setTimeout(ok, 900));
    if (id !== estado.busqueda) return;
    estado.modoBatalla = 'cpu';
    estado.miLado = 'player';
    estado.batalla = crearBatalla({ equipoJugador: eqJ, equipoRival: eqR, nombreJugador: estado.usuario, nombreRival: estado.rival, generacion: g.id });
    mostrarPreview();
  } catch (err) {
    console.error(err);
    if (id !== estado.busqueda) return;
    toast(err.message || 'No se pudo armar la partida. Revisa tu conexión e inténtalo otra vez.', 6000);
    mostrar('inicio');
  } finally {
    clearInterval(rotarTips);
  }
}

$('#btnCancelarBusqueda').addEventListener('click', () => {
  estado.busqueda++;
  estado.cancelarBusqueda?.();
  cerrarSala();
  clearInterval(rotarTips);
  mostrar('inicio');
});

// ------------------------------------------------------------
//  EN LÍNEA: emparejamiento y sala
// ------------------------------------------------------------
const quitarPesado = (b) => { const { movimientos, ...resto } = b; return resto; };

function cerrarSala() {
  if (estado.pvp?.reloj) clearInterval(estado.pvp.reloj);
  if (estado.pvp?.graciaAbandono) clearTimeout(estado.pvp.graciaAbandono);
  estado.sala?.cerrar();
  estado.sala = null;
}

async function buscarPartidaEnLinea() {
  if (!db.enLinea()) { toast('El modo en línea necesita Supabase configurado.'); return; }
  const id = ++estado.busqueda;
  const g = genActual();
  const tam = estado.tamano;
  cerrarSala();
  pantallaBusqueda(
    g.id === 0 ? 'Buscando otro entrenador (todas las generaciones)…' : g.id === LEGENDARIOS.id ? 'Buscando otro entrenador para un duelo de legendarios…' : `Buscando otro entrenador en ${g.region}…`,
    `Esperando a alguien que busque ${tam} contra ${tam} con la misma opción.`,
  );
  const busq = buscarRival({
    gen: g.id, tamano: tam, usuario: estado.usuario,
    alActualizar: ({ esperando }) => {
      if (id !== estado.busqueda) return;
      $('#busquedaDetalle').textContent = esperando > 1
        ? `${esperando} entrenadores buscando aquí. Emparejando…`
        : `Eres el único buscando ${tam} contra ${tam} aquí. Comparte el QR para que alguien se una.`;
    },
  });
  estado.cancelarBusqueda = busq.cancelar;

  let sala;
  try { sala = await busq.promesa; } catch (e) {
    if (e.cancelado || id !== estado.busqueda) return;
    toast(e.message, 6000); mostrar('inicio'); return;
  } finally { estado.cancelarBusqueda = null; }
  if (id !== estado.busqueda) { sala.cerrar(); return; }

  estado.sala = sala;
  estado.rival = sala.rival.usuario;
  sfx.encontrado();
  $('#busquedaTitulo').textContent = `¡Rival encontrado: ${estado.rival}!`;
  configurarSala(sala);

  // Cada entrenador arma SU equipo (aleatorio o personalizado); el anfitrión junta los dos y arranca.
  $('#busquedaDetalle').textContent = 'Preparando tu equipo…';
  let miEq;
  try {
    miEq = (await armarUnEquipo(g, tam, id)).map(quitarPesado);
  } catch (e) {
    sala.enviar('error', { mensaje: 'Tu rival no pudo cargar sus Pokémon.' });
    toast(e.message, 6000); cerrarSala(); mostrar('inicio'); return;
  }
  if (id !== estado.busqueda || sala.cerrada) return;

  if (sala.soyHost) {
    $('#busquedaDetalle').textContent = `Esperando el equipo de ${estado.rival}…`;
    let datos = null; let pedir = null; let limite = null;
    const empezar = (equipoRival) => {
      if (datos || id !== estado.busqueda || sala.cerrada) return;
      datos = {
        semilla: Math.floor(Math.random() * 2 ** 31), gen: g.id, tamano: tam,
        host: estado.usuario, invitado: estado.rival,
        equipos: { player: miEq, rival: equipoRival.slice(0, tam) },
      };
      clearInterval(pedir); clearTimeout(limite);
      sala.enviar('inicio', datos);
      prepararBatallaEnLinea(datos, 'player');
    };
    sala.on('equipo', ({ equipo }) => { if (Array.isArray(equipo) && equipo.length) empezar(equipo); });
    sala.on('hola', () => { if (datos) sala.enviar('inicio', datos); else sala.enviar('pideEquipo'); }); // por si un mensaje se perdió
    if (!datos) { pedir = setInterval(() => { if (!datos) sala.enviar('pideEquipo'); }, 2000); sala.enviar('pideEquipo'); }
    if (!datos) limite = setTimeout(() => {
      clearInterval(pedir);
      if (!datos && id === estado.busqueda) { toast(`${estado.rival} tardó demasiado en preparar su equipo.`); cerrarSala(); mostrar('inicio'); }
    }, 60000);
  } else {
    $('#busquedaDetalle').textContent = `Enviando tu equipo a ${estado.rival}…`;
    let ultimoEnvio = 0;
    const mandar = () => { if (Date.now() - ultimoEnvio < 1500) return; ultimoEnvio = Date.now(); sala.enviar('equipo', { equipo: miEq }); };
    sala.on('pideEquipo', mandar);
    mandar();
    const limite = setTimeout(() => {
      if (id === estado.busqueda && estado.batalla?.sala !== sala.id) { toast('El rival tardó demasiado. Busca otra vez.'); cerrarSala(); mostrar('inicio'); }
    }, 60000);
    sala.on('inicio', (datos) => {
      clearTimeout(limite);
      if (id !== estado.busqueda || estado.batalla?.sala === sala.id) return;
      prepararBatallaEnLinea(datos, 'rival');
    });
  }
}

/** Arma solo mi equipo con barra de progreso (para el modo en línea). */
async function armarUnEquipo(g, tam, id) {
  const barra = $('#barraProgreso');
  let n = 0;
  return armarMiEquipo(g, tam, ({ ultimo }) => {
    if (id !== estado.busqueda) return;
    n++;
    barra.firstElementChild.style.width = `${(n / tam) * 100}%`;
    $('#busquedaDetalle').textContent = `Preparando tu equipo: ${n} de ${tam}`;
    if (ultimo) { const img = new Image(64, 64); img.src = ultimo.sprites.frenteFijo; img.alt = ''; $('#desfile').append(img); }
  });
}

function prepararBatallaEnLinea(datos, lado) {
  clearInterval(rotarTips);
  estado.gen = datos.gen;
  estado.modoBatalla = 'pvp';
  estado.miLado = lado;
  estado.batalla = crearBatalla({
    equipoJugador: datos.equipos.player, equipoRival: datos.equipos.rival,
    nombreJugador: datos.host, nombreRival: datos.invitado, generacion: datos.gen,
    rng: rngConSemilla(datos.semilla),
  });
  estado.batalla.sala = estado.sala.id;
  estado.pvp = { acciones: {}, reemplazos: {}, aplicados: new Set(), listoYo: false, listoRival: false, fase: 'preview', reloj: null };
  mostrarPreview();
}

function configurarSala(sala) {
  sala.on('listo', () => {
    if (!estado.pvp) return;
    estado.pvp.listoRival = true;
    if (estado.pvp.fase === 'preview') {
      $('#pvEstado').textContent = estado.pvp.listoYo ? '' : `${estado.rival} ya está listo.`;
      intentarEmpezarEnLinea();
    }
  });
  sala.on('accion', ({ turno, accion }) => {
    if (!estado.pvp) return;
    (estado.pvp.acciones[turno] ||= {})[otro(estado.miLado)] = accion;
    intentarResolverTurno(turno);
  });
  sala.on('reemplazo', ({ clave, lado, indice }) => {
    if (!estado.pvp) return;
    (estado.pvp.reemplazos[clave] ||= {})[lado] = indice;
    intentarReemplazos();
  });
  sala.on('rendicion', () => {
    const b = estado.batalla;
    if (!b || b.terminada || b.sala !== sala.id) return;
    b.terminada = true; b.ganador = estado.miLado; b.motivo = 'rendicion';
    toast(`${estado.rival} se rindió.`);
    finalizar();
  });
  sala.on('error', ({ mensaje }) => { toast(mensaje || 'Hubo un problema con la partida.'); cerrarSala(); mostrar('inicio'); });
  sala.alSalirRival = () => {
    const b = estado.batalla;
    if (!b || b.terminada || b.sala !== sala.id) {
      if ($('#pantalla-busqueda').classList.contains('activa') || $('#pantalla-preview').classList.contains('activa')) {
        toast(`${estado.rival} se desconectó.`); cerrarSala(); mostrar('inicio');
      }
      return;
    }
    toast(`${estado.rival} perdió la conexión. Esperando 20 segundos…`);
    estado.pvp.graciaAbandono = setTimeout(() => {
      if (b.terminada) return;
      b.terminada = true; b.ganador = estado.miLado; b.motivo = 'abandono';
      finalizar();
    }, 20000);
  };
  sala.alVolverRival = () => {
    if (estado.pvp?.graciaAbandono) { clearTimeout(estado.pvp.graciaAbandono); estado.pvp.graciaAbandono = null; toast(`${estado.rival} volvió.`); }
  };
}

function intentarEmpezarEnLinea() {
  const p = estado.pvp;
  if (p.fase === 'preview' && p.listoYo && p.listoRival) {
    p.fase = 'batalla';
    clearTimeout(p.autoListo);
    iniciarBatalla();
  }
}

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
  const b = estado.batalla;
  const g = genPorId(b.generacion);
  const mio = estado.miLado; const suyo = otro(mio);
  const n = b.lados[mio].equipo.length;
  $('#pvJugador').textContent = estado.usuario;
  $('#pvRival').innerHTML = `${esc(estado.rival)}${enPvp() ? ' <span class="en-linea">EN LÍNEA</span>' : ''}`;
  $('#pvGen').textContent = `${etiquetaGen(g)}, ${n} contra ${n}`;
  $('#pvEquipoJ').innerHTML = b.lados[mio].equipo.map((p, i) => tarjetaPreview(p, mio, i)).join('');
  $('#pvEquipoR').innerHTML = b.lados[suyo].equipo.map((p, i) => tarjetaPreview(p, suyo, i)).join('');
  $('#pvTituloRival').textContent = `Equipo de ${estado.rival}`;
  $('#btnRearmar').hidden = enPvp();
  $('#btnComenzar').disabled = false;
  $('#btnComenzar').textContent = enPvp() ? '¡Estoy listo!' : 'Comenzar batalla';
  $('#pvEstado').textContent = enPvp() ? 'La batalla empieza cuando los dos estén listos.' : '';
  mostrar('preview');
  if (enPvp()) estado.pvp.autoListo = setTimeout(() => { if (!estado.pvp.listoYo) $('#btnComenzar').click(); }, 30000);
  $('#btnComenzar').focus();
}

$('#pantalla-preview').addEventListener('click', (e) => {
  const bt = e.target.closest('button[data-side]');
  if (!bt) return;
  const p = estado.batalla.lados[bt.dataset.side].equipo[Number(bt.dataset.i)];
  abrirInfo(p, bt.dataset.side === estado.miLado);
});
$('#btnRearmar').addEventListener('click', buscarPartida);
$('#btnComenzar').addEventListener('click', () => {
  if (!enPvp()) { iniciarBatalla(); return; }
  if (estado.pvp.listoYo) return;
  estado.pvp.listoYo = true;
  sfx.click();
  $('#btnComenzar').disabled = true;
  $('#btnComenzar').textContent = 'Listo';
  $('#pvEstado').textContent = estado.pvp.listoRival ? '' : `Esperando a que ${estado.rival} esté listo…`;
  estado.sala?.enviar('listo');
  intentarEmpezarEnLinea();
});

function abrirInfo(p, verMovs) {
  const color = (v) => (v >= 120 ? '#52d273' : v >= 90 ? '#a6e05b' : v >= 60 ? '#f5c518' : '#ff8a5b');
  const movs = verMovs ? p.moves.map((m) => `
      <div style="--c:${TIPOS[m.type]?.color}">
        <strong>${esc(m.nombre)}</strong>
        <small>${TIPOS[m.type]?.es}, ${CATEGORIAS[m.category]?.es}${poderNominal(m) ? `, potencia ${poderNominal(m)}` : ''}${m.accuracy ? `, precisión ${m.accuracy}%` : ', no falla'}, ${m.pp} PP</small>
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
        <p class="cat">${verMovs ? `Velocidad ${p.stats.speed}` : `Velocidad posible ${rangoVelocidad({ base: p.base, level: p.level, boosts: {} }).join('–')}`}</p>
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
const fx = new Efectos(arena);
fx.vel = estado.vel;
const slot = { player: $('#slotJugador'), rival: $('#slotRival') };
const hpbox = { player: $('#hpJugador'), rival: $('#hpRival') };
const spriteDe = (side) => slot[side].querySelector('.sprite');

function iniciarBatalla() {
  const b = estado.batalla;
  const g = genPorId(b.generacion);
  arena.style.setProperty('--c1', g.tema[0]);
  arena.style.setProperty('--c2', g.tema[1]);
  estado.caidos = { player: new Set(), rival: new Set() };
  estado.mostrado = { player: null, rival: null };
  $('#log').innerHTML = '';
  $('#turnoChip').textContent = 'Turno 1';
  for (const s of ['player', 'rival']) { spriteDe(s).className = 'sprite'; hpbox[s].classList.remove('visible'); slot[s].classList.remove('con-pantalla'); }
  pintarClima(null);
  $('#btnRevancha').textContent = enPvp() ? 'Buscar otro rival' : 'Revancha';
  mostrar('batalla');
  ajustarEscala();
  bloquear(true);

  const mio = estado.miLado; const suyo = otro(mio);
  const R = activo(b, suyo); const P = activo(b, mio);
  R.vecesUsado = 1; P.vecesUsado = 1;
  introVS(P, R).then(() => reproducir([
    { t: 'msg', texto: enPvp() ? `¡Duelo en línea contra ${estado.rival}!` : `¡${estado.rival} quiere pelear!` },
    { t: 'msg', texto: `¡${estado.rival} envió a ${R.nombre}!` },
    { t: 'entrar', side: suyo, mon: R, hp: R.hp, maxHp: R.maxHp, estado: null },
    { t: 'msg', texto: `¡Adelante, ${P.nombre}!` },
    { t: 'entrar', side: mio, mon: P, hp: P.hp, maxHp: P.maxHp, estado: null },
  ])).then(mostrarMenu);
}

/** Pantalla "VS" de entrada con los dos entrenadores y sus primeros Pokémon. */
function introVS(P, R) {
  const el = $('#vsIntro');
  el.innerHTML = `
    <div class="vs-mitad yo"><img src="${P.sprites.arte}" alt="" /><b>${esc(estado.usuario)}</b></div>
    <div class="vs-mitad el"><img src="${R.sprites.arte}" alt="" /><b>${esc(estado.rival)}</b></div>
    <div class="vs-logo">VS</div>`;
  el.hidden = false;
  el.classList.remove('sale'); void el.offsetWidth; el.classList.add('entra');
  sfx.inicioBatalla();
  musicaDe('batalla');
  return new Promise((ok) => {
    setTimeout(() => { el.classList.add('sale'); }, reducido ? 300 : 1700);
    setTimeout(() => { el.hidden = true; el.classList.remove('entra', 'sale'); ok(); }, reducido ? 500 : 2150);
  });
}

// Escala de sprites según el tamaño de la arena
const escalaArena = () => Math.max(1.15, Math.min(2.2, (arena.clientWidth || 700) / 400));
function ajustarEscala() {
  arena.style.setProperty('--k', escalaArena().toFixed(2));
  for (const s of ['player', 'rival']) limitarSprite(s);
}
function limitarSprite(side) {
  const img = spriteDe(side);
  const nw = Number(img.dataset.nw || 64);
  const k = escalaArena() * (side === 'player' ? 1.15 : 1);
  const max = arena.clientWidth * (side === 'player' ? 0.42 : 0.36);
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
  const hpVis = m.hpVis ?? m.hp;
  const pct = Math.max(0, Math.round((hpVis / m.maxHp) * 100));
  const nivel = pct > 50 ? '' : pct > 20 ? 'media' : 'baja';
  const est = m.estado ? `<span class="est" style="background:${ESTADOS[m.estado].color}">${ESTADOS[m.estado].corto}</span>` : '';
  const boosts = Object.entries(m.boosts || {}).filter(([, v]) => v).map(([k, v]) => {
    const mult = v > 0 ? (2 + v) / 2 : 2 / (2 - v);
    if (k === 'accuracy' || k === 'evasion') return `<span class="boost ${v < 0 ? 'neg' : ''}">${k === 'accuracy' ? 'Prec' : 'Evas'} ${v > 0 ? '+' : ''}${v}</span>`;
    return `<span class="boost ${v < 0 ? 'neg' : ''}">${STATS_CORTO[k]} ×${mult.toFixed(mult % 1 ? 2 : 0).replace(/0$/, '')}</span>`;
  }).join('');
  const equipo = estado.batalla.lados[motor(side)].equipo;
  const vb = m.boosts?.speed ?? 0; const para = m.estado === 'paralysis' ? 0.5 : 1;
  const vel = side === 'player'
    ? `<span class="vel" title="Velocidad real de tu Pokémon (con cambios y estado)">Vel <b>${Math.floor(mon.stats.speed * multEtapa(vb) * para)}</b></span>`
    : (() => { const [a, z] = rangoVelocidad({ ...mon, boosts: { speed: vb }, status: m.estado }); return `<span class="vel" title="Velocidad posible del rival: depende de su naturaleza y entrenamiento">Vel <b>${a}–${z}</b></span>`; })();
  const puntos = equipo.map((_, i) => `<img src="${BALL}" alt="" class="${estado.caidos[side].has(i) ? 'caido' : ''}" />`).join('');
  hpbox[side].innerHTML = `
    <div class="hp-top"><span class="nombre">${esc(mon.nombre)}</span><span class="nivel">Nv. ${mon.level}</span></div>
    <div class="tipos">${mon.types.map(badgeTipo).join('')}${vel}</div>
    <div class="hp-fila"><b>PS</b><div class="barra-hp"><div class="rastro" style="width:${pct}%"></div><div class="relleno ${nivel}" style="width:${pct}%"></div></div></div>
    <div class="hp-info">${est}<span class="boosts">${boosts}</span><span class="hp-num">${side === 'player' ? `${Math.round(hpVis)}/${m.maxHp}` : `${pct}%`}</span></div>
    <div class="equipo-puntos" aria-label="Pokémon restantes">${puntos}</div>`;
  hpbox[side].setAttribute('aria-label', `${mon.nombre}, ${pct}% de PS`);
  hpbox[side].classList.toggle('critico', side === 'player' && pct > 0 && pct <= 20);
}

/**
 * Anima la barra de PS como en los juegos: la barra baja poco a poco, los números
 * cuentan, y un "rastro" claro muestra lo que se perdió antes de encogerse.
 */
function animarPS(side, objetivo, dur = 900) {
  const m = estado.mostrado[side];
  const desde = m.hpVis ?? objetivo;
  const caja = hpbox[side];
  const relleno = caja.querySelector('.barra-hp .relleno');
  const rastro = caja.querySelector('.barra-hp .rastro');
  const num = caja.querySelector('.hp-num');
  if (!relleno) { m.hpVis = objetivo; renderHp(side); return Promise.resolve(); }
  const baja = objetivo < desde;
  const pctDe = (v) => Math.max(0, (v / m.maxHp) * 100);
  rastro.classList.toggle('cura', !baja);
  rastro.style.transition = 'none';
  rastro.style.width = `${pctDe(baja ? desde : objetivo)}%`;
  if (baja) setTimeout(() => { rastro.style.transition = `width ${0.5 / estado.vel}s ease-in`; rastro.style.width = `${pctDe(objetivo)}%`; }, (dur * 0.7) / estado.vel);
  const total = (reducido ? 200 : dur) / estado.vel;
  const t0 = performance.now();
  return new Promise((ok) => {
    const paso = (ahora) => {
      const k = Math.min(1, (ahora - t0) / total);
      const e = 1 - (1 - k) ** 3;
      const v = desde + (objetivo - desde) * e;
      m.hpVis = v;
      const pct = pctDe(v);
      relleno.style.width = `${pct}%`;
      relleno.className = `relleno ${pct > 50 ? '' : pct > 20 ? 'media' : 'baja'}`;
      num.textContent = side === 'player' ? `${Math.round(v)}/${m.maxHp}` : `${Math.round(pct)}%`;
      if (k < 1) requestAnimationFrame(paso);
      else {
        m.hpVis = objetivo;
        const final = pctDe(objetivo);
        caja.classList.toggle('critico', side === 'player' && final > 0 && final <= 20);
        if (side === 'player' && final > 0 && final <= 20 && !m.alarmado) { m.alarmado = true; sfx.alarma(); }
        ok();
      }
    };
    requestAnimationFrame(paso);
  });
}

/** Letrero grande en la arena: "¡SÚPER EFICAZ!", "¡CRÍTICO!"… */
function letrero(texto, cls = '') {
  const el = document.createElement('div');
  el.className = `letrero ${cls}`;
  el.textContent = texto;
  arena.append(el);
  setTimeout(() => el.remove(), 1300 / estado.vel);
}

/** Oscurece el escenario con el color del tipo mientras dura un ataque especial. */
function oscurecer(tipo, on) {
  let o = arena.querySelector('.oscuro');
  if (!o) { o = document.createElement('div'); o.className = 'oscuro'; arena.prepend(o); }
  o.style.setProperty('--c', TIPOS[tipo]?.color || '#000');
  o.classList.toggle('on', on);
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

async function animAtaque(side, move) {
  const img = spriteDe(side);
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  const dir = side === 'player' ? [1, -1] : [-1, 1];
  const contacto = move.category === 'physical';
  const estado_ = move.category === 'status';
  const fuerte = (move.power || 0) >= 80;
  const otroLado = side === 'player' ? 'rival' : 'player';
  if (!estado_ && (fuerte || move.category === 'special')) oscurecer(move.type, true);
  // 1) Carga de energía
  if (!estado_) {
    sfx.carga(move.type);
    anim(img, [{ filter: 'brightness(1)' }, { filter: `brightness(1.8) drop-shadow(0 0 12px ${TIPOS[move.type]?.color || '#fff'})` }, { filter: 'brightness(1)' }], { duration: 420 });
    await fx.cargar(move.type, centro(side), contacto ? 0.25 : 0.42);
  }
  // 2) Lanzamiento
  sfx.ataque(move);
  const dist = contacto ? 30 : 8;
  const embestida = anim(img, [
    { transform: `translate(0,0)${espejo}` },
    { transform: `translate(${-dir[0] * 4}%, ${-dir[1] * 2}%)${espejo}`, offset: 0.2 },
    { transform: `translate(${dir[0] * dist}%, ${dir[1] * dist * 0.5}%)${espejo}`, offset: 0.5 },
    { transform: `translate(0,0)${espejo}` },
  ], { duration: contacto ? 460 : 320 });
  if (contacto) await espera(200);
  await fx.animar(move, centro(side), centro(otroLado));
  await embestida;
  oscurecer(move.type, false);
}

async function animDanio(e) {
  const m = estado.mostrado[e.side];
  m.hp = e.hp;
  const img = spriteDe(e.side);
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  const c = centro(e.side);
  const pct = Math.max(1, Math.round((e.cantidad / m.maxHp) * 100));
  if (e.residual) { fx.estado(e.estado === 'burn' ? 'fire' : 'poison', c); sfx.residual(); }
  else { fx.golpecito(e.tipo || 'normal', c); sfx.golpe(e.eff ?? 1, e.critico); }
  // Destello blanco + retroceso del Pokémon golpeado
  const atras = e.side === 'rival' ? [5, -2] : [-5, 2];
  anim(img, [
    { transform: `translate(0,0)${espejo}`, filter: 'brightness(1)' },
    { transform: `translate(${atras[0]}%, ${atras[1]}%)${espejo}`, filter: 'brightness(5) saturate(0)', offset: 0.15 },
    { transform: `translate(${atras[0] * 0.6}%, ${atras[1] * 0.6}%)${espejo}`, filter: 'brightness(1)', offset: 0.35 },
    { transform: `translate(${atras[0] * 0.3}%, 0)${espejo}`, filter: 'brightness(4) saturate(0)', offset: 0.5 },
    { transform: `translate(0,0)${espejo}`, filter: 'brightness(1)' },
  ], { duration: 520 });
  anim(hpbox[e.side], [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320 });
  if (e.critico) {
    const f = document.createElement('div'); f.className = 'destello'; arena.append(f); setTimeout(() => f.remove(), 350);
    letrero('¡CRÍTICO!', 'critico');
  } else if (e.eff > 1) letrero('¡SÚPER EFICAZ!', 'eficaz');
  else if (e.eff < 1 && !e.residual) letrero('Poco eficaz', 'poco');
  if ((e.eff > 1 || e.critico || pct >= 35) && !reducido) {
    arena.classList.remove('sacudir', 'sacudir-fuerte'); void arena.offsetWidth;
    arena.classList.add(e.eff > 1 && pct >= 35 ? 'sacudir-fuerte' : 'sacudir');
  }
  flotante(e.side, e.critico ? `−${pct}%` : `−${pct}%`, e.critico ? 'crit grande' : pct >= 35 ? 'dano grande' : 'dano');
  await animarPS(e.side, e.hp, 500 + Math.min(700, pct * 12));
  await espera(180);
}

function pintarClima(c) {
  arena.dataset.clima = c || '';
  let el = $('#climaChip');
  if (!el) { el = document.createElement('div'); el.id = 'climaChip'; el.className = 'clima-chip'; arena.append(el); }
  el.hidden = !c;
  if (c) { el.textContent = `${CLIMA_ES[c].icono} ${CLIMA_ES[c].nombre}`; sfx.clima?.(c); }
}
function pintarPantallas() {
  const b = estado.batalla;
  for (const lado of ['player', 'rival']) {
    const p = b.lados[motor(lado)].pantallas;
    slot[lado].classList.toggle('con-pantalla', Object.values(p).some((v) => v > 0));
  }
}

async function animCurar(e) {
  estado.mostrado[e.side].hp = e.hp;
  fx.animar({ name: 'recover', type: 'grass', category: 'status', target: 'user', meta: { category: 'heal' } }, centro(e.side), centro(e.side));
  sfx.curar();
  flotante(e.side, `+${Math.max(1, Math.round((e.cantidad / e.maxHp) * 100))}%`, 'cura');
  if (estado.mostrado[e.side].hp / e.maxHp > 0.2) estado.mostrado[e.side].alarmado = false;
  await animarPS(e.side, e.hp, 800);
}

/** Punto de lanzamiento: el entrenador está fuera de cuadro, en la esquina de su lado. */
function origenLanzamiento(side) {
  const a = arena.getBoundingClientRect();
  return side === 'player' ? { x: -30, y: a.height * 0.95 } : { x: a.width + 30, y: a.height * 0.05 };
}

/** Lanza la Poké Ball en arco, rebota, se abre con un destello y el Pokémon se materializa. */
async function lanzarBall(side, destino) {
  const o = origenLanzamiento(side);
  const ball = particula('ball-vuelo', o.x, o.y);
  ball.innerHTML = `<img src="${BALL}" alt="" />`;
  const dx = destino.x - o.x; const dy = destino.y - o.y;
  const alto = Math.min(arena.clientHeight * 0.55, 230);
  const vueltas = side === 'player' ? 720 : -720;
  const pasos = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const x = dx * t; const y = dy * t - alto * 4 * t * (1 - t);
    pasos.push({ transform: `translate(${x}px, ${y}px) rotate(${vueltas * t}deg) scale(${0.7 + 0.5 * t})`, offset: t });
  }
  sfx.lanzar();
  // estela de destellos mientras vuela
  let estela = null;
  if (!reducido) {
    let n = 0;
    estela = setInterval(() => {
      const r = ball.getBoundingClientRect(); const a = arena.getBoundingClientRect();
      const ch = particula('chispa-ball', r.left - a.left + r.width / 2, r.top - a.top + r.height / 2);
      anim(ch, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 0.9 }, { transform: 'translate(-50%,-50%) scale(0)', opacity: 0 }], { duration: 380 }).then(() => ch.remove());
      if (++n > 30) clearInterval(estela);
    }, 28);
  }
  await anim(ball, pasos, { duration: 620, easing: 'linear' });
  clearInterval(estela);
  ball.style.transform = `translate(${dx}px, ${dy}px) scale(1.2)`;
  // rebote y tambaleo
  sfx.rebote();
  await anim(ball, [
    { transform: `translate(${dx}px, ${dy}px) scale(1.2)` },
    { transform: `translate(${dx}px, ${dy - 26}px) scale(1.2) rotate(${side === 'player' ? 20 : -20}deg)`, offset: 0.4 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.25, 1.1)`, offset: 0.75 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.2) rotate(-12deg)`, offset: 0.88 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.2)` },
  ], { duration: 360, easing: 'ease-out' });
  // se abre: destello blanco, anillo y luz
  sfx.abrir();
  ball.classList.add('abierta');
  const luz = particula('luz-ball', destino.x, destino.y);
  anim(luz, [{ transform: 'translate(-50%,-50%) scale(.1)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }], { duration: 520, easing: 'ease-out' }).then(() => luz.remove());
  fx.destelloBall?.(destino);
  anim(ball, [{ opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1.2)` }, { opacity: 0, transform: `translate(${dx}px, ${dy + 10}px) scale(.4)` }], { duration: 300 }).then(() => ball.remove());
  if (reducido) setTimeout(() => { ball.remove(); luz.remove(); }, 400);
}

async function animEntrar(e) {
  const side = e.side;
  estado.mostrado[side] = { mon: e.mon, hp: e.hp, hpVis: e.hp, maxHp: e.maxHp, estado: e.estado, boosts: {} };
  const img = spriteDe(side);
  img.classList.remove('visible');
  await cargarSprite(side, e.mon);
  renderHp(side);
  const c = centro(side);
  await lanzarBall(side, { x: c.x, y: c.y + c.h * 0.28 });
  img.classList.add('visible');
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  grito(e.mon.grito);
  hpbox[side].classList.add('visible');
  await anim(img, [
    { transform: `translateY(25%) scale(0.05, 0.05)${espejo}`, filter: 'brightness(0) invert(1) drop-shadow(0 0 18px #fff)', opacity: 0.9 },
    { transform: `translateY(4%) scale(0.9, 1.15)${espejo}`, filter: 'brightness(0) invert(1) drop-shadow(0 0 14px #fff)', opacity: 1, offset: 0.45 },
    { transform: `scale(1.08, .94)${espejo}`, filter: 'brightness(2.2)', offset: 0.72 },
    { transform: `scale(1)${espejo}`, filter: 'brightness(1)' },
  ], { duration: 560, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  await espera(220);
}

/** Rayo rojo de regreso a la Poké Ball. */
async function animRetirar(side) {
  const img = spriteDe(side);
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  const c = centro(side); const o = origenLanzamiento(side);
  const rayo = particula('rayo-retorno', c.x, c.y);
  const largo = Math.hypot(o.x - c.x, o.y - c.y);
  rayo.style.width = `${largo}px`;
  rayo.style.transform = `rotate(${Math.atan2(o.y - c.y, o.x - c.x)}rad)`;
  sfx.retirar();
  anim(rayo, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 0.35 }, { opacity: 1, clipPath: 'inset(0 0 0 0)', offset: 0.7 }, { opacity: 0, clipPath: 'inset(0 0 0 100%)' }], { duration: 620 }).then(() => rayo.remove());
  await anim(img, [
    { transform: `scale(1)${espejo}`, filter: 'none' },
    { transform: `scale(1.05)${espejo}`, filter: 'brightness(.7) sepia(1) hue-rotate(-50deg) saturate(8) drop-shadow(0 0 12px #ff3b3b)', offset: 0.35 },
    { transform: `translateY(20%) scale(0)${espejo}`, filter: 'brightness(.7) sepia(1) hue-rotate(-50deg) saturate(8)' },
  ], { duration: 520, easing: 'ease-in' });
  if (reducido) rayo.remove();
  img.classList.remove('visible');
  hpbox[side].classList.remove('visible');
  await espera(120);
}

async function animDebil(side) {
  const img = spriteDe(side);
  img.classList.remove('escondido');
  const m = estado.mostrado[side];
  m.hp = 0; m.hpVis = 0; m.estado = null;
  hpbox[side].classList.remove('critico');
  estado.caidos[side].add(estado.batalla.lados[motor(side)].equipo.indexOf(m.mon));
  grito(m.mon.grito, { velocidad: 0.75, volumen: 0.3 });
  sfx.debilitado();
  const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
  const c = centro(side);
  await anim(img, [{ transform: `translateY(0)${espejo}`, opacity: 1, filter: 'brightness(1)' }, { transform: `translateY(8%)${espejo}`, opacity: 1, filter: 'brightness(.6) grayscale(1)', offset: 0.3 }, { transform: `translateY(55%) scaleY(.6)${espejo}`, opacity: 0, filter: 'brightness(.4) grayscale(1)' }], { duration: 750, easing: 'ease-in' });
  fx.golpecito('ground', { x: c.x, y: c.y + c.h * 0.35 });
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
  const c = centro(e.side);
  if (e.tipo === 'carga') {
    const img = spriteDe(e.side);
    sfx.carga(e.move.type);
    await fx.cargar(e.move.type, c, 0.6);
    if (e.inv) {
      const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
      const fin = e.inv === 'aire' ? 'translateY(-140%) scale(.6)' : e.inv === 'sombra' ? 'scale(1.1)' : 'translateY(80%) scaleY(.2)';
      sfx.retirar();
      await anim(img, [{ transform: `none${espejo}`, opacity: 1 }, { transform: `${fin}${espejo}`, opacity: 0 }], { duration: 420, easing: 'ease-in' });
      img.classList.add('escondido');
    }
    return;
  }
  if (e.tipo === 'reaparecer') { const img = spriteDe(e.side); img.classList.remove('escondido'); await anim(img, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 }); return; }
  if (e.tipo === 'recarga') { flotante(e.side, '…', 'baja'); await espera(300); return; }
  if (e.tipo === 'proteccion') { sfx.escudo(); fx.escudo?.(c); await espera(450); return; }
  if (e.tipo === 'semilla') { fx.animar({ name: 'leech-seed', type: 'grass', category: 'status', target: 'selected-pokemon', meta: { category: 'unique' } }, centro(e.side === 'player' ? 'rival' : 'player'), c); await espera(500); return; }
  if (e.tipo === 'rocas') { fx.golpecito('rock', c); await espera(250); return; }
  if (e.tipo === 'futuro') { await fx.animar({ ...e.move, category: 'special' }, centro(e.side), centro(e.side === 'player' ? 'rival' : 'player')); return; }
  if (e.tipo === 'aura') { fx.estado('electric', c); await espera(300); return; }
  if (e.tipo === 'dormir') flotante(e.side, 'Z z z', 'baja');
  if (e.tipo === 'paralisis') fx.estado('electric', centro(e.side));
  if (e.tipo === 'confuso') flotante(e.side, '? ? ?', 'crit');
  await espera(350);
}

const lcd = $('#lcd');
function decir(textoCrudo, cls = '') {
  const texto = fmt(textoCrudo, estado.miLado);
  if (cls !== 'detalle') { $('#lcdTexto').textContent = texto; sfx.texto(); }
  const li = document.createElement('li');
  li.textContent = texto;
  if (cls) li.className = cls;
  const log = $('#log'); log.append(li); log.scrollTop = log.scrollHeight;
  return texto;
}
lcd.addEventListener('click', () => saltar?.());
arena.addEventListener('click', () => saltar?.());

async function reproducir(eventosMotor) {
  // Los eventos vienen con lados del motor: se traducen a lados de la pantalla
  const eventos = eventosMotor.map((e) => (e.side ? { ...e, side: pantalla(e.side) } : e));
  estado.reproduciendo = true;
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
      case 'msg': {
        const texto = decir(e.texto, e.cls);
        if (e.cls !== 'detalle') await espera(Math.min(1500, 620 + texto.length * 14));
        break;
      }
      case 'mover': {
        const sig = eventos[i + 1];
        if (sig?.t === 'msg') { decir(sig.texto, sig.cls); i++; }
        await espera(380);
        const img = spriteDe(e.side);
        if (img.classList.contains('escondido')) {
          img.classList.remove('escondido');
          const espejo = img.classList.contains('espejo') ? ' scaleX(-1)' : '';
          anim(img, [{ opacity: 0, transform: `translateY(-60%)${espejo}` }, { opacity: 1, transform: `none${espejo}` }], { duration: 260 });
        }
        await animAtaque(e.side, e.move);
        break;
      }
      case 'clima': pintarClima(e.clima); break;
      case 'pantalla': pintarPantallas(); break;
      case 'danio': await animDanio(e); break;
      case 'curar': await animCurar(e); break;
      case 'estado':
        estado.mostrado[e.side].estado = e.estado;
        renderHp(e.side);
        if (e.estado) { sfx.estado(); fx.estado({ burn: 'fire', paralysis: 'electric', poison: 'poison', toxic: 'poison', sleep: 'normal', freeze: 'ice' }[e.estado] || 'normal', centro(e.side)); }
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
  estado.reproduciendo = false;
}

// ---------- Menú del jugador ----------
function bloquear(si) {
  estado.ocupado = si;
  $('#controles').classList.toggle('bloqueado', si);
}

function reloj(segundos, alTerminar) {
  const p = estado.pvp;
  if (!p) return;
  clearInterval(p.reloj);
  let el = $('#reloj');
  if (!el) { el = document.createElement('span'); el.id = 'reloj'; el.className = 'reloj'; $('#cambiosTitulo').after(el); }
  let quedan = segundos;
  const pintar = () => { el.textContent = `${quedan}s`; el.classList.toggle('urgente', quedan <= 10); };
  pintar();
  p.reloj = setInterval(() => {
    quedan--; pintar();
    if (quedan <= 0) { clearInterval(p.reloj); el.textContent = ''; alTerminar(); }
  }, 1000);
}
function detenerReloj() {
  if (estado.pvp?.reloj) clearInterval(estado.pvp.reloj);
  const el = $('#reloj'); if (el) el.textContent = '';
}

function botonMovimiento(m, n, yo, foe, b) {
  const c = TIPOS[m.type]?.color || '#888';
  const ef = m.category === 'status' ? null : m.type === 'typeless' ? 1 : efectividad(m.type, foe.types);
  const efTxt = ef == null ? '' : ef === 0 ? '<span class="ef x0">Sin efecto</span>' : ef > 1 ? `<span class="ef x2">×${ef}</span>` : ef < 1 ? `<span class="ef xm">×${ef}</span>` : '';
  const pot = poderNominal(m);
  let danio = '';
  if (m.category !== 'status' && m !== RECARGA) {
    const r = rangoDanio(yo, foe, m, b);
    if (r?.variable) danio = '<span class="dmg var">daño variable</span>';
    else if (r && r.eff !== 0) danio = `<span class="dmg ${r.ko ? 'ko' : r.posibleKo ? 'quiza' : ''}">${r.pctMin === r.pctMax ? `${r.pctMax}%` : `${r.pctMin}–${r.pctMax}%`}${r.ko ? ' · KO' : r.posibleKo ? ' · ¿KO?' : ''}</span>`;
  }
  const titulo = `${m.nombre}: ${TIPOS[m.type]?.es}, ${CATEGORIAS[m.category]?.es}${pot ? `, potencia ${pot}` : ''}${m.accuracy ? `, precisión ${m.accuracy}%` : ', no falla'}${m.priority ? `, prioridad ${m.priority > 0 ? '+' : ''}${m.priority}` : ''}. ${m.desc || ''}`;
  return `<button class="mov" data-mov="${m.idx}" style="--c:${c};--t:${colorTexto(c)}" ${m.ppLeft <= 0 ? 'disabled' : ''} title="${esc(titulo)}">
    <span class="mn">${esc(m.nombre)}</span>
    <span class="md"><span>${TIPOS[m.type]?.es}</span><span>${CATEGORIAS[m.category]?.icono} ${CATEGORIAS[m.category]?.es}</span>${pot ? `<span>Pot. ${pot}</span>` : ''}<span>${m.accuracy ? `${m.accuracy}%` : '—'}</span><span class="kbd">[${n + 1}]</span></span>
    <span class="pp">${m.idx < 0 ? '' : `${m.ppLeft}/${m.pp}`}</span>${efTxt}${danio}
  </button>`;
}

function mostrarMenu() {
  const b = estado.batalla;
  if (!b || b.terminada) return;
  const yo = activo(b, estado.miLado);
  const foe = activo(b, otro(estado.miLado));
  $('#lcdTexto').textContent = `¿Qué debería hacer ${yo.nombre}?`;
  $('#controles').classList.remove('forzar');
  $('.cambios-titulo').classList.remove('forzado');
  $('#cambiosTitulo').textContent = 'Cambiar de Pokémon';

  const forzada = accionForzada(b, estado.miLado);
  const sinPP = !yo.moves.some((m) => m.ppLeft > 0);
  let lista;
  if (forzada) {
    const mv = forzada.indice === -2 ? { ...RECARGA, nombre: 'Recuperarse', desc: 'Debe descansar tras el ataque anterior.' } : yo.moves[forzada.indice];
    lista = [{ ...mv, idx: forzada.indice }];
    $('#lcdTexto').textContent = forzada.motivo === 'recarga' ? `${yo.nombre} necesita recuperarse este turno.` : forzada.motivo === 'carga' ? `${yo.nombre} va a liberar ${mv.nombre}.` : `${yo.nombre} sigue atacando sin control.`;
  } else lista = sinPP ? [{ ...FORCEJEO, ppLeft: 1, idx: -1 }] : yo.moves.map((m, i) => ({ ...m, idx: i }));
  $('#movs').innerHTML = lista.map((m, n) => botonMovimiento(m, n, yo, foe, b)).join('');
  $('#movs').classList.toggle('uno', lista.length === 1);
  renderCambios(false);
  if (forzada) $$('#cambios .cambio').forEach((x) => { x.disabled = true; });
  bloquear(false);
  if (enPvp()) {
    estado.pvp.fase = 'menu';
    reloj(60, () => {
      const usable = forzada ? forzada.indice : yo.moves.findIndex((m) => m.ppLeft > 0);
      accionJugador({ tipo: 'mover', indice: usable });
    });
  }
}

function renderCambios(forzado) {
  const b = estado.batalla;
  const lado = b.lados[estado.miLado];
  $('#cambios').innerHTML = lado.equipo.map((p, i) => {
    const pct = Math.round((p.hp / p.maxHp) * 100);
    const act = i === lado.activo && p.hp > 0;
    const dis = p.hp <= 0 || act;
    return `<button class="cambio ${act ? 'activo' : ''} ${p.hp <= 0 ? 'caido' : ''}" data-cambio="${i}" ${dis ? 'disabled' : ''}
      title="${esc(`${p.nombre} · ${p.types.map((t) => TIPOS[t]?.es).join('/')} (${p.hp}/${p.maxHp} PS, Vel ${p.stats.speed})${p.status ? ', ' + ESTADOS[p.status].es : ''}. ${p.moves.map((m) => m.nombre).join(', ')}`)}">
      <img src="${p.sprites.icono}" alt="" onerror="this.onerror=null;this.src='${p.sprites.frenteFijo}'" />
      <span class="cn">${esc(p.nombre)}</span>
      <span class="ct">${p.types.map((t) => `<i style="--c:${TIPOS[t]?.color}" title="${TIPOS[t]?.es}">${TIPOS[t]?.es}</i>`).join('')}</span>
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
  if (enPvp()) {
    detenerReloj();
    const turno = b.turno + 1;
    (estado.pvp.acciones[turno] ||= {})[estado.miLado] = accion;
    estado.pvp.fase = 'esperando';
    $('#lcdTexto').textContent = `Esperando a que ${estado.rival} elija…`;
    estado.sala?.enviar('accion', { turno, accion });
    intentarResolverTurno(turno);
    return;
  }
  const accR = decidirAccion(b, 'rival');
  const ev = ejecutarTurno(b, accion, accR);
  await reproducir(ev);
  await despuesDelTurno();
}

/** En línea: cuando ya están las dos acciones del turno, los dos navegadores lo ejecutan igual. */
async function intentarResolverTurno(turno) {
  const b = estado.batalla; const p = estado.pvp;
  if (!b || b.terminada || !p || p.fase !== 'esperando' || b.turno !== turno - 1) return;
  const acc = p.acciones[turno];
  if (!acc?.player || !acc?.rival) return;
  p.fase = 'turno';
  const ev = ejecutarTurno(b, acc.player, acc.rival);
  await reproducir(ev);
  await despuesDelTurno();
}

async function despuesDelTurno() {
  const b = estado.batalla;
  if (b.terminada) return finalizar();

  if (enPvp()) {
    const necesitan = ['player', 'rival'].filter((s) => activo(b, s).hp <= 0);
    if (!necesitan.length) { mostrarMenu(); return; }
    const caidos = ['player', 'rival'].reduce((n, s) => n + b.lados[s].equipo.filter((m) => m.hp <= 0).length, 0);
    const clave = `r${b.turno}.${caidos}`;
    estado.pvp.fase = 'reemplazo';
    estado.pvp.claveReemplazo = clave;
    const elegidos = (estado.pvp.reemplazos[clave] ||= {});
    if (necesitan.includes(estado.miLado) && elegidos[estado.miLado] == null) {
      pedirReemplazo();
      reloj(30, () => elegirReemplazoEnLinea(opcionesCambio(b, estado.miLado)[0]));
    } else {
      bloquear(true);
      $('#lcdTexto').textContent = `Esperando a que ${estado.rival} elija su siguiente Pokémon…`;
    }
    intentarReemplazos();
    return;
  }

  let vueltas = 0;
  while (!b.terminada && activo(b, 'rival').hp <= 0 && vueltas++ < 6) {
    await reproducir(cambioForzado(b, 'rival', mejorReemplazo(b, 'rival')));
  }
  if (b.terminada) return finalizar();
  if (b.pendiente === 'player') { pedirReemplazo(); return; }
  mostrarMenu();
}

function pedirReemplazo() {
  $('#lcdTexto').textContent = '¿Qué Pokémon vas a enviar?';
  $('.cambios-titulo').classList.add('forzado');
  $('#cambiosTitulo').textContent = 'Elige a tu siguiente Pokémon';
  renderCambios(true);
  bloquear(false);
}

function elegirReemplazoEnLinea(indice) {
  const p = estado.pvp;
  const clave = p.claveReemplazo;
  if ((p.reemplazos[clave] ||= {})[estado.miLado] != null) return;
  detenerReloj();
  bloquear(true);
  p.reemplazos[clave][estado.miLado] = indice;
  estado.sala?.enviar('reemplazo', { clave, lado: estado.miLado, indice });
  $('#lcdTexto').textContent = `Esperando a ${estado.rival}…`;
  intentarReemplazos();
}

async function intentarReemplazos() {
  const b = estado.batalla; const p = estado.pvp;
  if (!b || b.terminada || !p || p.fase !== 'reemplazo') return;
  const clave = p.claveReemplazo;
  if (p.aplicados.has(clave)) return;
  const necesitan = ['player', 'rival'].filter((s) => activo(b, s).hp <= 0);
  const elegidos = p.reemplazos[clave] || {};
  if (!necesitan.every((s) => elegidos[s] != null)) return;
  p.aplicados.add(clave);
  p.fase = 'turno';
  const ev = [];
  for (const s of necesitan) ev.push(...cambioForzado(b, s, elegidos[s]));
  await reproducir(ev);
  despuesDelTurno();
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
  const forzado = $('#controles').classList.contains('forzar');
  if (enPvp() && forzado) { sfx.click(); elegirReemplazoEnLinea(i); return; }
  if (!enPvp() && b.pendiente === 'player') {
    sfx.click(); bloquear(true);
    await reproducir(cambioForzado(b, 'player', i));
    despuesDelTurno();
    return;
  }
  accionJugador({ tipo: 'cambiar', indice: i });
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
  fx.vel = estado.vel;
});

function rendirse(sinPreguntar = false) {
  const b = estado.batalla;
  if (!b || b.terminada) return;
  if (!sinPreguntar && !confirm('¿Seguro que quieres rendirte? Contará como derrota.')) return;
  if (enPvp()) estado.sala?.enviar('rendicion');
  b.terminada = true; b.ganador = otro(estado.miLado); b.motivo = 'rendicion';
  finalizar();
}
$('#btnRendirse').addEventListener('click', () => rendirse());

// ---------- Fin de la batalla ----------
async function finalizar() {
  const b = estado.batalla;
  if (b.finalizada) return;
  b.finalizada = true;
  bloquear(true);
  detenerReloj();
  const mio = estado.miLado; const suyo = otro(mio);
  const gano = b.ganador === mio;
  const equipo = b.lados[mio].equipo;
  const mvp = [...equipo].sort((a, z) => z.kos - a.kos || z.danioHecho - a.danioHecho)[0];
  const restantes = vivos(b, mio).length;
  const kos = equipo.reduce((s, p) => s + p.kos, 0);
  const g = genPorId(b.generacion);
  const motivo = b.motivo === 'abandono' ? (gano ? `${estado.rival} abandonó la partida.` : 'Abandonaste la partida.')
    : b.motivo === 'rendicion' ? (gano ? `${estado.rival} se rindió.` : 'Te rendiste.') : '';
  $('#lcdTexto').textContent = motivo || (gano ? `¡Derrotaste a ${estado.rival}!` : `${estado.rival} ganó la batalla.`);
  (gano ? sfx.victoria : sfx.derrota)();
  if (gano) fx.confeti();

  $('#resultadoContenido').innerHTML = `
    <h2 id="t-res" class="res-titulo ${gano ? 'victoria' : 'derrota'}">${gano ? '¡Victoria!' : 'Derrota'}</h2>
    <p class="res-sub">${motivo ? `${esc(motivo)} ` : ''}${gano ? `Venciste a ${esc(estado.rival)}` : `${esc(estado.rival)} se llevó esta`} en ${etiquetaGen(g)}${enPvp() ? ' (en línea)' : ''}.</p>
    <div class="res-mvp">
      <img src="${mvp.sprites.frente}" alt="" onerror="this.onerror=null;this.src='${mvp.sprites.frenteFijo}'" />
      <p><small>Tu Pokémon más valioso</small><strong>${esc(mvp.nombre)}</strong><small>${mvp.kos} KO, ${mvp.danioHecho} de daño causado</small></p>
    </div>
    <dl class="res-datos">
      <div><dt>Turnos</dt><dd>${b.turno}</dd></div>
      <div><dt>Rivales noqueados</dt><dd>${kos}/${b.lados[suyo].equipo.length}</dd></div>
      <div><dt>Te quedaron</dt><dd>${restantes}/${equipo.length}</dd></div>
    </dl>
    <p class="res-guardado" id="resGuardado">Guardando resultado…</p>`;
  setTimeout(() => $('#modalResultado').showModal(), 700);

  const r = await db.guardarPartida({
    rival_nombre: estado.rival,
    generacion: etiquetaCorta(g),
    resultado: gano ? 'victoria' : 'derrota',
    turnos: b.turno,
    restantes,
    tamano: equipo.length,
    mvp_id: mvp.id,
    mvp_nombre: mvp.nombre,
    equipo: equipo.map((p) => p.nombre),
    rival: b.lados[suyo].equipo.map((p) => p.nombre),
    modo: enPvp() ? 'pvp' : 'cpu',
  }).catch((e) => ({ ok: false, error: e.message }));
  const guardado = $('#resGuardado');
  if (guardado) guardado.textContent = r.ok ? (r.remoto ? `Resultado guardado en el ranking global a nombre de ${estado.usuario}.` : 'Resultado guardado en este navegador (modo local).') : `No se pudo guardar: ${r.error}`;
  if (enPvp()) setTimeout(cerrarSala, 3000);
  cargarTablero();
  actualizarRecord();
}

$('#btnRevancha').addEventListener('click', () => {
  $('#modalResultado').close();
  if (estado.modoBatalla === 'pvp') { cerrarSala(); buscarPartidaEnLinea(); } else buscarPartida();
});
$('#btnMenu').addEventListener('click', () => { $('#modalResultado').close(); cerrarSala(); mostrar('inicio'); });

// ============================================================
//  MI EQUIPO (modo personalizado)
// ============================================================
const ed = { especies: null, slot: 0, movs: [], cargaId: 0, mon: null };
const equipoValidos = () => estado.miEquipo.filter((x) => x && x.id && x.moves?.length);
const normalizar = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const nombreClave = (k) => k.split('-').map((p) => p[0]?.toUpperCase() + p.slice(1)).join(' ');

function resumenEquipo() {
  const n = equipoValidos().length;
  actualizarCTA();
  $('#miEquipoTxt').textContent = n ? `${n} Pokémon listo${n === 1 ? '' : 's'}` : 'Tú eliges Pokémon y ataques';
}

async function abrirEditor() {
  sfx.confirmar();
  mostrar('equipo');
  while (estado.miEquipo.length < 6) estado.miEquipo.push(null);
  const sel = $('#eqTipoMov');
  if (sel.options.length < 3) sel.insertAdjacentHTML('beforeend', Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v.es}</option>`).join(''));
  await renderSlots();
  const vacio = estado.miEquipo.findIndex((x) => !x);
  seleccionarSlot(vacio === -1 ? 0 : vacio);
  ed.especies ||= await listaEspecies();
}

async function renderSlots() {
  const html = await Promise.all(estado.miEquipo.map(async (x, i) => {
    const clase = `eq-slot${i === ed.slot ? ' activo' : ''}${i >= 3 ? ' reserva' : ''}`;
    if (!x) return `<li class="${clase}"><button type="button" data-slot="${i}"><span class="vacio">Agregar</span></button></li>`;
    const mon = await cargarPokemon(x.id).catch(() => null);
    if (!mon) return `<li class="${clase}"><button type="button" data-slot="${i}"><span class="vacio">#${x.id}</span></button></li>`;
    const movs = await Promise.all(x.moves.map((n) => cargarMovimiento(n).catch(() => null)));
    const chips = movs.filter(Boolean).map((m) => `<span style="--c:${TIPOS[m.type]?.color}">${esc(m.nombre)}</span>`).join('');
    return `<li class="${clase}"><button type="button" data-slot="${i}" aria-label="${esc(mon.nombre)}, lugar ${i + 1}">
      <img src="${mon.sprites.frenteFijo}" alt="" loading="lazy" />
      <span class="n">${esc(mon.nombre)}</span>
      <span class="tipos">${mon.types.map(badgeTipo).join('')}</span>
      <span class="mvs">${chips || '<span class="falta">Sin movimientos</span>'}</span>
    </button></li>`;
  }));
  $('#eqSlots').innerHTML = html.join('');
}

function seleccionarSlot(i) {
  ed.slot = i;
  $$('#eqSlots .eq-slot').forEach((li, k) => li.classList.toggle('activo', k === i));
  $('#eqEditor').hidden = false;
  $('#eqNumSlot').textContent = i + 1;
  $('#eqBuscar').value = '';
  $('#eqSug').innerHTML = '';
  const x = estado.miEquipo[i];
  if (x?.id) cargarFicha(x.id, false);
  else { ed.mon = null; ed.movs = []; $('#eqFicha').innerHTML = ''; $('#eqLista').innerHTML = ''; $('#eqCarga').textContent = 'Primero elige un Pokémon.'; pintarElegidos(); $('#eqBuscar').focus(); }
}

function sugerencias(q) {
  const lista = ed.especies || [];
  const n = normalizar(q);
  if (!n) return [];
  const num = Number(q.trim().replace('#', ''));
  const res = [];
  if (num >= 1 && num <= 1025) { const e = lista.find((x) => x.id === num); if (e) res.push(e); }
  for (const e of lista) {
    if (res.length >= 24) break;
    if (e.id === num) continue;
    if (normalizar(e.clave).includes(n)) res.push(e);
  }
  return res.sort((a, b) => (normalizar(b.clave).startsWith(n) - normalizar(a.clave).startsWith(n)) || a.id - b.id);
}

function pintarSugerencias() {
  const res = sugerencias($('#eqBuscar').value);
  $('#eqSug').innerHTML = res.map((e) => `<li><button type="button" data-especie="${e.id}">
    <img src="${sprites(e.id).icono}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
    <span>${esc(nombreClave(e.clave))}</span><span class="num">#${e.id}</span></button></li>`).join('');
}

async function cargarFicha(id, nuevo) {
  const mio = ++ed.cargaId;
  $('#eqFicha').innerHTML = '<p class="eq-carga">Cargando Pokémon…</p>';
  $('#eqLista').innerHTML = '';
  let mon;
  try { mon = await cargarPokemon(id); } catch { $('#eqFicha').innerHTML = '<p class="eq-carga">No se pudo cargar. Revisa tu conexión.</p>'; return; }
  if (mio !== ed.cargaId) return;
  ed.mon = mon;
  const nivel = nivelPara(mon.total);
  const st = calcularStats(mon.base, nivel);
  const [vMin, vMax] = rangoVelocidad({ base: mon.base, level: nivel, boosts: {} });
  const maxBase = 200;
  $('#eqFicha').innerHTML = `
    <img class="arte" src="${mon.sprites.arte}" alt="${esc(mon.nombre)}" />
    <div><h4>${esc(mon.nombre)} <small class="cat">#${mon.id}${mon.categoria ? ` · ${esc(mon.categoria)}` : ''}</small></h4>
    <div class="tipos">${mon.types.map(badgeTipo).join('')}</div></div>
    <div class="bases">${Object.entries(mon.base).map(([k, v]) => `<span>${STATS_ES[k]}</span><b>${v}</b><i style="width:${Math.min(100, (v / maxBase) * 100)}%;--c:${v >= 110 ? '#52d273' : v >= 70 ? '#ffcf33' : '#ff8a5c'}"></i>`).join('')}</div>
    <p class="extra">Peleará a nivel ${nivel}. PS ${st.hp} · Velocidad ${st.speed} (otros entrenadores la verán como ${vMin}–${vMax}).</p>
    <button type="button" class="btn-texto" id="eqQuitar">Quitar del equipo</button>`;
  if (nuevo) {
    estado.miEquipo[ed.slot] = { id, moves: [] };
    grito(mon.grito, { volumen: 0.25 });
  }
  $('#eqCarga').textContent = `Cargando movimientos (0 de ${mon.movimientos.length})…`;
  ed.movs = [];
  pintarElegidos();
  const lista = await movimientosDe(mon, ({ hechos, total, lista: parcial }) => {
    if (mio !== ed.cargaId) return;
    $('#eqCarga').textContent = hechos < total ? `Cargando movimientos (${hechos} de ${total})…` : '';
    ed.movs = parcial; pintarListaMovs();
  });
  if (mio !== ed.cargaId) return;
  ed.movs = lista;
  const x = estado.miEquipo[ed.slot];
  if (x && !x.moves.length) { // propone 4 movimientos competitivos para empezar
    const sugeridos = await elegirMovimientos(mon);
    x.moves = sugeridos.map((m) => m.name).filter((n) => lista.some((m) => m.name === n)).slice(0, 4);
    renderSlots();
  }
  $('#eqCarga').textContent = `${lista.length} movimientos disponibles.`;
  pintarElegidos(); pintarListaMovs();
}

function pintarElegidos() {
  const x = estado.miEquipo[ed.slot];
  const elegidos = (x?.moves || []).map((n) => ed.movs.find((m) => m.name === n)).filter(Boolean);
  $('#eqCuenta').textContent = `${elegidos.length}/4`;
  const huecos = Array.from({ length: 4 - elegidos.length }, () => '<span class="hueco">Libre</span>');
  $('#eqElegidos').innerHTML = elegidos.map((m) => {
    const c = TIPOS[m.type]?.color || '#888';
    const pot = poderNominal(m);
    return `<button type="button" data-quitar="${m.name}" style="--c:${c};--t:${colorTexto(c)}" title="Quitar ${esc(m.nombre)}"><b>${esc(m.nombre)}</b>${TIPOS[m.type]?.es} · ${pot ? `Pot. ${pot}` : CATEGORIAS[m.category].es}</button>`;
  }).join('') + huecos.join('');
}

function pintarListaMovs() {
  const x = estado.miEquipo[ed.slot];
  const q = normalizar($('#eqFiltroMov').value);
  const tipo = $('#eqTipoMov').value; const cat = $('#eqCatMov').value;
  const mon = ed.mon;
  const filtrados = ed.movs.filter((m) => (!q || normalizar(m.nombre).includes(q) || normalizar(m.name).includes(q)) && (!tipo || m.type === tipo) && (!cat || m.category === cat));
  const valor = (m) => (m.category === 'status' ? -1 : (typeof poderNominal(m) === 'number' ? poderNominal(m) : 70) * (mon?.types.includes(m.type) ? 1.5 : 1));
  filtrados.sort((a, b) => valor(b) - valor(a) || a.nombre.localeCompare(b.nombre));
  $('#eqLista').innerHTML = filtrados.map((m) => {
    const sel = x?.moves.includes(m.name);
    const pot = poderNominal(m);
    const stab = mon?.types.includes(m.type) && m.category !== 'status';
    return `<button type="button" class="eq-mov" role="option" aria-selected="${sel}" data-mov-ed="${m.name}" style="--c:${TIPOS[m.type]?.color}" title="${esc(m.desc || '')}">
      <span class="mn">${sel ? '<span class="ok">✓</span> ' : ''}${esc(m.nombre)}${stab ? ' <span class="stab">STAB</span>' : ''}<small>${esc(m.desc || '')}</small></span>
      <span class="tipo" style="--c:${TIPOS[m.type]?.color}">${TIPOS[m.type]?.es}</span>
      <span class="cat-c">${CATEGORIAS[m.category]?.icono} ${CATEGORIAS[m.category]?.es}</span>
      <span class="num">${pot ?? '—'}<small>Potencia</small></span>
      <span class="num">${m.accuracy ?? '—'}<small>Precisión</small></span>
      <span class="num pp-c">${m.pp}<small>PP</small></span>
    </button>`;
  }).join('') || (ed.mon ? '<p class="eq-carga">Ningún movimiento coincide con el filtro.</p>' : '');
}

function alternarMovimiento(nombre) {
  const x = estado.miEquipo[ed.slot];
  if (!x) return;
  const i = x.moves.indexOf(nombre);
  if (i >= 0) { x.moves.splice(i, 1); sfx.cancelar(); } else if (x.moves.length >= 4) { toast('Ya tiene 4 movimientos. Quita uno de arriba para cambiarlo.', 2600); sfx.fallo(); return; } else { x.moves.push(nombre); sfx.seleccion(); }
  pintarElegidos(); pintarListaMovs(); renderSlots();
}

$('#btnEditarEquipo').addEventListener('click', abrirEditor);
$('#eqSlots').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b) { sfx.click(); seleccionarSlot(Number(b.dataset.slot)); renderSlots(); } });
$('#eqBuscar').addEventListener('input', pintarSugerencias);
$('#eqBuscar').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#eqSug button')?.click(); } });
$('#eqSug').addEventListener('click', (e) => {
  const b = e.target.closest('[data-especie]'); if (!b) return;
  const id = Number(b.dataset.especie);
  if (estado.miEquipo.some((x, k) => x?.id === id && k !== ed.slot)) { toast('Ese Pokémon ya está en tu equipo.', 2400); return; }
  sfx.confirmar();
  $('#eqSug').innerHTML = ''; $('#eqBuscar').value = '';
  cargarFicha(id, true).then(renderSlots);
});
$('#eqFicha').addEventListener('click', (e) => {
  if (e.target.id !== 'eqQuitar') return;
  estado.miEquipo[ed.slot] = null; sfx.cancelar();
  renderSlots(); seleccionarSlot(ed.slot);
});
$('#eqLista').addEventListener('click', (e) => { const b = e.target.closest('[data-mov-ed]'); if (b) alternarMovimiento(b.dataset.movEd); });
$('#eqElegidos').addEventListener('click', (e) => { const b = e.target.closest('[data-quitar]'); if (b) alternarMovimiento(b.dataset.quitar); });
['eqFiltroMov', 'eqTipoMov', 'eqCatMov'].forEach((id) => $(`#${id}`).addEventListener('input', pintarListaMovs));
$('#eqMovAzar').addEventListener('click', async () => {
  const x = estado.miEquipo[ed.slot]; if (!x || !ed.mon) return;
  const m = await elegirMovimientos({ ...ed.mon, movimientos: ed.movs.map((k) => k.name) });
  x.moves = m.map((k) => k.name).slice(0, 4); sfx.confirmar();
  pintarElegidos(); pintarListaMovs(); renderSlots();
});
$('#eqAzar').addEventListener('click', async () => {
  const faltan = estado.miEquipo.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  if (!faltan.length) { toast('El equipo ya está completo.', 2000); return; }
  $('#eqAzar').disabled = true; $('#eqCarga').textContent = 'Eligiendo Pokémon al azar…';
  try {
    const excluir = new Set(estado.miEquipo.filter(Boolean).map((x) => x.id));
    const nuevos = await armarEquipo(genActual().id, faltan.length, () => {}, excluir);
    nuevos.forEach((b, k) => { estado.miEquipo[faltan[k]] = { id: b.id, moves: b.moves.map((m) => m.name) }; });
    sfx.confirmar();
  } catch (e) { toast(e.message, 4000); }
  $('#eqAzar').disabled = false;
  await renderSlots(); seleccionarSlot(ed.slot);
});
$('#eqVaciar').addEventListener('click', () => {
  if (!confirm('¿Quitar todos los Pokémon del equipo?')) return;
  estado.miEquipo = Array(6).fill(null); renderSlots(); seleccionarSlot(0);
});
$('#eqListo').addEventListener('click', async () => {
  const limpio = estado.miEquipo.filter((x) => x?.id);
  for (const x of limpio) if (!x.moves.length) { toast('Cada Pokémon necesita al menos un movimiento.', 3000); return; }
  const r = await db.guardarEquipo(limpio);
  estado.miEquipo = limpio;
  resumenEquipo();
  toast(r.ok ? (r.remoto ? 'Equipo guardado en tu cuenta.' : 'Equipo guardado en este navegador.') : `Se guardó aquí, pero no en la nube: ${r.error}`, 2800);
  if (limpio.length) { estado.equipoModo = 'mio'; localStorage.setItem('gc:equipoModo', 'mio'); $$('input[name=equipo]').forEach((r2) => { r2.checked = r2.value === 'mio'; }); }
  actualizarCTA();
  sfx.confirmar();
  mostrar('inicio');
});
$$('input[name=equipo]').forEach((r) => r.addEventListener('change', () => {
  estado.equipoModo = r.value; localStorage.setItem('gc:equipoModo', r.value); sfx.click(); actualizarCTA();
  if (r.value === 'mio' && !equipoValidos().length) abrirEditor();
}));

/** Mi equipo para esta partida: el personalizado (si lo elegí) o uno al azar de la generación. */
function usarMiEquipo() { return estado.equipoModo === 'mio' && equipoValidos().length >= estado.tamano; }
function armarMiEquipo(g, tam, progreso) {
  if (usarMiEquipo()) return armarEquipoPersonalizado(equipoValidos().slice(0, tam), progreso);
  return armarEquipo(g.id, tam, progreso);
}
/** Revisa antes de buscar partida que el equipo personalizado alcance. */
function equipoListoParaJugar() {
  if (estado.equipoModo !== 'mio') return true;
  const n = equipoValidos().length;
  if (n >= estado.tamano) return true;
  toast(`Tu equipo tiene ${n} Pokémon y para ${estado.tamano} vs ${estado.tamano} necesitas ${estado.tamano}. Complétalo o juega 3 vs 3.`, 5000);
  abrirEditor();
  return false;
}

// ============================================================
//  ARRANQUE
// ============================================================
async function arrancar() {
  $$('input[name=tamano]').forEach((r) => { r.checked = Number(r.value) === estado.tamano; });
  $$('input[name=modo]').forEach((r) => { r.checked = r.value === estado.modo; });
  $$('input[name=equipo]').forEach((r) => { r.checked = r.value === estado.equipoModo; });
  $('#btnVelocidad').textContent = `${estado.vel}×`;
  document.documentElement.style.setProperty('--vel', estado.vel);
  const pintarSonido = () => {
    const m = modoSonido();
    const bt = $('#btnSonido');
    bt.classList.toggle('mute', m === 'silencio');
    bt.classList.toggle('sin-musica', m === 'efectos');
    bt.title = m === 'todo' ? 'Música y efectos' : m === 'efectos' ? 'Solo efectos (sin música)' : 'Sin sonido';
  };
  pintarSonido();
  $('#btnSonido').addEventListener('click', () => {
    const m = alternarSonido(); pintarSonido(); sfx.click();
    toast(m === 'todo' ? 'Música y efectos activados' : m === 'efectos' ? 'Música apagada, efectos activos' : 'Sonido apagado', 1800);
    if (m === 'todo') musicaDe($('#pantalla-batalla').classList.contains('activa') ? 'batalla' : 'inicio');
  });
  // Sonidos de interfaz: pasar el cursor y tocar botones
  let ultimoHover = 0;
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.mov:not(:disabled), .cartucho, .btn-primario, .btn-secundario, .cambio:not(:disabled), .pv-lista button');
    if (!b || e.pointerType !== 'mouse' || b.contains(e.relatedTarget)) return;
    const t = performance.now(); if (t - ultimoHover > 60) { ultimoHover = t; sfx.hover(); }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn-primario')) sfx.confirmar();
    else if (e.target.closest('.btn-secundario, .btn-mini, .btn-icono:not(#btnSonido), .login-tabs button')) sfx.seleccion();
  }, true);
  $$('[data-ir=inicio]').forEach((bt) => bt.addEventListener('click', () => {
    if (!estado.usuario) { mostrarLogin(); return; }
    const b = estado.batalla;
    if ($('#pantalla-batalla').classList.contains('activa') && b && !b.terminada) {
      if (!confirm('Si sales ahora, la batalla cuenta como derrota. ¿Salir?')) return;
      rendirse(true);
      $('#modalResultado').close();
    }
    estado.busqueda++;
    estado.cancelarBusqueda?.();
    cerrarSala();
    mostrar('inicio');
  }));
  renderEstante();
  prepararQR();
  precargarHojas();
  db.escucharPartidas((p) => {
    const ul = $('#recientes');
    ul.querySelector('.vacio')?.remove();
    ul.insertAdjacentHTML('afterbegin', itemReciente(p, true));
    while (ul.children.length > 8) ul.lastElementChild.remove();
    if (p.jugador !== estado.usuario && p.resultado === 'victoria') toast(`${p.jugador} acaba de ganar ${p.modo === 'pvp' ? 'un duelo en línea' : 'una batalla'} en ${p.generacion}.`);
    cargarTablero();
  });
  // ¿Hay sesión guardada?
  const s = await db.verificarSesion();
  if (s) entrarAlJuego(s.usuario); else mostrarLogin();
}
window.addEventListener('beforeunload', () => {
  const b = estado.batalla;
  if (enPvp() && b && !b.terminada) estado.sala?.enviar('rendicion');
});
arrancar();
