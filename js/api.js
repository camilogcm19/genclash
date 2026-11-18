// ============================================================
//  GenClash · Consumo de la PokeAPI (https://pokeapi.co)
//  - Caché en memoria + localStorage para no repetir peticiones
//  - Límite de peticiones simultáneas
//  - Arma equipos aleatorios por generación con movimientos reales
// ============================================================
import { GENERACIONES, TODAS, LEGENDARIOS, MOVIMIENTOS_EXCLUIDOS, ESTADO_PERMITIDOS } from './data.js';

export const API = 'https://pokeapi.co/api/v2';
const RAW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
const CRIES = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon';
const VERSION_CACHE = 'gc3';

const memoria = new Map();
let peticionesHechas = 0;
export const contadorPeticiones = () => peticionesHechas;

// ---------- Utilidades ----------
const leerCache = (k) => { try { const v = localStorage.getItem(`${VERSION_CACHE}:${k}`); return v ? JSON.parse(v) : null; } catch { return null; } };
const guardarCache = (k, v) => {
  try { localStorage.setItem(`${VERSION_CACHE}:${k}`, JSON.stringify(v)); }
  catch { // almacenamiento lleno: limpiar la caché del juego y seguir
    try { Object.keys(localStorage).filter((x) => x.startsWith(`${VERSION_CACHE}:`)).forEach((x) => localStorage.removeItem(x)); } catch { /* sin almacenamiento */ }
  }
};

export const aleatorio = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
export function barajar(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const capitalizar = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const idDeUrl = (url) => Number(url.split('/').filter(Boolean).pop());
const textoEs = (lista, campo = 'name') => lista?.find((x) => x.language?.name === 'es')?.[campo];
const limpiar = (t) => (t || '').replace(/[\n\f­]+/g, ' ').replace(/\s+/g, ' ').trim();

/** fetch con caché en memoria, reintento y límite de concurrencia. */
const cola = []; let activos = 0; const MAX = 10;
function programar(fn) {
  return new Promise((res, rej) => {
    cola.push({ fn, res, rej });
    siguiente();
  });
}
function siguiente() {
  while (activos < MAX && cola.length) {
    const { fn, res, rej } = cola.shift();
    activos++;
    fn().then(res, rej).finally(() => { activos--; siguiente(); });
  }
}
export function obtenerJSON(url) {
  if (memoria.has(url)) return memoria.get(url);
  const p = programar(async () => {
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await fetch(url);
        peticionesHechas++;
        if (r.status === 404) throw Object.assign(new Error('404'), { noReintentar: true });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (e.noReintentar || intento === 2) throw e;
        await new Promise((ok) => setTimeout(ok, 400 * (intento + 1)));
      }
    }
  });
  memoria.set(url, p);
  p.catch(() => memoria.delete(url));
  return p;
}

// ---------- Generaciones ----------
export async function idsDeGeneracion(genId) {
  if (genId === LEGENDARIOS.id) return [...LEGENDARIOS.lista];
  if (genId === 0) {
    const [a, z] = TODAS.ids;
    return Array.from({ length: z - a + 1 }, (_, i) => a + i);
  }
  const k = `gen:${genId}`;
  const c = leerCache(k);
  if (c) return c;
  try {
    const g = await obtenerJSON(`${API}/generation/${genId}`);
    const ids = g.pokemon_species.map((s) => idDeUrl(s.url)).sort((a, b) => a - b);
    guardarCache(k, ids);
    return ids;
  } catch {
    const [a, z] = GENERACIONES.find((x) => x.id === genId).ids; // respaldo local
    return Array.from({ length: z - a + 1 }, (_, i) => a + i);
  }
}

// ---------- Pokémon ----------
export const sprites = (id) => ({
  frente: `${RAW}/pokemon/other/showdown/${id}.gif`,
  espalda: `${RAW}/pokemon/other/showdown/back/${id}.gif`,
  frenteFijo: `${RAW}/pokemon/${id}.png`,
  espaldaFija: `${RAW}/pokemon/back/${id}.png`,
  arte: `${RAW}/pokemon/other/official-artwork/${id}.png`,
  icono: `${RAW}/pokemon/versions/generation-viii/icons/${id}.png`,
});

