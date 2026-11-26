'use strict';
const vscode = require('vscode');
const P = require('./src/palette');
const FX = require('./src/effects');
const Confetti = require('./src/confetti');
const Pulse = require('./src/pulse');
const { sunTimes, parseClock, formatClock } = require('./src/solar');
const CE = require('./src/colorEngine');
const Sync = require('./src/syncAndShare');

/** The two adaptive themes. Each gets its own colors in settings, scoped to its name. */
const THEMES = { dark: 'Skymood Adaptive', light: 'Skymood Adaptive Light' };
const keyFor = variant => `[${THEMES[variant]}]`;
const LABELS = { night: 'Night', dawn: 'Dawn', day: 'Day', dusk: 'Dusk' };
const ICONS = { night: '$(star-empty)', dawn: '$(sparkle)', day: '$(lightbulb)', dusk: '$(flame)' };
const IDLE_MS = 90 * 1000;
const DIAG_DEBOUNCE_MS = 700; // diagnostics arrive in bursts; settle before counting
const CHEER_CONFIRM_MS = 800; // errors must stay at zero this long before celebrating
const CHEER_EDIT_WINDOW_MS = 60 * 1000; // and you must have edited recently
const CHEER_MIN_ERROR_AGE_MS = 3000; // errors that blink while you type a line don't count
const PULSE_SETTLE_MS = 3000; // new errors must last this long before the editor pulses red
const PULSE_EDIT_WINDOW_MS = 15 * 1000; // and come from your typing, not from opening a file
const PULSE_COOLDOWN_MS = 30 * 1000; // at most one pulse this often
const WATCHED_SETTINGS = [
  'skymood', 'workbench.colorTheme', 'workbench.preferredDarkColorTheme',
  'workbench.preferredLightColorTheme', 'window.autoDetectColorScheme'
];

let loopHandle;
let flowHandle;
let diagHandle;
let cheerHandle;
let pulseHandle;
let statusItem;
let previewing = false;
let celebrating = false;
let writeChain = Promise.resolve();
let extContext; // the extension context, for globalState (stats, one-time flags)
let flowTicks = 0; // 15s flow ticks since activation, to persist flow time in steps
const overwrites = new Sync.OverwriteDetector();
let lastOwnWrite = 0; // when this window last wrote colors, to tell its own changes from others'
let lastWritten = null; // the scoped colors this window last wrote, per theme key

// Live playful state
const live = {
  flowStart: 0, lastEdit: 0, flowLevel: 0,
  errors: 0, errorFiles: new Set(), bugLevel: 0, errorsSince: 0,
  pulsedErrors: 0, lastPulse: 0 // error count the last pulse covered, and when it played
};

const cfg = () => vscode.workspace.getConfiguration('skymood');
const fun = key => cfg().get('playful.enabled', true) && cfg().get(`playful.${key}`, true);
const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const followsOsScheme = () => vscode.workspace.getConfiguration('window').get('autoDetectColorScheme', false);

/**
 * Which adaptive theme is on screen: 'dark', 'light', or null for neither. With
 * window.autoDetectColorScheme on, VS Code shows workbench.preferredDark/LightColorTheme and
 * ignores workbench.colorTheme.
 */
function activeVariant() {
  const kind = vscode.window.activeColorTheme.kind;
  const variant = kind === vscode.ColorThemeKind.Dark ? 'dark' : kind === vscode.ColorThemeKind.Light ? 'light' : null;
  if (!variant) return null; // high contrast is never Skymood
  const name = THEMES[variant];
  const wb = vscode.workspace.getConfiguration('workbench');
  if (followsOsScheme()) {
    return wb.get('preferredDarkColorTheme') === name || wb.get('preferredLightColorTheme') === name ? variant : null;
  }
  return wb.get('colorTheme') === name ? variant : null;
}
const themeActive = () => activeVariant() !== null;

/**
 * The colors live in user settings, which every window shares, but flow and error state are
 * per window. Only the window you're working in writes, so windows don't repaint each other.
 */
const canWrite = () => vscode.window.state.focused && themeActive();

const MODES = ['dark', 'light', 'system'];
const MODE_LABELS = { dark: 'Dark', light: 'Light', system: 'System default' };
let applying = false; // true while Skymood itself is switching themes, so it doesn't sync mid-way

/**
 * The mode chosen in skymood.appearance: 'dark', 'light' or 'system' (follow the OS). Left
 * unset, it's dark, unless VS Code already follows the OS appearance, then it's system, so
 * turning Skymood on doesn't undo that.
 */
