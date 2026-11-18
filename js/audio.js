// ============================================================
//  GenClash · Motor de audio
//  Todo se sintetiza en el navegador con Web Audio (sin archivos):
//  - Efectos de ataque distintos para cada uno de los 18 tipos
//  - Sonidos de interfaz, golpes, desmayo, estados, PS críticos
//  - Música de batalla original en bucle y fanfarrias
//  Cadena: efectos/música → compresor → salida, con reverberación.
//  Los gritos de cada Pokémon vienen del repositorio de la PokeAPI.
// ============================================================

// Modo de sonido: 'todo' | 'efectos' (sin música) | 'silencio'
let modo = localStorage.getItem('gc:sonido') || (localStorage.getItem('gc:mute') === '1' ? 'silencio' : 'todo');
let ctx = null; let salida; let busFx; let busMusica; let envioReverb; let ruidoBuf;

export const modoSonido = () => modo;
export const estaSilenciado = () => modo === 'silencio';
export function alternarSonido() {
  modo = modo === 'todo' ? 'efectos' : modo === 'efectos' ? 'silencio' : 'todo';
  localStorage.setItem('gc:sonido', modo);
  if (ctx) {
    busFx.gain.setTargetAtTime(modo === 'silencio' ? 0 : 0.9, ctx.currentTime, 0.05);
    busMusica.gain.setTargetAtTime(modo === 'todo' ? 0.22 : 0, ctx.currentTime, 0.1);
  }
  return modo;
}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    salida = ctx.createGain(); salida.gain.value = 0.9;
    comp.connect(salida).connect(ctx.destination);
    busFx = ctx.createGain(); busFx.gain.value = modo === 'silencio' ? 0 : 0.9; busFx.connect(comp);
    busMusica = ctx.createGain(); busMusica.gain.value = modo === 'todo' ? 0.22 : 0; busMusica.connect(comp);
    // Reverberación sintética (respuesta al impulso de ruido que decae)
    const rev = ctx.createConvolver();
    const largo = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, largo, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < largo; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** 3;
    }
    rev.buffer = ir;
    envioReverb = ctx.createGain(); envioReverb.gain.value = 0.28;
    envioReverb.connect(rev).connect(comp);
    // Ruido blanco reutilizable
    ruidoBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = ruidoBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ------------------------------------------------------------
//  Bloques de síntesis
// ------------------------------------------------------------
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function env(g, t, { a = 0.005, d = 0.1, s = 0, r = 0.08, pico = 0.2, dur = 0.2 }) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(pico, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, pico * s || 0.0001), t + a + d);
  if (s > 0) g.gain.setValueAtTime(pico * s, t + Math.max(a + d, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, dur) + r);
}

function tono(freq, t, dur, { tipo = 'sine', pico = 0.15, a = 0.005, d, s = 0.6, r = 0.1, hasta, detune = 0, vib = 0, vibF = 6, rev = 0.2, destino } = {}) {
  const c = ctx; const o = c.createOscillator(); const g = c.createGain();
  o.type = tipo; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
  if (hasta) o.frequency.exponentialRampToValueAtTime(Math.max(20, hasta), t + dur);
  if (vib) {
    const l = c.createOscillator(); const lg = c.createGain();
    l.frequency.value = vibF; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + r + 0.05);
  }
  env(g, t, { a, d: d ?? dur * 0.4, s, r, pico, dur });
  o.connect(g);
  g.connect(destino || busFx);
  if (rev && !destino) { const e = c.createGain(); e.gain.value = rev; g.connect(e).connect(envioReverb); }
  o.start(t); o.stop(t + dur + r + 0.05);
  return o;
}

function ruido(t, dur, { filtro = 'lowpass', f = 1200, hasta, q = 1, pico = 0.2, a = 0.005, s = 0.5, r = 0.08, rev = 0.15, destino } = {}) {
  const c = ctx; const src = c.createBufferSource(); src.buffer = ruidoBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = c.createBiquadFilter(); fl.type = filtro; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (hasta) fl.frequency.exponentialRampToValueAtTime(hasta, t + dur);
  const g = c.createGain();
  env(g, t, { a, d: dur * 0.5, s, r, pico, dur });
  src.connect(fl).connect(g).connect(destino || busFx);
  if (rev && !destino) { const e = c.createGain(); e.gain.value = rev; g.connect(e).connect(envioReverb); }
  src.start(t, Math.random() * 1.5); src.stop(t + dur + r + 0.05);
}

