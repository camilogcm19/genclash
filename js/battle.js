// ============================================================
//  GenClash · Motor de batalla
//  Es lógica pura: no toca el DOM. Cada acción devuelve una lista
//  de "eventos" que la interfaz anima en orden.
// ============================================================
import { efectividad, TIPOS, ESTADOS, STATS_ES } from './data.js';

export const FORCEJEO = {
  name: 'struggle', nombre: 'Forcejeo', type: 'typeless', power: 50, accuracy: null, pp: 1, priority: 0,
  category: 'physical', target: 'selected-pokemon', statChanges: [],
  meta: { category: 'damage', ailment: 'none', ailmentChance: 0, drain: 0, healing: 0, critRate: 0, flinchChance: 0, minHits: null, maxHits: null, statChance: 0 },
  desc: 'Solo se usa cuando no quedan PP. También daña al usuario.',
};

const OBJETIVO_PROPIO = new Set(['user', 'users-field', 'user-and-allies', 'all-allies', 'user-or-ally', 'ally']);
const POLVOS = new Set(['sleep-powder', 'stun-spore', 'poison-powder', 'spore', 'cotton-spore', 'rage-powder']);
const ESTADOS_MAYORES = new Set(['burn', 'paralysis', 'poison', 'toxic', 'sleep', 'freeze']);

/** Pseudo-movimiento del turno de recarga (Hiperrayo y similares). */
export const RECARGA = { name: 'recharge', nombre: 'Recarga', type: 'normal', power: null, accuracy: null, pp: 1, priority: 0, category: 'status', target: 'user', statChanges: [], meta: { category: 'unique' }, desc: '' };

/** Movimientos que necesitan un turno de recarga después de golpear. */
export const MOVS_RECARGA = new Set(['hyper-beam', 'giga-impact', 'blast-burn', 'hydro-cannon', 'frenzy-plant', 'rock-wrecker', 'roar-of-time', 'prismatic-laser', 'eternabeam', 'meteor-assault']);

/** Movimientos de dos turnos: el primero se carga (y a veces se esconde). */
export const MOVS_CARGA = {
  'solar-beam': { txt: 'absorbió luz solar', sinCargaCon: 'sun' },
  'solar-blade': { txt: 'absorbió luz solar', sinCargaCon: 'sun' },
  'sky-attack': { txt: 'está rodeado de una luz intensa' },
  'skull-bash': { txt: 'agachó la cabeza', stat: ['defense', 1] },
  'razor-wind': { txt: 'provocó un remolino' },
  'meteor-beam': { txt: 'está acumulando energía cósmica', stat: ['special-attack', 1] },
  'electro-shot': { txt: 'está acumulando electricidad', stat: ['special-attack', 1], sinCargaCon: 'rain' },
  'freeze-shock': { txt: 'se rodeó de un aire gélido' },
  'ice-burn': { txt: 'se rodeó de un aire gélido' },
  'fly': { txt: 'voló muy alto', inv: 'aire' },
  'bounce': { txt: 'dio un gran salto', inv: 'aire' },
  'dig': { txt: 'se ocultó bajo tierra', inv: 'tierra' },
  'dive': { txt: 'se sumergió', inv: 'agua' },
  'phantom-force': { txt: 'desapareció de repente', inv: 'sombra' },
  'shadow-force': { txt: 'desapareció de repente', inv: 'sombra' },
};
/** Qué movimientos alcanzan a un Pokémon escondido. */
const ALCANZA = {
  aire: new Set(['thunder', 'hurricane', 'gust', 'twister', 'sky-uppercut', 'smack-down', 'thousand-arrows']),
  tierra: new Set(['earthquake', 'magnitude', 'fissure']),
  agua: new Set(['surf', 'whirlpool']),
  sombra: new Set(),
};
/** Movimientos que bloquean al usuario 2-3 turnos y luego lo confunden. */
const MOVS_FURIA = new Set(['outrage', 'thrash', 'petal-dance', 'raging-fury']);
const MOVS_AUTODESTRUCCION = new Set(['self-destruct', 'explosion', 'misty-explosion', 'final-gambit']);
const MOVS_MEDIA_VIDA = new Set(['steel-beam', 'mind-blown', 'chloroblast']);
const MOVS_PROTECCION = new Set(['protect', 'detect', 'kings-shield', 'spiky-shield', 'baneful-bunker', 'silk-trap', 'obstruct', 'burning-bulwark', 'max-guard']);
const MOVS_FUTURO = new Set(['future-sight', 'doom-desire']);
const LIMPIAN_TRAMPAS = new Set(['rapid-spin', 'mortal-spin', 'defog', 'tidy-up']);
const CLIMAS = { 'rain-dance': 'rain', 'sunny-day': 'sun', sandstorm: 'sand', hail: 'snow', snowscape: 'snow', 'chilly-reception': 'snow' };
export const CLIMA_ES = {
  rain: { nombre: 'Lluvia', inicio: '¡Empezó a llover!', fin: 'Dejó de llover.', icono: '🌧️' },
  sun: { nombre: 'Sol intenso', inicio: '¡El sol empezó a brillar con fuerza!', fin: 'El sol volvió a la normalidad.', icono: '☀️' },
  sand: { nombre: 'Tormenta de arena', inicio: '¡Se desató una tormenta de arena!', fin: 'La tormenta de arena amainó.', icono: '🏜️' },
  snow: { nombre: 'Nieve', inicio: '¡Empezó a nevar!', fin: 'Dejó de nevar.', icono: '❄️' },
};
const PANTALLAS = {
  reflect: { nombre: 'Reflejo', txt: 'los ataques físicos' },
  'light-screen': { nombre: 'Pantalla de Luz', txt: 'los ataques especiales' },
  'aurora-veil': { nombre: 'Velo Aurora', txt: 'todos los ataques' },
};
/** Movimientos de estado con efectos propios que el motor sí modela. */
export const ESTADO_ESPECIALES = new Set([
  ...MOVS_PROTECCION, ...Object.keys(CLIMAS), ...Object.keys(PANTALLAS),
  'stealth-rock', 'spikes', 'toxic-spikes', 'leech-seed', 'taunt', 'haze', 'rest', 'belly-drum', 'pain-split',
  'heal-bell', 'aromatherapy', 'refresh', 'focus-energy', 'curse', 'memento', 'defog', 'tidy-up', 'healing-wish', 'lunar-dance',
]);
/** Daño o poder que depende de la situación: no se puede mostrar con un número fijo. */
export const SIN_RANGO = new Set(['counter', 'mirror-coat', 'metal-burst', 'comeuppance', 'endeavor', 'final-gambit', 'present', 'magnitude', 'psywave']);

const boostsVacios = () => ({ attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0, accuracy: 0, evasion: 0 });
const volatiles = () => ({
  confusion: 0, flinch: false, recarga: false, cargando: null, invulnerable: null, furia: null,
  protegido: false, protecciones: 0, drenadoras: false, maldito: false, mofa: 0, critBonus: 0,
  recibido: null, yaMovio: false,
});

/** ¿El motor sabe aplicar este movimiento de estado? (los demás no se ofrecen) */
export function estadoSoportado(move) {
  if (move.category !== 'status') return true;
  if (ESTADO_ESPECIALES.has(move.name)) return true;
  const c = move.meta?.category;
  if (c === 'heal') return true;
  if (c === 'ailment') return ESTADOS_MAYORES.has(move.meta.ailment) || move.meta.ailment === 'confusion' || move.name === 'toxic';
  if (c === 'swagger') return true;
  if (c === 'net-good-stats') return (move.statChanges || []).some((x) => x.stat in boostsVacios());
  return false;
}

/** Multiplicador de una etapa de stat (-6..+6). */
export const multEtapa = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));

