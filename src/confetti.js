'use strict';
/**
 * Celebrations drawn over the visible editors: a badge pops up in the middle with one emoji
 * and what happened, and confetti in the current Skymood palette bursts out of it and drifts
 * down across the editor.
 *
 * Extensions can't draw over the whole window, but they can draw inside the editor: every
 * piece is a decoration's ::before pseudo-element, positioned with CSS passed through
 * `textDecoration` and moved every frame. No settings are written, so it starts instantly
 * and never leaves colors behind.
 *
 * Where things go: an absolutely positioned decoration is placed relative to the *text of the
 * line it's attached to*, not the editor. On a short or empty line that box is almost zero
 * wide, so `left: 50%` lands at the editor's left edge (the badge used to slide under the
 * line numbers). Extensions can't read the editor's pixel width, so the centre is estimated
 * from the window width: (100vw - ~400px of sidebar and gutter) / editor columns / 2, and
 * never closer to the left edge than half the badge. Vertically everything is measured from
 * the first visible line (the top of the editor); the editor clips what falls outside it.
 */
const vscode = require('vscode');

const FRAME_MS = 33;
const BADGE_MS = 3200;
const BADGE_TOP = '22vh';
const CHROME_PX = 400; // activity bar + sidebar + line numbers, roughly, with the sidebar open
const GRAVITY = 700; // px/s²; with DRAG, paper rises ~170px, then drifts down at ~280 px/s
const DRAG = 2.5;

/** How much confetti each moment gets, in bursts of [pieces, delay ms]. */
const BURSTS = {
  small: [[32, 0]],
  medium: [[48, 0]],
  big: [[44, 0], [36, 350]],
  party: [[40, 0], [30, 300]],
  flow: [] // badge only: confetti while you're typing would be distracting
};
const SHAPES = [
  { w: 7, h: 11, r: '1px' }, // paper rectangle
  { w: 5, h: 15, r: '1px' }, // streamer
  { w: 8, h: 8, r: '50%' } // dot
];
const FALLBACK_COLORS = ['#ffd479', '#ff7eb6', '#5cc8ff', '#9ee493', '#c792ea', '#ff9f6e'];

let current; // { type, timer }

function reducedMotion() {
  return vscode.workspace.getConfiguration('workbench').get('reduceMotion') === 'on';
}

const rand = (a, b) => a + Math.random() * (b - a);

/** Confetti pieces for a moment, fanned upward out of the badge. */
function makePieces(kind, colors = FALLBACK_COLORS) {
  const pieces = [];
  for (const [count, delay] of BURSTS[kind] || BURSTS.party) {
    for (let i = 0; i < count; i++) {
      const angle = rand(-Math.PI * 0.93, -Math.PI * 0.07); // mostly up and out
      const speed = rand(260, 820);
      pieces.push({
        color: colors[i % colors.length],
        shape: SHAPES[i % SHAPES.length],
        delay: delay + rand(0, 90),
        life: rand(2600, 3500),
        vx: Math.cos(angle) * speed * 1.4, // a wider fan than tall
        vy: Math.sin(angle) * speed,
        spin: rand(-540, 540), // deg/s
        rot: rand(0, 360),
        flip: rand(5, 11), // paper flutter, rad/s
        sway: rand(6, 16),
        phase: rand(0, Math.PI * 2)
      });
    }
  }
  return pieces;
}

/** A piece's offset from the badge (px), rotation, flutter and opacity at `t` ms, or null. */
function pieceAt(p, t) {
  const s = (t - p.delay) / 1000;
  if (s < 0 || s * 1000 > p.life) return null;
  // Projectile with linear drag, y pointing down like CSS: it shoots up (vy < 0), slows,
  // then falls at the terminal speed GRAVITY / DRAG.
  const k = 1 - Math.exp(-DRAG * s);
  const terminal = GRAVITY / DRAG;
  const x = (p.vx / DRAG) * k + Math.sin(s * 3 + p.phase) * p.sway * Math.min(1, s);
  const y = terminal * s + ((p.vy - terminal) / DRAG) * k;
  const left = s * 1000 / p.life;
  return {
    x: Math.round(x),
    y: Math.round(y),
    rot: Math.round((p.rot + p.spin * s) / 5) * 5,
    flutter: Math.round(Math.cos(s * p.flip + p.phase) * 10) / 10,
    opacity: left > 0.65 ? Math.round(((1 - left) / 0.35) * 10) / 10 : 1
  };
}

/** The badge's scale and opacity at `t` ms: pops in with a little overshoot, holds, fades. */
function badgeAt(t) {
  if (t < 0 || t > BADGE_MS) return null;
  const pop = Math.min(1, t / 260);
  const scale = t < 260 ? 0.6 + 0.5 * pop : t < 380 ? 1.1 - 0.1 * ((t - 260) / 120) : 1;
  const fade = t > BADGE_MS - 500 ? (BADGE_MS - t) / 500 : 1;
  return { scale: Math.round(scale * 100) / 100, opacity: Math.round(Math.min(pop * 1.5, fade, 1) * 20) / 20 };
}

