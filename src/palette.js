'use strict';
/**
 * Skymood palette engine.
 * Four hand-tuned keyframe palettes are blended continuously across the day.
 */

const PHASES = ['night', 'dawn', 'day', 'dusk'];

const KEYFRAMES = {
  // Deep, warm, low-blue palette for late hours.
  night: {
    bg: '#17141f', bgAlt: '#13111a', bgDeep: '#0f0d15',
    fg: '#e6d9c8', muted: '#958899', accent: '#f0a35e',
    border: '#2a2433', selection: '#3a2f45', lineHL: '#201b29',
    keyword: '#e8939f', string: '#cdc98e', func: '#f2b880', type: '#d7a6e0',
    number: '#f59f7a', comment: '#7c7086', variable: '#e6d9c8', constant: '#ef8f6c',
    operator: '#c9ab92', tag: '#e8939f', property: '#dcc5aa', param: '#e9c7a2'
  },
  // Soft rose and teal as the sun comes up.
  dawn: {
    bg: '#1d1c2b', bgAlt: '#191827', bgDeep: '#141322',
    fg: '#ece4ec', muted: '#9c94aa', accent: '#ff9fb2',
    border: '#2d2b40', selection: '#3d3956', lineHL: '#252437',
    keyword: '#f49ac1', string: '#a8dcb5', func: '#ffc799', type: '#9fc4ff',
    number: '#ffb38a', comment: '#7f7996', variable: '#ece4ec', constant: '#ff9e9e',
    operator: '#c4b8d8', tag: '#f49ac1', property: '#e8c9d8', param: '#f6d2b8'
  },
  // Crisp, cool, high-clarity palette for focused daytime work.
  day: {
    bg: '#1b2130', bgAlt: '#171c29', bgDeep: '#121722',
    fg: '#e4ebf5', muted: '#8f9bb1', accent: '#5cc8ff',
    border: '#283146', selection: '#2f4566', lineHL: '#222a3b',
    keyword: '#c792ea', string: '#9ee493', func: '#82aaff', type: '#66e0d0',
    number: '#f9b26c', comment: '#717e9a', variable: '#e4ebf5', constant: '#ff8f8f',
    operator: '#89ddff', tag: '#ff7a93', property: '#b8d4ff', param: '#f2c38f'
  },
  // Sunset purples and oranges for the wind-down.
  dusk: {
    bg: '#1f1726', bgAlt: '#1a1321', bgDeep: '#150f1b',
    fg: '#f0e2ea', muted: '#a492a7', accent: '#ff8a5c',
    border: '#33253c', selection: '#4a3050', lineHL: '#281e30',
    keyword: '#ff7eb6', string: '#ffd479', func: '#ff9f6e', type: '#b49cff',
    number: '#ffb86b', comment: '#86728e', variable: '#f0e2ea', constant: '#ff6f91',
    operator: '#e0a8c8', tag: '#ff7eb6', property: '#f3c5d8', param: '#ffc9a0'
  }
};