/** Crea una instancia de batalla a partir de un "build" (ver api.js). */
export function prepararPokemon(build, side) {
  return {
    ...build,
    side,
    hp: build.stats.hp,
    maxHp: build.stats.hp,
    boosts: boostsVacios(),
    status: null, sleepTurns: 0, toxicN: 0, ...volatiles(), turnoEntrada: 0,
    moves: build.moves.map((m) => ({ ...m, ppLeft: m.pp })),
    kos: 0, danioHecho: 0, vecesUsado: 0,
  };
}

export function crearBatalla({ equipoJugador, equipoRival, nombreJugador, nombreRival, generacion, rng = Math.random }) {
  return {
    rng,
    generacion,
    turno: 0,
    terminada: false,
    ganador: null,
    pendiente: null, // 'player' cuando el jugador debe elegir reemplazo
    clima: null, // { tipo: 'rain'|'sun'|'sand'|'snow', turnos }
    lados: {
      player: { nombre: nombreJugador, equipo: equipoJugador.map((b) => prepararPokemon(b, 'player')), activo: 0, ultimoCambio: -9, ...campoLado() },
      rival:  { nombre: nombreRival,  equipo: equipoRival.map((b) => prepararPokemon(b, 'rival')),   activo: 0, ultimoCambio: -9, ...campoLado() },
    },
  };
}

const campoLado = () => ({ pantallas: { reflect: 0, 'light-screen': 0, 'aurora-veil': 0 }, trampas: { rocas: false, puas: 0, toxicas: 0 }, futuro: null });

/** Contexto de campo que modifica el daño (clima y pantallas del defensor). */
export function campoDe(b, def) {
  if (!b) return {};
  return { clima: b.clima?.tipo ?? null, pantallas: b.lados[def.side]?.pantallas ?? {} };
}

/** Si el Pokémon está obligado a repetir (carga, recarga, furia), devuelve esa acción. */
export function accionForzada(b, side) {
  const m = activo(b, side);
  if (!m || m.hp <= 0) return null;
  if (m.recarga) return { tipo: 'mover', indice: -2, motivo: 'recarga' };
  if (m.cargando) return { tipo: 'mover', indice: m.cargando.indice, motivo: 'carga' };
  if (m.furia) return { tipo: 'mover', indice: m.furia.indice, motivo: 'furia' };
  return null;
}

export const otro = (side) => (side === 'player' ? 'rival' : 'player');
export const activo = (b, side) => b.lados[side].equipo[b.lados[side].activo];
export const vivos = (b, side) => b.lados[side].equipo.filter((p) => p.hp > 0);
export const opcionesCambio = (b, side) =>
  b.lados[side].equipo.map((p, i) => ({ p, i })).filter(({ p, i }) => p.hp > 0 && i !== b.lados[side].activo).map(({ i }) => i);

// ------------------------------------------------------------------
//  Mensajes con perspectiva
//  El motor escribe "fichas" como ⟦N|player|Pikachu|1⟧ y la interfaz las
//  convierte según quién mira: "Pikachu" o "El Pikachu rival".
//  Así el mismo registro sirve para los dos jugadores de una partida en línea.
// ------------------------------------------------------------------
const F = (...partes) => `⟦${partes.join('|')}⟧`;
/** "Pikachu" / "El Pikachu rival" */
export const N = (mon, mayus = true) => F('N', mon.side, mon.nombre, mayus ? 1 : 0);
/** "de Pikachu" / "del Pikachu rival" */
const DE = (mon) => F('DE', mon.side, mon.nombre);
/** "a Pikachu" / "al Pikachu rival" */
const A = (mon) => F('A', mon.side, mon.nombre);
/** "tu equipo" / "el equipo rival" */
const EQ = (side) => F('EQ', side, '');
const DEQ = (side) => F('DEQ', side, '');
const AEQ = (side) => F('AEQ', side, '');

/** Convierte las fichas de un mensaje al punto de vista de `yo` ('player' o 'rival'). */
export function fmt(texto, yo = 'player') {
  return String(texto).replace(/⟦([^⟧]+)⟧/g, (_, cuerpo) => {
    const [tipo, side, nombre, extra] = cuerpo.split('|');
    const mio = side === yo;
    switch (tipo) {
      case 'N': return mio ? nombre : `${extra === '1' ? 'El' : 'el'} ${nombre} rival`;
      case 'DE': return mio ? `de ${nombre}` : `del ${nombre} rival`;
      case 'A': return mio ? `a ${nombre}` : `al ${nombre} rival`;
      case 'EQ': return mio ? `tu equipo` : `el equipo rival`;
      case 'DEQ': return mio ? `de tu equipo` : `del equipo rival`;
      case 'AEQ': return mio ? `a tu equipo` : `al equipo rival`;
      case 'VUELVE': return mio ? `¡${nombre}, vuelve!` : `${extra} retiró a ${nombre}.`;
      case 'ENVIA': return mio ? `¡Adelante, ${nombre}!` : `¡${extra} envió a ${nombre}!`;
      default: return nombre ?? '';
    }
  });
}

