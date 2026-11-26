'use strict';
/**
 * Skymood color pipeline.
 *
 *   phase blend (OKLab)  ->  atmosphere (OKLCH)  ->  night warmth  ->  playful tints
 *                         ->  WCAG contrast clamp (always last)
 *
 * Everything is a pure function, so the extension and the test suite run the exact same path.
 */
const P = require('./palette');
const FX = require('./effects');

const { hexToRgb, rgbToHex, luminance, contrast } = P;

// ---------- OKLab / OKLCH (Björn Ottosson) ----------
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex.slice(0, 7)).map(v => toLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}

/** Returns linear sRGB (may be out of gamut). */
function oklabToLinear(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}

const inGamut = rgb => rgb.every(v => v >= -0.0005 && v <= 1.0005);

function oklabToHex(L, a, b) {
  const lin = oklabToLinear(L, a, b);
  return rgbToHex(lin.map(v => toSrgb(Math.max(0, Math.min(1, v))) * 255));
}

const hexToOklch = hex => {
  const [L, a, b] = hexToOklab(hex);
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
};

/** OKLCH -> hex; chroma is reduced until the color fits in sRGB, so hue and lightness hold. */
function oklchToHex(L, C, h) {
  L = Math.max(0, Math.min(1, L));
  const at = c => [L, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
  if (inGamut(oklabToLinear(...at(C)))) return oklabToHex(...at(C));
  let lo = 0, hi = C;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinear(...at(mid)))) lo = mid; else hi = mid;
  }
  return oklabToHex(...at(lo));
}

// ---------- phase blend ----------
/** Blends keyframe palettes by phase weight in OKLab, so mid-transition colors stay clean (no muddy RGB midpoints). */
function blend(weights, frames = P.KEYFRAMES) {
  const out = {};
  for (const key of Object.keys(frames.day)) {
    const acc = [0, 0, 0];
    let total = 0;
    for (const phase of P.PHASES) {
      const w = weights[phase] || 0;
      if (!w) continue;
      total += w;
      hexToOklab(frames[phase][key]).forEach((v, i) => (acc[i] += v * w));
    }
    out[key] = oklabToHex(acc[0] / total, acc[1] / total, acc[2] / total);
  }
  return out;
}

// ---------- atmospheres ----------
const SURFACE = ['bg', 'bgAlt', 'bgDeep', 'border', 'selection', 'lineHL'];
const NEUTRAL = ['fg', 'muted', 'variable', 'comment'];
const ACCENT = ['accent'];
const FG_LIKE = ['fg', 'variable']; // the text colors overcast softens

/**
 * Each atmosphere is a bias applied on top of the solar phase:
 *  chroma   multiplier on colorfulness (per group)
 *  hue      { to, surface, neutral, accent, syntax }: how far (0..1) each group rotates toward a hue angle
 *  floor    minimum chroma for surfaces, so the tint is visible on near-gray backgrounds
 *  soften   fraction of the text-to-background lightness gap given up (calmer contrast)
 *  blueCut  { dark, light }: share of blue removed in sRGB; syntax gets half of it
 *  twilight stretch of the night <-> day transitions
 */
const ATMOSPHERES = {
  clear: { label: 'Clear', description: 'The crisp solar palette.' },
  overcast: {
    label: 'Overcast',
    description: 'Monsoon and rainy days: ~28% less chroma, cool slate neutrals, softer contrast.',
    chroma: { surface: 0.72, neutral: 0.72, accent: 0.72, syntax: 0.72 },
    hue: { to: 235, surface: 0.7, neutral: 0.55, accent: 0.2, syntax: 0.1 },
    floor: 0.011, soften: 0.1, twilight: 1
  },
  arctic: {
    label: 'Arctic',
    description: 'Crisp ice tones with a 215° hue bias and extended twilight transitions.',
    chroma: { surface: 1, neutral: 1, accent: 1.04, syntax: 1.04 },
    hue: { to: 215, surface: 0.75, neutral: 0.5, accent: 0.4, syntax: 0.2 },
    floor: 0.016, soften: 0, twilight: 1.45
  },
  amber: {
    label: 'Amber',
    description: 'Deep warm comfort: 55° hue bias and strong blue-light attenuation at every hour.',
    chroma: { surface: 1, neutral: 1, accent: 0.95, syntax: 0.92 },
    hue: { to: 55, surface: 0.6, neutral: 0.5, accent: 0.75, syntax: 0.18 },
    floor: 0.014, soften: 0, blueCut: { dark: 0.2, light: 0.12 }, twilight: 1
  }
};
const ATMOSPHERE_NAMES = Object.keys(ATMOSPHERES);
const atmosphereName = name => (ATMOSPHERES[name] ? name : 'clear');

