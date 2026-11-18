// ============================================================
//  GenClash · Inteligencia del rival
//  Evalúa daño esperado, KOs, estados y amenazas para decidir
//  entre atacar, usar un movimiento de estado o cambiar.
// ============================================================
import { activo, otro, opcionesCambio, danioEstimado, velocidad, FORCEJEO } from './battle.js';
import { efectividad } from './data.js';

const ETIQUETA_BOOST = new Set(['net-good-stats']);

/** Puntuación (0-100+) de usar `move` desde `yo` contra `foe`. */
function valorMovimiento(yo, foe, move, rng) {
  if (move.ppLeft <= 0) return -1;
  const meta = move.meta || {};
  const acc = (move.accuracy ?? 100) / 100;

  if (move.category !== 'status' && move.power) {
    const dmg = danioEstimado(yo, foe, move) * acc;
    if (dmg >= foe.hp) return 200 + (move.priority > 0 ? 40 : 0) + acc * 20; // puede noquear
    let v = (dmg / foe.hp) * 100;
    if (meta.drain > 0 && yo.hp < yo.maxHp * 0.6) v *= 1.15;
    if (meta.drain < 0) v *= 0.9;
    if (meta.ailment && meta.ailment !== 'none' && !foe.status) v += (meta.ailmentChance || 0) * 0.3;
    return v;
  }

  // Movimientos de estado
  const pctYo = yo.hp / yo.maxHp;
  const amenaza = amenazaMaxima(foe, yo) / yo.hp; // 1 = me noquea
  if (meta.category === 'heal' || meta.healing > 0) {
    if (pctYo > 0.7) return 0;
    return amenaza < 0.5 ? 70 : 30;
  }
  if (meta.category === 'ailment' || meta.category === 'swagger') {
    if (meta.ailment === 'confusion') return foe.confusion ? 0 : 22;
    if (foe.status) return 0;
    if ((move.name === 'thunder-wave' && foe.types.includes('ground')) || (meta.ailment === 'paralysis' && foe.types.includes('electric'))) return 0;
    if (meta.ailment === 'burn' && foe.types.includes('fire')) return 0;
    if ((meta.ailment === 'poison') && (foe.types.includes('poison') || foe.types.includes('steel'))) return 0;
    if (meta.ailment === 'sleep') return 58 * acc;
    if (meta.ailment === 'paralysis') return (velocidad(foe) > velocidad(yo) ? 55 : 35) * acc;
    if (meta.ailment === 'burn') return (foe.stats.attack > foe.stats['special-attack'] ? 55 : 30) * acc;
    return 40 * acc;
  }
  if (ETIQUETA_BOOST.has(meta.category)) {
    const sube = move.statChanges.some((s) => s.change > 0);
    if (sube) {
      const yaSubido = move.statChanges.some((s) => (yo.boosts[s.stat] ?? 0) >= 2);
      if (yaSubido || pctYo < 0.55 || amenaza > 0.6) return 3;
      return 48 + rng() * 10;
    }
    return 12;
  }
  return 5;
}

/** El mayor daño que `att` le puede hacer a `def` con sus movimientos. */
export function amenazaMaxima(att, def) {
  return Math.max(0, ...att.moves.filter((m) => m.ppLeft > 0).map((m) => danioEstimado(att, def, m) * ((m.accuracy ?? 100) / 100)));
}

/** Decide la acción del rival para este turno. */
export function decidirAccion(b, side = 'rival') {
  const yo = activo(b, side);
  const foe = activo(b, otro(side));
  const rng = b.rng;

  if (!yo.moves.some((m) => m.ppLeft > 0)) return { tipo: 'mover', indice: -1 }; // Forcejeo

  const puntajes = yo.moves.map((m, i) => ({ i, v: valorMovimiento(yo, foe, m, rng) })).filter((x) => x.v >= 0);
  puntajes.sort((a, z) => z.v - a.v);

  // ¿Conviene cambiar? Solo si me noquean y no puedo hacer mucho.
  const opciones = opcionesCambio(b, side);
  const mePuedeNoquear = amenazaMaxima(foe, yo) >= yo.hp;
  const masRapido = velocidad(foe) > velocidad(yo);
  const mejor = puntajes[0];
  if (opciones.length && mePuedeNoquear && masRapido && mejor.v < 200 && b.turno - b.lados[side].ultimoCambio > 2) {
    const candidato = mejorReemplazo(b, side, opciones);
    const amenazaCand = amenazaMaxima(foe, b.lados[side].equipo[candidato]) / b.lados[side].equipo[candidato].hp;
    if (amenazaCand < 0.45 && rng() < 0.65) return { tipo: 'cambiar', indice: candidato };
  }

  // Un toque humano: a veces elige la segunda mejor opción si es parecida
  if (puntajes.length > 1 && puntajes[1].v > puntajes[0].v * 0.8 && rng() < 0.25) {
    return { tipo: 'mover', indice: puntajes[1].i };
  }
  return { tipo: 'mover', indice: mejor.i };
}

/** Elige el mejor Pokémon para entrar contra el rival activo. */
export function mejorReemplazo(b, side = 'rival', opciones = opcionesCambio(b, side)) {
  const foe = activo(b, otro(side));
  let mejor = opciones[0]; let mejorV = -Infinity;
  for (const i of opciones) {
    const p = b.lados[side].equipo[i];
    const ofensa = amenazaMaxima(p, foe) / foe.hp;
    const defensa = amenazaMaxima(foe, p) / p.hp;
    const tipos = Math.max(...p.types.map((t) => efectividad(t, foe.types)));
    const v = ofensa * 1.2 - defensa + tipos * 0.15 + (p.hp / p.maxHp) * 0.2 + b.rng() * 0.05;
    if (v > mejorV) { mejorV = v; mejor = i; }
  }
  return mejor;
}

export { FORCEJEO };