export async function cargarPokemon(id) {
  const k = `mon:${id}`;
  const c = leerCache(k);
  if (c) return c;
  const [p, s] = await Promise.all([
    obtenerJSON(`${API}/pokemon/${id}`),
    obtenerJSON(`${API}/pokemon-species/${id}`).catch(() => null),
  ]);
  const base = Object.fromEntries(p.stats.map((x) => [x.stat.name, x.base_stat]));
  const sp = sprites(id);
  const datos = {
    id,
    nombre: textoEs(s?.names) || capitalizar(p.name),
    clave: p.name,
    categoria: textoEs(s?.genera, 'genus') || '',
    descripcion: limpiar(s?.flavor_text_entries?.filter((f) => f.language.name === 'es').pop()?.flavor_text),
    legendario: !!(s?.is_legendary || s?.is_mythical),
    types: p.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
    base,
    total: Object.values(base).reduce((a, b) => a + b, 0),
    altura: p.height / 10, peso: p.weight / 10,
    sprites: {
      frente: p.sprites?.other?.showdown?.front_default || sp.frente,
      espalda: p.sprites?.other?.showdown?.back_default || sp.espalda,
      frenteFijo: p.sprites?.front_default || sp.frenteFijo,
      espaldaFija: p.sprites?.back_default || p.sprites?.front_default || sp.frenteFijo,
      arte: p.sprites?.other?.['official-artwork']?.front_default || sp.arte,
      icono: p.sprites?.versions?.['generation-viii']?.icons?.front_default || p.sprites?.front_default || sp.frenteFijo,
    },
    grito: p.cries?.latest || `${CRIES}/latest/${id}.ogg`,
    movimientos: p.moves.map((m) => m.move.name).filter((n) => !MOVIMIENTOS_EXCLUIDOS.has(n) && !n.startsWith('max-') && !n.startsWith('g-max')),
  };
  guardarCache(k, datos);
  return datos;
}

// ---------- Movimientos ----------
export async function cargarMovimiento(nombre) {
  const k = `mv:${nombre}`;
  const c = leerCache(k);
  if (c) return c;
  const m = await obtenerJSON(`${API}/move/${nombre}`);
  const meta = m.meta ? {
    category: m.meta.category?.name, ailment: m.meta.ailment?.name, ailmentChance: m.meta.ailment_chance,
    drain: m.meta.drain, healing: m.meta.healing, critRate: m.meta.crit_rate, flinchChance: m.meta.flinch_chance,
    minHits: m.meta.min_hits, maxHits: m.meta.max_hits, statChance: m.meta.stat_chance,
  } : { category: m.damage_class?.name === 'status' ? 'unique' : 'damage' };
  const datos = {
    name: m.name,
    nombre: textoEs(m.names) || capitalizar(m.name),
    type: m.type?.name || 'normal',
    power: m.power, accuracy: m.accuracy, pp: m.pp || 10, priority: m.priority || 0,
    category: m.damage_class?.name || 'physical',
    target: m.target?.name,
    meta,
    statChanges: (m.stat_changes || []).map((s) => ({ stat: s.stat.name, change: s.change })),
    desc: limpiar(m.flavor_text_entries?.filter((f) => f.language.name === 'es').pop()?.flavor_text)
      || limpiar(m.effect_entries?.find((e) => e.language.name === 'en')?.short_effect),
  };
  guardarCache(k, datos);
  return datos;
}

const PLACAJE = {
  name: 'tackle', nombre: 'Placaje', type: 'normal', power: 40, accuracy: 100, pp: 35, priority: 0, category: 'physical',
  target: 'selected-pokemon', statChanges: [], desc: 'Embiste con todo el cuerpo.',
  meta: { category: 'damage', ailment: 'none', ailmentChance: 0, drain: 0, healing: 0, critRate: 0, flinchChance: 0, minHits: null, maxHits: null, statChance: 0 },
};

const esDaninoUtil = (m) => m.category !== 'status' && m.power >= 35 && !['ohko', 'unique', 'force-switch', 'field-effect', 'whole-field-effect'].includes(m.meta?.category);