/** Generador aleatorio con semilla (mulberry32): los dos jugadores obtienen los mismos números. */
export function rngConSemilla(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function velocidad(mon) {
  let v = mon.stats.speed * multEtapa(mon.boosts.speed);
  if (mon.status === 'paralysis') v *= 0.5;
  return v;
}

// ------------------------------------------------------------
//  Poder variable: movimientos cuya potencia depende de la situación
// ------------------------------------------------------------
const porPeso = (kg) => (kg < 10 ? 20 : kg < 25 ? 40 : kg < 50 ? 60 : kg < 100 ? 80 : kg < 200 ? 100 : 120);
const porRelacionPeso = (r) => (r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40);
const porVidaPropia = (f) => (f <= 0.0417 ? 200 : f <= 0.104 ? 150 : f <= 0.208 ? 100 : f <= 0.354 ? 80 : f <= 0.687 ? 40 : 20);
const subidas = (m) => Object.values(m.boosts).filter((v) => v > 0).reduce((a, v) => a + v, 0);

/** Daño fijo (no usa la fórmula): Movimiento Sísmico, Tinieblas, Superdiente… */
export function danioFijo(move, att, def) {
  switch (move.name) {
    case 'seismic-toss': case 'night-shade': return att.level;
    case 'dragon-rage': return 40;
    case 'sonic-boom': return 20;
    case 'super-fang': case 'ruination': case 'natures-madness': return Math.max(1, Math.floor(def.hp / 2));
    case 'psywave': return Math.floor(att.level * 1.0);
    case 'counter': return att.recibido?.cat === 'physical' ? att.recibido.danio * 2 : 0;
    case 'mirror-coat': return att.recibido?.cat === 'special' ? att.recibido.danio * 2 : 0;
    case 'metal-burst': case 'comeuppance': return att.recibido?.danio ? Math.floor(att.recibido.danio * 1.5) : 0;
    case 'endeavor': return Math.max(0, def.hp - att.hp);
    case 'final-gambit': return att.hp;
    default: return null;
  }
}

/** Potencia efectiva en este momento. */
export function poderDe(move, att, def) {
  const vA = velocidad(att); const vD = velocidad(def);
  switch (move.name) {
    case 'low-kick': case 'grass-knot': return porPeso(def.peso ?? 50);
    case 'heavy-slam': case 'heat-crash': return porRelacionPeso((att.peso ?? 50) / Math.max(0.1, def.peso ?? 50));
    case 'gyro-ball': return Math.min(150, Math.floor((25 * vD) / Math.max(1, vA)) + 1);
    case 'electro-ball': { const r = vA / Math.max(1, vD); return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; }
    case 'return': case 'frustration': return 102;
    case 'reversal': case 'flail': return porVidaPropia(att.hp / att.maxHp);
    case 'eruption': case 'water-spout': case 'dragon-energy': return Math.max(1, Math.floor((150 * att.hp) / att.maxHp));
    case 'crush-grip': case 'wring-out': case 'hard-press': return Math.max(1, Math.floor((120 * def.hp) / def.maxHp));
    case 'stored-power': case 'power-trip': return 20 + 20 * subidas(att);
    case 'punishment': return Math.min(200, 60 + 20 * subidas(def));
    case 'facade': return att.status ? 140 : 70;
    case 'hex': return def.status ? 130 : 65;
    case 'venoshock': return def.status === 'poison' || def.status === 'toxic' ? 130 : 65;
    case 'brine': return def.hp <= def.maxHp / 2 ? 130 : 65;
    case 'knock-off': return 97;
    case 'acrobatics': return 110;
    case 'magnitude': return 70;
    case 'present': return 40;
    case 'trump-card': return 40;
    case 'beat-up': return 40;
    case 'wake-up-slap': return def.status === 'sleep' ? 140 : 70;
    case 'smelling-salts': return def.status === 'paralysis' ? 140 : 70;
    case 'weather-ball': return 50;
    default: return move.power || 70;
  }
}

/** Poder "de catálogo" para mostrar en la interfaz (sin conocer al rival). */
export function poderNominal(move) {
  if (move.category === 'status') return null;
  if (move.power) return move.power;
  switch (move.name) {
    case 'seismic-toss': case 'night-shade': return 'Nivel';
    case 'super-fang': case 'ruination': case 'natures-madness': return '½ PS';
    case 'dragon-rage': return 40;
    case 'sonic-boom': return 20;
    case 'counter': case 'mirror-coat': return '×2';
    case 'metal-burst': case 'comeuppance': return '×1.5';
    case 'endeavor': case 'final-gambit': case 'psywave': return 'Var.';
    case 'fissure': case 'guillotine': case 'horn-drill': case 'sheer-cold': return 'KO';
    default: return 'Var.';
  }
}

/** Fórmula oficial de daño (Gen V+), con aleatoriedad, STAB, tipos, crítico y quemadura. */
export function calcularDanio(att, def, move, { critico = false, roll = 1, campo = {} } = {}) {
  const fisico = move.category === 'physical';
  const kA = fisico ? 'attack' : 'special-attack';
  const kD = fisico ? 'defense' : 'special-defense';
  let etA = att.boosts[kA] ?? 0;
  let etD = def.boosts[kD] ?? 0;
  if (critico) { etA = Math.max(0, etA); etD = Math.min(0, etD); }
  const A = att.stats[kA] * multEtapa(etA);
  let D = def.stats[kD] * multEtapa(etD);
  if (campo.clima === 'sand' && !fisico && def.types.includes('rock')) D *= 1.5;
  if (campo.clima === 'snow' && fisico && def.types.includes('ice')) D *= 1.5;
  const tipoReal = move.name === 'weather-ball' && campo.clima ? { rain: 'water', sun: 'fire', sand: 'rock', snow: 'ice' }[campo.clima] : move.type;
  const eff = tipoReal === 'typeless' ? 1 : efectividad(tipoReal, def.types);
  const fijo = danioFijo(move, att, def);
  if (fijo != null) return { danio: eff === 0 ? 0 : fijo, eff: eff === 0 ? 0 : 1 };
  if (move.meta?.category === 'ohko') return { danio: eff === 0 || def.level > att.level ? 0 : def.hp, eff: eff === 0 ? 0 : 1 };
  let poder = poderDe(move, att, def);
  const tipoMov = move.name === 'weather-ball' && campo.clima ? { rain: 'water', sun: 'fire', sand: 'rock', snow: 'ice' }[campo.clima] : move.type;
  if (move.name === 'weather-ball' && campo.clima) poder = 100;
  if (move.name === 'solar-beam' || move.name === 'solar-blade') { if (campo.clima && campo.clima !== 'sun') poder = Math.floor(poder / 2); }
  const base = Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * poder * A) / D) / 50) + 2;
  const stab = att.types.includes(tipoMov) ? 1.5 : 1;
  const quem = fisico && att.status === 'burn' && move.name !== 'facade' ? 0.5 : 1;
  let clima = 1;
  if (campo.clima === 'rain') clima = tipoMov === 'water' ? 1.5 : tipoMov === 'fire' ? 0.5 : 1;
  if (campo.clima === 'sun') clima = tipoMov === 'fire' ? 1.5 : tipoMov === 'water' ? 0.5 : 1;
  const p = campo.pantallas || {};
  const pantalla = !critico && (p['aurora-veil'] > 0 || (fisico ? p.reflect > 0 : p['light-screen'] > 0)) ? 0.5 : 1;
  let d = base * roll * stab * eff * (critico ? 1.5 : 1) * quem * clima * pantalla;
  d = eff === 0 ? 0 : Math.max(1, Math.floor(d));
  return { danio: d, eff };
}

/** Daño promedio estimado (sin crítico), útil para la IA y para la interfaz. */
export function danioEstimado(att, def, move, b = null) {
  if (move.category === 'status' || move === RECARGA) return 0;
  if (SIN_RANGO.has(move.name) && move.name !== 'present' && move.name !== 'magnitude') return move.name === 'final-gambit' ? att.hp : move.name === 'endeavor' ? Math.max(0, def.hp - att.hp) : 0;
  const { danio } = calcularDanio(att, def, move, { roll: 0.925, campo: campoDe(b, def) });
  const hits = move.meta?.maxHits ? ((move.meta.minHits ?? 1) + move.meta.maxHits) / 2 : 1;
  return danio * hits;
}

const golpesDe = (move) => {
  const m = move.meta || {};
  if (!m.maxHits) return [1, 1];
  return [m.minHits ?? m.maxHits, m.maxHits];
};

/** Rango de daño (mínimo y máximo, sin críticos) de `move` contra `def`, en PS y en % de su vida actual. */
export function rangoDanio(att, def, move, b = null) {
  if (move.category === 'status') return null;
  if (SIN_RANGO.has(move.name)) return { variable: true };
  const campo = campoDe(b, def);
  const [gMin, gMax] = golpesDe(move);
  const min = calcularDanio(att, def, move, { roll: 0.85, campo }).danio * gMin;
  const { danio: maxUno, eff } = calcularDanio(att, def, move, { roll: 1, campo });
  const max = maxUno * gMax;
  const base = Math.max(1, def.hp);
  return {
    min, max, eff,
    pctMin: Math.min(100, Math.round((min / def.maxHp) * 100)),
    pctMax: Math.min(100, Math.round((max / def.maxHp) * 100)),
    ko: min >= base, posibleKo: max >= base,
  };
}

/** Rango de velocidad posible de un Pokémon (lo que verías del rival sin conocer sus estadísticas). */
export function rangoVelocidad(mon) {
  const b = mon.base?.speed ?? 50; const L = mon.level;
  let min = Math.floor((Math.floor((2 * b) * L / 100) + 5) * 0.9);
  let max = Math.floor((Math.floor((2 * b + 31 + 63) * L / 100) + 5) * 1.1);
  const m = multEtapa(mon.boosts?.speed ?? 0) * (mon.status === 'paralysis' ? 0.5 : 1);
  return [Math.floor(min * m), Math.floor(max * m)];
}

// ------------------------------------------------------------------
//  Turno
// ------------------------------------------------------------------

/**
 * Ejecuta un turno completo.
 * @param {object} b batalla
 * @param {{tipo:'mover'|'cambiar', indice:number}} accJ acción del jugador
 * @param {{tipo:'mover'|'cambiar', indice:number}} accR acción del rival
 * @returns {Array} eventos
 */
