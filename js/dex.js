// ============================================================
//  GenDex: el asistente del juego (una Pokédex con personalidad)
//  - Pokédex de los 1025 Pokémon: arte, tipos, estadísticas,
//    debilidades y resistencias, descripción y grito.
//  - En batalla analiza el combate y da consejos cada turno.
//  Diseño propio del juego (una tablet flotante con ojos en pantalla).
// ============================================================
import { TIPOS, STATS_ES, efectividad } from './data.js';
import { cargarPokemon, listaEspecies, sprites } from './api.js';
import { activo, otro, vivos, danioEstimado, rangoVelocidad, velocidad } from './battle.js';
import { amenazaMaxima } from './ai.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalizar = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const nombreClave = (k) => k.split('-').map((p) => p[0]?.toUpperCase() + p.slice(1)).join(' ');
const badge = (t) => `<span class="tipo" style="--c:${TIPOS[t]?.color}">${TIPOS[t]?.es ?? t}</span>`;

// ---------- Pokémon vistos (se guardan en este navegador) ----------
let vistos = {};
try { vistos = JSON.parse(localStorage.getItem('gc:vistos') || '{}'); } catch { vistos = {}; }
export function registrarVistos(mons) {
  let nuevos = 0;
  for (const m of mons) if (m?.id && !vistos[m.id]) { vistos[m.id] = m.nombre; nuevos++; }
  if (nuevos) localStorage.setItem('gc:vistos', JSON.stringify(vistos));
  return nuevos;
}
export const totalVistos = () => Object.keys(vistos).length;

// ---------- Cálculo de debilidades ----------
const TODOS_TIPOS = Object.keys(TIPOS).filter((t) => t !== 'typeless');
export function tablaDefensiva(types) {
  const grupos = { x4: [], x2: [], x05: [], x025: [], x0: [] };
  for (const t of TODOS_TIPOS) {
    const m = efectividad(t, types);
    if (m >= 4) grupos.x4.push(t); else if (m >= 2) grupos.x2.push(t);
    else if (m === 0) grupos.x0.push(t); else if (m <= 0.25) grupos.x025.push(t); else if (m < 1) grupos.x05.push(t);
  }
  return grupos;
}

// ---------- La mascota (SVG propio) ----------
const CARA = `<svg class="dex-svg" viewBox="0 0 80 80" aria-hidden="true">
  <line x1="40" y1="12" x2="40" y2="3" stroke="#1d4f73" stroke-width="3" stroke-linecap="round"/>
  <circle class="dex-antena" cx="40" cy="4" r="4" fill="#ffd84a"/>
  <rect x="8" y="12" width="64" height="56" rx="18" fill="#2bb3c0" stroke="#1d4f73" stroke-width="3"/>
  <rect x="8" y="12" width="64" height="20" rx="14" fill="#5fd6e0" opacity=".55"/>
  <rect x="16" y="22" width="48" height="34" rx="10" fill="#10263b"/>
  <g class="dex-ojos"><rect x="25" y="31" width="9" height="14" rx="4" fill="#7ff7ff"/><rect x="46" y="31" width="9" height="14" rx="4" fill="#7ff7ff"/></g>
  <path class="dex-boca" d="M33 50 Q40 54 47 50" stroke="#7ff7ff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <circle cx="4" cy="44" r="5" fill="#2bb3c0" stroke="#1d4f73" stroke-width="2.5"/>
  <circle cx="76" cy="44" r="5" fill="#2bb3c0" stroke="#1d4f73" stroke-width="2.5"/>
  <rect x="30" y="68" width="20" height="5" rx="2.5" fill="#1d4f73" opacity=".25"/>
</svg>`;

export class GenDex {
  constructor({ sfx, grito, batalla, miLado, autoConsejos }) {
    this.sfx = sfx; this.grito = grito; this.batalla = batalla; this.miLado = miLado;
    this.autoConsejos = autoConsejos;
    this.especies = null; this.timer = null; this.idActual = null;
    this._crear();
  }