// ---------- color helpers ----------
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
function alpha(hex, a) {
  return hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
}
/** Shift a color toward warm (less blue light). amount 0..1 */
function warm(hex, amount) {
  if (amount <= 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * 0.05 * amount, g * (1 - 0.04 * amount), b * (1 - 0.3 * amount)]);
}
function luminance(hex) {
  const c = hexToRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// ---------- timeline ----------
const smooth = t => t * t * (3 - 2 * t);
const wrap = m => ((m % 1440) + 1440) % 1440;

/**
 * Returns the blended palette state for a time of day.
 * @param {number} minute minutes since local midnight
 * @param {number} sunrise minutes since midnight
 * @param {number} sunset minutes since midnight
 */
function stateAt(minute, sunrise, sunset) {
  const anchors = [
    [sunrise - 90, 'night'],
    [sunrise + 30, 'dawn'],
    [sunrise + 150, 'day'],
    [sunset - 120, 'day'],
    [sunset, 'dusk'],
    [sunset + 90, 'night']
  ].map(([m, p]) => [wrap(m), p]).sort((a, b) => a[0] - b[0]);

  const t = wrap(minute);
  let i = anchors.length - 1;
  for (let k = 0; k < anchors.length; k++) if (anchors[k][0] <= t) i = k;
  const [m0, p0] = anchors[i];
  const [m1, p1] = anchors[(i + 1) % anchors.length];
  const span = wrap(m1 - m0) || 1;
  const f = smooth(Math.min(1, wrap(t - m0) / span));

  const weights = { night: 0, dawn: 0, day: 0, dusk: 0 };
  weights[p0] += 1 - f;
  weights[p1] += f;
  const dominant = PHASES.reduce((a, b) => (weights[b] > weights[a] ? b : a));
  return { weights, dominant, from: p0, to: p1, progress: f };
}

function blend(weights) {
  const out = {};
  for (const key of Object.keys(KEYFRAMES.day)) {
    const acc = [0, 0, 0];
    for (const p of PHASES) {
      const w = weights[p] || 0;
      if (!w) continue;
      hexToRgb(KEYFRAMES[p][key]).forEach((v, i) => (acc[i] += v * w));
    }
    out[key] = rgbToHex(acc);
  }
  return out;
}

/** Applies night warmth (blue-light reduction) proportional to how "night" it is. */
function withWarmth(p, amount) {
  if (amount <= 0) return p;
  const out = {};
  for (const k of Object.keys(p)) out[k] = warm(p[k], amount);
  return out;
}

// ---------- theme builders ----------
function workbenchColors(p) {
  return {
    'foreground': p.fg,
    'descriptionForeground': p.muted,
    'icon.foreground': p.muted,
    'focusBorder': alpha(p.accent, 0.55),
    'selection.background': alpha(p.selection, 0.9),
    'widget.shadow': '#00000059',
    'textLink.foreground': p.accent,
    'textLink.activeForeground': mix(p.accent, p.fg, 0.3),

    'editor.background': p.bg,
    'editor.foreground': p.fg,
    'editorLineNumber.foreground': alpha(p.muted, 0.55),
    'editorLineNumber.activeForeground': p.accent,
    'editor.lineHighlightBackground': p.lineHL,
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': alpha(p.selection, 0.95),
    'editor.inactiveSelectionBackground': alpha(p.selection, 0.5),
    'editor.selectionHighlightBackground': alpha(p.accent, 0.12),
    'editor.wordHighlightBackground': alpha(p.accent, 0.12),
    'editor.wordHighlightStrongBackground': alpha(p.accent, 0.2),
    'editor.findMatchBackground': alpha(p.accent, 0.35),
    'editor.findMatchHighlightBackground': alpha(p.accent, 0.18),
    'editor.rangeHighlightBackground': alpha(p.accent, 0.08),
    'editorCursor.foreground': p.accent,
    'editorWhitespace.foreground': alpha(p.muted, 0.25),
    'editorIndentGuide.background1': alpha(p.border, 0.9),
    'editorIndentGuide.activeBackground1': alpha(p.accent, 0.45),
    'editorRuler.foreground': p.border,
    'editorBracketMatch.background': alpha(p.accent, 0.15),
    'editorBracketMatch.border': alpha(p.accent, 0.6),
    'editorBracketHighlight.foreground1': p.func,
    'editorBracketHighlight.foreground2': p.keyword,
    'editorBracketHighlight.foreground3': p.type,
    'editorBracketHighlight.foreground4': p.number,
    'editorBracketHighlight.foreground5': p.string,
    'editorBracketHighlight.foreground6': p.tag,
    'editorGutter.background': p.bg,
    'editorGutter.addedBackground': p.string,
    'editorGutter.modifiedBackground': p.func,
    'editorGutter.deletedBackground': p.constant,
    'editorError.foreground': p.constant,
    'editorWarning.foreground': p.number,
    'editorInfo.foreground': p.func,
    'editorHint.foreground': p.type,
    'editorLink.activeForeground': p.accent,
    'editorCodeLens.foreground': alpha(p.muted, 0.8),
    'editorInlayHint.foreground': alpha(p.muted, 0.9),
    'editorInlayHint.background': alpha(p.selection, 0.35),
    'editorOverviewRuler.border': '#00000000',
    'editorStickyScroll.background': p.bg,
    'editorStickyScrollHover.background': p.lineHL,

    'editorWidget.background': p.bgAlt,
    'editorWidget.border': p.border,
    'editorSuggestWidget.background': p.bgAlt,
    'editorSuggestWidget.border': p.border,
    'editorSuggestWidget.selectedBackground': p.selection,
    'editorSuggestWidget.highlightForeground': p.accent,
    'editorSuggestWidget.focusHighlightForeground': p.accent,
    'editorHoverWidget.background': p.bgAlt,
    'editorHoverWidget.border': p.border,
    'peekView.border': p.accent,
    'peekViewEditor.background': p.bgAlt,
    'peekViewResult.background': p.bgDeep,
    'peekViewTitle.background': p.bgDeep,
    'peekViewEditor.matchHighlightBackground': alpha(p.accent, 0.3),
    'peekViewResult.matchHighlightBackground': alpha(p.accent, 0.3),
    'diffEditor.insertedTextBackground': alpha(p.string, 0.14),
    'diffEditor.removedTextBackground': alpha(p.constant, 0.14),

    'editorGroup.border': p.border,
    'editorGroupHeader.tabsBackground': p.bgDeep,
    'editorGroupHeader.tabsBorder': p.bgDeep,
    'tab.activeBackground': p.bg,
    'tab.activeForeground': p.fg,
    'tab.activeBorderTop': p.accent,
    'tab.activeBorder': p.bg,
    'tab.inactiveBackground': p.bgDeep,
    'tab.inactiveForeground': p.muted,
    'tab.hoverBackground': p.bgAlt,
    'tab.border': p.bgDeep,
    'tab.unfocusedActiveBorderTop': alpha(p.accent, 0.4),
    'breadcrumb.foreground': p.muted,
    'breadcrumb.focusForeground': p.fg,
    'breadcrumb.activeSelectionForeground': p.accent,
    'breadcrumbPicker.background': p.bgAlt,

    'activityBar.background': p.bgDeep,
    'activityBar.foreground': p.accent,
    'activityBar.inactiveForeground': p.muted,
    'activityBar.activeBorder': p.accent,
    'activityBar.border': p.bgDeep,
    'activityBarBadge.background': p.accent,
    'activityBarBadge.foreground': p.bgDeep,

    'sideBar.background': p.bgAlt,
    'sideBar.foreground': mix(p.fg, p.muted, 0.35),
    'sideBar.border': p.border,
    'sideBarTitle.foreground': p.fg,
    'sideBarSectionHeader.background': p.bgAlt,
    'sideBarSectionHeader.foreground': p.fg,
    'sideBarSectionHeader.border': p.border,

    'list.activeSelectionBackground': p.selection,
    'list.activeSelectionForeground': p.fg,
    'list.inactiveSelectionBackground': alpha(p.selection, 0.6),
    'list.hoverBackground': p.lineHL,
    'list.focusOutline': alpha(p.accent, 0.5),
    'list.highlightForeground': p.accent,
    'list.errorForeground': p.constant,
    'list.warningForeground': p.number,
    'tree.indentGuidesStroke': p.border,

    'statusBar.background': p.bgDeep,
    'statusBar.foreground': p.muted,
    'statusBar.border': p.border,
    'statusBar.noFolderBackground': p.bgDeep,
    'statusBar.debuggingBackground': p.constant,
    'statusBar.debuggingForeground': p.bgDeep,
    'statusBarItem.hoverBackground': p.lineHL,
    'statusBarItem.remoteBackground': p.accent,
    'statusBarItem.remoteForeground': p.bgDeep,
    'statusBarItem.prominentBackground': p.selection,

    'titleBar.activeBackground': p.bgDeep,
    'titleBar.activeForeground': p.fg,
    'titleBar.inactiveBackground': p.bgDeep,
    'titleBar.inactiveForeground': p.muted,
    'titleBar.border': p.border,
    'menu.background': p.bgAlt,
    'menu.foreground': p.fg,
    'menu.selectionBackground': p.selection,
    'menu.border': p.border,

    'panel.background': p.bgAlt,
    'panel.border': p.border,
    'panelTitle.activeForeground': p.fg,
    'panelTitle.activeBorder': p.accent,
    'panelTitle.inactiveForeground': p.muted,
    'terminal.background': p.bgAlt,
    'terminal.foreground': p.fg,
    'terminalCursor.foreground': p.accent,
    'terminal.selectionBackground': alpha(p.selection, 0.9),
    'terminal.ansiBlack': p.bgDeep,
    'terminal.ansiRed': p.constant,
    'terminal.ansiGreen': p.string,
    'terminal.ansiYellow': p.number,
    'terminal.ansiBlue': p.func,
    'terminal.ansiMagenta': p.keyword,
    'terminal.ansiCyan': p.type,
    'terminal.ansiWhite': p.fg,
    'terminal.ansiBrightBlack': p.muted,
    'terminal.ansiBrightRed': mix(p.constant, '#ffffff', 0.2),
    'terminal.ansiBrightGreen': mix(p.string, '#ffffff', 0.2),
    'terminal.ansiBrightYellow': mix(p.number, '#ffffff', 0.2),
    'terminal.ansiBrightBlue': mix(p.func, '#ffffff', 0.2),
    'terminal.ansiBrightMagenta': mix(p.keyword, '#ffffff', 0.2),
    'terminal.ansiBrightCyan': mix(p.type, '#ffffff', 0.2),
    'terminal.ansiBrightWhite': '#ffffff',

    'input.background': p.bgDeep,
    'input.foreground': p.fg,
    'input.border': p.border,
    'input.placeholderForeground': alpha(p.muted, 0.8),
    'inputOption.activeBorder': p.accent,
    'inputOption.activeBackground': alpha(p.accent, 0.2),
    'dropdown.background': p.bgDeep,
    'dropdown.border': p.border,
    'dropdown.foreground': p.fg,
    'checkbox.background': p.bgDeep,
    'checkbox.border': p.border,
    'quickInput.background': p.bgAlt,
    'quickInputList.focusBackground': p.selection,
    'pickerGroup.foreground': p.accent,
    'pickerGroup.border': p.border,

    'button.background': p.accent,
    'button.foreground': p.bgDeep,
    'button.hoverBackground': mix(p.accent, '#ffffff', 0.15),
    'button.secondaryBackground': p.selection,
    'button.secondaryForeground': p.fg,
    'badge.background': p.accent,
    'badge.foreground': p.bgDeep,
    'progressBar.background': p.accent,
    'scrollbar.shadow': '#00000040',
    'scrollbarSlider.background': alpha(p.muted, 0.18),
    'scrollbarSlider.hoverBackground': alpha(p.muted, 0.3),
    'scrollbarSlider.activeBackground': alpha(p.accent, 0.45),
    'minimap.background': p.bg,
    'minimapSlider.background': alpha(p.muted, 0.12),

    'notifications.background': p.bgAlt,
    'notifications.border': p.border,
    'notificationCenterHeader.background': p.bgDeep,
    'notificationLink.foreground': p.accent,

    'gitDecoration.modifiedResourceForeground': p.number,
    'gitDecoration.untrackedResourceForeground': p.string,
    'gitDecoration.addedResourceForeground': p.string,
    'gitDecoration.deletedResourceForeground': p.constant,
    'gitDecoration.ignoredResourceForeground': alpha(p.muted, 0.6),
    'gitDecoration.conflictingResourceForeground': p.keyword
  };
}

function tokenRules(p) {
  const r = (name, scope, foreground, fontStyle) => ({
    name, scope, settings: fontStyle ? { foreground, fontStyle } : { foreground }
  });
  return [
    r('Comment', ['comment', 'punctuation.definition.comment'], p.comment, 'italic'),
    r('String', ['string', 'string.quoted', 'string.template'], p.string),
    r('Escape', ['constant.character.escape', 'string.regexp'], p.operator),
    r('Keyword', ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'], p.keyword),
    r('Control flow', ['keyword.control.flow', 'keyword.control.import', 'keyword.control.export'], p.keyword, 'italic'),
    r('Operator', ['keyword.operator', 'punctuation.accessor', 'punctuation.separator.key-value'], p.operator),
    r('Function', ['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'variable.function'], p.func),
    r('Type', ['entity.name.type', 'entity.name.class', 'support.class', 'support.type', 'entity.other.inherited-class', 'storage.type.primitive'], p.type),
    r('Number', ['constant.numeric'], p.number),
    r('Constant', ['constant.language', 'constant.other', 'variable.other.constant', 'support.constant'], p.constant),
    r('Variable', ['variable', 'variable.other.readwrite', 'meta.definition.variable'], p.variable),
    r('Parameter', ['variable.parameter', 'meta.parameter'], p.param, 'italic'),
    r('Property', ['variable.other.property', 'variable.other.object.property', 'support.type.property-name', 'meta.object-literal.key'], p.property),
    r('this/self', ['variable.language', 'variable.language.this', 'variable.language.self'], p.tag, 'italic'),
    r('Tag', ['entity.name.tag', 'meta.tag.sgml'], p.tag),
    r('Attribute', ['entity.other.attribute-name'], p.number, 'italic'),
    r('Decorator', ['meta.decorator', 'entity.name.function.decorator', 'punctuation.decorator'], p.accent),
    r('Punctuation', ['punctuation', 'meta.brace'], mix(p.fg, p.muted, 0.55)),
    r('Markdown heading', ['markup.heading', 'entity.name.section'], p.accent, 'bold'),
    r('Markdown bold', ['markup.bold'], p.number, 'bold'),
    r('Markdown italic', ['markup.italic'], p.keyword, 'italic'),
    r('Markdown link', ['markup.underline.link', 'string.other.link'], p.func),
    r('Markdown code', ['markup.inline.raw', 'markup.fenced_code'], p.string),
    r('Inserted', ['markup.inserted'], p.string),
    r('Deleted', ['markup.deleted'], p.constant),
    r('Changed', ['markup.changed'], p.number),
    r('Invalid', ['invalid', 'invalid.illegal'], p.constant)
  ];
}

module.exports = {
  PHASES, KEYFRAMES, stateAt, blend, withWarmth, workbenchColors, tokenRules,
  mix, alpha, contrast
};