function appearance() {
  const i = cfg().inspect('appearance') || {};
  const set = i.workspaceFolderValue ?? i.workspaceValue ?? i.globalValue;
  if (MODES.includes(set)) return set;
  return followsOsScheme() ? 'system' : 'dark';
}

/** The theme variant to use when Skymood isn't on screen yet (system: whatever the OS shows). */
function preferredVariant() {
  const mode = appearance();
  if (mode !== 'system') return mode;
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark';
}

/** True when Skymood is the selected theme, even if the OS is showing the other one right now. */
function skymoodSelected() {
  const wb = vscode.workspace.getConfiguration('workbench');
  const names = Object.values(THEMES);
  if (followsOsScheme()) return names.includes(wb.get('preferredDarkColorTheme')) || names.includes(wb.get('preferredLightColorTheme'));
  return names.includes(wb.get('colorTheme'));
}

/**
 * Makes Skymood the active theme in the mode from skymood.appearance.
 *  - dark / light: sets that theme, and turns off window.autoDetectColorScheme if it was on,
 *    since the OS would otherwise keep choosing.
 *  - system: Skymood Adaptive for dark, Skymood Adaptive Light for light, and turns on
 *    window.autoDetectColorScheme so VS Code follows the OS.
 * The theme is written before the OS switch flips, so the screen goes straight to the right one.
 */
async function selectTheme() {
  const wb = vscode.workspace.getConfiguration('workbench');
  const win = vscode.workspace.getConfiguration('window');
  const G = vscode.ConfigurationTarget.Global;
  const mode = appearance();
  applying = true;
  try {
    if (mode === 'system') {
      await wb.update('preferredDarkColorTheme', THEMES.dark, G);
      await wb.update('preferredLightColorTheme', THEMES.light, G);
      if (!followsOsScheme()) await win.update('autoDetectColorScheme', true, G);
    } else {
      await wb.update('colorTheme', THEMES[mode], G);
      if (followsOsScheme()) await win.update('autoDetectColorScheme', false, G);
    }
    await sleep(400); // let the theme change land before syncing again
  } finally {
    applying = false;
  }
}

/** skymood.appearance changed: switch modes, if Skymood is the theme in use. */
async function applyAppearance() {
  if (applying || !skymoodSelected()) return;
  await selectTheme();
  await render();
}

/**
 * Keeps skymood.appearance saying what's on screen when the theme is changed outside Skymood:
 * picking the other Skymood theme in VS Code's theme picker, or switching
 * window.autoDetectColorScheme on or off by hand.
 */
function syncAppearance() {
  if (applying) return;
  const variant = activeVariant();
  if (!variant) return;
  const mode = followsOsScheme() ? 'system' : variant;
  if (mode !== appearance()) cfg().update('appearance', mode, vscode.ConfigurationTarget.Global);
}

/** Menu: pick dark, light or system default. Turns Skymood on if another theme is showing. */
async function pickAppearance() {
  const current = appearance();
  const items = [
    { label: '$(color-mode) Dark', description: 'Skymood Adaptive', value: 'dark' },
    { label: '$(sun) Light', description: 'Skymood Adaptive Light', value: 'light' },
    { label: '$(device-desktop) System default', description: 'Dark or light, following your OS', value: 'system' }
  ].map(i => ({ ...i, detail: i.value === current ? 'Current' : undefined }));
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Skymood: appearance' });
  if (choice) await setAppearance(choice.value);
}

/** Switches to dark, light or system, and turns Skymood on if another theme is showing. */
async function setAppearance(value) {
  const current = appearance();
  const wasSelected = skymoodSelected();
  if (value !== current) {
    applying = true; // switch once, below, rather than also from the settings listener
    try {
      await cfg().update('appearance', value, vscode.ConfigurationTarget.Global);
    } finally {
      applying = false;
    }
  }
  if (value !== current || !wasSelected) await enable();
}

/** Sunrise/sunset for today, from location (solar mode) or fixed clock times. */
function getSunTimes() {
  const c = cfg();
  const fallback = { sunrise: parseClock(c.get('sunrise'), 390), sunset: parseClock(c.get('sunset'), 1110), source: 'clock' };
  const lat = c.get('latitude');
  const lon = c.get('longitude');
  if (c.get('mode') === 'solar' && typeof lat === 'number' && typeof lon === 'number') {
    const t = sunTimes(new Date(), lat, lon);
    if (t) return { ...t, source: 'solar' };
  }
  return fallback;
}