/** Campana / metal por síntesis FM. */
function fm(freq, t, dur, { ratio = 3.5, indice = 300, pico = 0.12, r = 0.3, rev = 0.35 } = {}) {
  const c = ctx; const car = c.createOscillator(); const mod = c.createOscillator(); const mg = c.createGain(); const g = c.createGain();
  car.frequency.value = freq; mod.frequency.value = freq * ratio;
  mg.gain.setValueAtTime(indice, t); mg.gain.exponentialRampToValueAtTime(1, t + dur);
  mod.connect(mg).connect(car.frequency);
  env(g, t, { a: 0.002, d: dur, s: 0, r, pico, dur });
  car.connect(g).connect(busFx);
  const e = c.createGain(); e.gain.value = rev; g.connect(e).connect(envioReverb);
  car.start(t); mod.start(t); car.stop(t + dur + r + 0.05); mod.stop(t + dur + r + 0.05);
}

function bombo(t, { pico = 0.5, desde = 160, hasta = 45, dur = 0.18 } = {}) {
  tono(desde, t, dur, { tipo: 'sine', pico, hasta, s: 0, d: dur, r: 0.05, rev: 0.05 });
}

/** Distorsión para rugidos. */
function rugido(freq, t, dur, pico = 0.12) {
  const c = ctx; const o = c.createOscillator(); const o2 = c.createOscillator(); const sh = c.createWaveShaper(); const g = c.createGain(); const fl = c.createBiquadFilter();
  const curva = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curva[i] = Math.tanh(x * 4); }
  sh.curve = curva;
  o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.setValueAtTime(freq, t); o2.frequency.setValueAtTime(freq * 1.01, t);
  o.frequency.linearRampToValueAtTime(freq * 1.6, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + dur);
  o2.frequency.linearRampToValueAtTime(freq * 1.62, t + dur * 0.35); o2.frequency.exponentialRampToValueAtTime(freq * 0.72, t + dur);
  fl.type = 'lowpass'; fl.frequency.value = 1400;
  env(g, t, { a: 0.03, d: dur * 0.6, s: 0.5, r: 0.15, pico, dur });
  o.connect(sh); o2.connect(sh); sh.connect(fl).connect(g).connect(busFx);
  const e = c.createGain(); e.gain.value = 0.3; g.connect(e).connect(envioReverb);
  o.start(t); o2.start(t); o.stop(t + dur + 0.25); o2.stop(t + dur + 0.25);
}

const al = (a, b) => a + Math.random() * (b - a);
const ahora = () => (ac() ? ctx.currentTime + 0.01 : null);

