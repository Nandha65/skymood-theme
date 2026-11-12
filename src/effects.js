'use strict';
/**
 * Playful effects layered on top of the base Skymood palette.
 * All pure functions: given colors + effect state, return new colors.
 */
const { mix } = require('./palette');

const GOLD = '#ffc46b';
const MOONLIGHT = '#cfd8ff';
const ERROR_RED = '#ff3b3b';

const ACCENT_KEYS = [
  'tab.activeBorderTop', 'activityBar.activeBorder', 'activityBar.foreground', 'editorCursor.foreground',
  'panelTitle.activeBorder', 'progressBar.background', 'button.background', 'badge.background',
  'activityBarBadge.background', 'editorLineNumber.activeForeground', 'textLink.foreground',
  'statusBarItem.remoteBackground', 'pickerGroup.foreground', 'list.highlightForeground',
  'editorSuggestWidget.highlightForeground', 'inputOption.activeBorder'
];
const SURFACE_KEYS = ['editor.background', 'editorGutter.background', 'minimap.background', 'sideBar.background',
  'titleBar.activeBackground', 'statusBar.background', 'activityBar.background', 'tab.activeBackground'];

/** mix() that tolerates #rrggbbaa values and keeps their alpha. */
function mixA(value, target, t) {
  if (!value || t <= 0) return value;
  const base = value.slice(0, 7);
  const a = value.length === 9 ? value.slice(7) : '';
  return mix(base, target, Math.min(1, t)) + a;
}
function shift(colors, keys, target, t) {
  for (const k of keys) if (colors[k]) colors[k] = mixA(colors[k], target, t);
}

// ---------- sky ----------
const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const MOON_NAMES = [
  [0.0339, 'New moon', '🌑'], [0.216, 'Waxing crescent', '🌒'], [0.284, 'First quarter', '🌓'],
  [0.466, 'Waxing gibbous', '🌔'], [0.534, 'Full moon', '🌕'], [0.716, 'Waning gibbous', '🌖'],
  [0.784, 'Last quarter', '🌗'], [0.966, 'Waning crescent', '🌘'], [1.01, 'New moon', '🌑']
];
function moonInfo(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const f = age / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * f)) / 2;
  const [, name, emoji] = MOON_NAMES.find(([lim]) => f < lim);
  return { name, emoji, illumination, age };
}

/** 0..1 golden-hour strength around sunrise and sunset. */
function goldenAmount(minute, sunrise, sunset) {
  const bell = (center, width) => {
    let d = Math.abs(minute - center);
    d = Math.min(d, 1440 - d);
    const x = Math.max(0, 1 - d / width);
    return x * x * (3 - 2 * x);
  };
  return Math.max(bell(sunset - 15, 40), 0.7 * bell(sunrise + 20, 35));
}

// ---------- activity levels ----------
function flowLevel(minutes) {
  if (minutes >= 30) return 3;
  if (minutes >= 15) return 2;
  if (minutes >= 5) return 1;
  return 0;
}
function bugLevel(errors) {
  if (errors >= 10) return 3;
  if (errors >= 3) return 2;
  if (errors >= 1) return 1;
  return 0;
}

/** One emoji per celebration, picked fresh each time so it doesn't get stale. */
const CHEER_EMOJI = {
  small: ['👍', '✅', '👌', '🙂', '✨'],
  medium: ['🙌', '💪', '💯', '👏', '🤟'],
  big: ['🏆', '🚀', '👑', '🥳', '🔥']
};

/**
 * How big a celebration fixing `fixed` errors deserves: how much confetti, the badge shown
 * over the editor, and the status bar message.
 */
function celebration(fixed, random = Math.random) {
  const kind = fixed >= 10 ? 'big' : fixed >= 3 ? 'medium' : 'small';
  const set = CHEER_EMOJI[kind];
  const emoji = set[Math.floor(random() * set.length)];
  const message = kind === 'big' ? `${fixed} errors squashed!`
    : kind === 'medium' ? `${fixed} errors fixed!`
      : fixed === 1 ? 'Error fixed. All clear!' : 'Both errors fixed. All clear!';
  return { kind, emoji, label: `${emoji}  ${message}`, text: `$(pass-filled) ${message} ${emoji}` };
}

/**
 * @param {Record<string,string>} base workbench colors
 * @param {object} p blended palette
 * @param {{golden?:number, moonGlow?:number, flow?:number, bugs?:number}} fx
 */
function decorate(base, p, fx) {
  const c = { ...base };
  const golden = fx.golden || 0;
  const moonGlow = fx.moonGlow || 0;
  const flow = (fx.flow || 0) / 3;
  const bugs = (fx.bugs || 0) / 3;

  if (golden > 0) {
    shift(c, ACCENT_KEYS, GOLD, 0.75 * golden);
    shift(c, SURFACE_KEYS, GOLD, 0.05 * golden);
    shift(c, ['editor.lineHighlightBackground', 'tab.activeBorder'], GOLD, 0.08 * golden);
  }
  if (moonGlow > 0) {
    shift(c, ACCENT_KEYS, MOONLIGHT, 0.55 * moonGlow);
  }
  if (bugs > 0) {
    shift(c, ['editor.background', 'editorGutter.background', 'minimap.background'], ERROR_RED, 0.045 * bugs);
    c['statusBar.background'] = mix(p.bgDeep, p.constant, 0.12 + 0.2 * bugs);
    c['statusBar.foreground'] = p.fg;
    c['statusBar.border'] = mixA(p.constant, p.bgDeep, 0.3);
    c['editorLineNumber.activeForeground'] = p.constant;
  }
  if (flow > 0) {
    shift(c, ACCENT_KEYS, '#ffffff', 0.15 * flow);
    c['editor.lineHighlightBackground'] = mix(p.lineHL, p.accent, 0.1 * flow);
    c['editor.lineHighlightBorder'] = p.accent + Math.round(0x40 * flow).toString(16).padStart(2, '0');
    if (!bugs) {
      c['statusBar.background'] = mix(p.bgDeep, p.accent, 0.12 * flow);
      c['statusBar.border'] = mix(p.border, p.accent, 0.6 * flow);
    }
  }
  return c;
}

module.exports = { moonInfo, goldenAmount, flowLevel, bugLevel, celebration, CHEER_EMOJI, decorate };