/** Elige 4 movimientos competitivos: STAB, cobertura de tipos y, a veces, uno de estado. */
export async function elegirMovimientos(mon, rng = Math.random) {
  const pool = barajar(mon.movimientos, rng);
  const estados = pool.filter((n) => ESTADO_PERMITIDOS.has(n));
  const resto = pool.filter((n) => !ESTADO_PERMITIDOS.has(n));
  const candidatos = [];
  const lote = 8;
  for (let i = 0; i < resto.length && i < lote * 4; i += lote) {
    const nuevos = await Promise.all(resto.slice(i, i + lote).map((n) => cargarMovimiento(n).catch(() => null)));
    candidatos.push(...nuevos.filter(Boolean).filter(esDaninoUtil));
    const stab = candidatos.filter((m) => mon.types.includes(m.type));
    if (candidatos.length >= 5 && stab.length >= 1) break;
  }

  const atk = mon.base.attack; const spa = mon.base['special-attack'];
  const score = (m) => {
    const hits = m.meta?.maxHits ? ((m.meta.minHits ?? 1) + m.meta.maxHits) / 2 : 1;
    const lado = (m.category === 'physical' ? atk : spa) / Math.max(atk, spa);
    const retroceso = m.meta?.drain < 0 ? 0.9 : 1;
    return Math.min(m.power, 130) * hits * ((m.accuracy ?? 100) / 100) * (mon.types.includes(m.type) ? 1.5 : 1) * lado ** 1.5 * retroceso * (0.85 + rng() * 0.3);
  };
  const orden = [...new Map(candidatos.map((m) => [m.name, m])).values()].sort((a, b) => score(b) - score(a));

  const elegidos = [];
  const stab = orden.find((m) => mon.types.includes(m.type));
  if (stab) elegidos.push(stab);
  let usarEstado = estados.length && rng() < 0.4;
  const maxDanino = usarEstado ? 3 : 4;
  for (const m of orden) {
    if (elegidos.length >= maxDanino) break;
    if (elegidos.includes(m)) continue;
    if (elegidos.some((e) => e.type === m.type) && orden.length - elegidos.length > maxDanino - elegidos.length) continue; // priorizar cobertura
    elegidos.push(m);
  }
  for (const m of orden) { if (elegidos.length >= maxDanino) break; if (!elegidos.includes(m)) elegidos.push(m); }

  if (usarEstado) {
    const est = await cargarMovimiento(estados[0]).catch(() => null);
    if (est) elegidos.push(est); else usarEstado = false;
  }
  if (!elegidos.some((m) => m.category !== 'status')) elegidos.unshift(PLACAJE);
  return elegidos.slice(0, 4);
}

/** Nivel balanceado según estadísticas base (como en los combates aleatorios de Showdown). */
export const nivelPara = (total) => Math.max(70, Math.min(96, Math.round(100 - (total - 300) / 10)));

export function calcularStats(base, nivel) {
  const calc = (b) => Math.floor(((2 * b + 31 + 21) * nivel) / 100);
  return {
    hp: base.hp === 1 ? 1 : calc(base.hp) + nivel + 10,
    attack: calc(base.attack) + 5,
    defense: calc(base.defense) + 5,
    'special-attack': calc(base['special-attack']) + 5,
    'special-defense': calc(base['special-defense']) + 5,
    speed: calc(base.speed) + 5,
  };
}

/**
 * Arma un equipo aleatorio de la generación indicada.
 * @param {number} genId 0 = todas
 * @param {number} tamano 3 o 6
 * @param {(info:{hechos:number,total:number,ultimo?:object})=>void} progreso
 * @param {Set<number>} excluir ids que no deben repetirse (p. ej., el equipo del otro lado)
 */
export async function armarEquipo(genId, tamano, progreso = () => {}, excluir = new Set(), rng = Math.random) {
  const ids = (await idsDeGeneracion(genId)).filter((i) => !excluir.has(i));
  const barajados = barajar(ids, rng);
  const equipo = [];
  const usados = new Set();
  let cursor = 0;
  let hechos = 0;

  // Carga en paralelo, descartando (a veces) Pokémon muy débiles para batallas más interesantes
  while (equipo.length < tamano && cursor < barajados.length) {
    const faltan = tamano - equipo.length;
    const lote = barajados.slice(cursor, cursor + faltan);
    cursor += faltan;
    const res = await Promise.all(lote.map(async (id) => {
      try {
        const mon = await cargarPokemon(id);
        if (mon.total < 330 && rng() < 0.7 && cursor < barajados.length - tamano) return null;
        const nivel = nivelPara(mon.total);
        const moves = await elegirMovimientos(mon, rng);
        const build = { ...mon, level: nivel, stats: calcularStats(mon.base, nivel), moves };
        hechos++;
        progreso({ hechos, total: tamano, ultimo: build });
        return build;
      } catch (e) {
        console.warn('No se pudo cargar el Pokémon', id, e);
        return null;
      }
    }));
    for (const b of res) if (b && !usados.has(b.id) && equipo.length < tamano) { usados.add(b.id); equipo.push(b); }
  }
  if (equipo.length === 0) throw new Error('No se pudo conectar con la PokeAPI. Revisa tu conexión a internet.');
  return equipo;
}