/** Full visual state for a minute of the day: phase blend, atmosphere, playful effects, readability clamp. */
function computeState(minute, { forPreview = false, variant = activeVariant() || preferredVariant() } = {}) {
  const c = cfg();
  const sun = getSunTimes();
  const pinned = forPreview ? 'auto' : c.get('pinnedPhase', 'auto');
  const atmosphere = CE.ATMOSPHERES[c.get('atmosphere')] ? c.get('atmosphere') : 'clear';
  const warmth = Math.max(0, Math.min(1, c.get('nightWarmth', 0.4)));

  const moon = FX.moonInfo();
  const night = CE.phaseState(minute, sun.sunrise, sun.sunset, pinned, atmosphere).weights.night || 0; // scales the moonlight accent
  const fx = {
    golden: pinned === 'auto' && fun('goldenHour') ? FX.goldenAmount(minute, sun.sunrise, sun.sunset) : 0,
    moonGlow: fun('moonPhase') && moon.illumination > 0.97 ? night : 0,
    flow: forPreview ? 0 : fun('flowGlow') ? live.flowLevel : 0,
    bugs: forPreview ? 0 : fun('bugMood') ? live.bugLevel : 0
  };
  const out = CE.compose({ minute, sunrise: sun.sunrise, sunset: sun.sunset, variant, atmosphere, warmth, pinned, fx });
  return { state: out.state, palette: out.palette, colors: out.colors, tokens: out.tokens, sun, pinned, moon, fx, variant, atmosphere };
}

/**
 * Writes colors into user settings, scoped to one adaptive theme (dark or light) only.
 * Compares against what settings hold now, not what this window last wrote: another window or
 * Settings Sync may have changed them since, and a write that changes nothing is skipped.
 */
function applyColors(info, variant) {
  const KEY = keyFor(variant);
  const colors = info.colors;
  const tokens = { textMateRules: info.tokens };

  writeChain = writeChain.then(async () => {
    const wb = vscode.workspace.getConfiguration('workbench');
    const ed = vscode.workspace.getConfiguration('editor');
    const colorCustom = { ...(wb.inspect('colorCustomizations')?.globalValue || {}) };
    const tokenCustom = { ...(ed.inspect('tokenColorCustomizations')?.globalValue || {}) };
    lastWritten = { ...(lastWritten || {}), [KEY]: colors };
    if (!sameJson(colorCustom[KEY], colors)) {
      colorCustom[KEY] = colors;
      lastOwnWrite = Date.now();
      await wb.update('colorCustomizations', colorCustom, vscode.ConfigurationTarget.Global);
    }
    if (!sameJson(tokenCustom[KEY], tokens)) {
      tokenCustom[KEY] = tokens;
      lastOwnWrite = Date.now();
      await ed.update('tokenColorCustomizations', tokenCustom, vscode.ConfigurationTarget.Global);
    }
    lastOwnWrite = Date.now();
  }).catch(err => console.error('[Skymood] failed to apply colors', err));
  return writeChain;
}

/**
 * Called when color settings change. A change this window didn't just make, to the colors this
 * window last wrote, is another window or machine repainting. Repeated, that's the Settings Sync
 * ping-pong, and the one-time tip points at skymood.configureSync.
 */
function checkForeignOverwrite() {
  // Only while focused: then this window is the one that writes, so a change it didn't make is foreign.
  if (!lastWritten || !vscode.window.state.focused || Date.now() - lastOwnWrite < 3000 || !themeActive()) return;
  const KEY = keyFor(activeVariant());
  const now = vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.globalValue?.[KEY];
  if (!lastWritten[KEY] || sameJson(now, lastWritten[KEY])) return;
  if (overwrites.record()) Sync.offerSyncTip(vscode, extContext);
}

function flowMinutes() {
  const now = Date.now();
  if (!live.lastEdit || now - live.lastEdit > IDLE_MS) return 0;
  return (now - live.flowStart) / 60000;
}

