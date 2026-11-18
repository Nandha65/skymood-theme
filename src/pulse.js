'use strict';
/**
 * Error pulse: when new errors show up, the editor takes a slow breath of soft red (fades in,
 * fades out, twice) and settles back. The steady bug-mood tint stays on top of that.
 *
 * Drawn the same way as the confetti (see confetti.js): one decoration's ::before pseudo-element,
 * attached to the first visible line, stretched over the whole text area and faded frame by
 * frame. Nothing is written to settings, so it starts instantly and never leaves color behind.
 */
const vscode = require('vscode');

const FRAME_MS = 80; // a slow fade doesn't need more frames than this
const BREATH_MS = 2800; // one fade in and out
const BREATHS = 2;
const RED = '255, 72, 72';
/** Peak opacity of the red wash per bug level (1–3 errors, 3–9, 10+). Mild on purpose. */
const PEAK = [0, 0.07, 0.09, 0.11];

let current; // { type, timer }

function reducedMotion() {
  return vscode.workspace.getConfiguration('workbench').get('reduceMotion') === 'on';
}

/**
 * Opacity of the wash at `t` ms, or null once it's over. Each breath is a smooth sin² curve,
 * so it eases in and out with no hard edge. Rounded so frames that look the same aren't redrawn.
 */
function pulseAt(t, level = 1) {
  const total = BREATH_MS * BREATHS;
  if (t < 0 || t >= total) return null;
  const peak = PEAK[Math.max(1, Math.min(3, level))];
  const s = Math.sin(Math.PI * (t % BREATH_MS) / BREATH_MS);
  return Math.round(peak * s * s * 200) / 200;
}

function stop() {
  if (!current) return;
  clearTimeout(current.timer);
  current.type.dispose();
  current = undefined;
}

const css = rules => 'none; ' + rules.join('; ') + ';';

/**
 * Pulses every visible text editor red.
 * @param {number} level bug level 1..3, for how strong the red gets
 * @returns {boolean} whether anything was shown
 */
function play(level = 1) {
  if (reducedMotion()) return false;
  if (!vscode.window.visibleTextEditors.some(e => e.visibleRanges.length)) return false;
  stop();

  const type = vscode.window.createTextEditorDecorationType({});
  const started = Date.now();
  current = { type, timer: undefined };
  const mine = current;
  let last;

  const frame = () => {
    if (current !== mine) return;
    const a = pulseAt(Date.now() - started, level);
    if (a === null) { stop(); return; }
    if (a !== last) {
      last = a;
      const before = {
        contentText: ' ',
        textDecoration: css([
          // Placed relative to the first visible line, so this covers it and everything below.
          // The editor clips the overflow, and the gutter stays clear.
          'position: absolute', 'left: 0', 'top: 0', 'width: 300vw', 'height: 200vh',
          `background: rgba(${RED}, ${a})`, 'font-size: 0', 'pointer-events: none', 'z-index: 10'
        ])
      };
      // Re-anchored every frame, so scrolling mid-pulse keeps the whole view covered.
      for (const editor of vscode.window.visibleTextEditors) {
        if (!editor.visibleRanges.length) continue;
        const top = editor.visibleRanges[0].start.line;
        editor.setDecorations(type, [{ range: new vscode.Range(top, 0, top, 0), renderOptions: { before } }]);
      }
    }
    mine.timer = setTimeout(frame, FRAME_MS);
  };
  frame();
  return true;
}

module.exports = { play, stop, pulseAt, BREATH_MS, BREATHS, PEAK };