export function ejecutarTurno(b, accJ, accR) {
  const ev = [];
  if (b.terminada) return ev;
  b.turno += 1;
  ev.push({ t: 'turno', n: b.turno });

  // Acciones obligadas (cargar, recargar, furia) mandan sobre lo elegido
  accJ = accionForzada(b, 'player') || accJ;
  accR = accionForzada(b, 'rival') || accR;
  const acciones = [
    { side: 'player', ...accJ },
    { side: 'rival', ...accR },
  ];
  for (const side of ['player', 'rival']) { const m = activo(b, side); m.yaMovio = false; m.recibido = null; m._eligio = null; }

  // 1) Cambios primero (el más rápido cambia antes)
  const cambios = acciones.filter((a) => a.tipo === 'cambiar')
    .sort((x, y) => velocidad(activo(b, y.side)) - velocidad(activo(b, x.side)));
  for (const a of cambios) { if (!b.terminada) cambiar(b, a.side, a.indice, ev, false); }

  // 2) Movimientos ordenados por prioridad y velocidad
  const movs = acciones.filter((a) => a.tipo === 'mover').map((a) => {
    const mon = activo(b, a.side);
    const move = a.indice === -2 ? RECARGA : a.indice === -1 ? FORCEJEO : (mon.moves[a.indice] || FORCEJEO);
    mon._eligio = move;
    return { ...a, mon, move, vel: velocidad(mon), desempate: b.rng() };
  }).sort((x, y) => (y.move.priority ?? 0) - (x.move.priority ?? 0) || y.vel - x.vel || y.desempate - x.desempate);

  for (const m of movs) {
    if (b.terminada) break;
    if (m.mon.hp <= 0 || activo(b, m.side) !== m.mon) continue; // debilitado o ya no está en el campo
    const def = activo(b, otro(m.side));
    if (def.hp <= 0 && !OBJETIVO_PROPIO.has(m.move.target)) continue;
    usarMovimiento(b, m.mon, def, m.move, ev);
    m.mon.yaMovio = true;
  }

  // 3) Efectos de final de turno
  if (!b.terminada) finDeTurno(b, ev);

  for (const side of ['player', 'rival']) { const m = activo(b, side); m.flinch = false; m.protegido = false; }

  // 4) Reemplazos
  if (!b.terminada) {
    if (activo(b, 'player').hp <= 0) b.pendiente = 'player';
  }
  return ev;
}

function finDeTurno(b, ev) {
  const fin = () => b.terminada;
  // Ataques previstos (Premonición, Deseo Oculto)
  for (const side of ['player', 'rival']) {
    const f = b.lados[side].futuro;
    if (!f || fin()) continue;
    f.turnos -= 1;
    if (f.turnos > 0) continue;
    b.lados[side].futuro = null;
    const mon = activo(b, side);
    if (mon.hp <= 0) continue;
    ev.push({ t: 'msg', texto: `¡${N(mon)} recibió el ataque de ${f.nombre}!` });
    ev.push({ t: 'anim', side: otro(side), tipo: 'futuro', move: f.move });
    aplicarDanio(b, mon, f.danio, ev, { eff: 1, tipo: f.move.type });
    revisarDebilitado(b, mon, ev);
  }
  // Clima
  if (b.clima && !fin()) {
    const c = b.clima.tipo;
    if (c === 'sand' || c === 'snow') {
      for (const side of ['player', 'rival']) {
        const mon = activo(b, side);
        if (mon.hp <= 0 || fin()) continue;
        const inmune = c === 'sand' ? mon.types.some((t) => ['rock', 'ground', 'steel'].includes(t)) : true; // la nieve moderna no daña
        if (inmune) continue;
        aplicarDanio(b, mon, Math.max(1, Math.floor(mon.maxHp / 16)), ev, { residual: true, estado: 'sand' });
        ev.push({ t: 'msg', texto: `La tormenta de arena zarandea ${A(mon)}.`, cls: 'residual' });
        revisarDebilitado(b, mon, ev);
      }
    }
    b.clima.turnos -= 1;
    if (b.clima.turnos <= 0) {
      ev.push({ t: 'msg', texto: CLIMA_ES[c].fin });
      b.clima = null;
      ev.push({ t: 'clima', clima: null });
    }
  }
  // Estados: quemadura y veneno
  for (const side of ['player', 'rival']) {
    const mon = activo(b, side);
    if (mon.hp <= 0 || fin()) continue;
    let d = 0; let txt = '';
    if (mon.status === 'burn') { d = Math.max(1, Math.floor(mon.maxHp / 16)); txt = `${N(mon)} se resiente de la quemadura.`; }
    if (mon.status === 'poison') { d = Math.max(1, Math.floor(mon.maxHp / 8)); txt = `${N(mon)} sufre por el envenenamiento.`; }
    if (mon.status === 'toxic') { mon.toxicN += 1; d = Math.max(1, Math.floor((mon.maxHp * mon.toxicN) / 16)); txt = `${N(mon)} sufre por el envenenamiento grave.`; }
    if (d > 0) {
      aplicarDanio(b, mon, d, ev, { residual: true, estado: mon.status });
      ev.push({ t: 'msg', texto: txt, cls: 'residual' });
      revisarDebilitado(b, mon, ev);
    }
  }
  // Drenadoras y maldición
  for (const side of ['player', 'rival']) {
    const mon = activo(b, side);
    if (mon.hp <= 0 || fin()) continue;
    if (mon.drenadoras) {
      const d = aplicarDanio(b, mon, Math.max(1, Math.floor(mon.maxHp / 8)), ev, { residual: true, estado: 'drenadoras' });
      ev.push({ t: 'msg', texto: `Las drenadoras restan salud ${A(mon)}.`, cls: 'residual' });
      const rival = activo(b, otro(side));
      if (rival.hp > 0) curar(rival, d, ev);
      revisarDebilitado(b, mon, ev);
    }
    if (mon.hp > 0 && mon.maldito && !fin()) {
      aplicarDanio(b, mon, Math.max(1, Math.floor(mon.maxHp / 4)), ev, { residual: true, estado: 'maldicion' });
      ev.push({ t: 'msg', texto: `${N(mon)} es víctima de una maldición.`, cls: 'residual' });
      revisarDebilitado(b, mon, ev);
    }
  }
  // Contadores: pantallas y mofa
  for (const side of ['player', 'rival']) {
    const lado = b.lados[side];
    for (const [k, info] of Object.entries(PANTALLAS)) {
      if (lado.pantallas[k] > 0) {
        lado.pantallas[k] -= 1;
        if (lado.pantallas[k] === 0) { ev.push({ t: 'msg', texto: `${info.nombre} ${DEQ(side)} se agotó.` }); ev.push({ t: 'pantalla', side, pantalla: k, on: false }); }
      }
    }
    const mon = activo(b, side);
    if (mon.mofa > 0) { mon.mofa -= 1; if (mon.mofa === 0 && mon.hp > 0) ev.push({ t: 'msg', texto: `${N(mon)} ya no está bajo los efectos de la Mofa.` }); }
  }
}

/** Reemplazo tras un debilitamiento (no consume turno). */
export function cambioForzado(b, side, indice) {
  const ev = [];
  cambiar(b, side, indice, ev, true);
  if (side === 'player') b.pendiente = activo(b, 'player').hp <= 0 && !b.terminada ? 'player' : null;
  return ev;
}

function cambiar(b, side, indice, ev, forzado) {
  const lado = b.lados[side];
  const saliente = activo(b, side);
  if (!forzado && saliente.hp > 0) {
    ev.push({ t: 'msg', texto: F('VUELVE', side, saliente.nombre, lado.nombre) });
    ev.push({ t: 'retirar', side });
  }
  // Al salir se reinician los cambios de stats y estados volátiles
  saliente.boosts = boostsVacios();
  Object.assign(saliente, volatiles());
  if (saliente.status === 'toxic') saliente.toxicN = 0;

  lado.activo = indice;
  lado.ultimoCambio = b.turno;
  const entra = activo(b, side);
  entra.vecesUsado += 1;
  entra.turnoEntrada = b.turno;
  entra.yaMovio = true; // no puede actuar en el turno en que entra
  ev.push({ t: 'msg', texto: F('ENVIA', side, entra.nombre, lado.nombre) });
  ev.push({ t: 'entrar', side, indice, mon: entra, hp: entra.hp, maxHp: entra.maxHp, estado: entra.status });
  if (lado.deseoCuracion && entra.hp > 0) {
    lado.deseoCuracion = false;
    if (entra.status) { entra.status = null; ev.push({ t: 'estado', side, estado: null }); }
    curar(entra, entra.maxHp, ev);
    ev.push({ t: 'msg', texto: `¡${N(entra)} recibió el deseo de curación!` });
  }
  trampasDeEntrada(b, entra, ev);
}

