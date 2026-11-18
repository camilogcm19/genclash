// ============================================================
//  GenClash · Animaciones de ataques (canvas + partículas)
//  Cada movimiento se anima según su TIPO (fuego, agua, eléctrico…)
//  y su FORMA, deducida del nombre y la categoría del movimiento:
//  rayo, proyectil, golpe, mordida, garras, sismo, caída desde el cielo,
//  drenaje, ondas, polvos, aura de mejora, curación…
// ============================================================

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Paleta y forma de partícula por tipo
const ESTILO = {
  fire:     { c: ['#fff6c2', '#ffc04d', '#ff7a1a', '#e3340b'], forma: 'llama',  luz: true,  sube: -60, tinte: 'rgba(255,110,30,.16)' },
  water:    { c: ['#ffffff', '#bfeaff', '#5cb8ff', '#2367e0'], forma: 'burbuja', luz: false, sube: 40,  tinte: 'rgba(40,120,255,.12)' },
  electric: { c: ['#ffffff', '#fffa9e', '#ffe23d', '#ffb800'], forma: 'chispa', luz: true,  sube: 0,   tinte: 'rgba(255,240,80,.18)' },
  grass:    { c: ['#e5ffb8', '#a8e65a', '#5cbf2a', '#2f7d1c'], forma: 'hoja',   luz: false, sube: -10, tinte: 'rgba(90,200,60,.10)' },
  ice:      { c: ['#ffffff', '#e2fbff', '#9fe6ff', '#4fc3f7'], forma: 'cristal', luz: true, sube: 10,  tinte: 'rgba(150,230,255,.18)' },
  fighting: { c: ['#ffffff', '#ffe0b8', '#ff9a5c', '#d1452b'], forma: 'estrella', luz: true, sube: 0,  tinte: 'rgba(255,120,60,.10)' },
  poison:   { c: ['#f3d1ff', '#cc7af0', '#9b3fc9', '#5e1a85'], forma: 'burbuja', luz: false, sube: -50, tinte: 'rgba(150,50,200,.14)' },
  ground:   { c: ['#f2d49b', '#d4a95c', '#a87b3a', '#6e4f22'], forma: 'roca',   luz: false, sube: 160, tinte: 'rgba(170,120,50,.14)' },
  flying:   { c: ['#ffffff', '#f1edff', '#cfc2ff', '#9d8cf0'], forma: 'pluma',  luz: false, sube: 15,  tinte: 'rgba(200,190,255,.12)' },
  psychic:  { c: ['#ffffff', '#ffd0ea', '#ff70b5', '#c2185b'], forma: 'brillo', luz: true,  sube: -15, tinte: 'rgba(255,80,160,.15)' },
  bug:      { c: ['#f6ffb0', '#d4e157', '#a6b91a', '#5c6b00'], forma: 'punto',  luz: false, sube: 0,   tinte: 'rgba(170,190,30,.10)' },
  rock:     { c: ['#efe0b0', '#cbb26a', '#9c8540', '#5f4f22'], forma: 'roca',   luz: false, sube: 200, tinte: 'rgba(160,140,70,.12)' },
  ghost:    { c: ['#ead9ff', '#a77bff', '#6a3fc4', '#2b1450'], forma: 'humo',   luz: false, sube: -25, tinte: 'rgba(70,30,130,.22)' },
  dragon:   { c: ['#ffffff', '#c8b6ff', '#7c4dff', '#3417b0'], forma: 'brillo', luz: true,  sube: -10, tinte: 'rgba(100,60,255,.16)' },
  dark:     { c: ['#a1887f', '#5d4037', '#2b1d18', '#0d0806'], forma: 'humo',   luz: false, sube: -15, tinte: 'rgba(20,10,10,.30)' },
  steel:    { c: ['#ffffff', '#eef2f8', '#b9c3d3', '#7d8aa0'], forma: 'cristal', luz: true, sube: 30,  tinte: 'rgba(200,210,230,.16)' },
  fairy:    { c: ['#ffffff', '#ffe3f4', '#ff9ad5', '#f06292'], forma: 'corazon', luz: true, sube: -30, tinte: 'rgba(255,150,210,.16)' },
  normal:   { c: ['#ffffff', '#f6f4e6', '#d9d6b8', '#a8a77a'], forma: 'estrella', luz: true, sube: 0,  tinte: 'rgba(255,255,255,.10)' },
  typeless: { c: ['#ffffff', '#e0e0e0', '#9e9e9e', '#616161'], forma: 'estrella', luz: true, sube: 0,  tinte: 'rgba(255,255,255,.08)' },
};