/** Applies an atmosphere to a blended palette. 'clear' returns it unchanged. */
function applyAtmosphere(palette, name) {
  const spec = ATMOSPHERES[atmosphereName(name)];
  if (!spec.hue) return palette;
  const light = P.isLight(palette);
  const bgL = hexToOklch(palette.bg)[0];
  const out = {};
  for (const key of Object.keys(palette)) {
    const group = SURFACE.includes(key) ? 'surface' : NEUTRAL.includes(key) ? 'neutral' : ACCENT.includes(key) ? 'accent' : 'syntax';
    let [L, C, h] = hexToOklch(palette[key]);
    C *= spec.chroma[group];
    const s = spec.hue[group];
    if (group === 'surface') C = Math.max(C, spec.floor); // give gray surfaces a visible tint
    // Pull the color toward the target hue in the a/b plane (not around the hue wheel): a warm
    // cream drifts to cool slate by way of neutral gray instead of detouring through green.
    const t = spec.hue.to * Math.PI / 180;
    const a = (1 - s) * C * Math.cos(h * Math.PI / 180) + s * C * Math.cos(t);
    const b = (1 - s) * C * Math.sin(h * Math.PI / 180) + s * C * Math.sin(t);
    C = Math.hypot(a, b);
    h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    if (spec.soften && FG_LIKE.includes(key)) L += (bgL - L) * spec.soften;
    let hex = oklchToHex(L, C, h);
    if (spec.blueCut) {
      const k = (light ? spec.blueCut.light : spec.blueCut.dark) * (group === 'surface' || group === 'neutral' ? 1 : 0.5);
      const [r, g, b] = hexToRgb(hex);
      hex = rgbToHex([r, g, b * (1 - k)]);
    }
    out[key] = hex;
  }
  return out;
}

const twilightFor = name => ATMOSPHERES[atmosphereName(name)].twilight || 1;

// ---------- readability clamp ----------
const MIN_TEXT = 4.55; // editor text and syntax tokens
const MIN_COMMENT = 3.05; // comments are deliberately quieter

/**
 * Nudges `fg` in OKLCH lightness, away from `bg`, until it reaches `min`. Hue and chroma are
 * kept (chroma is trimmed only if the color would leave sRGB). Colors already readable are untouched.
 */
function ensureContrast(fg, bg, min) {
  const base = fg.slice(0, 7);
  const back = bg.slice(0, 7);
  if (contrast(base, back) >= min) return fg;
  const [L, C, h] = hexToOklch(base);
  const target = luminance(base) >= luminance(back) ? 1 : 0; // away from the background
  if (contrast(oklchToHex(target, C, h), back) < min) return oklchToHex(target, C, h); // best possible
  let lo = L, hi = target; // lo fails, hi passes
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(oklchToHex(mid, C, h), back) >= min) hi = mid; else lo = mid;
  }
  return oklchToHex(hi, C, h);
}

/**
 * The last step of the pipeline, after atmosphere, warmth and playful tints, so none of them
 * can make code harder to read. Mutates and returns its arguments.
 */
function clampReadability(colors, tokens) {
  const bg = colors['editor.background'];
  colors['editor.foreground'] = ensureContrast(colors['editor.foreground'], bg, MIN_TEXT);
  for (const rule of tokens) {
    const min = /comment/i.test(rule.name) ? MIN_COMMENT : MIN_TEXT;
    rule.settings.foreground = ensureContrast(rule.settings.foreground, bg, min);
  }
  return { colors, tokens };
}

// ---------- the whole pipeline ----------
/** Phase weights for a minute of the day (or a pinned phase), including the atmosphere's twilight stretch. */
function phaseState(minute, sunrise, sunset, pinned = 'auto', atmosphere = 'clear') {
  if (pinned !== 'auto' && P.PHASES.includes(pinned)) {
    return { weights: { night: 0, dawn: 0, day: 0, dusk: 0, [pinned]: 1 }, dominant: pinned, from: pinned, to: pinned, progress: 0 };
  }
  return P.stateAt(minute, sunrise, sunset, twilightFor(atmosphere));
}


/**
 * @param {object} o
 * @param {number} o.minute minutes since local midnight
 * @param {number} o.sunrise
 * @param {number} o.sunset
 * @param {'dark'|'light'} [o.variant]
 * @param {string} [o.atmosphere] clear | overcast | arctic | amber
 * @param {number} [o.warmth] night warmth 0..1
 * @param {string} [o.pinned] 'auto' or a phase
 * @param {object} [o.fx] playful effect levels for FX.decorate()
 */
function compose({ minute, sunrise, sunset, variant = 'dark', atmosphere = 'clear', warmth = 0.4, pinned = 'auto', fx = {} }) {
  const atmo = atmosphereName(atmosphere);
  const state = phaseState(minute, sunrise, sunset, pinned, atmo);
  const frames = variant === 'light' ? P.LIGHT_KEYFRAMES : P.KEYFRAMES;
  let palette = blend(state.weights, frames);
  palette = applyAtmosphere(palette, atmo);
  palette = P.withWarmth(palette, Math.max(0, Math.min(1, warmth)) * (state.weights.night || 0));
  const colors = FX.decorate(P.workbenchColors(palette), palette, fx);
  const tokens = P.tokenRules(palette);
  clampReadability(colors, tokens);
  return { state, palette, colors, tokens, atmosphere: atmo };
}

module.exports = {
  ATMOSPHERES, ATMOSPHERE_NAMES, MIN_TEXT, MIN_COMMENT,
  hexToOklab, hexToOklch, oklchToHex, blend, applyAtmosphere, twilightFor, phaseState,
  ensureContrast, clampReadability, compose
};