function trampasDeEntrada(b, mon, ev) {
  const t = b.lados[mon.side].trampas;
  const vuela = mon.types.includes('flying');
  if (t.rocas && mon.hp > 0) {
    const d = Math.max(1, Math.floor((mon.maxHp * efectividad('rock', mon.types)) / 8));
    ev.push({ t: 'anim', side: mon.side, tipo: 'rocas' });
    aplicarDanio(b, mon, d, ev, { residual: true, estado: 'rocas' });
    ev.push({ t: 'msg', texto: `¡Unas piedras puntiagudas hieren ${A(mon)}!`, cls: 'residual' });
    revisarDebilitado(b, mon, ev);
  }
  if (t.puas > 0 && !vuela && mon.hp > 0) {
    const d = Math.max(1, Math.floor(mon.maxHp * [0, 1 / 8, 1 / 6, 1 / 4][t.puas]));
    aplicarDanio(b, mon, d, ev, { residual: true, estado: 'puas' });
    ev.push({ t: 'msg', texto: `¡Las púas hieren ${A(mon)}!`, cls: 'residual' });
    revisarDebilitado(b, mon, ev);
  }
  if (t.toxicas > 0 && !vuela && mon.hp > 0) {
    if (mon.types.includes('poison')) {
      t.toxicas = 0;
      ev.push({ t: 'msg', texto: `¡${N(mon)} absorbió las púas tóxicas!` });
    } else if (!mon.types.includes('steel')) {
      aplicarEstado(b, mon, t.toxicas >= 2 ? 'toxic' : 'poison', ev, { silencioso: true });
    }
  }
}

/** ¿Algo impide moverse este turno? Devuelve true si puede actuar. */
function puedeMoverse(b, att, move, ev) {
  const rng = b.rng;
  if (att.status === 'sleep') {
    if (att.sleepTurns > 0) {
      att.sleepTurns -= 1;
      ev.push({ t: 'anim', side: att.side, tipo: 'dormir' });
      ev.push({ t: 'msg', texto: `${N(att)} está profundamente dormido.` });
      return false;
    }
    att.status = null;
    ev.push({ t: 'estado', side: att.side, estado: null });
    ev.push({ t: 'msg', texto: `¡${N(att)} se despertó!` });
  }
  if (att.status === 'freeze') {
    if (move.type === 'fire' || rng() < 0.2) {
      att.status = null;
      ev.push({ t: 'estado', side: att.side, estado: null });
      ev.push({ t: 'msg', texto: `¡${N(att)} se descongeló!` });
    } else {
      ev.push({ t: 'msg', texto: `${N(att)} está congelado. ¡No se puede mover!` });
      return false;
    }
  }
  if (att.flinch) {
    att.flinch = false;
    ev.push({ t: 'msg', texto: `¡${N(att)} retrocedió y no se pudo mover!` });
    return false;
  }
  if (att.confusion > 0) {
    att.confusion -= 1;
    if (att.confusion === 0) {
      ev.push({ t: 'msg', texto: `${N(att)} ya no está confuso.` });
    } else {
      ev.push({ t: 'anim', side: att.side, tipo: 'confuso' });
      ev.push({ t: 'msg', texto: `${N(att)} está confuso.` });
      if (rng() < 1 / 3) {
        const golpe = { ...FORCEJEO, power: 40, type: 'typeless' };
        const { danio } = calcularDanio(att, att, golpe, { roll: 0.85 + rng() * 0.15 });
        ev.push({ t: 'msg', texto: '¡Está tan confuso que se hirió a sí mismo!' });
        aplicarDanio(b, att, danio, ev, {});
        revisarDebilitado(b, att, ev);
        return false;
      }
    }
  }
  if (att.status === 'paralysis' && rng() < 0.25) {
    ev.push({ t: 'anim', side: att.side, tipo: 'paralisis' });
    ev.push({ t: 'msg', texto: `¡${N(att)} está paralizado! No se puede mover.` });
    return false;
  }
  return true;
}

const falla = (ev, texto = '¡Pero falló!') => { ev.push({ t: 'msg', texto }); };

function usarMovimiento(b, att, def, move, ev) {
  const rng = b.rng;

  if (move === RECARGA) {
    att.recarga = false;
    ev.push({ t: 'anim', side: att.side, tipo: 'recarga' });
    ev.push({ t: 'msg', texto: `${N(att)} necesita recuperarse.` });
    return;
  }

  const liberando = att.cargando && att.cargando.move === move;
  const enFuria = att.furia && att.furia.move === move;

  if (!puedeMoverse(b, att, move, ev)) {
    // Si algo lo detiene, pierde la carga o la furia
    if (att.invulnerable) ev.push({ t: 'anim', side: att.side, tipo: 'reaparecer' });
    att.cargando = null; att.invulnerable = null; att.furia = null;
    return;
  }

  if (att.mofa > 0 && move.category === 'status') {
    falla(ev, `¡${N(att)} no puede usar ${move.nombre} por la Mofa!`);
    return;
  }
  if (!MOVS_PROTECCION.has(move.name)) att.protecciones = 0;

  // --- Usar el movimiento ---
  if (move !== FORCEJEO && move.ppLeft > 0 && !liberando && !enFuria) move.ppLeft -= 1;

  // Primer turno de un movimiento de carga
  const carga = MOVS_CARGA[move.name];
  if (carga && !liberando && !(carga.sinCargaCon && b.clima?.tipo === carga.sinCargaCon)) {
    att.cargando = { move, indice: att.moves.indexOf(move) };
    att.invulnerable = carga.inv || null;
    ev.push({ t: 'anim', side: att.side, tipo: 'carga', move, inv: att.invulnerable });
    ev.push({ t: 'msg', texto: `¡${N(att)} ${carga.txt}!`, cls: 'uso', tipo: move.type });
    if (carga.stat) cambiarStat(att, carga.stat[0], carga.stat[1], ev);
    return;
  }
  if (liberando) { att.cargando = null; att.invulnerable = null; }

  ev.push({ t: 'mover', side: att.side, move });
  ev.push({ t: 'msg', texto: `¡${N(att)} usó ${move.nombre}!`, cls: 'uso', tipo: move.type });

  const haciaMi = OBJETIVO_PROPIO.has(move.target) || move.target === 'entire-field' || move.target === 'users-field';
  const alRival = !haciaMi && move.target !== 'opponents-field';

  if (def.hp <= 0 && alRival) { falla(ev, '¡Pero no hay objetivo!'); return; }

  // Protección
  if (alRival && def.protegido && move.name !== 'feint') {
    ev.push({ t: 'anim', side: def.side, tipo: 'proteccion' });
    falla(ev, `¡${N(def)} se protegió!`);
    if (MOVS_AUTODESTRUCCION.has(move.name) && move.name !== 'final-gambit') autoKO(b, att, ev);
    att.furia = null;
    return;
  }
  // Escondido (Vuelo, Excavar, Buceo…)
  if (alRival && def.invulnerable && !ALCANZA[def.invulnerable]?.has(move.name)) {
    ev.push({ t: 'fallo', side: def.side });
    falla(ev, `¡${N(def)} esquivó el ataque!`);
    att.furia = null;
    return;
  }

  // Condiciones especiales
  if ((move.name === 'fake-out' || move.name === 'first-impression') && b.turno - att.turnoEntrada !== 1) { falla(ev); return; }
  if ((move.name === 'sucker-punch' || move.name === 'thunderclap')) {
    const elegido = def._eligio;
    if (def.yaMovio || !elegido || elegido.category === 'status' || elegido === RECARGA) { falla(ev); return; }
  }
  if (move.name === 'focus-punch' && att.recibido) { falla(ev, `¡${N(att)} perdió la concentración y no pudo moverse!`); return; }
  if (move.name === 'dream-eater' && def.status !== 'sleep') { falla(ev, `No afecta ${A(def)}…`); return; }
  if (move.name === 'synchronoise' && !def.types.some((t) => att.types.includes(t))) { falla(ev, `No afecta ${A(def)}…`); return; }
  if ((move.name === 'counter' || move.name === 'mirror-coat' || move.name === 'metal-burst' || move.name === 'comeuppance') && !danioFijo(move, att, def)) { falla(ev); return; }

  // Precisión
  if (alRival && !precisionOk(b, att, def, move)) {
    ev.push({ t: 'fallo', side: def.side });
    falla(ev, `¡${N(def)} esquivó el ataque!`);
    if (MOVS_MEDIA_VIDA.has(move.name)) mediaVida(b, att, ev);
    att.furia = null;
    if (move.name === 'high-jump-kick' || move.name === 'jump-kick' || move.name === 'supercell-slam' || move.name === 'axe-kick') {
      aplicarDanio(b, att, Math.max(1, Math.floor(att.maxHp / 2)), ev, {});
      ev.push({ t: 'msg', texto: `¡${N(att)} falló y se estrelló contra el suelo!` });
      revisarDebilitado(b, att, ev);
    }
    return;
  }

  if (MOVS_FUTURO.has(move.name)) {
    const lado = b.lados[def.side];
    if (lado.futuro) { falla(ev); return; }
    const { danio } = calcularDanio(att, def, move, { roll: 0.85 + rng() * 0.15, campo: campoDe(b, def) });
    lado.futuro = { turnos: 3, danio, nombre: move.nombre, move };
    ev.push({ t: 'msg', texto: `¡${N(att)} previó un ataque!` });
    return;
  }

  if (move.category !== 'status') {
    movimientoDanino(b, att, def, move, ev);
    if (b.terminada) return;
    if (MOVS_RECARGA.has(move.name) && att.hp > 0) att.recarga = true;
    if (MOVS_MEDIA_VIDA.has(move.name)) mediaVida(b, att, ev);
    if (MOVS_AUTODESTRUCCION.has(move.name)) autoKO(b, att, ev);
    if (MOVS_FURIA.has(move.name) && att.hp > 0) {
      if (!att.furia) att.furia = { move, indice: att.moves.indexOf(move), turnos: 1 + Math.floor(rng() * 2) };
      else att.furia.turnos -= 1;
      if (att.furia.turnos <= 0) {
        att.furia = null;
        ev.push({ t: 'msg', texto: `¡${N(att)} está agotado por la furia!` });
        aplicarEstado(b, att, 'confusion', ev, { silencioso: true });
      }
    }
  } else {
    movimientoEstado(b, att, def, move, ev);
  }
}