// ------------------------------------------------------------
//  Sonidos de ataque por tipo
// ------------------------------------------------------------
const ATAQUE = {
  fire(t, k) {
    ruido(t, 0.55 * k, { filtro: 'lowpass', f: 300, hasta: 2600, q: 0.7, pico: 0.35, s: 0.7 });
    for (let i = 0; i < 10; i++) ruido(t + al(0.05, 0.55 * k), 0.03, { filtro: 'highpass', f: 2500, pico: 0.12, r: 0.02, rev: 0.1 });
    bombo(t + 0.05, { pico: 0.35, desde: 90, hasta: 40, dur: 0.4 });
  },
  water(t, k) {
    ruido(t, 0.45 * k, { filtro: 'bandpass', f: 600, hasta: 2200, q: 1.2, pico: 0.3, s: 0.6 });
    for (let i = 0; i < 9; i++) tono(al(250, 500), t + al(0, 0.5 * k), 0.08, { tipo: 'sine', hasta: al(900, 1500), pico: 0.08, s: 0, r: 0.03, rev: 0.3 });
  },
  electric(t, k) {
    for (let i = 0; i < 4; i++) {
      const ti = t + i * 0.07;
      tono(al(800, 1600), ti, 0.12, { tipo: 'sawtooth', hasta: al(150, 300), pico: 0.07, vib: 400, vibF: 60, s: 0.3, r: 0.04, rev: 0.15 });
      ruido(ti, 0.06, { filtro: 'highpass', f: 3000, pico: 0.15, r: 0.03 });
    }
    tono(110, t, 0.5 * k, { tipo: 'square', pico: 0.05, vib: 30, vibF: 50, s: 0.6, rev: 0.1 });
  },
  grass(t, k) {
    ruido(t, 0.5 * k, { filtro: 'bandpass', f: 3500, hasta: 5000, q: 2, pico: 0.18, s: 0.6 });
    [76, 79, 83, 86].forEach((m, i) => tono(mtof(m), t + i * 0.06, 0.18, { tipo: 'triangle', pico: 0.06, s: 0.2, r: 0.2, rev: 0.4 }));
  },
  ice(t, k) {
    [88, 91, 95, 98, 100].forEach((m, i) => fm(mtof(m), t + i * 0.05, 0.4, { ratio: 3.5, indice: 900, pico: 0.07, r: 0.5 }));
    ruido(t, 0.4 * k, { filtro: 'highpass', f: 6000, pico: 0.12, s: 0.4, rev: 0.4 });
  },
  psychic(t, k) {
    tono(300, t, 0.6 * k, { tipo: 'sine', hasta: 900, pico: 0.12, vib: 25, vibF: 7, s: 0.8, r: 0.3, rev: 0.6 });
    tono(450, t + 0.05, 0.6 * k, { tipo: 'triangle', hasta: 1350, pico: 0.06, vib: 30, vibF: 5, s: 0.8, r: 0.3, rev: 0.6 });
  },
  ghost(t, k) {
    tono(520, t, 0.8 * k, { tipo: 'sawtooth', hasta: 180, pico: 0.05, vib: 20, vibF: 4, detune: 12, s: 0.7, r: 0.4, rev: 0.7 });
    tono(523, t, 0.8 * k, { tipo: 'sine', hasta: 175, pico: 0.1, vib: 25, vibF: 3, s: 0.7, r: 0.4, rev: 0.7 });
    ruido(t, 0.6 * k, { filtro: 'bandpass', f: 800, hasta: 300, q: 5, pico: 0.1, rev: 0.6 });
  },
  dragon(t, k) {
    rugido(75, t, 0.7 * k, 0.14);
    ruido(t, 0.5 * k, { filtro: 'lowpass', f: 600, hasta: 2000, pico: 0.2 });
  },
  dark(t, k) {
    ruido(t, 0.35 * k, { filtro: 'lowpass', f: 3000, hasta: 300, pico: 0.25, s: 0.4 });
    bombo(t + 0.15, { pico: 0.45, desde: 120, hasta: 35, dur: 0.3 });
    tono(110, t, 0.5, { tipo: 'sawtooth', hasta: 55, pico: 0.05, s: 0.5, rev: 0.4 });
  },
  fighting(t) {
    ruido(t, 0.12, { filtro: 'lowpass', f: 1800, pico: 0.35, s: 0.2, r: 0.05 });
    bombo(t, { pico: 0.6, desde: 180, hasta: 50, dur: 0.16 });
    bombo(t + 0.11, { pico: 0.45, desde: 160, hasta: 45, dur: 0.14 });
  },
  poison(t, k) {
    for (let i = 0; i < 12; i++) tono(al(120, 320), t + al(0, 0.6 * k), 0.09, { tipo: 'sine', hasta: al(400, 700), pico: 0.09, s: 0, r: 0.04, rev: 0.3 });
    ruido(t, 0.5 * k, { filtro: 'bandpass', f: 500, q: 3, pico: 0.12, rev: 0.3 });
  },
  ground(t, k) {
    ruido(t, 0.9 * k, { filtro: 'lowpass', f: 160, pico: 0.55, s: 0.8, r: 0.3, rev: 0.2 });
    tono(42, t, 0.9 * k, { tipo: 'sine', pico: 0.35, s: 0.8, r: 0.3, rev: 0 });
    for (let i = 0; i < 5; i++) ruido(t + al(0.1, 0.7), 0.05, { filtro: 'bandpass', f: 700, q: 2, pico: 0.15 });
  },
  rock(t, k) {
    for (let i = 0; i < 7; i++) {
      const ti = t + al(0, 0.55 * k);
      ruido(ti, 0.07, { filtro: 'bandpass', f: al(500, 1200), q: 2, pico: 0.25, r: 0.04 });
      bombo(ti, { pico: 0.2, desde: 140, hasta: 50, dur: 0.1 });
    }
  },
  flying(t, k) {
    ruido(t, 0.6 * k, { filtro: 'bandpass', f: 400, hasta: 3200, q: 2.5, pico: 0.3, s: 0.6 });
    ruido(t + 0.25, 0.4 * k, { filtro: 'bandpass', f: 3000, hasta: 700, q: 2.5, pico: 0.2, s: 0.5 });
  },
  bug(t, k) {
    const o = tono(170, t, 0.6 * k, { tipo: 'sawtooth', pico: 0.07, vib: 25, vibF: 32, s: 0.8, r: 0.1, rev: 0.15 });
    void o;
    tono(340, t, 0.6 * k, { tipo: 'square', pico: 0.03, vib: 40, vibF: 28, s: 0.8, r: 0.1, rev: 0.15 });
  },
  steel(t) {
    fm(520, t, 0.6, { ratio: 1.41, indice: 1400, pico: 0.12, r: 0.6 });
    fm(780, t + 0.02, 0.5, { ratio: 2.76, indice: 900, pico: 0.07, r: 0.5 });
    ruido(t, 0.05, { filtro: 'highpass', f: 4000, pico: 0.25, r: 0.03 });
  },
  fairy(t) {
    [84, 88, 91, 96, 100, 103].forEach((m, i) => {
      tono(mtof(m), t + i * 0.045, 0.22, { tipo: 'sine', pico: 0.07, s: 0.2, r: 0.3, rev: 0.6 });
      tono(mtof(m + 12), t + i * 0.045, 0.12, { tipo: 'triangle', pico: 0.02, s: 0, r: 0.2, rev: 0.6 });
    });
  },
  normal(t, k) {
    ruido(t, 0.25 * k, { filtro: 'bandpass', f: 600, hasta: 2500, q: 1.5, pico: 0.25, s: 0.4 });
    bombo(t + 0.08, { pico: 0.4 });
  },
};
ATAQUE.typeless = ATAQUE.normal;