function updateStatus(info, labelOverride) {
  if (!statusItem) return;
  if (!cfg().get('showStatusBar', true)) { statusItem.hide(); return; }
  statusItem.show();
  const { state, sun, pinned, moon, fx } = info;
  const d = state.dominant;
  const pin = pinned !== 'auto' ? ' $(pinned)' : '';
  let text;
  if (labelOverride) text = labelOverride;
  else if (fx.flow > 0) text = `$(flame) Flow ${Math.floor(flowMinutes())}m`;
  else if (fx.golden > 0.35) text = '$(sparkle) Golden hour';
  else if (d === 'night' && fun('moonPhase')) text = `${moon.emoji} ${LABELS[d]}${pin}`;
  else text = `${ICONS[d]} ${LABELS[d]}${pin}`;
  statusItem.text = text;

  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(`**Skymood** · ${LABELS[d]} (${Math.round(Math.max(...Object.values(state.weights)) * 100)}%)\n\n`);
  if (pinned !== 'auto') md.appendMarkdown(`Pinned to **${LABELS[pinned]}**\n\n`);
  else if (state.from !== state.to) md.appendMarkdown(`Shifting ${LABELS[state.from]} → ${LABELS[state.to]} (${Math.round(state.progress * 100)}%)\n\n`);
  md.appendMarkdown(`🌤️ Atmosphere: **${CE.ATMOSPHERES[info.atmosphere].label}** · [change](command:skymood.selectAtmosphere)\n\n`);
  const place = cfg().get('cityName', '');
  md.appendMarkdown(`☀️ Sunrise ${formatClock(sun.sunrise)} · Sunset ${formatClock(sun.sunset)} _(${sun.source === 'solar' ? (place || 'your location') : 'fixed times'})_\n\n`);
  if (fun('moonPhase')) md.appendMarkdown(`${moon.emoji} ${moon.name}, ${Math.round(moon.illumination * 100)}% lit${fx.moonGlow ? ' (moonlight accent on)' : ''}\n\n`);
  if (fun('flowGlow')) md.appendMarkdown(`🔥 Flow: ${fx.flow ? `level ${fx.flow}/3, ${Math.floor(flowMinutes())} min` : 'warming up (5 min of steady typing)'}\n\n`);
  if (fun('bugMood')) md.appendMarkdown(`🐞 Errors in open files: ${live.errors}${live.errors ? '' : ' (clean!)'}\n\n`);
  if (!themeActive()) md.appendMarkdown(`_Skymood Adaptive is not your active theme._ [Turn it on](command:skymood.enable)\n\n`);
  md.appendMarkdown(`[Preview 24h](command:skymood.previewCycle) · [Menu](command:skymood.menu)`);
  statusItem.tooltip = md;
}

async function render() {
  if (previewing || celebrating) return;
  const info = computeState(nowMinutes());
  updateStatus(info);
  if (canWrite()) await applyColors(info, info.variant);
  return info;
}

/** Main loop: refreshes faster during golden hour so the shimmer is smooth. */
function scheduleLoop() {
  if (loopHandle) clearTimeout(loopHandle);
  const info = computeState(nowMinutes());
  const base = Math.max(1, Math.min(60, cfg().get('updateIntervalMinutes', 5)));
  const minutes = info.fx.golden > 0 ? 1 : base;
  loopHandle = setTimeout(async () => { await render(); scheduleLoop(); }, minutes * 60 * 1000);
}

// ---------------- playful trackers ----------------

function onEdit(e) {
  if (!e.contentChanges.length) return;
  const scheme = e.document.uri.scheme;
  if (scheme !== 'file' && scheme !== 'untitled') return;
  const now = Date.now();
  if (!live.lastEdit || now - live.lastEdit > IDLE_MS) live.flowStart = now;
  live.lastEdit = now;
}

function checkFlow() {
  const minutes = flowMinutes();
  // Only durations are kept (never what you type): time in flow and your longest streak.
  if (extContext && minutes >= 5 && vscode.window.state.focused) {
    Sync.addFlow(extContext, 15, minutes).then(() => Sync.checkMilestone(vscode, extContext));
  }
  const level = FX.flowLevel(minutes);
  if (level !== live.flowLevel) {
    // Reaching a new flow milestone (5, 15, 30 min) gets a 🔥 badge (no confetti mid-typing).
    if (level > live.flowLevel && fun('flowGlow') && fun('confetti') && vscode.window.state.focused) {
      Confetti.play('flow', badgeFor(computeState(nowMinutes()).palette, `🔥  ${[0, 5, 15, 30][level]} minutes in the flow`, 'accent'));
    }
    live.flowLevel = level;
    render();
  } else if (level > 0 && statusItem && !previewing && !celebrating) {
    updateStatus(computeState(nowMinutes())); // keep the minute counter fresh
  }
}

/** URIs of the files open in editor tabs (the modified side, for diffs). */
function openTabUris() {
  const uris = new Set();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) uris.add(tab.input.uri.toString());
      else if (tab.input instanceof vscode.TabInputTextDiff) uris.add(tab.input.modified.toString());
    }
  }
  return uris;
}