function precisionOk(b, att, def, move) {
  let acc = move.accuracy;
  const clima = b.clima?.tipo;
  if ((move.name === 'thunder' || move.name === 'hurricane') && clima === 'rain') acc = null;
  if ((move.name === 'thunder' || move.name === 'hurricane') && clima === 'sun') acc = 50;
  if (move.name === 'blizzard' && clima === 'snow') acc = null;
  if (move.name === 'toxic' && att.types.includes('poison')) acc = null;
  if (move.meta?.category === 'ohko') {
    if (def.level > att.level) return false;
    return b.rng() * 100 < 30 + (att.level - def.level);
  }
  if (acc == null) return true;
  const etapa = Math.max(-6, Math.min(6, (att.boosts.accuracy ?? 0) - (def.boosts.evasion ?? 0)));
  const mult = etapa >= 0 ? (3 + etapa) / 3 : 3 / (3 - etapa);
  return b.rng() * 100 < acc * mult;
}

function autoKO(b, att, ev) {
  if (att.hp <= 0) return;
  aplicarDanio(b, att, att.hp, ev, {});
  revisarDebilitado(b, att, ev);
}
function mediaVida(b, att, ev) {
  if (att.hp <= 0) return;
  aplicarDanio(b, att, Math.max(1, Math.ceil(att.maxHp / 2)), ev, {});
  ev.push({ t: 'msg', texto: `${N(att)} sacrificó parte de sus PS.` });
  revisarDebilitado(b, att, ev);
}

function movimientoDanino(b, att, def, move, ev) {
  const rng = b.rng;
  const meta = move.meta || {};
  const campo = campoDe(b, def);
  const tipoReal = move.name === 'weather-ball' && campo.clima ? { rain: 'water', sun: 'fire', sand: 'rock', snow: 'ice' }[campo.clima] : move.type;
  const eff = tipoReal === 'typeless' ? 1 : efectividad(tipoReal, def.types);
  if (eff === 0) {
    ev.push({ t: 'msg', texto: `No afecta ${A(def)}…` });
    return;
  }
  const fijo = danioFijo(move, att, def);
  if (fijo === 0) { falla(ev); return; }

  // Número de golpes
  let golpes = 1;
  if (meta.maxHits) {
    const min = meta.minHits ?? meta.maxHits;
    if (min === meta.maxHits) golpes = min;
    else if (min === 2 && meta.maxHits === 5) {
      const r = rng();
      golpes = r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5;
    } else golpes = min + Math.floor(rng() * (meta.maxHits - min + 1));
  }

  let total = 0; let hechos = 0;
  for (let i = 0; i < golpes && def.hp > 0; i++) {
    const etapa = Math.min(3, (meta.critRate ?? 0) + (att.critBonus || 0));
    const prob = etapa >= 3 ? 1 : [1 / 24, 1 / 8, 1 / 2][etapa];
    const critico = fijo == null && meta.category !== 'ohko' && rng() < prob;
    const { danio } = calcularDanio(att, def, move, { critico, roll: 0.85 + rng() * 0.15, campo });
    const real = aplicarDanio(b, def, danio, ev, { eff, critico, tipo: tipoReal });
    total += real; hechos += 1;
    if (critico) ev.push({ t: 'msg', texto: '¡Un golpe crítico!', cls: 'critico' });
  }
  if (meta.category === 'ohko' && def.hp <= 0) ev.push({ t: 'msg', texto: '¡Fulminado de un golpe!', cls: 'critico' });
  else if (fijo == null && eff > 1) ev.push({ t: 'msg', texto: '¡Es súper eficaz!', cls: 'eficaz' });
  else if (fijo == null && eff < 1) ev.push({ t: 'msg', texto: 'No es muy eficaz…', cls: 'poco' });
  if (golpes > 1) ev.push({ t: 'msg', texto: `¡Golpeó ${hechos} ${hechos === 1 ? 'vez' : 'veces'}!` });

  const pct = Math.round((total / def.maxHp) * 100);
  ev.push({ t: 'msg', texto: `(${N(def)} perdió ${Math.min(100, pct)}% de sus PS)`, cls: 'detalle' });

  att.danioHecho += total;
  def.recibido = { danio: (def.recibido?.danio || 0) + total, cat: move.category };
  if (move.name === 'final-gambit') autoKO(b, att, ev);

  // Absorción / retroceso
  if (move === FORCEJEO) {
    const r = Math.max(1, Math.floor(att.maxHp / 4));
    aplicarDanio(b, att, r, ev, {});
    ev.push({ t: 'msg', texto: `${N(att)} se ve afectado por el retroceso.` });
  } else if (meta.drain > 0 && att.hp > 0) {
    const cura = Math.max(1, Math.floor((total * meta.drain) / 100));
    if (curar(att, cura, ev)) ev.push({ t: 'msg', texto: `¡${N(def)} perdió energía!` });
  } else if (meta.drain < 0 && att.hp > 0) {
    const r = Math.max(1, Math.floor((total * -meta.drain) / 100));
    aplicarDanio(b, att, r, ev, {});
    ev.push({ t: 'msg', texto: `${N(att)} se ve afectado por el retroceso.` });
  }

  const defCayo = def.hp <= 0;
  if (defCayo) att.kos += 1;
  revisarDebilitado(b, def, ev);
  if (b.terminada) return;
  revisarDebilitado(b, att, ev);
  if (b.terminada) return;

  if (LIMPIAN_TRAMPAS.has(move.name) && att.hp > 0) limpiarTrampas(b, att.side, ev);

  // Efectos secundarios
  if (!defCayo) {
    if (meta.ailment && meta.ailment !== 'none' && meta.ailmentChance > 0 && b.rng() * 100 < meta.ailmentChance) {
      aplicarEstado(b, def, meta.ailment, ev, { silencioso: true });
    }
    if (meta.flinchChance > 0 && b.rng() * 100 < meta.flinchChance) def.flinch = true;
  }
  if (move.statChanges?.length) {
    const prob = meta.statChance || 100;
    if (b.rng() * 100 < prob) {
      const objetivo = (meta.category === 'damage-raise' || meta.category === 'damage+raise') ? att : def;
      if (objetivo.hp > 0) for (const s of move.statChanges) cambiarStat(objetivo, s.stat, s.change, ev);
    }
  }
}