// ------------------------------------------------------------
//  Hojas de sprites renderizadas en Blender (assets/fx/<tipo>.webp)
//  4x4 cuadros de 256 px: explosiones 3D de cada tipo.
// ------------------------------------------------------------
const HOJAS = {};
const TIPOS_HOJA = ['fire', 'electric', 'water', 'ice', 'grass', 'psychic', 'ghost', 'dragon', 'dark',
  'fighting', 'poison', 'ground', 'rock', 'flying', 'bug', 'steel', 'fairy', 'normal'];
const LUMINOSOS = new Set(['fire', 'electric', 'psychic', 'dragon', 'ice', 'fairy', 'fighting', 'normal', 'water', 'steel']);

/** Descarga las hojas en segundo plano. Si alguna falla, se usan solo partículas. */
export function precargarHojas(base = 'assets/fx/') {
  for (const t of TIPOS_HOJA) {
    if (HOJAS[t]) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = `${base}${t}.webp`;
    HOJAS[t] = img;
  }
}
const hojaLista = (t) => { const i = HOJAS[t === 'typeless' ? 'normal' : t]; return i && i.complete && i.naturalWidth > 0 ? i : null; };

/** Decide la "forma" visual del movimiento a partir de su nombre en inglés y su categoría. */
export function formaDe(move) {
  const n = move.name || '';
  const t = move.type;
  const meta = move.meta || {};
  if (move.category === 'status') {
    if (meta.category === 'heal' || meta.healing > 0) return 'curar';
    if (['user', 'users-field', 'user-and-allies'].includes(move.target)) return 'aura';
    if (/powder|spore/.test(n)) return 'polvo';
    if (/sing|supersonic|screech|growl|metal-sound|captivate|grass-whistle|perish/.test(n)) return 'sonido';
    if (/wave|glare|leer|scary|hypnosis|confuse|eerie|dark-void|kiss|charm|tickle|tail-whip|fake-tears/.test(n)) return 'hechizo';
    if (/will-o-wisp|toxic|poison-gas/.test(n)) return 'proyectil';
    return 'hechizo';
  }
  if (meta.drain > 0) return 'drenar';
  if (/earthquake|magnitude|bulldoze|earth-power|precipice|fissure|stomping|high-horsepower|land-wrath|thousand/.test(n)) return 'sismo';
  if (/^thunder$|thunderclap|rock-slide|avalanche|meteor|icicle-crash|blizzard|hail|draco-meteor|rock-tomb|sky|dragon-rush|bolt-strike|hurricane|zap-cannon/.test(n)) return 'caida';
  if (/bite|fang|crunch|jaw|super-fang/.test(n)) return 'mordida';
  if (/slash|claw|cut|scissor|blade|razor|sword|aerial-ace|air-cutter|night-slash|cross-chop|dual-chop|x-scissor|fury-swipes|scratch/.test(n)) return 'garra';
  if (/beam|ray|laser|cannon|flash|hyper|signal|aurora|psybeam|moongeist|photon|prismatic|dragon-pulse|flamethrower|hydro-pump|water-gun|oblivion|origin|spacial|fleur/.test(n)) return 'rayo';
  if (/wave|pulse|surf|storm|boomburst|hyper-voice|bug-buzz|discharge|heat-wave|dazzling|snarl|echoed|round|uproar|overdrive|psychic$|psyshock|extrasensory|sludge-wave|muddy|lava-plume|eruption|explosion|blast-burn/.test(n)) return 'onda';
  if (move.category === 'physical') return t === 'ground' || t === 'rock' ? 'caida' : 'golpe';
  if (t === 'electric' || t === 'ice' || t === 'psychic') return 'rayo';
  return 'proyectil';
}

export class Efectos {
  constructor(arena) {
    this.arena = arena;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    arena.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.p = [];        // partículas
    this.formas = [];   // trazos especiales (rayos, anillos, tajos, mandíbulas…)
    this.tinte = null;
    this.vel = 1;
    this.reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._loop = this._loop.bind(this);
    this._ultimo = 0;
    this._activo = false;
    new ResizeObserver(() => this._redimensionar()).observe(arena);
    this._redimensionar();
  }

