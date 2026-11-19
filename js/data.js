// ============================================================
//  GenClash · Datos estáticos del juego
//  (tabla de tipos, traducciones, generaciones, nombres de rivales)
// ============================================================

/** Generaciones disponibles. `ids` = rango de la Pokédex nacional (respaldo si falla la API). */
export const GENERACIONES = [
  { id: 1, romano: 'I',    region: 'Kanto',   año: 1996, ids: [1, 151],    destacados: [6, 9, 150],    tema: ['#ff7b54', '#ffb26b'] },
  { id: 2, romano: 'II',   region: 'Johto',   año: 1999, ids: [152, 251],  destacados: [157, 160, 249], tema: ['#c9a227', '#f4d35e'] },
  { id: 3, romano: 'III',  region: 'Hoenn',   año: 2002, ids: [252, 386],  destacados: [257, 260, 384], tema: ['#1fab89', '#62d2a2'] },
  { id: 4, romano: 'IV',   region: 'Sinnoh',  año: 2006, ids: [387, 493],  destacados: [392, 448, 445], tema: ['#5c6bc0', '#9fa8da'] },
  { id: 5, romano: 'V',    region: 'Teselia', año: 2010, ids: [494, 649],  destacados: [500, 503, 635], tema: ['#424242', '#9e9e9e'] },
  { id: 6, romano: 'VI',   region: 'Kalos',   año: 2013, ids: [650, 721],  destacados: [658, 681, 700], tema: ['#e91e63', '#f48fb1'] },
  { id: 7, romano: 'VII',  region: 'Alola',   año: 2016, ids: [722, 809],  destacados: [724, 745, 785], tema: ['#ff9800', '#ffcc80'] },
  { id: 8, romano: 'VIII', region: 'Galar',   año: 2019, ids: [810, 905],  destacados: [812, 887, 892], tema: ['#7b1fa2', '#ce93d8'] },
  { id: 9, romano: 'IX',   region: 'Paldea',  año: 2022, ids: [906, 1025], destacados: [908, 937, 1007], tema: ['#d32f2f', '#7e57c2'] },
];

/** Legendarios y singulares de todas las generaciones (formas base de la Pokédex nacional). */
export const LEGENDARIOS = {
  id: 10, romano: '★', region: 'Legendarios', año: 'Solo legendarios y singulares', destacados: [150, 384, 249], tema: ['#f9d423', '#ff4e50'],
  lista: [
    144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251,
    377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
    480, 481, 482, 483, 484, 485, 486, 487, 488, 490, 491, 492, 493,
    494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
    716, 717, 718, 719, 720, 721,
    772, 773, 785, 786, 787, 788, 791, 792, 800, 801, 802, 807, 809,
    888, 889, 890, 892, 893, 894, 895, 896, 897, 898, 905,
    1001, 1002, 1003, 1004, 1007, 1008, 1014, 1015, 1016, 1017, 1024, 1025,
  ],
};

export const TODAS = { id: 0, romano: '∞', region: 'Todas las generaciones', año: '1996–hoy', ids: [1, 1025], destacados: [25, 448, 6], tema: ['#00bcd4', '#7c4dff'] };

/** Multiplicadores de efectividad: atacante -> { defensor: multiplicador } (solo los distintos de 1). */
const TABLA = {
  normal:   { rock: .5, ghost: 0, steel: .5 },
  fire:     { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5, steel: 2 },
  water:    { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
  electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
  grass:    { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5, rock: 2, dragon: .5, steel: .5 },
  ice:      { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2, steel: .5 },
  fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: .5 },
  poison:   { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2, steel: 2 },
  flying:   { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5, steel: .5 },
  psychic:  { fighting: 2, poison: 2, psychic: .5, dark: 0, steel: .5 },
  bug:      { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5, dark: 2, steel: .5, fairy: .5 },
  rock:     { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2, steel: .5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: .5 },
  dragon:   { dragon: 2, steel: .5, fairy: 0 },
  dark:     { fighting: .5, psychic: 2, ghost: 2, dark: .5, fairy: .5 },
  steel:    { fire: .5, water: .5, electric: .5, ice: 2, rock: 2, steel: .5, fairy: 2 },
  fairy:    { fire: .5, fighting: 2, poison: .5, dragon: 2, dark: 2, steel: .5 },
};

/** Efectividad de un tipo de ataque contra una lista de tipos defensores. */
export function efectividad(tipoAtaque, tiposDefensor) {
  if (!tipoAtaque || !TABLA[tipoAtaque]) return 1;
  return tiposDefensor.reduce((m, t) => m * (TABLA[tipoAtaque][t] ?? 1), 1);
}

export const TIPOS = {
  normal:   { es: 'Normal',    color: '#A8A77A' },
  fire:     { es: 'Fuego',     color: '#EE8130' },
  water:    { es: 'Agua',      color: '#6390F0' },
  electric: { es: 'Eléctrico', color: '#F7D02C' },
  grass:    { es: 'Planta',    color: '#7AC74C' },
  ice:      { es: 'Hielo',     color: '#96D9D6' },
  fighting: { es: 'Lucha',     color: '#C22E28' },
  poison:   { es: 'Veneno',    color: '#A33EA1' },
  ground:   { es: 'Tierra',    color: '#E2BF65' },
  flying:   { es: 'Volador',   color: '#A98FF3' },
  psychic:  { es: 'Psíquico',  color: '#F95587' },
  bug:      { es: 'Bicho',     color: '#A6B91A' },
  rock:     { es: 'Roca',      color: '#B6A136' },
  ghost:    { es: 'Fantasma',  color: '#735797' },
  dragon:   { es: 'Dragón',    color: '#6F35FC' },
  dark:     { es: 'Siniestro', color: '#705746' },
  steel:    { es: 'Acero',     color: '#B7B7CE' },
  fairy:    { es: 'Hada',      color: '#D685AD' },
  typeless: { es: '???',       color: '#68A090' },
};