// ------------------------------------------------------------
//  API de efectos
// ------------------------------------------------------------
export const sfx = {
  hover: () => { const t = ahora(); if (t != null) tono(1800, t, 0.025, { tipo: 'sine', pico: 0.02, s: 0, r: 0.02, rev: 0 }); },
  click: () => { const t = ahora(); if (t == null) return; tono(880, t, 0.04, { tipo: 'square', pico: 0.035, s: 0, r: 0.03, rev: 0.05 }); tono(1320, t + 0.035, 0.05, { tipo: 'square', pico: 0.03, s: 0, r: 0.04, rev: 0.1 }); },
  seleccion: () => { const t = ahora(); if (t != null) tono(660, t, 0.06, { tipo: 'triangle', hasta: 990, pico: 0.06, s: 0, r: 0.04, rev: 0.15 }); },
  confirmar: () => { const t = ahora(); if (t == null) return; [72, 76, 79, 84].forEach((m, i) => tono(mtof(m), t + i * 0.055, 0.12, { tipo: 'square', pico: 0.045, s: 0.3, r: 0.1, rev: 0.25 })); },
  cancelar: () => { const t = ahora(); if (t == null) return; [76, 69].forEach((m, i) => tono(mtof(m), t + i * 0.07, 0.1, { tipo: 'triangle', pico: 0.06, s: 0.2, r: 0.08 })); },
  texto: () => { const t = ahora(); if (t != null) tono(al(1100, 1250), t, 0.018, { tipo: 'square', pico: 0.012, s: 0, r: 0.01, rev: 0 }); },
  encontrado: () => {
    const t = ahora(); if (t == null) return;
    [67, 72, 76, 79].forEach((m, i) => tono(mtof(m), t + i * 0.09, 0.16, { tipo: 'square', pico: 0.05, s: 0.4, r: 0.1, rev: 0.3 }));
    tono(mtof(84), t + 0.36, 0.5, { tipo: 'square', pico: 0.05, vib: 6, s: 0.6, r: 0.3, rev: 0.4 });
  },
  inicioBatalla: () => {
    const t = ahora(); if (t == null) return;
    ruido(t, 0.6, { filtro: 'bandpass', f: 300, hasta: 4000, q: 1.5, pico: 0.25, s: 0.5 });
    [[57, 64, 69], [60, 67, 72]].forEach((ac2, i) => ac2.forEach((m) => tono(mtof(m), t + 0.55 + i * 0.18, 0.2, { tipo: 'sawtooth', pico: 0.035, s: 0.5, r: 0.2, rev: 0.4 })));
    bombo(t + 0.55, { pico: 0.5 }); bombo(t + 0.73, { pico: 0.5 });
  },
  carga: (tipo = 'normal') => {
    const t = ahora(); if (t == null) return;
    tono(200, t, 0.35, { tipo: tipo === 'electric' ? 'sawtooth' : 'sine', hasta: 900, pico: 0.05, vib: 12, vibF: 14, s: 0.7, r: 0.05, rev: 0.3 });
    ruido(t, 0.35, { filtro: 'bandpass', f: 400, hasta: 3000, q: 4, pico: 0.08, rev: 0.3 });
  },
  ataque: (tipo = 'normal', potencia = 60) => {
    const t = ahora(); if (t == null) return;
    const k = Math.min(1.5, 0.7 + (potencia || 50) / 150);
    (ATAQUE[tipo] || ATAQUE.normal)(t, k);
  },
  golpe: (eff = 1, critico = false) => {
    const t = ahora(); if (t == null) return;
    if (eff > 1) {
      bombo(t, { pico: 0.7, desde: 220, hasta: 40, dur: 0.22 });
      ruido(t, 0.18, { filtro: 'highpass', f: 1500, pico: 0.35, s: 0.2, r: 0.1, rev: 0.3 });
      tono(mtof(84), t + 0.02, 0.15, { tipo: 'square', pico: 0.05, s: 0.3, r: 0.1, rev: 0.3 });
    } else if (eff < 1) {
      bombo(t, { pico: 0.3, desde: 120, hasta: 50, dur: 0.12 });
      ruido(t, 0.08, { filtro: 'lowpass', f: 600, pico: 0.18 });
    } else {
      bombo(t, { pico: 0.5, desde: 170, hasta: 45, dur: 0.16 });
      ruido(t, 0.12, { filtro: 'lowpass', f: 2200, pico: 0.28, s: 0.2, r: 0.06 });
    }
    if (critico) fm(1400, t + 0.03, 0.35, { ratio: 2.0, indice: 500, pico: 0.09, r: 0.3 });
  },
  residual: () => { const t = ahora(); if (t != null) ruido(t, 0.25, { filtro: 'bandpass', f: 900, q: 4, pico: 0.15 }); },
  fallo: () => { const t = ahora(); if (t != null) ruido(t, 0.3, { filtro: 'bandpass', f: 2500, hasta: 500, q: 3, pico: 0.15, rev: 0.3 }); },
  curar: () => { const t = ahora(); if (t == null) return; [72, 76, 79, 84, 88].forEach((m, i) => tono(mtof(m), t + i * 0.07, 0.2, { tipo: 'sine', pico: 0.07, s: 0.4, r: 0.3, rev: 0.6 })); },
  subir: () => { const t = ahora(); if (t == null) return; [67, 71, 74, 79, 83].forEach((m, i) => tono(mtof(m), t + i * 0.045, 0.1, { tipo: 'square', pico: 0.035, s: 0.3, r: 0.06, rev: 0.3 })); },
  bajar: () => { const t = ahora(); if (t == null) return; [79, 74, 71, 67, 62].forEach((m, i) => tono(mtof(m), t + i * 0.05, 0.1, { tipo: 'square', pico: 0.035, s: 0.3, r: 0.06, rev: 0.3 })); },
  estado: () => { const t = ahora(); if (t == null) return; tono(300, t, 0.3, { tipo: 'square', hasta: 500, pico: 0.04, vib: 40, vibF: 12, s: 0.5, rev: 0.3 }); },
  debilitado: () => {
    const t = ahora(); if (t == null) return;
    tono(700, t, 0.7, { tipo: 'square', hasta: 80, pico: 0.06, s: 0.5, r: 0.1, rev: 0.4 });
    bombo(t + 0.6, { pico: 0.5, desde: 90, hasta: 30, dur: 0.3 });
    ruido(t + 0.6, 0.3, { filtro: 'lowpass', f: 500, pico: 0.25 });
  },
  entrar: () => {
    const t = ahora(); if (t == null) return;
    ruido(t, 0.15, { filtro: 'highpass', f: 2500, hasta: 6000, pico: 0.12 });
    tono(mtof(84), t + 0.12, 0.08, { tipo: 'sine', pico: 0.06, s: 0, r: 0.15, rev: 0.4 });
    tono(mtof(91), t + 0.18, 0.12, { tipo: 'sine', pico: 0.05, s: 0, r: 0.2, rev: 0.4 });
  },
  retirar: () => { const t = ahora(); if (t != null) tono(900, t, 0.25, { tipo: 'sine', hasta: 200, pico: 0.06, s: 0.4, rev: 0.3 }); },
  alarma: () => {
    const t = ahora(); if (t == null) return;
    for (let i = 0; i < 3; i++) { tono(mtof(88), t + i * 0.3, 0.1, { tipo: 'square', pico: 0.025, s: 0.6, r: 0.02, rev: 0 }); tono(mtof(84), t + i * 0.3 + 0.13, 0.1, { tipo: 'square', pico: 0.025, s: 0.6, r: 0.02, rev: 0 }); }
  },
  disparo: () => sfx.carga(),
  victoria: () => {
    detenerMusica();
    const t = ahora(); if (t == null) return;
    const mel = [[72, 0, 0.12], [72, 0.13, 0.12], [72, 0.26, 0.12], [72, 0.39, 0.36], [68, 0.78, 0.36], [70, 1.17, 0.36], [72, 1.56, 0.24], [70, 1.82, 0.12], [72, 1.95, 0.9]];
    mel.forEach(([m, d, l]) => { tono(mtof(m), t + d, l, { tipo: 'square', pico: 0.06, s: 0.6, r: 0.08, rev: 0.3 }); tono(mtof(m - 12), t + d, l, { tipo: 'triangle', pico: 0.06, s: 0.6, r: 0.08, rev: 0.2 }); });
    [[60, 64, 67], [56, 60, 63], [58, 62, 65], [60, 64, 67]].forEach((ac2, i) => ac2.forEach((m) => tono(mtof(m), t + [0, 0.78, 1.17, 1.95][i], [0.7, 0.36, 0.7, 1.0][i], { tipo: 'sawtooth', pico: 0.018, s: 0.6, r: 0.2, rev: 0.4 })));
    [0, 0.39, 0.78, 1.17, 1.56, 1.95].forEach((d) => bombo(t + d, { pico: 0.35 }));
  },
  derrota: () => {
    detenerMusica();
    const t = ahora(); if (t == null) return;
    [[67, 0], [66, 0.35], [65, 0.7], [64, 1.05]].forEach(([m, d]) => tono(mtof(m), t + d, 0.4, { tipo: 'triangle', pico: 0.08, vib: 8, s: 0.6, r: 0.3, rev: 0.5 }));
    tono(mtof(40), t + 1.05, 1.2, { tipo: 'sawtooth', pico: 0.04, s: 0.6, r: 0.6, rev: 0.5 });
  },
};

