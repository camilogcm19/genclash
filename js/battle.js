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

/** Multiplicador de una etapa de stat (-6..+6). */
export const multEtapa = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));

/** Crea una instancia de batalla a partir de un "build" (ver api.js). */
export function prepararPokemon(build, side) {
  return {
    ...build,
    side,
    hp: build.stats.hp,
    maxHp: build.stats.hp,
    boosts: { attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 },
    status: null, sleepTurns: 0, toxicN: 0, confusion: 0, flinch: false,
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
    lados: {
      player: { nombre: nombreJugador, equipo: equipoJugador.map((b) => prepararPokemon(b, 'player')), activo: 0, ultimoCambio: -9 },
      rival:  { nombre: nombreRival,  equipo: equipoRival.map((b) => prepararPokemon(b, 'rival')),   activo: 0, ultimoCambio: -9 },
    },
  };
}

export const otro = (side) => (side === 'player' ? 'rival' : 'player');
export const activo = (b, side) => b.lados[side].equipo[b.lados[side].activo];
export const vivos = (b, side) => b.lados[side].equipo.filter((p) => p.hp > 0);
export const opcionesCambio = (b, side) =>
  b.lados[side].equipo.map((p, i) => ({ p, i })).filter(({ p, i }) => p.hp > 0 && i !== b.lados[side].activo).map(({ i }) => i);

/** Nombre para mensajes: "Pikachu" o "el Pikachu rival". */
export function N(mon, mayus = true) {
  if (mon.side === 'rival') return `${mayus ? 'El' : 'el'} ${mon.nombre} rival`;
  return mon.nombre;
}
/** "de Pikachu" / "del Pikachu rival" */
const DE = (mon) => (mon.side === 'rival' ? `del ${mon.nombre} rival` : `de ${mon.nombre}`);
/** "a Pikachu" / "al Pikachu rival" */
const A = (mon) => (mon.side === 'rival' ? `al ${mon.nombre} rival` : `a ${mon.nombre}`);

export function velocidad(mon) {
  let v = mon.stats.speed * multEtapa(mon.boosts.speed);
  if (mon.status === 'paralysis') v *= 0.5;
  return v;
}

/** Fórmula oficial de daño (Gen V+), con aleatoriedad, STAB, tipos, crítico y quemadura. */
export function calcularDanio(att, def, move, { critico = false, roll = 1 } = {}) {
  const fisico = move.category === 'physical';
  const kA = fisico ? 'attack' : 'special-attack';
  const kD = fisico ? 'defense' : 'special-defense';
  let etA = att.boosts[kA] ?? 0;
  let etD = def.boosts[kD] ?? 0;
  if (critico) { etA = Math.max(0, etA); etD = Math.min(0, etD); }
  const A = att.stats[kA] * multEtapa(etA);
  const D = def.stats[kD] * multEtapa(etD);
  const base = Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * move.power * A) / D) / 50) + 2;
  const eff = move.type === 'typeless' ? 1 : efectividad(move.type, def.types);
  const stab = att.types.includes(move.type) ? 1.5 : 1;
  const quem = fisico && att.status === 'burn' ? 0.5 : 1;
  let d = base * roll * stab * eff * (critico ? 1.5 : 1) * quem;
  d = eff === 0 ? 0 : Math.max(1, Math.floor(d));
  return { danio: d, eff };
}

