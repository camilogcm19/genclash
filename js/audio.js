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
    busMusica.gain.setTargetAtTime(modo === 'todo' ? (temaActual === 'menu' ? 0.18 : 0.22) : 0, ctx.currentTime, 0.1);
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
const ahora = () => ((navigator.userActivation && !navigator.userActivation.hasBeenActive) ? null : (ac() ? ctx.currentTime + 0.01 : null));

// ------------------------------------------------------------
//  Sonidos de ataque por tipo (p = factor de tono, k = duración)
// ------------------------------------------------------------
const ATAQUE = {
  fire(t, k, p) {
    ruido(t, 0.55 * k, { filtro: 'lowpass', f: 300 * p, hasta: 2600 * p, q: 0.7, pico: 0.35, s: 0.7 });
    for (let i = 0; i < 10; i++) ruido(t + al(0.05, 0.55 * k), 0.03, { filtro: 'highpass', f: 2500 * p, pico: 0.12, r: 0.02, rev: 0.1 });
    bombo(t + 0.05, { pico: 0.35, desde: 90 * p, hasta: 40, dur: 0.4 });
  },
  water(t, k, p) {
    ruido(t, 0.45 * k, { filtro: 'bandpass', f: 600 * p, hasta: 2200 * p, q: 1.2, pico: 0.3, s: 0.6 });
    for (let i = 0; i < 9; i++) tono(al(250, 500) * p, t + al(0, 0.5 * k), 0.08, { tipo: 'sine', hasta: al(900, 1500) * p, pico: 0.08, s: 0, r: 0.03, rev: 0.3 });
  },
  electric(t, k, p) {
    for (let i = 0; i < 4; i++) {
      const ti = t + i * 0.07 * k;
      tono(al(800, 1600) * p, ti, 0.12, { tipo: 'sawtooth', hasta: al(150, 300) * p, pico: 0.07, vib: 400, vibF: 60, s: 0.3, r: 0.04, rev: 0.15 });
      ruido(ti, 0.06, { filtro: 'highpass', f: 3000 * p, pico: 0.15, r: 0.03 });
    }
    tono(110 * p, t, 0.5 * k, { tipo: 'square', pico: 0.05, vib: 30, vibF: 50, s: 0.6, rev: 0.1 });
  },
  grass(t, k, p) {
    ruido(t, 0.5 * k, { filtro: 'bandpass', f: 3500 * p, hasta: 5000 * p, q: 2, pico: 0.18, s: 0.6 });
    [76, 79, 83, 86].forEach((m, i) => tono(mtof(m) * p, t + i * 0.06, 0.18, { tipo: 'triangle', pico: 0.06, s: 0.2, r: 0.2, rev: 0.4 }));
  },
  ice(t, k, p) {
    [88, 91, 95, 98, 100].forEach((m, i) => fm(mtof(m) * p, t + i * 0.05, 0.4, { ratio: 3.5, indice: 900, pico: 0.07, r: 0.5 }));
    ruido(t, 0.4 * k, { filtro: 'highpass', f: 6000 * p, pico: 0.12, s: 0.4, rev: 0.4 });
  },
  psychic(t, k, p) {
    tono(300 * p, t, 0.6 * k, { tipo: 'sine', hasta: 900 * p, pico: 0.12, vib: 25, vibF: 7, s: 0.8, r: 0.3, rev: 0.6 });
    tono(450 * p, t + 0.05, 0.6 * k, { tipo: 'triangle', hasta: 1350 * p, pico: 0.06, vib: 30, vibF: 5, s: 0.8, r: 0.3, rev: 0.6 });
  },
  ghost(t, k, p) {
    tono(520 * p, t, 0.8 * k, { tipo: 'sawtooth', hasta: 180 * p, pico: 0.05, vib: 20, vibF: 4, detune: 12, s: 0.7, r: 0.4, rev: 0.7 });
    tono(523 * p, t, 0.8 * k, { tipo: 'sine', hasta: 175 * p, pico: 0.1, vib: 25, vibF: 3, s: 0.7, r: 0.4, rev: 0.7 });
    ruido(t, 0.6 * k, { filtro: 'bandpass', f: 800 * p, hasta: 300 * p, q: 5, pico: 0.1, rev: 0.6 });
  },
  dragon(t, k, p) {
    rugido(75 * p, t, 0.7 * k, 0.14);
    ruido(t, 0.5 * k, { filtro: 'lowpass', f: 600 * p, hasta: 2000 * p, pico: 0.2 });
  },
  dark(t, k, p) {
    ruido(t, 0.35 * k, { filtro: 'lowpass', f: 3000 * p, hasta: 300 * p, pico: 0.25, s: 0.4 });
    bombo(t + 0.15, { pico: 0.45, desde: 120 * p, hasta: 35, dur: 0.3 });
    tono(110 * p, t, 0.5, { tipo: 'sawtooth', hasta: 55 * p, pico: 0.05, s: 0.5, rev: 0.4 });
  },
  fighting(t, k, p) {
    ruido(t, 0.12, { filtro: 'lowpass', f: 1800 * p, pico: 0.35, s: 0.2, r: 0.05 });
    bombo(t, { pico: 0.6, desde: 180 * p, hasta: 50, dur: 0.16 });
    bombo(t + 0.11 * k, { pico: 0.45, desde: 160 * p, hasta: 45, dur: 0.14 });
  },
  poison(t, k, p) {
    for (let i = 0; i < 12; i++) tono(al(120, 320) * p, t + al(0, 0.6 * k), 0.09, { tipo: 'sine', hasta: al(400, 700) * p, pico: 0.09, s: 0, r: 0.04, rev: 0.3 });
    ruido(t, 0.5 * k, { filtro: 'bandpass', f: 500 * p, q: 3, pico: 0.12, rev: 0.3 });
  },
  ground(t, k, p) {
    ruido(t, 0.9 * k, { filtro: 'lowpass', f: 160 * p, pico: 0.55, s: 0.8, r: 0.3, rev: 0.2 });
    tono(42 * p, t, 0.9 * k, { tipo: 'sine', pico: 0.35, s: 0.8, r: 0.3, rev: 0 });
    for (let i = 0; i < 5; i++) ruido(t + al(0.1, 0.7 * k), 0.05, { filtro: 'bandpass', f: 700 * p, q: 2, pico: 0.15 });
  },
  rock(t, k, p) {
    for (let i = 0; i < 7; i++) {
      const ti = t + al(0, 0.55 * k);
      ruido(ti, 0.07, { filtro: 'bandpass', f: al(500, 1200) * p, q: 2, pico: 0.25, r: 0.04 });
      bombo(ti, { pico: 0.2, desde: 140 * p, hasta: 50, dur: 0.1 });
    }
  },
  flying(t, k, p) {
    ruido(t, 0.6 * k, { filtro: 'bandpass', f: 400 * p, hasta: 3200 * p, q: 2.5, pico: 0.3, s: 0.6 });
    ruido(t + 0.25 * k, 0.4 * k, { filtro: 'bandpass', f: 3000 * p, hasta: 700 * p, q: 2.5, pico: 0.2, s: 0.5 });
  },
  bug(t, k, p) {
    tono(170 * p, t, 0.6 * k, { tipo: 'sawtooth', pico: 0.07, vib: 25, vibF: 32, s: 0.8, r: 0.1, rev: 0.15 });
    tono(340 * p, t, 0.6 * k, { tipo: 'square', pico: 0.03, vib: 40, vibF: 28, s: 0.8, r: 0.1, rev: 0.15 });
  },
  steel(t, k, p) {
    fm(520 * p, t, 0.6, { ratio: 1.41, indice: 1400, pico: 0.12, r: 0.6 });
    fm(780 * p, t + 0.02, 0.5, { ratio: 2.76, indice: 900, pico: 0.07, r: 0.5 });
    ruido(t, 0.05, { filtro: 'highpass', f: 4000 * p, pico: 0.25, r: 0.03 });
  },
  fairy(t, k, p) {
    [84, 88, 91, 96, 100, 103].forEach((m, i) => {
      tono(mtof(m) * p, t + i * 0.045 * k, 0.22, { tipo: 'sine', pico: 0.07, s: 0.2, r: 0.3, rev: 0.6 });
      tono(mtof(m + 12) * p, t + i * 0.045 * k, 0.12, { tipo: 'triangle', pico: 0.02, s: 0, r: 0.2, rev: 0.6 });
    });
  },
  normal(t, k, p) {
    ruido(t, 0.25 * k, { filtro: 'bandpass', f: 600 * p, hasta: 2500 * p, q: 1.5, pico: 0.25, s: 0.4 });
    bombo(t + 0.08, { pico: 0.4, desde: 160 * p });
  },
};
ATAQUE.typeless = ATAQUE.normal;