/** Grito de un Pokémon (archivo .ogg de la PokeAPI). */
export function grito(url, { volumen = 0.35, velocidad = 1 } = {}) {
  if (modo === 'silencio' || !url) return;
  try {
    const a = new Audio(url);
    a.volume = volumen; a.playbackRate = velocidad;
    a.play().catch(() => {});
  } catch { /* formato no soportado (algunos iPhone) */ }
}

// ------------------------------------------------------------
//  Música de batalla (composición original, La menor, 150 BPM)
// ------------------------------------------------------------
const BPM = 150;
const PASO = 60 / BPM / 4; // semicorchea
// Acordes por compás: [raíz MIDI, tipo]
const ACORDES = [[57, 'm'], [53, 'M'], [55, 'M'], [52, 'M'], [57, 'm'], [53, 'M'], [55, 'M'], [52, '7']];
const NOTAS_ACORDE = { m: [0, 3, 7], M: [0, 4, 7], 7: [0, 4, 7, 10] };
// Melodía: por compás, [paso, nota MIDI, duración en pasos]
const MELODIA = [
  [[0, 69, 2], [2, 72, 2], [4, 76, 4], [8, 74, 2], [10, 72, 2], [12, 71, 2], [14, 72, 2]],
  [[0, 69, 4], [4, 65, 2], [6, 69, 2], [8, 72, 6]],
  [[0, 71, 2], [2, 74, 2], [4, 79, 4], [8, 77, 2], [10, 76, 2], [12, 74, 4]],
  [[0, 76, 6], [6, 68, 2], [8, 71, 4], [12, 76, 4]],
  [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 81, 2], [10, 83, 2], [12, 84, 4]],
  [[0, 81, 4], [4, 77, 4], [8, 72, 2], [10, 77, 2], [12, 81, 4]],
  [[0, 83, 2], [2, 81, 2], [4, 79, 2], [6, 77, 2], [8, 76, 2], [10, 74, 2], [12, 71, 4]],
  [[0, 80, 4], [4, 76, 4], [8, 71, 4], [12, 68, 4]],
];