/** Daño promedio estimado (sin crítico), útil para la IA y para la interfaz. */
export function danioEstimado(att, def, move) {
  if (!move.power || move.category === 'status') return 0;
  const { danio } = calcularDanio(att, def, move, { roll: 0.925 });
  const hits = move.meta?.maxHits ? ((move.meta.minHits ?? 1) + move.meta.maxHits) / 2 : 1;
  return danio * hits;
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

  const acciones = [
    { side: 'player', ...accJ },
    { side: 'rival', ...accR },
  ];

  // 1) Cambios primero (el más rápido cambia antes)
  const cambios = acciones.filter((a) => a.tipo === 'cambiar')
    .sort((x, y) => velocidad(activo(b, y.side)) - velocidad(activo(b, x.side)));
  for (const a of cambios) cambiar(b, a.side, a.indice, ev, false);

  // 2) Movimientos ordenados por prioridad y velocidad
  const movs = acciones.filter((a) => a.tipo === 'mover').map((a) => {
    const mon = activo(b, a.side);
    const move = a.indice === -1 ? FORCEJEO : mon.moves[a.indice];
    return { ...a, mon, move, vel: velocidad(mon), desempate: b.rng() };
  }).sort((x, y) => (y.move.priority ?? 0) - (x.move.priority ?? 0) || y.vel - x.vel || y.desempate - x.desempate);

  for (const m of movs) {
    if (b.terminada) break;
    if (m.mon.hp <= 0 || activo(b, m.side) !== m.mon) continue; // debilitado o ya no está en el campo
    const def = activo(b, otro(m.side));
    if (def.hp <= 0) continue;
    usarMovimiento(b, m.mon, def, m.move, ev);
  }

  // 3) Daño residual (quemadura / veneno)
  if (!b.terminada) {
    for (const side of ['player', 'rival']) {
      const mon = activo(b, side);
      if (mon.hp <= 0 || b.terminada) continue;
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
  }

  for (const side of ['player', 'rival']) activo(b, side).flinch = false;

  // 4) Reemplazos
  if (!b.terminada) {
    if (activo(b, 'player').hp <= 0) b.pendiente = 'player';
  }
  return ev;
}

/** Reemplazo tras un debilitamiento (no consume turno). */
export function cambioForzado(b, side, indice) {
  const ev = [];
  cambiar(b, side, indice, ev, true);
  if (side === 'player') b.pendiente = null;
  return ev;
}

function cambiar(b, side, indice, ev, forzado) {
  const lado = b.lados[side];
  const saliente = activo(b, side);
  if (!forzado && saliente.hp > 0) {
    ev.push({ t: 'msg', texto: side === 'player' ? `¡${saliente.nombre}, vuelve!` : `${b.lados.rival.nombre} retiró a ${saliente.nombre}.` });
    ev.push({ t: 'retirar', side });
  }
  // Al salir se reinician los cambios de stats y estados volátiles
  saliente.boosts = { attack: 0, defense: 0, 'special-attack': 0, 'special-defense': 0, speed: 0 };
  saliente.confusion = 0; saliente.flinch = false;
  if (saliente.status === 'toxic') saliente.toxicN = 0;

  lado.activo = indice;
  lado.ultimoCambio = b.turno;
  const entra = activo(b, side);
  entra.vecesUsado += 1;
  ev.push({ t: 'msg', texto: side === 'player' ? `¡Adelante, ${entra.nombre}!` : `¡${b.lados.rival.nombre} envió a ${entra.nombre}!` });
  ev.push({ t: 'entrar', side, indice, mon: entra, hp: entra.hp, maxHp: entra.maxHp, estado: entra.status });
}

function usarMovimiento(b, att, def, move, ev) {
  const rng = b.rng;

  // --- Condiciones que impiden moverse ---
  if (att.status === 'sleep') {
    if (att.sleepTurns > 0) {
      att.sleepTurns -= 1;
      ev.push({ t: 'anim', side: att.side, tipo: 'dormir' });
      ev.push({ t: 'msg', texto: `${N(att)} está profundamente dormido.` });
      return;
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
      return;
    }
  }
  if (att.flinch) {
    att.flinch = false;
    ev.push({ t: 'msg', texto: `¡${N(att)} retrocedió y no se pudo mover!` });
    return;
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
        return;
      }
    }
  }
  if (att.status === 'paralysis' && rng() < 0.25) {
    ev.push({ t: 'anim', side: att.side, tipo: 'paralisis' });
    ev.push({ t: 'msg', texto: `¡${N(att)} está paralizado! No se puede mover.` });
    return;
  }

  // --- Usar el movimiento ---
  if (move !== FORCEJEO && move.ppLeft > 0) move.ppLeft -= 1;
  ev.push({ t: 'mover', side: att.side, move });
  ev.push({ t: 'msg', texto: `¡${N(att)} usó ${move.nombre}!`, cls: 'uso', tipo: move.type });

  const haciaMi = OBJETIVO_PROPIO.has(move.target);

  // Precisión
  if (!haciaMi && move.accuracy != null && rng() * 100 >= move.accuracy) {
    ev.push({ t: 'fallo', side: def.side });
    ev.push({ t: 'msg', texto: `¡${N(def)} esquivó el ataque!` });
    return;
  }

  if (move.category !== 'status' && move.power) {
    movimientoDanino(b, att, def, move, ev);
  } else {
    movimientoEstado(b, att, def, move, ev);
  }
}

