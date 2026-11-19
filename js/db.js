// ============================================================
//  GenClash · Base de datos (Supabase)
//  - Cuentas con usuario y contraseña (funciones SQL, sin correo)
//  - Partidas, ranking y tiempo real
//  Ver supabase/schema.sql
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let cliente = null;
try {
  if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase?.createClient) {
    cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
} catch (e) {
  console.warn('Supabase no disponible, se usará modo local.', e);
}

export const enLinea = () => !!cliente;
export const obtenerCliente = () => cliente;

// ------------------------------------------------------------
//  Sesión
// ------------------------------------------------------------
const CLAVE_SESION = 'gc:sesion';
let sesion = (() => { try { return JSON.parse(localStorage.getItem(CLAVE_SESION)); } catch { return null; } })();
export const sesionActual = () => sesion;
const guardarSesion = (s) => { sesion = s; try { s ? localStorage.setItem(CLAVE_SESION, JSON.stringify(s)) : localStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ } };

const ERRORES = {
  USUARIO_INVALIDO: 'El usuario debe tener de 3 a 16 letras, números o guion bajo, sin espacios.',
  PASSWORD_INVALIDA: 'La contraseña debe tener al menos 4 caracteres.',
  USUARIO_EXISTE: 'Ese usuario ya existe. Elige otro o inicia sesión.',
  CREDENCIALES: 'Usuario o contraseña incorrectos.',
  SESION_INVALIDA: 'Tu sesión expiró. Vuelve a iniciar sesión.',
};
const traducir = (error) => {
  const m = error?.message || String(error);
  const clave = Object.keys(ERRORES).find((k) => m.includes(k));
  if (clave) return ERRORES[clave];
  if (/fetch|network/i.test(m)) return 'No hay conexión con el servidor. Revisa tu internet.';
  return m;
};

async function rpc(nombre, args) {
  const { data, error } = await cliente.rpc(nombre, args);
  if (error) throw new Error(traducir(error));
  return data;
}

export async function registrar(usuario, password) {
  usuario = usuario.trim();
  if (!/^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚüÜ]{3,16}$/.test(usuario)) throw new Error(ERRORES.USUARIO_INVALIDO);
  if (password.length < 4) throw new Error(ERRORES.PASSWORD_INVALIDA);
  if (!cliente) { guardarSesion({ token: 'local', usuario }); return sesion; }
  const r = await rpc('registrar', { p_usuario: usuario, p_password: password });
  guardarSesion({ token: r.token, usuario: r.usuario });
  return sesion;
}

export async function iniciarSesion(usuario, password) {
  usuario = usuario.trim();
  if (!usuario || !password) throw new Error('Escribe tu usuario y tu contraseña.');
  if (!cliente) { guardarSesion({ token: 'local', usuario }); return sesion; }
  const r = await rpc('iniciar_sesion', { p_usuario: usuario, p_password: password });
  guardarSesion({ token: r.token, usuario: r.usuario });
  return sesion;
}

/** Revisa que la sesión guardada siga siendo válida. */
export async function verificarSesion() {
  if (!sesion) return null;
  if (!cliente) return sesion;
  try {
    const r = await rpc('sesion_actual', { p_token: sesion.token });
    if (!r) { guardarSesion(null); return null; }
    sesion.usuario = r.usuario;
    return sesion;
  } catch {
    return sesion; // sin internet: se mantiene y se valida al guardar
  }
}

export async function cerrarSesion() {
  const s = sesion;
  guardarSesion(null);
  if (cliente && s?.token) { try { await cliente.rpc('cerrar_sesion', { p_token: s.token }); } catch { /* da igual */ } }
}

// ------------------------------------------------------------
//  Partidas y ranking
// ------------------------------------------------------------
const CLAVE_LOCAL = 'gc:partidas';
const leerLocal = () => { try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL)) || []; } catch { return []; } };
const guardarLocal = (lista) => { try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(lista.slice(0, 200))); } catch { /* lleno */ } };

/** Guarda el resultado de una batalla a nombre del usuario con sesión. */
export async function guardarPartida(partida) {
  const fila = { ...partida, jugador: sesion?.usuario || 'Invitado', creado_en: new Date().toISOString() };
  guardarLocal([fila, ...leerLocal()]);
  if (!cliente) return { ok: true, remoto: false };
  if (!sesion) return { ok: false, error: 'Inicia sesión para guardar en el ranking.' };
  try {
    await rpc('guardar_partida', { p_token: sesion.token, p: partida });
    return { ok: true, remoto: true };
  } catch (e) {
    return { ok: false, remoto: true, error: e.message };
  }
}

// ---------- Equipo personalizado ----------
const claveEquipo = () => `gc:equipo:${(sesion?.usuario || 'invitado').toLowerCase()}`;
const equipoValido = (e) => Array.isArray(e) && e.length <= 6 && e.every((x) => Number.isInteger(x?.id) && Array.isArray(x.moves) && x.moves.length <= 4);

/** Lee el equipo guardado: primero en Supabase (si hay sesión) y si no, en este navegador. */
export async function cargarEquipo() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(claveEquipo()) || '[]'); } catch { local = []; }
  if (!equipoValido(local)) local = [];
  if (!cliente || !sesion) return local;
  try {
    const remoto = await rpc('obtener_equipo', { p_token: sesion.token });
    if (equipoValido(remoto) && remoto.length) { localStorage.setItem(claveEquipo(), JSON.stringify(remoto)); return remoto; }
  } catch (e) { console.warn('No se pudo leer el equipo de Supabase', e); }
  return local;
}

/** Guarda el equipo en este navegador y en Supabase. */
export async function guardarEquipo(equipo) {
  const limpio = equipo.filter((x) => x && x.id).map((x) => ({ id: x.id, moves: x.moves.slice(0, 4) })).slice(0, 6);
  localStorage.setItem(claveEquipo(), JSON.stringify(limpio));
  if (!cliente || !sesion) return { ok: true, remoto: false };
  try { await rpc('guardar_equipo', { p_token: sesion.token, p_equipo: limpio }); return { ok: true, remoto: true }; } catch (e) { return { ok: false, error: e.message }; }
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
    .select('id, jugador, rival_nombre, generacion, resultado, turnos, restantes, mvp_id, mvp_nombre, tamano, modo, creado_en')
    .order('creado_en', { ascending: false }).limit(limite);
  if (error) throw error;
  return data;
}

export async function obtenerEstadisticas() {
  let filas;
  if (!cliente) filas = leerLocal();
  else {
    const { data, error } = await cliente.from('partidas').select('jugador, generacion, resultado, mvp_id, mvp_nombre, modo').order('creado_en', { ascending: false }).limit(1000);
    if (error) throw error;
    filas = data;
  }
  const total = filas.length;
  const mvps = new Map();
  for (const f of filas) if (f.resultado === 'victoria' && f.mvp_id) {
    const r = mvps.get(f.mvp_id) || { id: f.mvp_id, nombre: f.mvp_nombre, veces: 0 };
    r.veces++; mvps.set(f.mvp_id, r);
  }
  return {
    total,
    jugadores: new Set(filas.map((f) => f.jugador)).size,
    duelos: Math.round(filas.filter((f) => f.modo === 'pvp').length / 2),
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