/**
 * Errors in files open in editor tabs. Counting the whole workspace would leave a repo with a
 * backlog of existing errors tinted red all the time.
 */
function scanErrors() {
  const open = openTabUris();
  const files = new Set();
  let count = 0;
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const key = uri.toString();
    if (!open.has(key)) continue;
    const n = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
    if (n) { count += n; files.add(key); }
  }
  return { count, files, open };
}

function onDiagnostics() {
  if (diagHandle) clearTimeout(diagHandle);
  diagHandle = setTimeout(() => {
    const prev = live.errors;
    const prevFiles = live.errorFiles;
    const { count, files, open } = scanErrors();
    live.errors = count;
    live.errorFiles = files;
    if (prev === 0 && count > 0) live.errorsSince = Date.now();
    if (count > 0) clearTimeout(cheerHandle);
    const level = FX.bugLevel(count);
    if (level !== live.bugLevel) {
      live.bugLevel = level;
      render();
    }
    if (prev > 0 && count === 0 && fun('celebrate')) maybeCelebrate(prev, prevFiles, open);
    trackPulse(count);
  }, DIAG_DEBOUNCE_MS);
}

/**
 * New errors make the editor breathe soft red, once they've stuck around a few seconds (so a
 * half-typed line doesn't set it off). Fixing some and breaking more pulses again, at most every
 * PULSE_COOLDOWN_MS. The steady bug-mood tint is separate and stays while errors remain.
 */
function trackPulse(count) {
  if (count === 0) {
    live.pulsedErrors = 0;
    clearTimeout(pulseHandle);
    Pulse.stop();
    return;
  }
  if (count <= live.pulsedErrors) {
    live.pulsedErrors = count;
    return;
  }
  clearTimeout(pulseHandle);
  pulseHandle = setTimeout(() => {
    const now = Date.now();
    const n = scanErrors().count;
    if (n <= live.pulsedErrors) return;
    live.pulsedErrors = n;
    if (!fun('errorPulse') || previewing || celebrating || !vscode.window.state.focused) return;
    if (now - live.lastEdit > PULSE_EDIT_WINDOW_MS || now - live.lastPulse < PULSE_COOLDOWN_MS) return;
    if (Pulse.play(FX.bugLevel(n))) live.lastPulse = now;
  }, PULSE_SETTLE_MS);
}

/**
 * Celebrates only a real fix. The count also drops to zero when you close the files that had
 * errors, or when a language server restarts and briefly clears its diagnostics.
 */
function maybeCelebrate(fixed, prevFiles, open) {
  const now = Date.now();
  const fileStillOpen = [...prevFiles].some(uri => open.has(uri));
  const editedRecently = now - live.lastEdit < CHEER_EDIT_WINDOW_MS;
  const hadErrorsAWhile = now - live.errorsSince > CHEER_MIN_ERROR_AGE_MS;
  if (!fileStillOpen || !editedRecently || !hadErrorsAWhile) return;
  clearTimeout(cheerHandle);
  cheerHandle = setTimeout(() => {
    if (scanErrors().count === 0) celebrate(FX.celebration(fixed));
  }, CHEER_CONFIRM_MS);
}

const PARTY = { kind: 'party', label: '🎉', text: '🎉' }; // the popper says it all

/**
 * Badge and confetti colours from the current palette, so a celebration at night is warm amber
 * and rose, and one at noon is crisp blue and green.
 */
const badgeFor = (palette, label, tint = 'string') => ({
  label,
  color: palette[tint],
  background: palette.bgAlt,
  colors: ['accent', 'string', 'keyword', 'func', 'number', 'type', 'tag'].map(k => palette[k]),
  columns: vscode.window.tabGroups.all.length // editors side by side, to find the centre of each
});

/**
 * A badge with one emoji pops up over the editors saying what happened, confetti bursts out
 * of it, and the status bar item cheers. Nothing is written to settings, so it starts instantly and ends cleanly.
 * @param {{kind: string, label: string, text: string}} [moment] from FX.celebration(), or a party when run by hand
 */
async function celebrate(moment) {
  if (celebrating || previewing) return;
  const real = Boolean(moment && moment.kind); // a fix, not the command
  const { kind, label, text } = real ? moment : PARTY; // the command passes no args
  celebrating = true;
  if (real && extContext) Sync.addVictory(extContext).then(() => Sync.checkMilestone(vscode, extContext));
  try {
    const info = computeState(nowMinutes());
    updateStatus(info, text);
    if (statusItem) statusItem.color = info.palette.string;
    if (fun('confetti')) Confetti.play(kind, badgeFor(info.palette, label));
    await sleep(3200);
  } finally {
    celebrating = false;
    if (statusItem) statusItem.color = undefined;
    await render();
  }
}