let musica = null;
function voz(freq, t, dur, tipo, pico, destino) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = tipo; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pico, t + 0.008);
  g.gain.setValueAtTime(pico * 0.7, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(destino); o.start(t); o.stop(t + dur + 0.02);
}
function percusion(t, clase) {
  if (clase === 'bombo') { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(g).connect(busMusica); o.start(t); o.stop(t + 0.15); return; }
  const src = ctx.createBufferSource(); src.buffer = ruidoBuf; const f = ctx.createBiquadFilter(); const g = ctx.createGain();
  f.type = clase === 'caja' ? 'bandpass' : 'highpass'; f.frequency.value = clase === 'caja' ? 1800 : 7000;
  const dur = clase === 'caja' ? 0.12 : 0.04;
  g.gain.setValueAtTime(clase === 'caja' ? 0.5 : 0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(busMusica); src.start(t, Math.random()); src.stop(t + dur + 0.01);
}

function programarCompas(c, t0) {
  const [raiz, tipo] = ACORDES[c % 8];
  const tonos = NOTAS_ACORDE[tipo];
  for (let p = 0; p < 16; p++) {
    const t = t0 + p * PASO;
    // bajo en corcheas
    if (p % 2 === 0) voz(mtof(raiz - 12 + (p % 8 === 6 ? 7 : p % 8 === 4 ? 12 : 0)), t, PASO * 1.8, 'triangle', 0.5, busMusica);
    // arpegio
    const n = tonos[(p % tonos.length + Math.floor(p / 4)) % tonos.length];
    voz(mtof(raiz + 12 + n), t, PASO * 0.9, 'square', 0.07, busMusica);
    // batería
    if (p === 0 || p === 8 || (p === 10 && c % 2)) percusion(t, 'bombo');
    if (p === 4 || p === 12) percusion(t, 'caja');
    if (p % 2 === 0) percusion(t, 'plato');
  }
  for (const [p, m, l] of MELODIA[c % 8]) {
    const t = t0 + p * PASO;
    voz(mtof(m), t, l * PASO * 0.95, 'square', 0.16, busMusica);
    voz(mtof(m) * 1.004, t, l * PASO * 0.95, 'sawtooth', 0.04, busMusica);
  }
}

export function iniciarMusica() {
  if (!ac() || musica) return;
  const duracion = 16 * PASO;
  let compas = 0; let siguiente = ctx.currentTime + 0.1;
  musica = setInterval(() => {
    while (siguiente < ctx.currentTime + 0.3) { programarCompas(compas++, siguiente); siguiente += duracion; }
  }, 50);
}
export function detenerMusica() {
  if (musica) { clearInterval(musica); musica = null; }
  if (ctx && busMusica) {
    // corta suave lo que quede programado
    const g = busMusica.gain; const v = modo === 'todo' ? 0.22 : 0;
    g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    g.setValueAtTime(v, ctx.currentTime + 2.6);
  }
}

// Desbloquea el audio en el primer toque (requisito de los navegadores móviles)
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => ac(), { once: true, passive: true }));