function limpiarTrampas(b, side, ev) {
  const t = b.lados[side].trampas;
  if (t.rocas || t.puas || t.toxicas) {
    t.rocas = false; t.puas = 0; t.toxicas = 0;
    ev.push({ t: 'msg', texto: `¡Se despejaron las trampas del lado ${DEQ(side)}!` });
  }
}

function movimientoEstado(b, att, def, move, ev) {
  const meta = move.meta || {};
  const cat = meta.category;
  const haciaMi = OBJETIVO_PROPIO.has(move.target);
  let hizoAlgo = false;
  const rng = b.rng;
  const ladoMio = b.lados[att.side];
  const ladoRival = b.lados[def.side];

  if (POLVOS.has(move.name) && def.types.includes('grass') && !haciaMi) {
    ev.push({ t: 'msg', texto: `No afecta ${A(def)}…` });
    return;
  }
  if (move.name === 'thunder-wave' && def.types.includes('ground')) {
    ev.push({ t: 'msg', texto: `No afecta ${A(def)}…` });
    return;
  }

  // ---- Movimientos con efecto propio ----
  if (MOVS_PROTECCION.has(move.name)) {
    const prob = 1 / 3 ** att.protecciones;
    if (rng() < prob) {
      att.protegido = true; att.protecciones += 1;
      ev.push({ t: 'anim', side: att.side, tipo: 'proteccion' });
      ev.push({ t: 'msg', texto: `¡${N(att)} se está protegiendo!` });
    } else { att.protecciones = 0; falla(ev); }
    return;
  }
  if (CLIMAS[move.name]) {
    const c = CLIMAS[move.name];
    if (b.clima?.tipo === c) { falla(ev); return; }
    b.clima = { tipo: c, turnos: 5 };
    ev.push({ t: 'clima', clima: c });
    ev.push({ t: 'msg', texto: CLIMA_ES[c].inicio });
    return;
  }
  if (PANTALLAS[move.name]) {
    if (ladoMio.pantallas[move.name] > 0) { falla(ev); return; }
    ladoMio.pantallas[move.name] = 5;
    ev.push({ t: 'pantalla', side: att.side, pantalla: move.name, on: true });
    ev.push({ t: 'msg', texto: `¡${PANTALLAS[move.name].nombre} protege ${AEQ(att.side)} contra ${PANTALLAS[move.name].txt}!` });
    return;
  }
  switch (move.name) {
    case 'stealth-rock':
      if (ladoRival.trampas.rocas) return falla(ev);
      ladoRival.trampas.rocas = true;
      ev.push({ t: 'msg', texto: `¡Hay piedras puntiagudas flotando alrededor ${DEQ(def.side)}!` });
      return;
    case 'spikes':
      if (ladoRival.trampas.puas >= 3) return falla(ev);
      ladoRival.trampas.puas += 1;
      ev.push({ t: 'msg', texto: `¡Hay púas esparcidas alrededor ${DEQ(def.side)}!` });
      return;
    case 'toxic-spikes':
      if (ladoRival.trampas.toxicas >= 2) return falla(ev);
      ladoRival.trampas.toxicas += 1;
      ev.push({ t: 'msg', texto: `¡Hay púas tóxicas esparcidas alrededor ${DEQ(def.side)}!` });
      return;
    case 'leech-seed':
      if (def.types.includes('grass') || def.drenadoras) return falla(ev, `No afecta ${A(def)}…`);
      def.drenadoras = true;
      ev.push({ t: 'anim', side: def.side, tipo: 'semilla' });
      ev.push({ t: 'msg', texto: `¡Se plantó una semilla en ${N(def, false)}!` });
      return;
    case 'taunt':
      if (def.mofa > 0) return falla(ev);
      def.mofa = 3;
      ev.push({ t: 'msg', texto: `¡${N(def)} cayó en la Mofa!` });
      return;
    case 'haze':
      for (const s of ['player', 'rival']) { const m = activo(b, s); m.boosts = boostsVacios(); ev.push({ t: 'stat', side: s, stat: 'attack', cambio: 0, boosts: { ...m.boosts } }); }
      ev.push({ t: 'msg', texto: '¡Se eliminaron todos los cambios de características!' });
      return;
    case 'rest':
      if (att.hp >= att.maxHp || att.status === 'sleep') return falla(ev);
      att.status = 'sleep'; att.sleepTurns = 2; att.toxicN = 0;
      ev.push({ t: 'estado', side: att.side, estado: 'sleep' });
      curar(att, att.maxHp, ev);
      ev.push({ t: 'msg', texto: `¡${N(att)} se echó a dormir y recuperó toda su salud!` });
      return;
    case 'belly-drum':
      if (att.hp <= att.maxHp / 2 || att.boosts.attack >= 6) return falla(ev);
      aplicarDanio(b, att, Math.floor(att.maxHp / 2), ev, {});
      cambiarStat(att, 'attack', 12, ev);
      ev.push({ t: 'msg', texto: `¡${N(att)} sacrificó PS y maximizó su Ataque!` });
      return;
    case 'pain-split': {
      const media = Math.floor((att.hp + def.hp) / 2);
      for (const m of [att, def]) {
        if (m.hp > media) aplicarDanio(b, m, m.hp - media, ev, {}); else curar(m, media - m.hp, ev);
      }
      ev.push({ t: 'msg', texto: '¡Los dos Pokémon comparten sus PS!' });
      return;
    }
    case 'heal-bell': case 'aromatherapy':
      for (const m of ladoMio.equipo) if (m.hp > 0) m.status = null;
      ev.push({ t: 'estado', side: att.side, estado: null });
      ev.push({ t: 'msg', texto: `¡Se curaron los problemas de estado ${DEQ(att.side)}!` });
      return;
    case 'refresh':
      if (!['burn', 'paralysis', 'poison', 'toxic'].includes(att.status)) return falla(ev);
      att.status = null;
      ev.push({ t: 'estado', side: att.side, estado: null });
      ev.push({ t: 'msg', texto: `¡${N(att)} se recuperó de su problema de estado!` });
      return;
    case 'focus-energy':
      if (att.critBonus >= 2) return falla(ev);
      att.critBonus = 2;
      ev.push({ t: 'anim', side: att.side, tipo: 'aura', color: '#ffcf33' });
      ev.push({ t: 'msg', texto: `¡${N(att)} se está preparando para luchar!` });
      return;
    case 'curse':
      if (att.types.includes('ghost')) {
        if (def.maldito) return falla(ev);
        aplicarDanio(b, att, Math.max(1, Math.floor(att.maxHp / 2)), ev, {});
        def.maldito = true;
        ev.push({ t: 'msg', texto: `¡${N(att)} sacrificó PS y maldijo ${A(def)}!` });
        revisarDebilitado(b, att, ev);
      } else {
        cambiarStat(att, 'speed', -1, ev); cambiarStat(att, 'attack', 1, ev); cambiarStat(att, 'defense', 1, ev);
      }
      return;
    case 'memento':
      cambiarStat(def, 'attack', -2, ev); cambiarStat(def, 'special-attack', -2, ev);
      autoKO(b, att, ev);
      return;
    case 'healing-wish': case 'lunar-dance':
      if (vivos(b, att.side).length <= 1) return falla(ev);
      ladoMio.deseoCuracion = true;
      autoKO(b, att, ev);
      return;
    case 'defog':
      limpiarTrampas(b, 'player', ev); limpiarTrampas(b, 'rival', ev);
      for (const k of Object.keys(ladoRival.pantallas)) ladoRival.pantallas[k] = 0;
      cambiarStat(def, 'evasion', -1, ev);
      return;
    case 'tidy-up':
      limpiarTrampas(b, 'player', ev); limpiarTrampas(b, 'rival', ev);
      cambiarStat(att, 'attack', 1, ev); cambiarStat(att, 'speed', 1, ev);
      return;
    default: break;
  }

  if (cat === 'heal' || (meta.healing > 0 && haciaMi)) {
    if (att.hp >= att.maxHp) {
      ev.push({ t: 'msg', texto: `¡Los PS ${DE(att)} están al máximo!` });
      return;
    }
    let pct = meta.healing || 50;
    if (['moonlight', 'morning-sun', 'synthesis'].includes(move.name) && b.clima) pct = b.clima.tipo === 'sun' ? 66 : 25;
    if (move.name === 'shore-up' && b.clima?.tipo === 'sand') pct = 66;
    curar(att, Math.floor((att.maxHp * pct) / 100), ev);
    ev.push({ t: 'msg', texto: `${N(att)} recuperó salud.` });
    return;
  }

  if (cat === 'ailment' || cat === 'swagger') {
    if (cat === 'swagger') for (const s of move.statChanges) hizoAlgo = cambiarStat(def, s.stat, s.change, ev) || hizoAlgo;
    const estado = move.name === 'toxic' ? 'toxic' : meta.ailment;
    hizoAlgo = aplicarEstado(b, def, estado, ev, { silencioso: false }) || hizoAlgo;
    if (!hizoAlgo) ev.push({ t: 'msg', texto: '¡Pero falló!' });
    return;
  }

  if (move.statChanges?.length) {
    const objetivo = haciaMi ? att : def;
    for (const s of move.statChanges) hizoAlgo = cambiarStat(objetivo, s.stat, s.change, ev) || hizoAlgo;
    if (!hizoAlgo) ev.push({ t: 'msg', texto: '¡Pero falló!' });
    return;
  }
  ev.push({ t: 'msg', texto: '¡Pero no pasó nada!' });
}