// ------------------------------------------------------------
//  Capas que hacen que cada movimiento suene distinto
// ------------------------------------------------------------
const CAPAS = [
  [/punch|kick|slam|hammer|smash|tackle|strike|stomp|body|crash|knuckle|arm|press|wood-hammer|headbutt|head/, (t, k, p, r) => {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) { bombo(t + 0.06 + i * 0.09, { pico: 0.55, desde: (150 + r() * 80) * p, hasta: 40, dur: 0.16 }); ruido(t + 0.06 + i * 0.09, 0.07, { filtro: 'lowpass', f: 2500 * p, pico: 0.3, r: 0.04 }); }
  }],
  [/beam|ray|laser|cannon|gun|blast-burn|prismatic|flash-cannon|signal/, (t, k, p, r) => {
    fm((180 + r() * 220) * p, t, 0.75 * k, { ratio: 1 + Math.floor(r() * 4) * 0.5, indice: 600 + r() * 900, pico: 0.07, r: 0.35 });
    tono((900 + r() * 500) * p, t, 0.7 * k, { tipo: 'sawtooth', hasta: (300 + r() * 200) * p, pico: 0.035, vib: 18, vibF: 22, s: 0.8, r: 0.2, rev: 0.4 });
  }],
  [/sing|song|voice|sound|roar|howl|growl|chatter|screech|hyper-voice|boomsupersonic|uproar|echoed|round|disarming|perish|clanging|torch-song|alluring/, (t, k, p, r) => {
    const escala = [0, 2, 4, 7, 9, 12, 14];
    for (let i = 0; i < 5; i++) { const m = 72 + escala[Math.floor(r() * escala.length)]; tono(mtof(m) * p, t + i * 0.1 * k, 0.2 * k, { tipo: r() < 0.5 ? 'triangle' : 'sine', pico: 0.06, vib: 10, vibF: 6, s: 0.6, r: 0.2, rev: 0.6 }); }
  }],
  [/slash|cut|claw|blade|scratch|scissor|razor|sacred-sword|leaf-blade|psycho-cut|night-slash|x-scissor|cross|aqua-cutter|kowtow/, (t, k, p, r) => {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) ruido(t + i * 0.11, 0.14, { filtro: 'bandpass', f: (1800 + r() * 2500) * p, hasta: (6000 + r() * 2000) * p, q: 3, pico: 0.28, s: 0.2, r: 0.05, rev: 0.25 });
  }],
  [/bite|fang|crunch|jaw|chomp/, (t, k, p) => {
    ruido(t + 0.05, 0.06, { filtro: 'bandpass', f: 1400 * p, q: 2, pico: 0.35, r: 0.03 });
    bombo(t + 0.07, { pico: 0.4, desde: 220 * p, hasta: 70, dur: 0.08 });
    ruido(t + 0.16, 0.05, { filtro: 'bandpass', f: 1100 * p, q: 2, pico: 0.3, r: 0.03 });
  }],
  [/drain|absorb|leech|giga-drain|horn-leech|parabolic|bitter-blade/, (t, k, p) => {
    tono(1200 * p, t, 0.7 * k, { tipo: 'sine', hasta: 300 * p, pico: 0.06, vib: 14, vibF: 9, s: 0.7, r: 0.3, rev: 0.6 });
    [88, 84, 79, 76].forEach((m, i) => tono(mtof(m) * p, t + 0.3 + i * 0.07, 0.15, { tipo: 'sine', pico: 0.04, s: 0.2, r: 0.2, rev: 0.6 }));
  }],
  [/quake|earth|bulldoze|magnitude|fissure|tectonic|land|precipice|stomping|high-horsepower/, (t, k, p) => {
    for (let i = 0; i < 4; i++) bombo(t + i * 0.12, { pico: 0.4, desde: 70 * p, hasta: 30, dur: 0.3 });
    ruido(t, 1.0 * k, { filtro: 'lowpass', f: 120 * p, pico: 0.45, s: 0.8, r: 0.4, rev: 0.3 });
  }],
  [/wing|air|wind|gust|hurricane|twister|tailwind|aeroblast|bleakwind|sky|brave-bird|acrobatics/, (t, k, p, r) => {
    ruido(t, 0.55 * k, { filtro: 'bandpass', f: (500 + r() * 600) * p, hasta: (2400 + r() * 1600) * p, q: 4, pico: 0.22, s: 0.6, rev: 0.4 });
  }],
  [/bomb|blast|burst|explosion|eruption|boom|nova|mind-blown|outburst|overheat|draco/, (t, k, p) => {
    bombo(t + 0.15, { pico: 0.8, desde: 120 * p, hasta: 25, dur: 0.6 });
    ruido(t + 0.15, 0.9 * k, { filtro: 'lowpass', f: 3500 * p, hasta: 200, pico: 0.45, s: 0.5, r: 0.4, rev: 0.4 });
  }],
  [/spore|powder|dust|seed|pollen|sleep|cotton/, (t, k, p, r) => {
    for (let i = 0; i < 14; i++) tono((2000 + r() * 3000) * p, t + al(0, 0.6 * k), 0.04, { tipo: 'sine', pico: 0.025, s: 0, r: 0.06, rev: 0.6 });
  }],
  [/ball|shot|bullet|sphere|orb|pulse|wave|shuriken|spikes|dart|needle|pin|arrow/, (t, k, p, r) => {
    tono((300 + r() * 300) * p, t, 0.25, { tipo: 'square', hasta: (900 + r() * 500) * p, pico: 0.035, s: 0.3, r: 0.08, rev: 0.3 });
    bombo(t + 0.28 * k, { pico: 0.35, desde: 200 * p, hasta: 60, dur: 0.12 });
  }],
  [/dance|swords|plot|calm|bulk|growth|work-up|coil|polish|agility|amnesia|barrier|defense|shift|hone|focus|tail-glow/, (t, k, p, r) => {
    const base = 67 + Math.floor(r() * 5);
    [0, 4, 7, 12, 16].forEach((d, i) => tono(mtof(base + d) * p, t + i * 0.06, 0.16, { tipo: 'square', pico: 0.03, s: 0.4, r: 0.12, rev: 0.4 }));
  }],
];
/** Si el nombre no dice nada, se elige una capa "de firma" con el hash del movimiento. */
const FIRMAS = [
  (t, k, p, r) => tono((600 + r() * 600) * p, t + 0.05, 0.35 * k, { tipo: 'sine', hasta: (1500 + r() * 900) * p, pico: 0.05, vib: 8, vibF: 9, s: 0.5, r: 0.2, rev: 0.5 }),
  (t, k, p, r) => fm((200 + r() * 300) * p, t, 0.4 * k, { ratio: 2 + Math.floor(r() * 3), indice: 300 + r() * 500, pico: 0.06, r: 0.3 }),
  (t, k, p, r) => { for (let i = 0; i < 3; i++) tono((400 + r() * 800) * p, t + i * 0.07, 0.08, { tipo: 'square', pico: 0.025, s: 0, r: 0.05, rev: 0.3 }); },
  (t, k, p) => ruido(t, 0.4 * k, { filtro: 'bandpass', f: 1200 * p, hasta: 300 * p, q: 6, pico: 0.15, s: 0.4, rev: 0.4 }),
  (t, k, p, r) => tono((90 + r() * 60) * p, t, 0.45 * k, { tipo: 'sawtooth', hasta: (45 + r() * 20) * p, pico: 0.05, s: 0.6, r: 0.2, rev: 0.3 }),
  (t, k, p, r) => { const m = 76 + Math.floor(r() * 8); tono(mtof(m) * p, t + 0.1, 0.3, { tipo: 'triangle', pico: 0.05, s: 0.3, r: 0.3, rev: 0.7 }); tono(mtof(m + 7) * p, t + 0.18, 0.3, { tipo: 'triangle', pico: 0.04, s: 0.3, r: 0.3, rev: 0.7 }); },
];