// ---------------- commands ----------------

async function enable() {
  await selectTheme();
  await render();
}

async function previewCycle() {
  if (previewing) return;
  previewing = true;
  try {
    if (!themeActive()) await selectTheme();
    // The theme switch can land a moment after the setting, so pick the variant now and keep it.
    const variant = activeVariant() || preferredVariant();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Skymood: previewing a full day', cancellable: true },
      async (progress, token) => {
        const frames = 48;
        for (let i = 0; i <= frames && !token.isCancellationRequested; i++) {
          const minute = (i / frames) * 1440;
          const info = computeState(minute, { forPreview: true, variant });
          const tag = info.fx.golden > 0.35 ? ' ✨ golden hour' : '';
          progress.report({ message: `${formatClock(minute)} · ${LABELS[info.state.dominant]}${tag}`, increment: 100 / frames });
          updateStatus(info, `$(play) ${formatClock(minute)}`);
          await applyColors(info, variant);
          await sleep(140);
        }
      }
    );
  } finally {
    previewing = false;
    await render();
  }
}

async function pickPhase() {
  const current = cfg().get('pinnedPhase', 'auto');
  const items = [
    { label: '$(sync) Follow the sun', description: 'Blend continuously through the day', value: 'auto' },
    ...P.PHASES.map(p => ({ label: `${ICONS[p]} ${LABELS[p]}`, description: 'Pin this palette', value: p }))
  ].map(i => ({ ...i, detail: i.value === current ? 'Current' : undefined }));
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Skymood: choose a phase' });
  if (choice) await cfg().update('pinnedPhase', choice.value, vscode.ConfigurationTarget.Global);
}

/** Cities from data/cities.json, loaded once and only when the picker opens. */
let cityList;
const cities = () => cityList || (cityList = [...require('./data/cities.json')].sort((a, b) => a.name.localeCompare(b.name)));

const parseCoords = v => {
  const m = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/.exec(v);
  return m ? [+m[1], +m[3]] : null;
};

async function askCoordinates() {
  const c = cfg();
  const existing = typeof c.get('latitude') === 'number' ? `${c.get('latitude')}, ${c.get('longitude')}` : '';
  const value = await vscode.window.showInputBox({
    title: 'Skymood: your approximate location',
    prompt: 'Latitude, longitude (e.g. 12.97, 77.59 for Bengaluru). Used offline only, to compute sunrise and sunset.',
    value: existing,
    validateInput: v => {
      const xy = parseCoords(v);
      if (!xy) return 'Enter as: latitude, longitude';
      if (Math.abs(xy[0]) > 90 || Math.abs(xy[1]) > 180) return 'Latitude must be within ±90 and longitude within ±180';
      return null;
    }
  });
  if (!value) return null;
  return parseCoords(value).map(n => Math.round(n * 100) / 100);
}

/** Pick a city (offline list) or type coordinates; switches to solar mode and repaints right away. */
async function setLocation() {
  const custom = { label: '$(edit) Enter custom coordinates (latitude, longitude)...', alwaysShow: true, custom: true };
  const items = [
    custom,
    { label: 'Major cities', kind: vscode.QuickPickItemKind.Separator },
    ...cities().map(city => ({
      label: city.name,
      description: `${city.country} · (${city.lat}, ${city.lon})`,
      city
    }))
  ];
  const choice = await vscode.window.showQuickPick(items, {
    title: 'Skymood: set location',
    placeHolder: 'Pick your city, or enter coordinates. Used offline only, for sunrise and sunset.',
    matchOnDescription: true
  });
  if (!choice) return;
  let lat, lon, name = '';
  if (choice.custom) {
    const xy = await askCoordinates();
    if (!xy) return;
    [lat, lon] = xy;
  } else {
    ({ lat, lon, name } = choice.city);
  }
  const c = cfg();
  const G = vscode.ConfigurationTarget.Global;
  await c.update('latitude', lat, G);
  await c.update('longitude', lon, G);
  await c.update('cityName', name, G);
  await c.update('mode', 'solar', G);
  await render();
  scheduleLoop();
  const sun = getSunTimes();
  vscode.window.showInformationMessage(`Skymood: following the sun${name ? ` in ${name}` : ''}. Today: sunrise ${formatClock(sun.sunrise)}, sunset ${formatClock(sun.sunset)}.`);
}