function stop() {
  if (!current) return;
  clearTimeout(current.timer);
  current.type.dispose();
  current = undefined;
}

const css = rules => 'none; ' + rules.join('; ') + ';';

/** True for a label that is only emoji (e.g. "🎉"), drawn big and without a pill. */
const emojiOnly = label => !/[\p{L}\p{N}]/u.test(label);

/** Roughly half the badge's width in px, so it never slides past the editor's left edge. */
function badgeHalfWidth(label) {
  if (emojiOnly(label)) return 48;
  return Math.ceil(([...label].length * 16 + 52) / 2);
}

/** CSS for the horizontal centre of an editor; see the header comment. */
function centreX(columns, minPx) {
  const n = Math.max(1, columns || 1);
  return `max(${minPx}px, calc((100vw - ${CHROME_PX}px) / ${n * 2}))`;
}

/**
 * Plays a celebration in every visible text editor.
 * @param {'small'|'medium'|'big'|'party'|'flow'} kind how much confetti
 * @param {{label?: string, color?: string, background?: string, colors?: string[], columns?: number}} [opts]
 *   badge text and colours, the confetti colours (from the current palette), and how many
 *   editor columns sit side by side
 * @returns {boolean} whether anything was shown
 */
function play(kind = 'party', opts = {}) {
  if (reducedMotion()) return false;
  const editors = vscode.window.visibleTextEditors.filter(e => e.visibleRanges.length);
  if (!editors.length) return false;
  stop();

  const type = vscode.window.createTextEditorDecorationType({});
  const pieces = makePieces(kind, opts.colors && opts.colors.length ? opts.colors : FALLBACK_COLORS);
  const anchors = editors.map(editor => {
    const top = editor.visibleRanges[0].start.line;
    return { editor, anchor: new vscode.Range(top, 0, top, 0) };
  });
  const end = Math.max(opts.label ? BADGE_MS : 0, ...pieces.map(p => p.delay + p.life));
  const centre = centreX(opts.columns, opts.label ? badgeHalfWidth(opts.label) + 8 : 160);
  const started = Date.now();
  current = { type, timer: undefined };
  const mine = current;

  const frame = () => {
    if (current !== mine) return;
    const t = Date.now() - started;
    const options = [];
    const b = opts.label ? badgeAt(t) : null;
    if (b && emojiOnly(opts.label)) {
      // A lone emoji (🎉) pops up big, with a little wiggle, and no pill around it.
      const wiggle = Math.round(Math.sin(t / 90) * 12 * Math.max(0, 1 - t / 900));
      options.push({
        contentText: opts.label,
        textDecoration: css([
          'position: absolute', `left: ${centre}`, `top: ${BADGE_TOP}`,
          `transform: translate(-50%, -50%) scale(${b.scale}) rotate(${wiggle}deg)`,
          'font-size: 72px', 'line-height: 1', 'filter: drop-shadow(0 6px 16px rgba(0,0,0,0.45))',
          `opacity: ${b.opacity}`, 'pointer-events: none', 'z-index: 11'
        ])
      });
    } else if (b) {
      options.push({
        contentText: opts.label,
        color: opts.color,
        backgroundColor: opts.background,
        textDecoration: css([
          'position: absolute', `left: ${centre}`, `top: ${BADGE_TOP}`, `transform: translate(-50%, -50%) scale(${b.scale})`,
          'font-size: 26px', 'font-weight: 600', 'line-height: 1', 'padding: 14px 24px', 'border-radius: 999px',
          `border: 2px solid ${opts.color || 'currentColor'}`, 'box-shadow: 0 8px 30px rgba(0,0,0,0.45)',
          'white-space: nowrap', `opacity: ${b.opacity}`, 'pointer-events: none', 'z-index: 11'
        ])
      });
    }
    for (const p of pieces) {
      const s = pieceAt(p, t);
      if (!s) continue;
      options.push({
        contentText: ' ',
        textDecoration: css([
          'position: absolute', `left: calc(${centre} + ${s.x}px)`, `top: calc(${BADGE_TOP} + ${s.y}px)`,
          `width: ${p.shape.w}px`, `height: ${p.shape.h}px`, `border-radius: ${p.shape.r}`, `background: ${p.color}`,
          `transform: rotate(${s.rot}deg) scaleY(${s.flutter})`, `opacity: ${s.opacity}`,
          'font-size: 0', 'pointer-events: none', 'z-index: 12'
        ])
      });
    }
    for (const { editor, anchor } of anchors) {
      editor.setDecorations(type, options.map(before => ({ range: anchor, renderOptions: { before } })));
    }
    if (t < end) mine.timer = setTimeout(frame, FRAME_MS);
    else stop();
  };
  frame();
  return true;
}

module.exports = { play, stop, BURSTS, makePieces, pieceAt, badgeAt, centreX, badgeHalfWidth };