const hash = (txt) => { let h = 2166136261; for (const ch of String(txt)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function semilla(n) { let a = n >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/** Sonido propio de cada movimiento: base del tipo + capa por nombre + firma por hash. */
function sonidoMovimiento(move) {
  const t = ahora(); if (t == null) return;
  const r = semilla(hash(move.name || move.nombre));
  const tipo = ATAQUE[move.type] ? move.type : 'normal';
  const potencia = move.power || 70;
  const p = 0.8 + r() * 0.45;
  const k = Math.min(1.6, 0.65 + potencia / 160) * (0.85 + r() * 0.3);
  if (move.category === 'status') {
    // movimientos de estado: textura suave del tipo + arpegio mágico propio
    ATAQUE[tipo](t, 0.5, p * 1.1);
    const esc = [0, 3, 5, 7, 10, 12, 15];
    const base = 72 + Math.floor(r() * 6);
    for (let i = 0; i < 5; i++) tono(mtof(base + esc[Math.floor(r() * esc.length)]) * p, t + 0.05 + i * 0.075, 0.18, { tipo: i % 2 ? 'sine' : 'triangle', pico: 0.05, s: 0.3, r: 0.25, rev: 0.6 });
    return;
  }
  ATAQUE[tipo](t, k, p);
  const nombre = move.name || '';
  const capa = CAPAS.find(([re]) => re.test(nombre));
  if (capa) capa[1](t, k, p, r);
  FIRMAS[Math.floor(r() * FIRMAS.length)](t + 0.03, k, p, r);
  // golpes múltiples: un "tic" por golpe
  const golpes = Math.min(5, move.meta?.maxHits || 1);
  for (let i = 1; i < golpes; i++) bombo(t + 0.15 * i, { pico: 0.25, desde: 200 * p, hasta: 70, dur: 0.08 });
  // final por categoría
  if (move.category === 'physical') ruido(t + 0.2 * k, 0.08, { filtro: 'lowpass', f: 1500 * p, pico: 0.2, r: 0.05 });
  else fm(mtof(84 + Math.floor(r() * 8)) * p, t + 0.25 * k, 0.4, { ratio: 3, indice: 200, pico: 0.03, r: 0.4 });
}

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
  /** Acepta el movimiento completo (sonido único) o, por compatibilidad, (tipo, potencia). */
  ataque: (move = 'normal', potencia = 60) => {
    if (typeof move === 'string') move = { name: move, type: move, power: potencia, category: 'special' };
    sonidoMovimiento(move);
  },
  lanzar: () => {
    const t = ahora(); if (t == null) return;
    ruido(t, 0.45, { filtro: 'bandpass', f: 500, hasta: 2600, q: 3, pico: 0.18, s: 0.6, rev: 0.2 });
    tono(500, t, 0.4, { tipo: 'sine', hasta: 1100, pico: 0.03, s: 0.5, r: 0.1, rev: 0.2 });
  },
  rebote: () => { const t = ahora(); if (t == null) return; tono(300, t, 0.06, { tipo: 'square', hasta: 180, pico: 0.06, s: 0, r: 0.04, rev: 0.1 }); tono(380, t + 0.13, 0.05, { tipo: 'square', hasta: 220, pico: 0.04, s: 0, r: 0.04, rev: 0.1 }); },
  abrir: () => {
    const t = ahora(); if (t == null) return;
    ruido(t, 0.2, { filtro: 'highpass', f: 2500, hasta: 7000, pico: 0.16, r: 0.1, rev: 0.4 });
    [79, 84, 88, 91].forEach((m, i) => tono(mtof(m), t + 0.03 + i * 0.04, 0.12, { tipo: 'sine', pico: 0.05, s: 0.2, r: 0.25, rev: 0.6 }));
    bombo(t, { pico: 0.25, desde: 300, hasta: 90, dur: 0.1 });
  },
  escudo: () => { const t = ahora(); if (t == null) return; fm(660, t, 0.5, { ratio: 1.5, indice: 300, pico: 0.06, r: 0.5 }); tono(990, t + 0.05, 0.4, { tipo: 'sine', pico: 0.04, vib: 6, s: 0.5, r: 0.3, rev: 0.6 }); },
  clima: (c) => {
    const t = ahora(); if (t == null) return;
    if (c === 'rain') for (let i = 0; i < 30; i++) ruido(t + al(0, 1.4), 0.02, { filtro: 'highpass', f: 3000, pico: 0.06, r: 0.02, rev: 0.4 });
    else if (c === 'sun') [72, 76, 79, 84, 88].forEach((m, i) => tono(mtof(m), t + i * 0.08, 0.4, { tipo: 'sine', pico: 0.04, s: 0.5, r: 0.4, rev: 0.7 }));
    else if (c === 'sand') ruido(t, 1.4, { filtro: 'bandpass', f: 900, hasta: 2500, q: 1, pico: 0.12, s: 0.7, r: 0.4, rev: 0.3 });
    else [96, 91, 88, 84].forEach((m, i) => fm(mtof(m), t + i * 0.1, 0.5, { ratio: 3.5, indice: 600, pico: 0.03, r: 0.6 }));
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
//  Música original (todo sintetizado). Tres temas:
//  - "menu": tranquilo, Fa mayor, 96 BPM, piano eléctrico y campanas
//  - "batalla": Re menor, 172 BPM, bajo galopante, metales y arpegios
//  - "legendaria": Do menor, 132 BPM, timbales, coro y cuerdas épicas
// ------------------------------------------------------------
const ACORDE = { m: [0, 3, 7], M: [0, 4, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 6: [0, 4, 7, 9], sus: [0, 5, 7] };

function osc(tipo, freq, t, dur, pico, destino, { a = 0.006, r = 0.06, detune = 0, filtro, q = 0.8, fenv, vib = 0 } = {}) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = tipo; o.frequency.value = freq; o.detune.value = detune;
  let nodo = o;
  if (filtro) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(filtro, t);
    if (fenv) { f.frequency.linearRampToValueAtTime(fenv, t + Math.min(0.08, dur * 0.3)); f.frequency.exponentialRampToValueAtTime(Math.max(80, filtro), t + dur); }
    o.connect(f); nodo = f;
  }
  if (vib) { const l = ctx.createOscillator(); const lg = ctx.createGain(); l.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(vib, t + Math.min(0.5, dur * 0.6)); l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + r + 0.05); }
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pico, t + a);
  g.gain.setValueAtTime(pico, t + Math.max(a, dur - r)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + r);
  nodo.connect(g).connect(destino);
  o.start(t); o.stop(t + dur + r + 0.05);
  return g;
}
const conRev = (g, cant = 0.25) => { const e = ctx.createGain(); e.gain.value = cant; g.connect(e).connect(envioReverb); };

const inst = {
  bajo: (m, t, d, v = 0.5) => osc('square', mtof(m), t, d, v * 0.35, busMusica, { filtro: 500, fenv: 1400, q: 4, r: 0.04 }),
  bajoSuave: (m, t, d, v = 0.5) => osc('triangle', mtof(m), t, d, v * 0.7, busMusica, { r: 0.1 }),
  pluck: (m, t, d, v = 0.1) => conRev(osc('sawtooth', mtof(m), t, d, v, busMusica, { filtro: 900, fenv: 4200, q: 3, r: 0.05 }), 0.2),
  metal: (m, t, d, v = 0.13) => { for (const det of [-9, 9]) conRev(osc('sawtooth', mtof(m), t, d, v * 0.5, busMusica, { a: 0.03, filtro: 1400, fenv: 3600, q: 1.5, detune: det, r: 0.08, vib: d > 0.3 ? 5 : 0 }), 0.3); },
  cuadrado: (m, t, d, v = 0.08) => conRev(osc('square', mtof(m), t, d, v, busMusica, { filtro: 3000, r: 0.05, vib: d > 0.3 ? 4 : 0 }), 0.25),
  piano: (m, t, d, v = 0.08) => { conRev(osc('sine', mtof(m), t, d, v, busMusica, { a: 0.005, r: 0.35 }), 0.4); conRev(osc('triangle', mtof(m) * 2, t, Math.min(d, 0.12), v * 0.25, busMusica, { r: 0.15 }), 0.3); },
  campana: (m, t, d, v = 0.06) => {
    const f = mtof(m); const o = ctx.createOscillator(); const mo = ctx.createOscillator(); const mg = ctx.createGain(); const g = ctx.createGain();
    o.frequency.value = f; mo.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 2.5, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    mo.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, d * 2));
    o.connect(g).connect(busMusica); conRev(g, 0.5);
    o.start(t); mo.start(t); o.stop(t + Math.max(0.6, d * 2) + 0.05); mo.stop(t + Math.max(0.6, d * 2) + 0.05);
  },
  pad: (notas, t, d, v = 0.03) => { for (const m of notas) for (const det of [-6, 6]) conRev(osc('sawtooth', mtof(m), t, d, v, busMusica, { a: Math.min(0.4, d * 0.3), r: 0.4, filtro: 1100, detune: det }), 0.5); },
  coro: (notas, t, d, v = 0.045) => { for (const m of notas) conRev(osc('sine', mtof(m), t, d, v, busMusica, { a: 0.35, r: 0.5, vib: 4 }), 0.7); },
};
const perc = {
  bombo: (t, v = 0.9) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.connect(g).connect(busMusica); o.start(t); o.stop(t + 0.17); },
  ruido: (t, tipo, f, dur, v) => { const src = ctx.createBufferSource(); src.buffer = ruidoBuf; const fl = ctx.createBiquadFilter(); const g = ctx.createGain(); fl.type = tipo; fl.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); src.connect(fl).connect(g).connect(busMusica); src.start(t, Math.random()); src.stop(t + dur + 0.01); return g; },
  caja: (t, v = 0.5) => { conRev(perc.ruido(t, 'bandpass', 1900, 0.13, v), 0.25); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.05); g.gain.setValueAtTime(v * 0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07); o.connect(g).connect(busMusica); o.start(t); o.stop(t + 0.08); },
  plato: (t, v = 0.16) => perc.ruido(t, 'highpass', 7500, 0.04, v),
  abierto: (t, v = 0.12) => perc.ruido(t, 'highpass', 6500, 0.22, v),
  crash: (t, v = 0.2) => conRev(perc.ruido(t, 'highpass', 4000, 1.2, v), 0.4),
  tom: (t, f = 160, v = 0.6) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.18); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g).connect(busMusica); conRev(g, 0.3); o.start(t); o.stop(t + 0.23); },
  timbal: (t, f = 70, v = 0.9) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.setValueAtTime(f * 1.3, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); o.connect(g).connect(busMusica); conRev(g, 0.5); o.start(t); o.stop(t + 0.92); perc.ruido(t, 'lowpass', 300, 0.25, v * 0.4); },
  shaker: (t, v = 0.05) => perc.ruido(t, 'bandpass', 5500, 0.05, v),
};