  _crear() {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dex-boton'; b.id = 'dexBoton';
    b.setAttribute('aria-label', 'Abrir GenDex, la Pokédex del juego');
    b.innerHTML = `${CARA}<span class="dex-globo" role="status" aria-live="polite" hidden></span>`;
    document.body.append(b);
    this.boton = b; this.globo = $('.dex-globo', b);
    this.globo.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      const enlace = e.target.closest('[data-dex-abrir]');
      if (enlace) this.abrir(Number(enlace.dataset.dexAbrir)); else this.callar();
    });
    b.addEventListener('click', () => {
      if (this.enBatalla() && this.globo.hidden) { this.consejo(true); return; }
      this.abrir(this.enBatalla() ? activo(this.batalla(), otro(this.miLado())).id : this.idActual);
    });

    const d = document.createElement('dialog');
    d.className = 'modal modal-dex'; d.id = 'modalDex'; d.setAttribute('aria-labelledby', 't-dex');
    d.innerHTML = `
      <form method="dialog"><button class="cerrar" aria-label="Cerrar">×</button></form>
      <header class="dex-cab"><span class="dex-mini">${CARA}</span><div><h2 id="t-dex">GenDex</h2><p class="dex-vistos" id="dexVistos"></p></div></header>
      <div class="dex-cuerpo">
        <div class="dex-lista-col">
          <label class="eq-label" for="dexBuscar">Buscar Pokémon</label>
          <input id="dexBuscar" type="search" placeholder="Nombre o número: eevee, 448…" autocomplete="off" spellcheck="false" />
          <ul class="dex-lista" id="dexLista" aria-label="Resultados"></ul>
        </div>
        <article class="dex-ficha" id="dexFicha" aria-live="polite"></article>
      </div>`;
    document.body.append(d);
    this.dialogo = d;
    $('#dexBuscar', d).addEventListener('input', () => this._lista());
    $('#dexLista', d).addEventListener('click', (e) => { const x = e.target.closest('[data-dex-id]'); if (x) this.ficha(Number(x.dataset.dexId)); });
    $('#dexFicha', d).addEventListener('click', (e) => { if (e.target.closest('#dexGrito')) this.grito(this._mon?.grito, { volumen: 0.4 }); });
    setInterval(() => this.boton.classList.toggle('parpadea'), 3800);
  }

  enBatalla() { const b = this.batalla(); return !!(b && !b.terminada && document.querySelector('#pantalla-batalla.activa')); }

  /** Coloca a la mascota: flotando en la esquina, o dentro de la arena durante la batalla. */
  acomodar(pantalla) {
    this.boton.hidden = pantalla === 'login';
    const lcd = document.getElementById('lcd');
    if (pantalla === 'batalla' && lcd) { lcd.append(this.boton, this.globo); lcd.classList.add('con-dex'); this.boton.classList.add('en-batalla'); }
    else { this.boton.append(this.globo); document.body.append(this.boton); lcd?.classList.remove('con-dex'); this.boton.classList.remove('en-batalla'); this.callar(); }
  }

  decir(html, ms = 8000) {
    clearTimeout(this.timer);
    this.globo.innerHTML = html;
    this.globo.hidden = false;
    this.boton.classList.add('hablando');
    this.timer = setTimeout(() => this.callar(), ms);
  }
  callar() { clearTimeout(this.timer); this.globo.hidden = true; this.boton.classList.remove('hablando'); }

  /** Analiza el turno y da 2-3 consejos. */
  consejo(forzado = false) {
    if (!forzado && !this.autoConsejos()) return;
    const b = this.batalla(); if (!b || b.terminada) return;
    const lado = this.miLado();
    const yo = activo(b, lado); const foe = activo(b, otro(lado));
    if (!yo || !foe || yo.hp <= 0 || foe.hp <= 0) return;
    const lineas = [];
    // 1) Debilidades del rival
    const t = tablaDefensiva(foe.types);
    const deb = [...t.x4.map((x) => `${TIPOS[x].es} ×4`), ...t.x2.map((x) => TIPOS[x].es)];
    if (deb.length) lineas.push(`<b>${esc(foe.nombre)}</b> es débil a ${deb.slice(0, 4).join(', ')}.`);
    // 2) Mejor ataque
    const opciones = yo.moves.map((m) => ({ m, d: m.ppLeft > 0 && m.category !== 'status' ? danioEstimado(yo, foe, m, b) : 0 })).sort((x, y) => y.d - x.d);
    const mejor = opciones[0];
    if (mejor && mejor.d > 0) {
      const pct = Math.min(100, Math.round((mejor.d / foe.maxHp) * 100));
      lineas.push(mejor.d >= foe.hp ? `¡<b>${esc(mejor.m.nombre)}</b> lo puede debilitar!` : `Te recomiendo <b>${esc(mejor.m.nombre)}</b> (≈${pct}% de su vida).`);
    }
    // 3) ¿Quién es más rápido?
    const miVel = velocidad(yo);
    const [vMin, vMax] = rangoVelocidad(foe);
    if (miVel > vMax) lineas.push('Eres más rápido: atacas primero.');
    else if (miVel < vMin) lineas.push('El rival es más rápido que tú.');
    else lineas.push(miVel >= (vMin + vMax) / 2 ? 'Quizá seas más rápido, pero no es seguro.' : 'Quizá el rival sea más rápido.');
    // 4) Peligro: ¿te puede noquear?
    if (amenazaMaxima(foe, yo) >= yo.hp) {
      const reserva = vivos(b, lado).filter((m) => m !== yo)
        .map((m) => ({ m, riesgo: Math.max(...foe.types.map((ft) => efectividad(ft, m.types))) }))
        .sort((x, y) => x.riesgo - y.riesgo)[0];
      lineas.unshift(`¡Cuidado! Te puede debilitar este turno.${reserva && reserva.riesgo < 1 ? ` <b>${esc(reserva.m.nombre)}</b> lo resiste mejor.` : ''}`);
    }
    if (!lineas.length) return;
    const cuantos = matchMedia('(max-width: 720px)').matches ? 2 : 3;
    this.decir(`<span class="dex-bzz">¡Bzzt!</span> ${lineas.slice(0, cuantos).join(' ')} <a href="#" data-dex-abrir="${foe.id}">Ver ficha</a>`, forzado ? 11000 : 8500);
    if (forzado) this.sfx.texto?.();
  }

  // ---------- Pokédex ----------
  async abrir(id) {
    this.sfx.confirmar?.();
    this.callar();
    $('#dexVistos', this.dialogo).textContent = `Has visto ${totalVistos()} de 1025 Pokémon en tus batallas`;
    if (id) $('#dexBuscar', this.dialogo).value = '';
    if (!this.dialogo.open) this.dialogo.showModal();
    this.especies ||= await listaEspecies();
    this._lista();
    const inicial = id || this.idActual || Number(Object.keys(vistos).pop()) || 25;
    this.ficha(inicial);
  }

  _lista() {
    const q = $('#dexBuscar', this.dialogo).value.trim();
    const n = normalizar(q); const num = Number(q.replace('#', ''));
    let res = this.especies || [];
    if (q) res = res.filter((e) => e.id === num || normalizar(e.clave).includes(n) || (vistos[e.id] && normalizar(vistos[e.id]).includes(n)));
    else res = res.filter((e) => vistos[e.id]).concat(res.filter((e) => !vistos[e.id]).slice(0, 30));
    $('#dexLista', this.dialogo).innerHTML = res.slice(0, 60).map((e) => `<li><button type="button" data-dex-id="${e.id}" class="${vistos[e.id] ? 'visto' : ''}${e.id === this.idActual ? ' actual' : ''}">
      <img src="${sprites(e.id).icono}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
      <span>${esc(vistos[e.id] || nombreClave(e.clave))}</span><span class="num">#${String(e.id).padStart(4, '0')}</span></button></li>`).join('')
      || '<li class="dex-vacio">Ningún Pokémon coincide.</li>';
  }

  async ficha(id) {
    if (!id) return;
    this.idActual = id;
    const f = $('#dexFicha', this.dialogo);
    f.innerHTML = '<p class="dex-cargando">Buscando datos…</p>';
    let p;
    try { p = await cargarPokemon(id); } catch { f.innerHTML = '<p class="dex-cargando">No se pudo cargar. Revisa tu conexión.</p>'; return; }
    if (this.idActual !== id) return;
    this._mon = p;
    const t = tablaDefensiva(p.types);
    const grupo = (titulo, lista, mult) => (lista.length ? `<div class="dex-grupo"><span>${titulo}</span><div>${lista.map((x) => `${badge(x)}${mult ? `<small>${mult}</small>` : ''}`).join('')}</div></div>` : '');
    const max = 200;
    f.innerHTML = `
      <div class="dex-arte"><img src="${p.sprites.arte}" alt="${esc(p.nombre)}" /></div>
      <div class="dex-datos">
        <p class="dex-num">#${String(p.id).padStart(4, '0')}${p.legendario ? ' · <span class="dex-leg">Legendario</span>' : ''}</p>
        <h3>${esc(p.nombre)}</h3>
        <p class="dex-cat">${esc(p.categoria || '')}</p>
        <div class="tipos">${p.types.map(badge).join('')}</div>
        <p class="dex-desc">${esc(p.descripcion || 'Sin descripción en español.')}</p>
        <p class="dex-medidas">Altura ${p.altura} m · Peso ${p.peso} kg <button type="button" class="btn-texto" id="dexGrito">Escuchar grito</button></p>
        <div class="dex-stats">${Object.entries(p.base).map(([k, v]) => `<span>${STATS_ES[k]}</span><b>${v}</b><i style="width:${Math.min(100, (v / max) * 100)}%;--c:${v >= 110 ? '#3ec94a' : v >= 70 ? '#f5c518' : '#f07a3a'}"></i>`).join('')}<span>Total</span><b>${p.total}</b><i style="width:0"></i></div>
        <div class="dex-tabla">
          ${grupo('Muy débil', t.x4, '×4')}${grupo('Débil', t.x2, '×2')}${grupo('Resiste', t.x05, '×½')}${grupo('Resiste mucho', t.x025, '×¼')}${grupo('Inmune', t.x0, '×0')}
        </div>
      </div>`;
    $$('#dexLista button', this.dialogo).forEach((x) => x.classList.toggle('actual', Number(x.dataset.dexId) === id));
  }
}
