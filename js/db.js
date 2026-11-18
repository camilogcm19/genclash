// ============================================================
//  GenClash · Base de datos (Supabase)
//  Tabla `partidas` + vista `ranking` (ver supabase/schema.sql).
//  Incluye respaldo en localStorage si Supabase no está configurado.
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let cliente = null;
try {
  if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase?.createClient) {
    cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.warn('Supabase no disponible, se usará modo local.', e);
}

export const enLinea = () => !!cliente;

const CLAVE_LOCAL = 'gc:partidas';
const leerLocal = () => { try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL)) || []; } catch { return []; } };
const guardarLocal = (lista) => { try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(lista.slice(0, 200))); } catch { /* lleno */ } };

/** Guarda el resultado de una batalla. Devuelve { ok, remoto }. */
export async function guardarPartida(partida) {
  const fila = { ...partida, creado_en: new Date().toISOString() };
  guardarLocal([fila, ...leerLocal()]);
  if (!cliente) return { ok: true, remoto: false };
  const { creado_en, ...sinFecha } = fila;
  const { error } = await cliente.from('partidas').insert(sinFecha);
  if (error) { console.error(error); return { ok: false, remoto: true, error: error.message }; }
  return { ok: true, remoto: true };
}

function rankingDesde(filas) {
  const m = new Map();
  for (const f of filas) {
    const r = m.get(f.jugador) || { jugador: f.jugador, victorias: 0, derrotas: 0, partidas: 0 };
    r.partidas++; f.resultado === 'victoria' ? r.victorias++ : r.derrotas++;
    m.set(f.jugador, r);
  }
  return [...m.values()].map((r) => ({ ...r, porcentaje: Math.round((r.victorias / r.partidas) * 1000) / 10 }))
    .sort((a, b) => b.victorias - a.victorias || b.porcentaje - a.porcentaje).slice(0, 10);
}

export async function obtenerRanking() {
  if (!cliente) return rankingDesde(leerLocal());
  const { data, error } = await cliente.from('ranking').select('*')
    .order('victorias', { ascending: false }).order('porcentaje', { ascending: false }).limit(10);
  if (error) throw error;
  return data;
}

export async function obtenerRecientes(limite = 8) {
  if (!cliente) return leerLocal().slice(0, limite);
  const { data, error } = await cliente.from('partidas')
    .select('id, jugador, rival_nombre, generacion, resultado, turnos, restantes, mvp_id, mvp_nombre, tamano, creado_en')
    .order('creado_en', { ascending: false }).limit(limite);
  if (error) throw error;
  return data;
}

export async function obtenerEstadisticas() {
  let filas;
  if (!cliente) filas = leerLocal();
  else {
    const { data, error } = await cliente.from('partidas').select('jugador, generacion, resultado, mvp_id, mvp_nombre').order('creado_en', { ascending: false }).limit(1000);
    if (error) throw error;
    filas = data;
  }
  const total = filas.length;
  const victorias = filas.filter((f) => f.resultado === 'victoria').length;
  const contar = (campo) => {
    const c = new Map();
    for (const f of filas) if (f[campo] != null) c.set(f[campo], (c.get(f[campo]) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  };
  const gens = contar('generacion');
  const mvps = new Map();
  for (const f of filas) if (f.resultado === 'victoria' && f.mvp_id) {
    const r = mvps.get(f.mvp_id) || { id: f.mvp_id, nombre: f.mvp_nombre, veces: 0 };
    r.veces++; mvps.set(f.mvp_id, r);
  }
  return {
    total,
    jugadores: new Set(filas.map((f) => f.jugador)).size,
    porcentajeGlobal: total ? Math.round((victorias / total) * 100) : 0,
    genFavorita: gens[0]?.[0] ?? '—',
    topMvp: [...mvps.values()].sort((a, b) => b.veces - a.veces).slice(0, 3),
  };
}

export async function recordDe(jugador) {
  if (!jugador) return null;
  if (!cliente) {
    const f = leerLocal().filter((x) => x.jugador === jugador);
    return { victorias: f.filter((x) => x.resultado === 'victoria').length, derrotas: f.filter((x) => x.resultado === 'derrota').length };
  }
  const { data, error } = await cliente.from('ranking').select('victorias, derrotas').eq('jugador', jugador).maybeSingle();
  if (error) return null;
  return data || { victorias: 0, derrotas: 0 };
}

/** Escucha en tiempo real las partidas nuevas de cualquier jugador. */
export function escucharPartidas(callback) {
  if (!cliente) return () => {};
  const canal = cliente.channel('partidas-en-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'partidas' }, (p) => callback(p.new))
    .subscribe();
  return () => cliente.removeChannel(canal);
}