const TEMAS = {
  batalla: {
    bpm: 172,
    acordes: [[50, 'm'], [46, 'M'], [48, 'M'], [45, '7'], [50, 'm'], [53, 'M'], [55, 'm'], [45, 'M'],
      [46, 'M'], [48, 'M'], [50, 'm'], [50, 'm'], [46, 'M'], [48, 'M'], [45, 'M'], [45, '7']],
    melodia: [
      [[0, 74, 3], [3, 77, 3], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 77, 2]],
      [[0, 74, 6], [6, 70, 2], [8, 74, 4], [12, 77, 4]],
      [[0, 76, 3], [3, 79, 3], [6, 84, 2], [8, 83, 2], [10, 81, 2], [12, 79, 4]],
      [[0, 81, 8], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 73, 2]],
      [[0, 74, 2], [2, 74, 1], [3, 77, 1], [4, 81, 4], [8, 86, 4], [12, 84, 2], [14, 81, 2]],
      [[0, 84, 6], [6, 81, 2], [8, 77, 4], [12, 72, 4]],
      [[0, 79, 2], [2, 82, 2], [4, 86, 4], [8, 84, 2], [10, 82, 2], [12, 81, 2], [14, 79, 2]],
      [[0, 81, 4], [4, 76, 2], [6, 73, 2], [8, 69, 8]],
      [[0, 70, 2], [3, 74, 3], [6, 77, 2], [8, 82, 6], [14, 81, 2]],
      [[0, 79, 2], [3, 76, 3], [6, 72, 2], [8, 79, 6], [14, 77, 2]],
      [[0, 77, 3], [3, 76, 3], [6, 74, 2], [8, 69, 4], [12, 74, 4]],
      [[0, 77, 4], [4, 81, 4], [8, 86, 8]],
      [[0, 86, 2], [2, 84, 2], [4, 82, 2], [6, 81, 2], [8, 82, 4], [12, 77, 4]],
      [[0, 84, 2], [2, 82, 2], [4, 81, 2], [6, 79, 2], [8, 79, 4], [12, 76, 4]],
      [[0, 81, 6], [6, 85, 2], [8, 88, 8]],
      [[0, 85, 4], [4, 81, 4], [8, 76, 4], [12, 73, 2], [14, 76, 2]],
    ],
    compas(c, t0, P) {
      const [raiz, tipo] = this.acordes[c % 16]; const ac2 = ACORDE[tipo];
      const fin = c % 8 === 7;
      for (let p = 0; p < 16; p++) {
        const t = t0 + p * P;
        // bajo galopante: corchea + dos semicorcheas
        if (p % 4 !== 3) inst.bajo(raiz - 12 + (p % 8 >= 6 ? 12 : 0), t, P * 0.9, 0.55);
        // arpegio de sierra
        inst.pluck(raiz + 24 + ac2[(p + Math.floor(p / 4)) % ac2.length], t, P * 0.8, 0.05);
        // batería
        if (p === 0 || p === 6 || p === 10) perc.bombo(t);
        if (p === 4 || p === 12) perc.caja(t);
        if (fin && p >= 12) perc.tom(t, [200, 170, 140, 110][p - 12]);
        if (p % 2 === 0) perc.plato(t); else if (p % 4 === 3) perc.plato(t, 0.08);
      }
      if (c % 8 === 0) perc.crash(t0);
      inst.pad(ac2.map((n) => raiz + 12 + n), t0, 16 * P, 0.012);
      for (const [p, m, l] of this.melodia[c % 16]) inst.metal(m, t0 + p * P, l * P * 0.95, 0.12);
      // contracanto en la segunda mitad
      if (c % 16 >= 8) for (const [p, m, l] of this.melodia[(c + 8) % 16]) if (p % 4 === 0) inst.cuadrado(m - 12, t0 + p * P, l * P * 0.8, 0.025);
    },
  },
  legendaria: {
    bpm: 132,
    acordes: [[48, 'm'], [44, 'M'], [51, 'M'], [46, 'M'], [48, 'm'], [44, 'M'], [53, 'm'], [55, 'M']],
    melodia: [
      [[0, 72, 8], [8, 75, 4], [12, 74, 4]], [[0, 72, 6], [6, 70, 2], [8, 68, 8]],
      [[0, 70, 8], [8, 74, 4], [12, 75, 4]], [[0, 77, 12], [12, 74, 4]],
      [[0, 79, 8], [8, 80, 4], [12, 79, 4]], [[0, 77, 6], [6, 75, 2], [8, 72, 8]],
      [[0, 77, 4], [4, 80, 4], [8, 84, 8]], [[0, 83, 8], [8, 79, 4], [12, 74, 4]],
    ],
    compas(c, t0, P) {
      const [raiz, tipo] = this.acordes[c % 8]; const ac2 = ACORDE[tipo];
      for (let p = 0; p < 16; p++) {
        const t = t0 + p * P;
        if (p % 2 === 0) inst.bajo(raiz - 12, t, P * 1.6, 0.5);
        if (p % 4 === 0 || p === 14) inst.pluck(raiz + 12 + ac2[(p / 2) % ac2.length | 0], t, P * 1.5, 0.035);
        if (p === 0 || p === 8) perc.timbal(t, mtof(raiz - 12));
        if (p === 14 && c % 2) perc.timbal(t, mtof(raiz - 5), 0.6);
        if (p === 4 || p === 12) perc.caja(t, 0.35);
        if (p % 2 === 1) perc.shaker(t);
      }
      if (c % 4 === 0) perc.crash(t0, 0.15);
      inst.coro(ac2.map((n) => raiz + 24 + n), t0, 16 * P, 0.03);
      inst.pad(ac2.map((n) => raiz + 12 + n), t0, 16 * P, 0.016);
      for (const [p, m, l] of this.melodia[c % 8]) inst.metal(m, t0 + p * P, l * P * 0.97, 0.14);
    },
  },
  menu: {
    bpm: 96,
    acordes: [[53, 'maj7'], [57, 'm7'], [58, 'maj7'], [60, '6'], [62, 'm7'], [58, 'maj7'], [55, 'm7'], [60, '7']],
    melodia: [
      [[0, 81, 4], [6, 79, 2], [8, 77, 6]], [[2, 76, 2], [4, 79, 4], [8, 84, 6]],
      [[0, 82, 4], [4, 81, 2], [6, 77, 2], [8, 74, 8]], [[4, 72, 2], [6, 74, 2], [8, 76, 4], [12, 79, 4]],
      [[0, 81, 6], [8, 84, 4], [12, 86, 4]], [[0, 84, 4], [4, 82, 2], [6, 81, 2], [8, 77, 8]],
      [[2, 74, 2], [4, 77, 4], [8, 79, 4], [12, 81, 4]], [[0, 79, 8], [10, 76, 2], [12, 72, 4]],
    ],
    compas(c, t0, P) {
      const [raiz, tipo] = this.acordes[c % 8]; const ac2 = ACORDE[tipo];
      // acordes de piano eléctrico, con un poco de swing
      for (const p of [0, 6, 10]) ac2.forEach((n, i) => inst.piano(raiz + n + (i === 0 ? 12 : 0), t0 + p * P + i * 0.012, P * (p === 0 ? 5 : 3.5), 0.035));
      inst.bajoSuave(raiz - 12, t0, P * 6, 0.45);
      inst.bajoSuave(raiz - 12 + 7, t0 + 8 * P, P * 3, 0.35);
      inst.bajoSuave(raiz - 12, t0 + 12 * P, P * 3, 0.35);
      for (let p = 0; p < 16; p++) {
        const t = t0 + p * P + (p % 2 ? P * 0.18 : 0);
        if (p === 0 || p === 9) perc.bombo(t, 0.55);
        if (p === 4 || p === 12) perc.ruido(t, 'bandpass', 1500, 0.09, 0.18);
        if (p % 2 === 0) perc.plato(t, 0.06); else perc.shaker(t, 0.03);
      }
      for (const [p, m, l] of this.melodia[c % 8]) inst.campana(m, t0 + p * P, l * P, 0.05);
    },
  },
};