  _redimensionar() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.arena.clientWidth; const h = this.arena.clientHeight;
    this.w = w; this.h = h;
    this.canvas.width = Math.max(1, w * dpr); this.canvas.height = Math.max(1, h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _arrancar() {
    if (this._activo) return;
    this._activo = true; this._ultimo = performance.now();
    requestAnimationFrame(this._loop);
  }

  _loop(ahora) {
    const dt = Math.min(0.05, (ahora - this._ultimo) / 1000) * this.vel;
    this._ultimo = ahora;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    if (this.tinte) {
      this.tinte.t += dt;
      const a = Math.max(0, 1 - this.tinte.t / this.tinte.dur);
      ctx.globalAlpha = a; ctx.fillStyle = this.tinte.color; ctx.fillRect(0, 0, this.w, this.h); ctx.globalAlpha = 1;
      if (a <= 0) this.tinte = null;
    }

    // Formas especiales
    this.formas = this.formas.filter((f) => { f.t += dt; f.dibujar(ctx, Math.min(1, f.t / f.dur), f); return f.t < f.dur; });

    // Partículas
    const vivos = [];
    for (const q of this.p) {
      q.vida -= dt;
      if (q.vida <= 0) continue;
      q.vx += (q.ax || 0) * dt; q.vy += (q.ay || 0) * dt;
      q.vx *= q.friccion ?? 1; q.vy *= q.friccion ?? 1;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.rot += (q.vr || 0) * dt;
      this._dibujarParticula(ctx, q);
      vivos.push(q);
    }
    this.p = vivos;

    if (this.p.length || this.formas.length || this.tinte) requestAnimationFrame(this._loop);
    else { this._activo = false; ctx.clearRect(0, 0, this.w, this.h); }
  }

  _dibujarParticula(ctx, q) {
    const k = q.vida / q.max; // 1 → 0
    const s = q.tam * (q.crece ? (1 + (1 - k) * q.crece) : (0.4 + 0.6 * k));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (q.alfa ?? 1) * (q.desvanece === false ? 1 : Math.min(1, k * 1.6))));
    ctx.globalCompositeOperation = q.luz ? 'lighter' : 'source-over';
    ctx.translate(q.x, q.y); ctx.rotate(q.rot);
    ctx.fillStyle = q.color; ctx.strokeStyle = q.color;
    switch (q.forma) {
      case 'llama': {
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.6);
        ctx.quadraticCurveTo(s, -s * 0.2, 0, s);
        ctx.quadraticCurveTo(-s, -s * 0.2, 0, -s * 1.6);
        ctx.fill();
        break;
      }
      case 'burbuja':
        ctx.lineWidth = Math.max(1, s * 0.25);
        ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke();
        ctx.globalAlpha *= 0.35; ctx.fill();
        ctx.globalAlpha /= 0.35; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-s * 0.35, -s * 0.35, s * 0.25, 0, TAU); ctx.fill();
        break;
      case 'chispa':
        ctx.lineWidth = Math.max(1.5, s * 0.35); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-s * 1.4, 0); ctx.lineTo(s * 1.4, 0); ctx.stroke();
        break;
      case 'hoja':
        ctx.beginPath(); ctx.ellipse(0, 0, s * 1.3, s * 0.55, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,60,0,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-s * 1.2, 0); ctx.lineTo(s * 1.2, 0); ctx.stroke();
        break;
      case 'cristal':
        ctx.beginPath(); ctx.moveTo(0, -s * 1.5); ctx.lineTo(s * 0.6, 0); ctx.lineTo(0, s * 1.5); ctx.lineTo(-s * 0.6, 0); ctx.closePath(); ctx.fill();
        break;
      case 'estrella': {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? s * 0.45 : s * 1.2; const a = (i / 10) * TAU - Math.PI / 2;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'roca': {
        ctx.beginPath();
        const lados = q.lados || 6;
        for (let i = 0; i < lados; i++) {
          const a = (i / lados) * TAU; const r = s * (0.75 + ((i * 37) % 10) / 25);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
        break;
      }
      case 'pluma':
        ctx.beginPath(); ctx.ellipse(0, 0, s * 1.6, s * 0.45, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(80,60,140,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-s * 1.8, 0); ctx.lineTo(s * 1.6, 0); ctx.stroke();
        break;
      case 'humo': {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.6);
        g.addColorStop(0, q.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 1.6, 0, TAU); ctx.fill();
        break;
      }
      case 'corazon':
        ctx.beginPath();
        ctx.moveTo(0, s * 0.9);
        ctx.bezierCurveTo(-s * 1.4, -s * 0.2, -s * 0.6, -s * 1.3, 0, -s * 0.45);
        ctx.bezierCurveTo(s * 0.6, -s * 1.3, s * 1.4, -s * 0.2, 0, s * 0.9);
        ctx.fill();
        break;
      case 'nota':
        ctx.font = `bold ${s * 2.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(q.texto || '♪', 0, 0);
        break;
      case 'brillo':
      case 'punto':
      default: {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.4);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, q.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = q.forma === 'punto' ? q.color : g;
        ctx.beginPath(); ctx.arc(0, 0, q.forma === 'punto' ? s * 0.7 : s * 1.4, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- Fábricas de partículas ----------
  _emitir(tipo, x, y, n, op = {}) {
    if (this.reducido) n = Math.ceil(n / 4);
    const e = ESTILO[tipo] || ESTILO.normal;
    for (let i = 0; i < n; i++) {
      const ang = op.ang != null ? op.ang + rnd(-(op.abanico ?? Math.PI), op.abanico ?? Math.PI) : rnd(0, TAU);
      const v = rnd(op.vmin ?? 60, op.vmax ?? 260);
      const vida = rnd(op.vidaMin ?? 0.35, op.vidaMax ?? 0.8);
      this.p.push({
        x: x + rnd(-(op.dispersion ?? 6), op.dispersion ?? 6), y: y + rnd(-(op.dispersion ?? 6), op.dispersion ?? 6),
        vx: Math.cos(ang) * v + (op.vx || 0), vy: Math.sin(ang) * v + (op.vy || 0),
        ax: op.ax || 0, ay: op.ay ?? e.sube,
        friccion: op.friccion ?? 0.985,
        vida, max: vida,
        tam: rnd(op.tmin ?? 3, op.tmax ?? 8) * (this.w / 600 + 0.35),
        crece: op.crece, alfa: op.alfa,
        color: op.color || pick(e.c), forma: op.forma || e.forma, luz: op.luz ?? e.luz,
        rot: rnd(0, TAU), vr: op.vr ?? rnd(-6, 6), lados: 5 + Math.floor(rnd(0, 3)), texto: op.texto,
        desvanece: op.desvanece,
      });
    }
    if (this.p.length > 900) this.p.splice(0, this.p.length - 900);
    this._arrancar();
  }

  _forma(dur, dibujar, extra = {}) {
    this.formas.push({ t: 0, dur, dibujar, ...extra });
    this._arrancar();
  }

  _tintar(tipo, dur = 0.5) {
    const e = ESTILO[tipo] || ESTILO.normal;
    this.tinte = { color: e.tinte, t: 0, dur };
    this._arrancar();
  }

  _anillo(tipo, x, y, { r0 = 6, r1 = 90, dur = 0.45, ancho = 6, color } = {}) {
    const e = ESTILO[tipo] || ESTILO.normal;
    const c = color || e.c[2];
    const esc = this.w / 600 + 0.35;
    this._forma(dur, (ctx, k) => {
      ctx.save();
      ctx.globalCompositeOperation = e.luz ? 'lighter' : 'source-over';
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = c; ctx.lineWidth = ancho * (1 - k * 0.7) * esc;
      ctx.beginPath(); ctx.arc(x, y, (r0 + (r1 - r0) * k) * esc, 0, TAU); ctx.stroke();
      ctx.restore();
    });
  }

  _destello(x, y, tipo, tam = 70) {
    const e = ESTILO[tipo] || ESTILO.normal;
    const esc = this.w / 600 + 0.35;
    this._forma(0.28, (ctx, k) => {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
      const r = tam * esc * (0.6 + k);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, e.c[1]); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      // rayos del destello
      ctx.strokeStyle = e.c[0]; ctx.lineWidth = 3 * esc; ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + k; const r1 = r * 0.5; const r2 = r * (1.1 + (i % 2) * 0.4);
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.restore();
    });
  }

  /** Reproduce la explosión 3D de Blender centrada en (x, y). Devuelve false si la hoja no está cargada. */
  _hoja(tipo, x, y, tam = 1, dur = 0.8) {
    const img = hojaLista(tipo);
    if (!img) return false;
    const cuadros = 16; const cols = 4; const lado = img.naturalWidth / cols;
    const esc = this.w / 600 + 0.35;
    const t = 175 * tam * esc;
    const rot = rnd(-0.5, 0.5);
    this._forma(dur, (ctx, k) => {
      const i = Math.min(cuadros - 1, Math.floor(k * cuadros));
      const sx = (i % cols) * lado; const sy = Math.floor(i / cols) * lado;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.drawImage(img, sx, sy, lado, lado, -t / 2, -t / 2, t, t);
      if (LUMINOSOS.has(tipo) && k < 0.5) { // brillo extra en los primeros cuadros
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * (1 - k * 2);
        ctx.drawImage(img, sx, sy, lado, lado, -t / 2, -t / 2, t, t);
      }
      ctx.restore();
    });
    return true;
  }

  _impacto(tipo, x, y, fuerza = 1) {
    const conHoja = this._hoja(tipo, x, y, fuerza);
    if (conHoja) {
      this._emitir(tipo, x, y, Math.round(14 * fuerza), { vmin: 80, vmax: 300 * fuerza, tmin: 2, tmax: 6 });
      if (tipo === 'electric') this._rayo(x, y - 60, x, y + 40, tipo, 0.2, 3);
      return;
    }
    this._destello(x, y, tipo, 60 * fuerza);
    this._anillo(tipo, x, y, { r1: 80 * fuerza, ancho: 7 });
    this._emitir(tipo, x, y, Math.round(28 * fuerza), { vmin: 80, vmax: 320 * fuerza, tmin: 3, tmax: 8 });
    if (tipo === 'electric') this._rayo(x, y - 60, x, y + 40, tipo, 0.25, 4);
  }

  /** Relámpago zigzag entre dos puntos. */
  _rayo(x1, y1, x2, y2, tipo = 'electric', dur = 0.35, ancho = 5) {
    const e = ESTILO[tipo] || ESTILO.electric;
    const esc = this.w / 600 + 0.35;
    const segmentos = 9;
    let puntos = [];
    const regenerar = () => {
      puntos = [[x1, y1]];
      for (let i = 1; i < segmentos; i++) {
        const k = i / segmentos;
        const nx = -(y2 - y1); const ny = x2 - x1; const len = Math.hypot(nx, ny) || 1;
        const d = rnd(-18, 18) * esc;
        puntos.push([x1 + (x2 - x1) * k + (nx / len) * d, y1 + (y2 - y1) * k + (ny / len) * d]);
      }
      puntos.push([x2, y2]);
    };
    regenerar();
    let cuadro = 0;
    this._forma(dur, (ctx, k) => {
      if (cuadro++ % 3 === 0) regenerar();
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k * 0.6;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [w, c] of [[ancho * 3.2, e.c[3]], [ancho * 1.6, e.c[2]], [ancho * 0.6, '#ffffff']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w * esc;
        ctx.beginPath(); puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      ctx.restore();
    });
  }

  // ---------- Formas de ataque ----------

  async _proyectil(tipo, a, b, { grande = false, cantidad = 1 } = {}) {
    const e = ESTILO[tipo] || ESTILO.normal;
    const dur = 0.42;
    const esc = this.w / 600 + 0.35;
    for (let n = 0; n < cantidad; n++) {
      const arco = rnd(-0.25, 0.1) * Math.hypot(b.x - a.x, b.y - a.y);
      const pos = (k) => {
        const x = a.x + (b.x - a.x) * k; const y = a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * arco;
        return [x, y];
      };
      this._forma(dur, (ctx, k) => {
        const [x, y] = pos(k);
        // estela
        this._emitir(tipo, x, y, grande ? 4 : 2, { vmin: 10, vmax: 60, vidaMin: 0.2, vidaMax: 0.45, tmin: 3, tmax: grande ? 9 : 6 });
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const r = (grande ? 20 : 13) * esc;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, e.c[1]); g.addColorStop(0.7, e.c[2]); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, TAU); ctx.fill();
        ctx.restore();
      });
      if (cantidad > 1) await espera(110 / this.vel);
    }
    await espera((dur * 1000) / this.vel);
    this._impacto(tipo, b.x, b.y, grande ? 1.4 : 1);
  }

  async _rayoLineal(tipo, a, b) {
    const e = ESTILO[tipo] || ESTILO.normal;
    const esc = this.w / 600 + 0.35;
    const dur = 0.6;
    if (tipo === 'electric') { this._rayo(a.x, a.y, b.x, b.y, tipo, dur, 6); }
    else {
      this._forma(dur, (ctx, k) => {
        const crece = Math.min(1, k / 0.35);
        const x2 = a.x + (b.x - a.x) * crece; const y2 = a.y + (b.y - a.y) * crece;
        const pulso = 1 + Math.sin(k * 40) * 0.15;
        const fin = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (const [w, c, al] of [[34, e.c[3], 0.35], [20, e.c[2], 0.7], [9, e.c[1], 0.9], [3.5, '#ffffff', 1]]) {
          ctx.globalAlpha = al * fin; ctx.strokeStyle = c; ctx.lineWidth = w * esc * pulso * fin;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.restore();
        if (Math.random() < 0.7) {
          const t = Math.random() * crece;
          this._emitir(tipo, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 1, { vmin: 20, vmax: 90, vidaMin: 0.2, vidaMax: 0.4 });
        }
      });
    }
    await espera(230 / this.vel);
    this._impacto(tipo, b.x, b.y, 1.2);
    this._emitir(tipo, b.x, b.y, 18, { vmin: 60, vmax: 220 });
    await espera(150 / this.vel);
  }

  async _golpe(tipo, b, { veces = 1 } = {}) {
    for (let i = 0; i < veces; i++) {
      const x = b.x + rnd(-14, 14) * (veces > 1 ? 1 : 0); const y = b.y + rnd(-14, 14) * (veces > 1 ? 1 : 0);
      this._impacto(tipo, x, y, veces > 1 ? 0.8 : 1.3);
      if (tipo === 'fire' || tipo === 'ice' || tipo === 'electric') this._emitir(tipo, x, y, 20, { vmin: 40, vmax: 200 });
      if (veces > 1) await espera(140 / this.vel);
    }
  }

  async _mordida(tipo, b) {
    const esc = this.w / 600 + 0.35;
    const e = ESTILO[tipo] || ESTILO.normal;
    const ancho = 70 * esc; const alto = 46 * esc;
    this._forma(0.42, (ctx, k) => {
      const cierre = Math.min(1, k / 0.45);
      const sep = alto * (1 - cierre);
      ctx.save();
      ctx.globalAlpha = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      for (const lado of [-1, 1]) {
        const y0 = b.y + lado * (sep + 8 * esc);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = tipo === 'dark' ? '#311' : e.c[3]; ctx.lineWidth = 2.5 * esc;
        ctx.beginPath();
        ctx.moveTo(b.x - ancho / 2, y0);
        for (let i = 0; i <= 6; i++) {
          const x = b.x - ancho / 2 + (ancho / 6) * i;
          ctx.lineTo(x, y0);
          if (i < 6) ctx.lineTo(x + ancho / 12, y0 - lado * 16 * esc);
        }
        ctx.lineTo(b.x + ancho / 2, y0 + lado * 18 * esc);
        ctx.lineTo(b.x - ancho / 2, y0 + lado * 18 * esc);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
    await espera(200 / this.vel);
    this._impacto(tipo, b.x, b.y, 1.1);
  }

  async _garra(tipo, b) {
    const esc = this.w / 600 + 0.35;
    const e = ESTILO[tipo] || ESTILO.normal;
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 18 * esc;
      this._forma(0.35, (ctx, k) => {
        const largo = Math.min(1, k / 0.35);
        const x1 = b.x - 45 * esc + off; const y1 = b.y - 50 * esc;
        const x2 = x1 + 70 * esc * largo; const y2 = y1 + 95 * esc * largo;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - Math.max(0, k - 0.5) * 2; ctx.lineCap = 'round';
        for (const [w, c] of [[11, e.c[2]], [4, '#ffffff']]) {
          ctx.strokeStyle = c; ctx.lineWidth = w * esc;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2 + 10 * esc, (y1 + y2) / 2 - 8 * esc, x2, y2); ctx.stroke();
        }
        ctx.restore();
      });
      await espera(70 / this.vel);
    }
    await espera(120 / this.vel);
    this._impacto(tipo, b.x, b.y, 0.9);
  }

  async _sismo(tipo, b) {
    this.arena.classList.remove('temblor'); void this.arena.offsetWidth; this.arena.classList.add('temblor');
    const suelo = b.y + 40 * (this.w / 600 + 0.35);
    for (let i = 0; i < 4; i++) {
      this._emitir(tipo, b.x + rnd(-70, 70), suelo, 10, { ang: -Math.PI / 2, abanico: 0.5, vmin: 150, vmax: 380, ay: 600, tmin: 4, tmax: 10, vidaMin: 0.5, vidaMax: 0.9 });
      this._anillo(tipo, b.x, suelo, { r1: 130, ancho: 5, color: ESTILO.ground.c[2] });
      await espera(120 / this.vel);
    }
    this._impacto(tipo, b.x, b.y, 1.1);
  }

  async _caida(tipo, b) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = b.x + rnd(-50, 50) * (this.w / 600 + 0.35);
      if (tipo === 'electric') { this._rayo(x, -10, x, b.y, tipo, 0.3, 6); }
      else {
        const f = tipo === 'ice' ? 'cristal' : tipo === 'rock' || tipo === 'ground' ? 'roca' : undefined;
        this._emitir(tipo, x, -10, 1, { ang: Math.PI / 2, abanico: 0.05, vmin: 700, vmax: 900, ay: 900, tmin: 9, tmax: 15, vidaMin: (b.y + 10) / 800, vidaMax: (b.y + 10) / 760, forma: f, desvanece: false, friccion: 1 });
      }
      await espera(70 / this.vel);
    }
    await espera(180 / this.vel);
    this._impacto(tipo, b.x, b.y, 1.3);
  }

  async _drenar(tipo, a, b) {
    this._impacto(tipo, b.x, b.y, 0.8);
    await espera(200 / this.vel);
    for (let i = 0; i < 10; i++) {
      const dx = a.x - b.x; const dy = a.y - b.y; const t = 0.55;
      this._emitir(tipo, b.x + rnd(-20, 20), b.y + rnd(-20, 20), 1, { ang: Math.atan2(dy, dx), abanico: 0.15, vmin: Math.hypot(dx, dy) / t * 0.9, vmax: Math.hypot(dx, dy) / t, vidaMin: t, vidaMax: t, ay: 0, friccion: 1, forma: 'brillo', color: '#9dff8a', luz: true, tmin: 5, tmax: 8 });
      await espera(40 / this.vel);
    }
    await espera(300 / this.vel);
    this._emitir('grass', a.x, a.y, 14, { ay: -80, vmin: 20, vmax: 90, forma: 'brillo', color: '#b9ffad' });
  }

  async _onda(tipo, a, b) {
    for (let i = 0; i < 4; i++) {
      this._anillo(tipo, b.x, b.y, { r0: 10, r1: 110, ancho: 8, dur: 0.5 });
      this._emitir(tipo, b.x, b.y, 10, { vmin: 100, vmax: 260 });
      await espera(110 / this.vel);
    }
    if (tipo === 'water') this._emitir('water', b.x, b.y + 30, 40, { ang: -Math.PI / 2, abanico: 1, vmin: 150, vmax: 380, ay: 500, forma: 'burbuja' });
    this._impacto(tipo, b.x, b.y, 1.1);
  }

  async _aura(tipo, a) {
    const esc = this.w / 600 + 0.35;
    this._anillo(tipo, a.x, a.y + 40 * esc, { r0: 20, r1: 70, ancho: 5, dur: 0.6 });
    for (let i = 0; i < 6; i++) {
      this._emitir(tipo, a.x + rnd(-40, 40) * esc, a.y + 40 * esc, 6, { ang: -Math.PI / 2, abanico: 0.3, vmin: 60, vmax: 160, ay: -60, forma: 'brillo', luz: true });
      await espera(70 / this.vel);
    }
  }

  async _curar(a) {
    for (let i = 0; i < 6; i++) {
      this._emitir('grass', a.x + rnd(-35, 35), a.y + 30, 5, { ang: -Math.PI / 2, abanico: 0.3, vmin: 40, vmax: 120, ay: -40, forma: 'brillo', color: pick(['#c8ffbd', '#7dff9a', '#ffffff']), luz: true });
      await espera(70 / this.vel);
    }
  }

  async _polvo(tipo, b) {
    for (let i = 0; i < 5; i++) {
      this._emitir(tipo, b.x + rnd(-40, 40), b.y - 70, 8, { ang: Math.PI / 2, abanico: 0.8, vmin: 20, vmax: 70, ay: 40, forma: 'punto', tmin: 2, tmax: 4, vidaMin: 0.8, vidaMax: 1.3 });
      await espera(70 / this.vel);
    }
  }

  async _sonido(tipo, a, b) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    for (let i = 0; i < 5; i++) {
      this._anillo(tipo, a.x, a.y, { r0: 10, r1: 70 + i * 10, ancho: 4, dur: 0.45 });
      this._emitir(tipo, a.x, a.y, 2, { ang, abanico: 0.4, vmin: 160, vmax: 220, ay: 0, forma: 'nota', texto: pick(['♪', '♫']), luz: false, tmin: 6, tmax: 8, vidaMin: 0.9, vidaMax: 1.1, friccion: 1 });
      await espera(100 / this.vel);
    }
  }

  async _hechizo(tipo, a, b) {
    const e = ESTILO[tipo] || ESTILO.normal;
    if (tipo === 'electric') { for (let i = 0; i < 3; i++) { this._rayo(b.x + rnd(-40, 40), b.y - 60, b.x + rnd(-30, 30), b.y + 30, tipo, 0.25, 3); await espera(90 / this.vel); } return; }
    for (let i = 0; i < 3; i++) {
      this._anillo(tipo, b.x, b.y, { r0: 110, r1: 10, ancho: 5, dur: 0.5, color: e.c[2] });
      await espera(120 / this.vel);
    }
    this._emitir(tipo, b.x, b.y, 16, { vmin: 30, vmax: 120, forma: 'brillo' });
  }

  /**
   * Anima un movimiento. `a` y `b` son {x, y} dentro de la arena (atacante y objetivo).
   * La promesa se resuelve cuando el golpe "llega", para sincronizar la barra de PS.
   */
  async animar(move, a, b) {
    const tipo = ESTILO[move.type] ? move.type : 'normal';
    const forma = formaDe(move);
    const fuerte = (move.power || 0) >= 100;
    if (fuerte || forma === 'sismo' || forma === 'caida') this._tintar(tipo, 0.7);
    switch (forma) {
      case 'rayo': return this._rayoLineal(tipo, a, b);
      case 'golpe': return this._golpe(tipo, b, { veces: move.meta?.maxHits ? 1 : (tipo === 'fighting' && fuerte ? 3 : 1) });
      case 'mordida': return this._mordida(tipo, b);
      case 'garra': return this._garra(tipo, b);
      case 'sismo': return this._sismo(tipo, b);
      case 'caida': return this._caida(tipo, b);
      case 'drenar': return this._drenar(tipo, a, b);
      case 'onda': return this._onda(tipo, a, b);
      case 'aura': {
        const porStat = { attack: 'fire', defense: 'water', 'special-attack': 'psychic', 'special-defense': 'fairy', speed: 'electric' };
        const st = (move.statChanges || []).find((x) => x.change > 0)?.stat;
        return this._aura(porStat[st] || tipo, a);
      }
      case 'curar': return this._curar(a);
      case 'polvo': return this._polvo(tipo, b);
      case 'sonido': return this._sonido(tipo, a, b);
      case 'hechizo': return this._hechizo(tipo, a, b);
      default: return this._proyectil(tipo, a, b, { grande: fuerte, cantidad: move.meta?.maxHits ? 2 : 1 });
    }
  }

  /** Pequeño efecto de impacto adicional (para golpes múltiples o daño residual). */
  golpecito(tipo, b) { this._impacto(ESTILO[tipo] ? tipo : 'normal', b.x, b.y, 0.6); }
  estado(tipo, b) { this._emitir(tipo, b.x, b.y, 14, { ay: -80, vmin: 20, vmax: 90, forma: 'brillo' }); }
}