export const STATS_ES = {
  hp: 'PS', attack: 'Ataque', defense: 'Defensa',
  'special-attack': 'At. Esp.', 'special-defense': 'Def. Esp.', speed: 'Velocidad',
  accuracy: 'Precisión', evasion: 'Evasión',
};

export const STATS_CORTO = {
  attack: 'Atq', defense: 'Def', 'special-attack': 'AtE', 'special-defense': 'DfE', speed: 'Vel',
};

export const ESTADOS = {
  burn:      { es: 'quemado',     corto: 'QUE', color: '#EE8130' },
  paralysis: { es: 'paralizado',  corto: 'PAR', color: '#d4b106' },
  poison:    { es: 'envenenado',  corto: 'ENV', color: '#A33EA1' },
  toxic:     { es: 'gravemente envenenado', corto: 'TOX', color: '#7b1fa2' },
  sleep:     { es: 'dormido',     corto: 'DOR', color: '#8c8c8c' },
  freeze:    { es: 'congelado',   corto: 'CON', color: '#4fc3f7' },
};

export const CATEGORIAS = {
  physical: { es: 'Física',   icono: '⚔️' },
  special:  { es: 'Especial', icono: '✦' },
  status:   { es: 'Estado',   icono: '◎' },
};

/** Los pocos movimientos que el motor no puede representar (dependen de objetos, de aliados o de cambiar a mitad del ataque). */
export const MOVIMIENTOS_EXCLUIDOS = new Set([
  'snore', 'sleep-talk', 'belch', 'fling', 'natural-gift', 'spit-up', 'stockpile', 'swallow', 'bide', 'struggle',
  'baton-pass', 'teleport', 'shed-tail', 'sky-drop', 'geomancy', 'upper-hand', 'mat-block', 'steel-roller',
  'clangorous-soul', 'ally-switch', 'after-you', 'helping-hand', 'follow-me', 'rage-powder', 'spotlight',
  'instruct', 'quash', 'transform', 'mimic', 'sketch', 'metronome', 'copycat', 'mirror-move', 'assist',
  'me-first', 'nature-power', 'celebrate', 'hold-hands', 'happy-hour', 'splash', 'max-guard',
]);

/** Movimientos de estado que sí se permiten (el motor los modela). */
export const ESTADO_PERMITIDOS = new Set([
  'swords-dance', 'dragon-dance', 'nasty-plot', 'calm-mind', 'bulk-up', 'agility', 'iron-defense', 'amnesia',
  'quiver-dance', 'shell-smash', 'coil', 'hone-claws', 'work-up', 'growth', 'shift-gear', 'rock-polish',
  'cosmic-power', 'acid-armor', 'barrier', 'cotton-guard', 'tail-glow', 'victory-dance', 'take-heart',
  'recover', 'roost', 'soft-boiled', 'slack-off', 'milk-drink', 'moonlight', 'morning-sun', 'synthesis',
  'shore-up', 'heal-order', 'thunder-wave', 'will-o-wisp', 'toxic', 'hypnosis', 'sleep-powder', 'spore',
  'stun-spore', 'glare', 'sing', 'lovely-kiss', 'dark-void', 'poison-powder', 'confuse-ray',
  'sweet-kiss', 'supersonic', 'growl', 'screech', 'charm', 'scary-face', 'leer', 'tail-whip', 'metal-sound',
  'fake-tears', 'feather-dance', 'tickle', 'string-shot', 'cotton-spore', 'eerie-impulse', 'swagger',
  'protect', 'detect', 'stealth-rock', 'spikes', 'toxic-spikes', 'leech-seed', 'reflect', 'light-screen',
  'rain-dance', 'sunny-day', 'sandstorm', 'snowscape', 'taunt', 'haze', 'rest', 'belly-drum', 'pain-split',
  'heal-bell', 'aromatherapy', 'focus-energy', 'curse', 'defog', 'kings-shield', 'spiky-shield', 'baneful-bunker',
]);

export const NOMBRES_RIVALES = [
  'Ximena', 'Bruno', 'Valeria', 'Iker', 'Renata', 'Mateo', 'Camila', 'Santiago', 'Regina', 'Diego',
  'Fernanda', 'Leonardo', 'Sofía', 'Emiliano', 'Natalia', 'Rodrigo', 'Andrea', 'Gael', 'Mariana', 'Alonso',
];

export const TITULOS_RIVALES = [
  'Entrenadora As', 'Entrenador As', 'Campeón regional', 'Líder de gimnasio', 'Domadragones',
  'Montañero', 'Nadadora', 'Karateka', 'Psíquica', 'Científico', 'Criadora', 'Guardabosques',
];
