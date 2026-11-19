// ============================================================
//  GenClash · Inteligencia del rival
//  Evalúa daño esperado, KOs, estados y amenazas para decidir
//  entre atacar, usar un movimiento de estado o cambiar.
// ============================================================
import { activo, otro, opcionesCambio, danioEstimado, velocidad, vivos, FORCEJEO, MOVS_RECARGA, MOVS_CARGA, accionForzada } from './battle.js';
import { efectividad } from './data.js';

const ETIQUETA_BOOST = new Set(['net-good-stats']);

/** Puntuación (0-100+) de usar `move` desde `yo` contra `foe`. */
function valorMovimiento(yo, foe, move, rng, b) {
  if (move.ppLeft <= 0) return -1;
  const meta = move.meta || {};
  const acc = (move.accuracy ?? 100) / 100;
  const n = move.name;

  if (move.category !== 'status') {
    if ((n === 'fake-out' || n === 'first-impression') && b && b.turno + 1 - yo.turnoEntrada !== 1) return 0;
    if (n === 'dream-eater' && foe.status !== 'sleep') return 0;
    if (n === 'focus-punch') return 8;
    if (n === 'counter') return foe.stats.attack > foe.stats['special-attack'] && yo.hp > yo.maxHp * 0.5 ? 30 : 4;
    if (n === 'mirror-coat') return foe.stats['special-attack'] > foe.stats.attack && yo.hp > yo.maxHp * 0.5 ? 30 : 4;
    if (n === 'metal-burst' || n === 'comeuppance') return 12;
    if (['self-destruct', 'explosion', 'misty-explosion', 'final-gambit', 'memento'].includes(n) && yo.hp > yo.maxHp * 0.35) return 3;
    const dmg = danioEstimado(yo, foe, move, b) * acc;
    if (dmg >= foe.hp) return 200 + (move.priority > 0 ? 40 : 0) + acc * 20; // puede noquear
    let v = (dmg / foe.hp) * 100;
    if (MOVS_RECARGA.has(n)) v *= 0.7;
    if (MOVS_CARGA[n]) v *= MOVS_CARGA[n].inv ? 0.65 : 0.55;
    if (n === 'fake-out') v += 30;
    if (meta.drain > 0 && yo.hp < yo.maxHp * 0.6) v *= 1.15;
    if (meta.drain < 0) v *= 0.9;
    if (meta.ailment && meta.ailment !== 'none' && !foe.status) v += (meta.ailmentChance || 0) * 0.3;
    return v;
  }

  // Movimientos de estado
  const pctYo = yo.hp / yo.maxHp;
  const amenaza = amenazaMaxima(foe, yo) / yo.hp; // 1 = me noquea
  if (b) {
    const ladoFoe = b.lados[foe.side]; const ladoYo = b.lados[yo.side];
    const quedanFoe = vivos(b, foe.side).length;
    const especiales = {
      'stealth-rock': () => (!ladoFoe.trampas.rocas && quedanFoe > 1 ? 46 : 0),
      spikes: () => (ladoFoe.trampas.puas < 3 && quedanFoe > 1 ? 34 - ladoFoe.trampas.puas * 8 : 0),
      'toxic-spikes': () => (ladoFoe.trampas.toxicas < 2 && quedanFoe > 1 ? 28 : 0),
      'leech-seed': () => (!foe.types.includes('grass') && !foe.drenadoras ? 42 : 0),
      reflect: () => (!ladoYo.pantallas.reflect && foe.stats.attack >= foe.stats['special-attack'] ? 38 : 0),
      'light-screen': () => (!ladoYo.pantallas['light-screen'] && foe.stats['special-attack'] > foe.stats.attack ? 38 : 0),
      'aurora-veil': () => (!ladoYo.pantallas['aurora-veil'] ? 40 : 0),
      protect: () => (yo.protecciones ? 0 : 8), detect: () => (yo.protecciones ? 0 : 8),
      taunt: () => (foe.mofa ? 0 : 14),
      haze: () => (Object.values(foe.boosts).reduce((a, v) => a + Math.max(0, v), 0) >= 2 ? 62 : 0),
      rest: () => (pctYo < 0.4 ? 60 : 0),
      'belly-drum': () => (pctYo > 0.75 && amenaza < 0.45 ? 58 : 0),
      'pain-split': () => (foe.hp > yo.hp * 1.6 ? 52 : 0),
      'heal-bell': () => (ladoYo.equipo.some((m) => m.hp > 0 && m.status) ? 45 : 0),
      aromatherapy: () => (ladoYo.equipo.some((m) => m.hp > 0 && m.status) ? 45 : 0),
      refresh: () => (yo.status && yo.status !== 'sleep' ? 45 : 0),
      'focus-energy': () => (yo.critBonus ? 0 : 10),
      curse: () => (yo.types.includes('ghost') ? (foe.maldito ? 0 : 26) : (yo.boosts.attack >= 2 || amenaza > 0.6 ? 3 : 40)),
      defog: () => (ladoYo.trampas.rocas || ladoYo.trampas.puas ? 45 : 2),
      'tidy-up': () => (amenaza < 0.6 ? 44 : 4),
      memento: () => (pctYo < 0.3 ? 30 : 2),
      'healing-wish': () => (pctYo < 0.25 ? 30 : 0), 'lunar-dance': () => (pctYo < 0.25 ? 30 : 0),
    };
    const climas = { 'rain-dance': 'rain', 'sunny-day': 'sun', sandstorm: 'sand', hail: 'snow', snowscape: 'snow', 'chilly-reception': 'snow' };
    if (climas[n]) return b.clima?.tipo === climas[n] ? 0 : 26;
    if (especiales[n]) return especiales[n]();
    if (['kings-shield', 'spiky-shield', 'baneful-bunker', 'silk-trap', 'obstruct', 'burning-bulwark'].includes(n)) return yo.protecciones ? 0 : 10;
  }
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

  const forzada = accionForzada(b, side);
  if (forzada) return forzada;
  if (!yo.moves.some((m) => m.ppLeft > 0)) return { tipo: 'mover', indice: -1 }; // Forcejeo

  const puntajes = yo.moves.map((m, i) => ({ i, v: valorMovimiento(yo, foe, m, rng, b) })).filter((x) => x.v >= 0);
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
