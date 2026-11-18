// ============================================================
//  GenClash · Juego en línea (Supabase Realtime)
//
//  1) Presencia global: cuántos entrenadores hay conectados.
//  2) Emparejamiento: cada generación/tamaño tiene una "sala de espera"
//     (canal con Presence). Los jugadores se ordenan por hora de llegada
//     y se emparejan de dos en dos: el primero invita al segundo.
//  3) Sala de batalla: canal privado de la pareja por donde viajan los
//     mensajes (equipos, acciones de cada turno, reemplazos, rendición).
//     Los dos navegadores ejecutan el mismo motor con la misma semilla,
//     así que solo hace falta enviar las ACCIONES, no el resultado.
// ============================================================
import { obtenerCliente } from './db.js';

const idAleatorio = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const MI_ID = idAleatorio(); // un id por pestaña

// ------------------------------------------------------------
//  Presencia global
// ------------------------------------------------------------
let canalGlobal = null;
export function conectarPresencia(usuario, alCambiar) {
  const c = obtenerCliente();
  if (!c) return () => {};
  if (canalGlobal) c.removeChannel(canalGlobal);
  canalGlobal = c.channel('genclash-en-linea', { config: { presence: { key: MI_ID } } });
  canalGlobal
    .on('presence', { event: 'sync' }, () => {
      const estado = canalGlobal.presenceState();
      const usuarios = new Set(Object.values(estado).flat().map((m) => m.usuario));
      alCambiar(usuarios.size);
    })
    .subscribe(async (s) => { if (s === 'SUBSCRIBED') await canalGlobal.track({ usuario, desde: Date.now() }); });
  return () => { c.removeChannel(canalGlobal); canalGlobal = null; };
}

// ------------------------------------------------------------
//  Sala de batalla
// ------------------------------------------------------------
export class Sala {
  constructor(id, { soyHost, yo, rival }) {
    this.id = id; this.soyHost = soyHost; this.yo = yo; this.rival = rival;
    this.manejadores = new Map();
    this.pendientes = new Map(); // mensajes que llegaron antes de registrar su manejador
    this.alSalirRival = null; this.alVolverRival = null;
    this.rivalPresente = false;
    this.cerrada = false;
    const c = obtenerCliente();
    this.canal = c.channel(`sala-${id}`, { config: { broadcast: { self: false, ack: true }, presence: { key: MI_ID } } });
    this.canal.on('broadcast', { event: 'msg' }, ({ payload }) => this._recibir(payload));
    this.canal.on('presence', { event: 'sync' }, () => {
      const ids = Object.keys(this.canal.presenceState());
      const presente = ids.some((k) => k !== MI_ID);
      if (presente && !this.rivalPresente) { this.rivalPresente = true; this.alVolverRival?.(); }
      if (!presente && this.rivalPresente) { this.rivalPresente = false; this.alSalirRival?.(); }
    });
    this.listo = new Promise((ok, mal) => {
      const limite = setTimeout(() => mal(new Error('No se pudo abrir la sala')), 10000);
      this.canal.subscribe(async (s) => {
        if (s === 'SUBSCRIBED') { clearTimeout(limite); await this.canal.track({ usuario: yo.usuario }); ok(); }
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(limite); mal(new Error('Error de conexión con la sala')); }
      });
    });
  }

  _recibir(msg) {
    if (!msg?.tipo) return;
    if (msg.tipo === 'inicio' && this._saludo) { clearInterval(this._saludo); this._saludo = null; }
    const fn = this.manejadores.get(msg.tipo);
    if (fn) fn(msg.datos, msg);
    else {
      if (!this.pendientes.has(msg.tipo)) this.pendientes.set(msg.tipo, []);
      this.pendientes.get(msg.tipo).push(msg);
    }
  }

  on(tipo, fn) {
    this.manejadores.set(tipo, fn);
    const cola = this.pendientes.get(tipo);
    if (cola) { this.pendientes.delete(tipo); cola.forEach((m) => fn(m.datos, m)); }
    return this;
  }

  async enviar(tipo, datos = {}) {
    if (this.cerrada) return;
    try {
      await this.canal.send({ type: 'broadcast', event: 'msg', payload: { tipo, datos, de: MI_ID } });
    } catch (e) { console.warn('No se pudo enviar', tipo, e); }
  }

  cerrar() {
    if (this.cerrada) return;
    this.cerrada = true;
    if (this._saludo) clearInterval(this._saludo);
    try { obtenerCliente()?.removeChannel(this.canal); } catch { /* nada */ }
  }
}