// ------------------------------------------------------------------
//  Utilidades de estado
// ------------------------------------------------------------------

function aplicarDanio(b, mon, cantidad, ev, extra) {
  const real = Math.min(mon.hp, cantidad);
  mon.hp -= real;
  ev.push({ t: 'danio', side: mon.side, hp: mon.hp, maxHp: mon.maxHp, cantidad: real, ...extra });
  return real;
}

function curar(mon, cantidad, ev) {
  const real = Math.min(mon.maxHp - mon.hp, cantidad);
  if (real <= 0) return false;
  mon.hp += real;
  ev.push({ t: 'curar', side: mon.side, hp: mon.hp, maxHp: mon.maxHp, cantidad: real });
  return true;
}

function revisarDebilitado(b, mon, ev) {
  if (mon.hp > 0 || mon._debilitadoAvisado) return;
  mon._debilitadoAvisado = true;
  mon.status = null;
  ev.push({ t: 'debilitado', side: mon.side });
  ev.push({ t: 'msg', texto: `¡${N(mon)} se debilitó!`, cls: 'ko' });
  if (vivos(b, mon.side).length === 0) {
    b.terminada = true;
    b.ganador = otro(mon.side);
    ev.push({ t: 'fin', ganador: b.ganador });
  }
}

export function aplicarEstado(b, mon, estado, ev, { silencioso }) {
  const fallar = () => { if (!silencioso) ev.push({ t: 'msg', texto: `${N(mon)} no se ve afectado.` }); return false; };
  if (mon.hp <= 0) return false;

  if (estado === 'confusion') {
    if (mon.confusion > 0) { if (!silencioso) ev.push({ t: 'msg', texto: `${N(mon)} ya está confuso.` }); return false; }
    mon.confusion = 2 + Math.floor(b.rng() * 4);
    ev.push({ t: 'anim', side: mon.side, tipo: 'confuso' });
    ev.push({ t: 'msg', texto: `¡${N(mon)} se encuentra confuso!` });
    return true;
  }
  if (!ESTADOS_MAYORES.has(estado)) return false; // atrapar, enamorar, etc. no se modelan
  if (mon.status) {
    if (!silencioso) ev.push({ t: 'msg', texto: `${N(mon)} ya está ${ESTADOS[mon.status].es}.` });
    return false;
  }
  const t = mon.types;
  if (estado === 'burn' && t.includes('fire')) return fallar();
  if (estado === 'paralysis' && t.includes('electric')) return fallar();
  if ((estado === 'poison' || estado === 'toxic') && (t.includes('poison') || t.includes('steel'))) return fallar();
  if (estado === 'freeze' && t.includes('ice')) return fallar();

  mon.status = estado;
  if (estado === 'sleep') mon.sleepTurns = 1 + Math.floor(b.rng() * 3);
  if (estado === 'toxic') mon.toxicN = 0;
  const frases = {
    burn: `¡${N(mon)} se quemó!`, paralysis: `¡${N(mon)} está paralizado! Quizás no pueda moverse.`,
    poison: `¡${N(mon)} fue envenenado!`, toxic: `¡${N(mon)} fue gravemente envenenado!`,
    sleep: `¡${N(mon)} se quedó dormido!`, freeze: `¡${N(mon)} se congeló!`,
  };
  ev.push({ t: 'estado', side: mon.side, estado });
  ev.push({ t: 'msg', texto: frases[estado], cls: 'estado' });
  return true;
}

export function cambiarStat(mon, stat, cambio, ev) {
  if (!(stat in mon.boosts)) return false; // precisión / evasión no se modelan
  const antes = mon.boosts[stat];
  const despues = Math.max(-6, Math.min(6, antes + cambio));
  const nombre = STATS_ES[stat] ?? stat;
  const art = ['attack', 'special-attack'].includes(stat) ? 'El' : 'La';
  if (antes === despues) {
    ev.push({ t: 'msg', texto: `¡${art} ${nombre} ${DE(mon)} no puede ${cambio > 0 ? 'subir' : 'bajar'} más!` });
    return false;
  }
  mon.boosts[stat] = despues;
  const d = despues - antes;
  const intensidad = Math.abs(d) >= 3 ? 'muchísimo' : Math.abs(d) === 2 ? 'mucho' : '';
  ev.push({ t: 'stat', side: mon.side, stat, cambio: d, boosts: { ...mon.boosts } });
  ev.push({ t: 'msg', texto: `¡${art} ${nombre} ${DE(mon)} ${d > 0 ? 'subió' : 'bajó'}${intensidad ? ' ' + intensidad : ''}!`, cls: d > 0 ? 'sube' : 'baja' });
  return true;
}

export function tieneMovimientosUsables(mon) {
  return mon.moves.some((m) => m.ppLeft > 0);
}

export { TIPOS };