function movimientoDanino(b, att, def, move, ev) {
  const rng = b.rng;
  const meta = move.meta || {};
  const eff = move.type === 'typeless' ? 1 : efectividad(move.type, def.types);
  if (eff === 0) {
    ev.push({ t: 'msg', texto: `No afecta ${A(def)}…` });
    return;
  }

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

  let total = 0; let hechos = 0; let huboCritico = false;
  for (let i = 0; i < golpes && def.hp > 0; i++) {
    const etapa = meta.critRate ?? 0;
    const prob = etapa >= 3 ? 1 : [1 / 24, 1 / 8, 1 / 2][etapa];
    const critico = rng() < prob;
    huboCritico ||= critico;
    const { danio } = calcularDanio(att, def, move, { critico, roll: 0.85 + rng() * 0.15 });
    const real = aplicarDanio(b, def, danio, ev, { eff, critico, tipo: move.type });
    total += real; hechos += 1;
    if (critico) ev.push({ t: 'msg', texto: '¡Un golpe crítico!', cls: 'critico' });
  }
  if (eff > 1) ev.push({ t: 'msg', texto: '¡Es súper eficaz!', cls: 'eficaz' });
  else if (eff < 1) ev.push({ t: 'msg', texto: 'No es muy eficaz…', cls: 'poco' });
  if (golpes > 1) ev.push({ t: 'msg', texto: `¡Golpeó ${hechos} ${hechos === 1 ? 'vez' : 'veces'}!` });

  const pct = Math.round((total / def.maxHp) * 100);
  ev.push({ t: 'msg', texto: `(${N(def)} perdió ${Math.min(100, pct)}% de sus PS)`, cls: 'detalle' });

  att.danioHecho += total;

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
      const objetivo = meta.category === 'damage-raise' ? att : def;
      if (objetivo.hp > 0) for (const s of move.statChanges) cambiarStat(objetivo, s.stat, s.change, ev);
    }
  }
}

function movimientoEstado(b, att, def, move, ev) {
  const meta = move.meta || {};
  const cat = meta.category;
  const haciaMi = OBJETIVO_PROPIO.has(move.target);
  let hizoAlgo = false;

  if (POLVOS.has(move.name) && def.types.includes('grass') && !haciaMi) {
    ev.push({ t: 'msg', texto: `No afecta ${A(def)}…` });
    return;
  }
  if (move.name === 'thunder-wave' && def.types.includes('ground')) {
    ev.push({ t: 'msg', texto: `No afecta ${A(def)}…` });
    return;
  }

  if (cat === 'heal' || (meta.healing > 0 && haciaMi)) {
    if (att.hp >= att.maxHp) {
      ev.push({ t: 'msg', texto: `¡Los PS ${DE(att)} están al máximo!` });
      return;
    }
    curar(att, Math.floor((att.maxHp * (meta.healing || 50)) / 100), ev);
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
  if (antes === despues) {
    ev.push({ t: 'msg', texto: `¡El ${nombre} ${DE(mon)} no puede ${cambio > 0 ? 'subir' : 'bajar'} más!` });
    return false;
  }
  mon.boosts[stat] = despues;
  const d = despues - antes;
  const intensidad = Math.abs(d) >= 3 ? 'muchísimo' : Math.abs(d) === 2 ? 'mucho' : '';
  ev.push({ t: 'stat', side: mon.side, stat, cambio: d, boosts: { ...mon.boosts } });
  ev.push({ t: 'msg', texto: `¡El ${nombre} ${DE(mon)} ${d > 0 ? 'subió' : 'bajó'}${intensidad ? ' ' + intensidad : ''}!`, cls: d > 0 ? 'sube' : 'baja' });
  return true;
}

export function tieneMovimientosUsables(mon) {
  return mon.moves.some((m) => m.ppLeft > 0);
}

export { TIPOS };