// ------------------------------------------------------------
//  Emparejamiento
// ------------------------------------------------------------
/**
 * Busca un rival que esté esperando en la misma generación y tamaño de equipo.
 * Devuelve { promesa, cancelar }. La promesa se resuelve con una Sala lista.
 */
export function buscarRival({ gen, tamano, usuario, alActualizar = () => {} }) {
  const c = obtenerCliente();
  if (!c) return { promesa: Promise.reject(new Error('El modo en línea necesita Supabase configurado.')), cancelar() {} };

  const yo = { id: MI_ID, usuario };
  const llegada = Date.now();
  const lobby = c.channel(`espera-g${gen}-t${tamano}`, { config: { broadcast: { self: false }, presence: { key: MI_ID } } });
  let emparejado = false; let invitacion = null; let cancelado = false;
  let resolver; let rechazar;
  const promesa = new Promise((ok, mal) => { resolver = ok; rechazar = mal; });

  const terminar = (sala) => {
    emparejado = true;
    try { lobby.untrack(); c.removeChannel(lobby); } catch { /* nada */ }
    resolver(sala);
  };

  const esperando = () => Object.values(lobby.presenceState()).flat()
    .filter((m) => m.id && !m.ocupado)
    .sort((a, b) => a.llegada - b.llegada || (a.id < b.id ? -1 : 1));

  async function invitar(otro) {
    const salaId = idAleatorio();
    invitacion = { para: otro.id, salaId };
    const sala = new Sala(salaId, { soyHost: true, yo, rival: { id: otro.id, usuario: otro.usuario } });
    try { await sala.listo; } catch { sala.cerrar(); invitacion = null; return; }
    let hecho = false;
    sala.on('hola', () => { if (!hecho && !cancelado) { hecho = true; clearTimeout(sala._limite); terminar(sala); } });
    await lobby.send({ type: 'broadcast', event: 'invitar', payload: { de: MI_ID, deUsuario: usuario, para: otro.id, sala: salaId } });
    sala._limite = setTimeout(() => {
      if (!hecho) { sala.cerrar(); invitacion = null; revisar(); }
    }, 8000);
  }

  function revisar() {
    if (emparejado || cancelado || invitacion) return;
    const lista = esperando();
    alActualizar({ esperando: lista.length });
    const i = lista.findIndex((m) => m.id === MI_ID);
    if (i >= 0 && i % 2 === 0 && lista[i + 1]) invitar(lista[i + 1]);
  }

  lobby
    .on('presence', { event: 'sync' }, revisar)
    .on('broadcast', { event: 'invitar' }, async ({ payload }) => {
      if (payload.para !== MI_ID || emparejado || cancelado || invitacion) return;
      emparejado = true;
      const sala = new Sala(payload.sala, { soyHost: false, yo, rival: { id: payload.de, usuario: payload.deUsuario } });
      try {
        await sala.listo;
        // Saludamos hasta que el anfitrión responda con el inicio de la partida
        const saludar = () => sala.enviar('hola', { usuario });
        saludar();
        sala._saludo = setInterval(saludar, 1500);
        terminar(sala);
      } catch (e) {
        emparejado = false; sala.cerrar(); revisar();
      }
    })
    .subscribe(async (s) => {
      if (s === 'SUBSCRIBED') await lobby.track({ id: MI_ID, usuario, llegada });
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') rechazar(new Error('No se pudo conectar con el servidor en tiempo real.'));
    });

  return {
    promesa,
    cancelar() {
      cancelado = true;
      try { lobby.untrack(); c.removeChannel(lobby); } catch { /* nada */ }
      rechazar(Object.assign(new Error('cancelado'), { cancelado: true }));
    },
  };
}
