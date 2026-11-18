// ============================================================
//  GenClash · Sonido
//  Efectos sintetizados con Web Audio (sin archivos) + gritos
//  reales de cada Pokémon desde el repositorio de la PokeAPI.
// ============================================================
let ctx = null;
let silencio = localStorage.getItem('gc:mute') === '1';

export const estaSilenciado = () => silencio;
export function alternarSonido() {
  silencio = !silencio;
  localStorage.setItem('gc:mute', silencio ? '1' : '0');
  return silencio;
}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tono(freq, dur = 0.12, { tipo = 'square', vol = 0.08, desliz = 0, retraso = 0 } = {}) {
  if (silencio) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime + retraso;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = tipo; o.frequency.setValueAtTime(freq, t);
  if (desliz) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + desliz), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function ruido(dur = 0.15, vol = 0.18, filtro = 1200) {
  if (silencio) return;
  const c = ac(); if (!c) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filtro;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination);
  s.start();
}

export const sfx = {
  click: () => tono(880, 0.05, { tipo: 'triangle', vol: 0.05 }),
  hover: () => tono(1320, 0.03, { tipo: 'sine', vol: 0.02 }),
  golpe: (eff = 1) => {
    if (eff > 1) { ruido(0.22, 0.28, 2400); tono(180, 0.18, { desliz: -120, vol: 0.12 }); tono(140, 0.2, { desliz: -90, vol: 0.1, retraso: 0.09 }); }
    else if (eff < 1) { ruido(0.12, 0.12, 700); }
    else { ruido(0.16, 0.2, 1500); tono(160, 0.12, { desliz: -80, vol: 0.08 }); }
  },
  disparo: () => tono(520, 0.18, { tipo: 'sawtooth', vol: 0.04, desliz: 400 }),
  fallo: () => tono(400, 0.2, { tipo: 'sine', vol: 0.05, desliz: -250 }),
  curar: () => [523, 659, 784, 1046].forEach((f, i) => tono(f, 0.12, { tipo: 'sine', vol: 0.06, retraso: i * 0.07 })),
  subir: () => [440, 554, 659].forEach((f, i) => tono(f, 0.09, { tipo: 'triangle', vol: 0.06, retraso: i * 0.06 })),
  bajar: () => [659, 554, 440].forEach((f, i) => tono(f, 0.09, { tipo: 'triangle', vol: 0.06, retraso: i * 0.06 })),
  estado: () => tono(300, 0.25, { tipo: 'square', vol: 0.05, desliz: 200 }),
  debilitado: () => tono(600, 0.6, { tipo: 'square', vol: 0.07, desliz: -540 }),
  entrar: () => { ruido(0.08, 0.1, 3000); tono(990, 0.08, { tipo: 'sine', vol: 0.05, retraso: 0.05 }); },
  encontrado: () => [392, 523, 659, 784].forEach((f, i) => tono(f, 0.14, { tipo: 'square', vol: 0.05, retraso: i * 0.09 })),
  victoria: () => [523, 523, 523, 659, 784, 659, 784, 1046].forEach((f, i) => tono(f, i === 7 ? 0.5 : 0.13, { tipo: 'square', vol: 0.06, retraso: [0, .12, .24, .36, .55, .74, .86, 1.0][i] })),
  derrota: () => [392, 349, 311, 262].forEach((f, i) => tono(f, 0.3, { tipo: 'triangle', vol: 0.07, retraso: i * 0.25 })),
};

/** Reproduce el grito de un Pokémon (archivo .ogg de la PokeAPI). */
export function grito(url, { volumen = 0.35, velocidad = 1 } = {}) {
  if (silencio || !url) return;
  try {
    const a = new Audio(url);
    a.volume = volumen; a.playbackRate = velocidad;
    a.play().catch(() => {});
  } catch { /* formato no soportado (algunos iPhone) */ }
}