let musica = null; let temaActual = null;
/** Inicia (o cambia a) un tema: 'batalla', 'legendaria' o 'menu'. */
let temaPendiente = null;
export function iniciarMusica(tema = 'batalla') {
  // Los navegadores no dejan sonar nada antes del primer toque: se guarda para entonces
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) { temaPendiente = tema; return; }
  if (!ac()) return;
  if (musica && temaActual === tema) return;
  if (musica) detenerMusica(true);
  const T = TEMAS[tema] || TEMAS.batalla;
  temaActual = tema;
  const P = 60 / T.bpm / 4;
  const dur = 16 * P;
  let compas = 0; let siguiente = ctx.currentTime + 0.12;
  const g = busMusica.gain; const v = modo === 'todo' ? (tema === 'menu' ? 0.18 : 0.22) : 0;
  g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(0.0001, ctx.currentTime); g.linearRampToValueAtTime(v, ctx.currentTime + 0.6);
  const id = setInterval(() => {
    while (siguiente < ctx.currentTime + 0.35) { T.compas(compas++, siguiente, P); siguiente += dur; }
  }, 60);
  musica = id;
}
export function temaSonando() { return musica ? temaActual : null; }
export function detenerMusica(rapido = false) {
  temaPendiente = null;
  if (musica) { clearInterval(musica); musica = null; temaActual = null; }
  if (ctx && busMusica) {
    // corta suave lo que quede programado
    const g = busMusica.gain;
    g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + (rapido ? 0.15 : 0.3));
  }
}

// Desbloquea el audio en el primer toque (requisito de los navegadores móviles)
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => {
  ac();
  if (temaPendiente && modo === 'todo') { const t = temaPendiente; temaPendiente = null; setTimeout(() => iniciarMusica(t), 0); }
}, { once: true, passive: true }));