async function selectAtmosphere() {
  const current = cfg().get('atmosphere', 'clear');
  const items = CE.ATMOSPHERE_NAMES.map(name => ({
    label: `${name === current ? '$(check) ' : ''}${CE.ATMOSPHERES[name].label}`,
    description: CE.ATMOSPHERES[name].description,
    value: name
  }));
  const choice = await vscode.window.showQuickPick(items, { title: 'Skymood: atmosphere', placeHolder: 'Pick a mood to layer over the sky' });
  if (choice) await cfg().update('atmosphere', choice.value, vscode.ConfigurationTarget.Global);
}

function cardInfo() {
  const info = computeState(nowMinutes());
  const s = Sync.stats(extContext);
  return {
    phase: info.state.dominant, pinned: info.pinned !== 'auto', source: info.sun.source,
    cityName: cfg().get('cityName', ''), atmosphere: info.atmosphere, variant: info.variant, moon: info.moon,
    longestFlowMinutes: Math.max(s.longestFlowMinutes, flowMinutes()), palette: info.palette
  };
}

async function togglePlayful() {
  const on = !cfg().get('playful.enabled', true);
  await cfg().update('playful.enabled', on, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Skymood: playful effects ${on ? 'on ✨' : 'off'}.`);
}

async function removeOverrides() {
  const wb = vscode.workspace.getConfiguration('workbench');
  const ed = vscode.workspace.getConfiguration('editor');
  const cc = { ...(wb.inspect('colorCustomizations')?.globalValue || {}) };
  const tc = { ...(ed.inspect('tokenColorCustomizations')?.globalValue || {}) };
  for (const variant of Object.keys(THEMES)) {
    delete cc[keyFor(variant)];
    delete tc[keyFor(variant)];
  }
  await wb.update('colorCustomizations', Object.keys(cc).length ? cc : undefined, vscode.ConfigurationTarget.Global);
  await ed.update('tokenColorCustomizations', Object.keys(tc).length ? tc : undefined, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage('Skymood: adaptive color overrides removed from your settings.');
}

/** Status bar menu: live status in the placeholder, one-click actions in groups. */
async function menu() {
  const info = computeState(nowMinutes());
  const playful = cfg().get('playful.enabled', true);
  const mode = appearance();
  const sep = label => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const cmd = (label, command, extra = {}) => ({ label, run: () => vscode.commands.executeCommand(command, ...(extra.args || [])), ...extra });
  const mark = on => (on ? '$(check) ' : '');

  const status = [LABELS[info.state.dominant], CE.ATMOSPHERES[info.atmosphere].label, `${info.moon.emoji} ${info.moon.name}`];
  if (info.fx.flow > 0) status.push(`🔥 ${Math.floor(flowMinutes())}m`);

  const items = [
    sep('Appearance'),
    ...MODES.map(m => ({
      label: `$(color-mode) ${mark(mode === m)}Appearance: ${MODE_LABELS[m].replace(' default', '')}`,
      run: () => setAppearance(m)
    })),
    sep('Atmosphere'),
    ...CE.ATMOSPHERE_NAMES.map(a => ({
      label: `$(cloud) ${mark(info.atmosphere === a)}Atmosphere: ${CE.ATMOSPHERES[a].label}`,
      run: () => cfg().update('atmosphere', a, vscode.ConfigurationTarget.Global)
    })),
    sep('Time & place'),
    cmd('$(pin) Pin Phase / Follow the Sun', 'skymood.pickPhase',
      { description: info.pinned !== 'auto' ? `Pinned to ${LABELS[info.pinned]}` : 'Following the sun' }),
    cmd('$(location) Set Location (City or Coordinates)', 'skymood.setLocation',
      { description: cfg().get('cityName', '') || undefined }),
    cmd('$(play) Preview a Full Day (7s)', 'skymood.previewCycle'),
    sep('Playful'),
    cmd(`$(sparkle) Toggle Playful Effects`, 'skymood.togglePlayful', { description: playful ? 'On' : 'Off' }),
    cmd('$(flame) Celebrate!', 'skymood.celebrate'),
    sep('Share & sync'),
    cmd('$(clippy) Copy Setup Card (Share Your Sky)', 'skymood.copySetupCard'),
    cmd('$(sync) Configure Settings Sync for Multi-Machine', 'skymood.configureSync'),
    sep('More'),
    cmd('$(paintcan) Switch to Skymood Adaptive', 'skymood.enable'),
    cmd('$(gear) Settings', 'workbench.action.openSettings', { args: ['skymood'] }),
    cmd('$(trash) Remove adaptive overrides', 'skymood.removeOverrides')
  ];
  const choice = await vscode.window.showQuickPick(items, { title: 'Skymood', placeHolder: status.join(' · ') });
  if (choice && choice.run) await choice.run();
}

/** Removes color overrides left behind by the pre-release name ("Circadia"). */
async function cleanupLegacy() {
  const legacy = '[' + 'Circadia Adaptive]';
  const wb = vscode.workspace.getConfiguration('workbench');
  const ed = vscode.workspace.getConfiguration('editor');
  const cc = { ...(wb.inspect('colorCustomizations')?.globalValue || {}) };
  const tc = { ...(ed.inspect('tokenColorCustomizations')?.globalValue || {}) };
  if (!(legacy in cc) && !(legacy in tc)) return;
  delete cc[legacy];
  delete tc[legacy];
  await wb.update('colorCustomizations', Object.keys(cc).length ? cc : undefined, vscode.ConfigurationTarget.Global);
  await ed.update('tokenColorCustomizations', Object.keys(tc).length ? tc : undefined, vscode.ConfigurationTarget.Global);
}

// ---------------- lifecycle ----------------

function activate(context) {
  extContext = context;
  statusItem = vscode.window.createStatusBarItem('skymood.status', vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'Skymood';
  statusItem.command = 'skymood.menu';
  statusItem.show();

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('skymood.enable', enable);
  reg('skymood.pickAppearance', pickAppearance); // from the menu
  reg('skymood.previewCycle', previewCycle);
  reg('skymood.pickPhase', pickPhase);
  reg('skymood.setLocation', setLocation);
  reg('skymood.togglePlayful', togglePlayful);
  reg('skymood.celebrate', celebrate);
  reg('skymood.removeOverrides', removeOverrides);
  reg('skymood.menu', menu);
  reg('skymood.selectAtmosphere', selectAtmosphere);
  reg('skymood.copySetupCard', () => Sync.copySetupCard(vscode, cardInfo()));
  reg('skymood.configureSync', () => Sync.configureSync(vscode));

  cleanupLegacy();
  const scan = scanErrors();
  live.errors = scan.count;
  live.errorFiles = scan.files;
  live.bugLevel = FX.bugLevel(scan.count);
  live.pulsedErrors = scan.count; // errors already there at startup don't pulse

  context.subscriptions.push(
    statusItem,
    vscode.workspace.onDidChangeTextDocument(onEdit),
    vscode.languages.onDidChangeDiagnostics(onDiagnostics),
    vscode.window.tabGroups.onDidChangeTabs(e => { if (e.opened.length || e.closed.length) onDiagnostics(); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('skymood.appearance')) applyAppearance();
      if (e.affectsConfiguration('window.autoDetectColorScheme')) syncAppearance();
      if (e.affectsConfiguration('workbench.colorCustomizations')) checkForeignOverwrite();
      if (WATCHED_SETTINGS.some(s => e.affectsConfiguration(s))) render().then(scheduleLoop);
    }),
    // Fires once the new theme is on screen (the setting can land before the theme does) and when
    // the OS switches between light and dark under window.autoDetectColorScheme.
    vscode.window.onDidChangeActiveColorTheme(() => { syncAppearance(); render(); }),
    // Gaining focus makes this window the one that writes, so it puts its own colors back.
    vscode.window.onDidChangeWindowState(s => { if (s.focused) render(); }),
    { dispose: () => { clearTimeout(loopHandle); clearInterval(flowHandle); clearTimeout(diagHandle); clearTimeout(cheerHandle); clearTimeout(pulseHandle); Confetti.stop(); Pulse.stop(); } }
  );

  flowHandle = setInterval(checkFlow, 15000);
  render().then(scheduleLoop);

  if (!context.globalState.get('skymood.welcomed') && !themeActive()) {
    context.globalState.update('skymood.welcomed', true);
    vscode.window
      .showInformationMessage('Skymood is installed. Turn on the adaptive theme that shifts with your day?', 'Turn on', 'Preview a day')
      .then(a => {
        if (a === 'Turn on') enable();
        if (a === 'Preview a day') previewCycle();
      });
  }
}

function deactivate() {
  clearTimeout(loopHandle);
  clearInterval(flowHandle);
  clearTimeout(diagHandle);
  clearTimeout(cheerHandle);
  clearTimeout(pulseHandle);
  Confetti.stop();
  Pulse.stop();
}

module.exports = { activate, deactivate };
