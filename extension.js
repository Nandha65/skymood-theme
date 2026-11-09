'use strict';
const vscode = require('vscode');
const P = require('./src/palette');
const FX = require('./src/effects');
const { sunTimes, parseClock, formatClock } = require('./src/sun');

const THEME = 'Skymood Adaptive';
const KEY = `[${THEME}]`;
const LABELS = { night: 'Night', dawn: 'Dawn', day: 'Day', dusk: 'Dusk' };
const ICONS = { night: '$(star-empty)', dawn: '$(sparkle)', day: '$(lightbulb)', dusk: '$(flame)' };
const IDLE_MS = 90 * 1000;
const CHEER_CONFIRM_MS = 3000; // errors must stay at zero this long before celebrating
const CHEER_EDIT_WINDOW_MS = 60 * 1000; // and you must have edited recently
const WATCHED_SETTINGS = [
  'skymood', 'workbench.colorTheme', 'workbench.preferredDarkColorTheme',
  'workbench.preferredLightColorTheme', 'window.autoDetectColorScheme'
];

let loopHandle;
let flowHandle;
let diagHandle;
let cheerHandle;
let statusItem;
let previewing = false;
let celebrating = false;
let writeChain = Promise.resolve();

// Live playful state
const live = {
  flowStart: 0, lastEdit: 0, flowLevel: 0,
  errors: 0, errorFiles: new Set(), bugLevel: 0, errorsSince: 0
};

const cfg = () => vscode.workspace.getConfiguration('skymood');
const fun = key => cfg().get('playful.enabled', true) && cfg().get(`playful.${key}`, true);
const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const followsOsScheme = () => vscode.workspace.getConfiguration('window').get('autoDetectColorScheme', false);

/**
 * True when Skymood Adaptive is the theme on screen. With window.autoDetectColorScheme on,
 * VS Code shows workbench.preferredDark/LightColorTheme and ignores workbench.colorTheme.
 */
function themeActive() {
  // Skymood Adaptive is a dark theme, so a light or high-contrast theme on screen is not it.
  if (vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Dark) return false;
  const wb = vscode.workspace.getConfiguration('workbench');
  if (followsOsScheme()) {
    return wb.get('preferredDarkColorTheme') === THEME || wb.get('preferredLightColorTheme') === THEME;
  }
  return wb.get('colorTheme') === THEME;
}

/**
 * The colors live in user settings, which every window shares, but flow and error state are
 * per window. Only the window you're working in writes, so windows don't repaint each other.
 */
const canWrite = () => vscode.window.state.focused && themeActive();

/** Makes Skymood Adaptive the active theme, through whichever setting VS Code is using. */
async function selectTheme() {
  const followsOs = followsOsScheme();
  await vscode.workspace.getConfiguration('workbench')
    .update(followsOs ? 'preferredDarkColorTheme' : 'colorTheme', THEME, vscode.ConfigurationTarget.Global);
  if (followsOs && vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Dark) {
    vscode.window.showInformationMessage(
      'Skymood: set as your dark theme. VS Code follows your OS appearance (window.autoDetectColorScheme), so Skymood shows up when your OS is in dark mode.'
    );
  }
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

/** Full visual state for a minute of the day: phase blend + playful effects. */
function computeState(minute, { forPreview = false } = {}) {
  const c = cfg();
  const sun = getSunTimes();
  const pinned = forPreview ? 'auto' : c.get('pinnedPhase', 'auto');
  let state;
  if (pinned !== 'auto' && P.PHASES.includes(pinned)) {
    state = { weights: { night: 0, dawn: 0, day: 0, dusk: 0, [pinned]: 1 }, dominant: pinned, from: pinned, to: pinned, progress: 0 };
  } else {
    state = P.stateAt(minute, sun.sunrise, sun.sunset);
  }
  const warmth = Math.max(0, Math.min(1, c.get('nightWarmth', 0.4)));
  const night = state.weights.night || 0;
  const palette = P.withWarmth(P.blend(state.weights), warmth * night);

  const moon = FX.moonInfo();
  const fx = {
    golden: pinned === 'auto' && fun('goldenHour') ? FX.goldenAmount(minute, sun.sunrise, sun.sunset) : 0,
    moonGlow: fun('moonPhase') && moon.illumination > 0.97 ? night : 0,
    flow: forPreview ? 0 : fun('flowGlow') ? live.flowLevel : 0,
    bugs: forPreview ? 0 : fun('bugMood') ? live.bugLevel : 0
  };
  return { state, palette, sun, pinned, moon, fx };
}

/**
 * Writes colors into user settings, scoped to the Skymood Adaptive theme only.
 * Compares against what settings hold now, not what this window last wrote: another window or
 * Settings Sync may have changed them since, and a write that changes nothing is skipped.
 */
function applyColors(palette, fx) {
  const colors = FX.decorate(P.workbenchColors(palette), palette, fx);
  const tokens = { textMateRules: P.tokenRules(palette) };

  writeChain = writeChain.then(async () => {
    const wb = vscode.workspace.getConfiguration('workbench');
    const ed = vscode.workspace.getConfiguration('editor');
    const colorCustom = { ...(wb.inspect('colorCustomizations')?.globalValue || {}) };
    const tokenCustom = { ...(ed.inspect('tokenColorCustomizations')?.globalValue || {}) };
    if (!sameJson(colorCustom[KEY], colors)) {
      colorCustom[KEY] = colors;
      await wb.update('colorCustomizations', colorCustom, vscode.ConfigurationTarget.Global);
    }
    if (!sameJson(tokenCustom[KEY], tokens)) {
      tokenCustom[KEY] = tokens;
      await ed.update('tokenColorCustomizations', tokenCustom, vscode.ConfigurationTarget.Global);
    }
  }).catch(err => console.error('[Skymood] failed to apply colors', err));
  return writeChain;
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
  md.appendMarkdown(`☀️ Sunrise ${formatClock(sun.sunrise)} · Sunset ${formatClock(sun.sunset)} _(${sun.source === 'solar' ? 'your location' : 'fixed times'})_\n\n`);
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
  if (canWrite()) await applyColors(info.palette, info.fx);
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
  const level = FX.flowLevel(flowMinutes());
  if (level !== live.flowLevel) {
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
    if (prev > 0 && count === 0 && fun('celebrate')) maybeCelebrate(prevFiles, open);
  }, 1500);
}

/**
 * Celebrates only a real fix. The count also drops to zero when you close the files that had
 * errors, or when a language server restarts and briefly clears its diagnostics.
 */
function maybeCelebrate(prevFiles, open) {
  const now = Date.now();
  const fileStillOpen = [...prevFiles].some(uri => open.has(uri));
  const editedRecently = now - live.lastEdit < CHEER_EDIT_WINDOW_MS;
  const hadErrorsAWhile = now - live.errorsSince > 5000;
  if (!fileStillOpen || !editedRecently || !hadErrorsAWhile) return;
  clearTimeout(cheerHandle);
  cheerHandle = setTimeout(() => {
    if (scanErrors().count === 0) celebrate();
  }, CHEER_CONFIRM_MS);
}

async function celebrate() {
  if (celebrating || previewing) return;
  celebrating = true;
  try {
    const info = computeState(nowMinutes());
    if (canWrite()) {
      for (const party of [1, 1, 0.75, 0.45, 0.2]) {
        updateStatus(info, '$(pass-filled) All clear! $(sparkle)');
        await applyColors(info.palette, { ...info.fx, celebrate: party });
        await sleep(420);
      }
    } else {
      updateStatus(info, '$(pass-filled) All clear! $(sparkle)');
      await sleep(2000);
    }
  } finally {
    celebrating = false;
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
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Skymood: previewing a full day', cancellable: true },
      async (progress, token) => {
        const frames = 48;
        for (let i = 0; i <= frames && !token.isCancellationRequested; i++) {
          const minute = (i / frames) * 1440;
          const info = computeState(minute, { forPreview: true });
          const tag = info.fx.golden > 0.35 ? ' ✨ golden hour' : '';
          progress.report({ message: `${formatClock(minute)} · ${LABELS[info.state.dominant]}${tag}`, increment: 100 / frames });
          updateStatus(info, `$(play) ${formatClock(minute)}`);
          await applyColors(info.palette, info.fx);
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

async function setLocation() {
  const c = cfg();
  const existing = typeof c.get('latitude') === 'number' ? `${c.get('latitude')}, ${c.get('longitude')}` : '';
  const value = await vscode.window.showInputBox({
    title: 'Skymood: your approximate location',
    prompt: 'Latitude, longitude (e.g. 12.97, 77.59 for Bengaluru). Used offline only, to compute sunrise and sunset.',
    value: existing,
    validateInput: v => {
      const m = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/.exec(v);
      if (!m) return 'Enter as: latitude, longitude';
      if (Math.abs(+m[1]) > 90 || Math.abs(+m[3]) > 180) return 'Latitude must be within ±90 and longitude within ±180';
      return null;
    }
  });
  if (!value) return;
  const [lat, lon] = value.split(',').map(s => Math.round(parseFloat(s) * 100) / 100);
  await c.update('latitude', lat, vscode.ConfigurationTarget.Global);
  await c.update('longitude', lon, vscode.ConfigurationTarget.Global);
  await c.update('mode', 'solar', vscode.ConfigurationTarget.Global);
  const sun = getSunTimes();
  vscode.window.showInformationMessage(`Skymood: following the sun. Today: sunrise ${formatClock(sun.sunrise)}, sunset ${formatClock(sun.sunset)}.`);
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
  delete cc[KEY];
  delete tc[KEY];
  await wb.update('colorCustomizations', Object.keys(cc).length ? cc : undefined, vscode.ConfigurationTarget.Global);
  await ed.update('tokenColorCustomizations', Object.keys(tc).length ? tc : undefined, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage('Skymood: adaptive color overrides removed from your settings.');
}

async function menu() {
  const playful = cfg().get('playful.enabled', true);
  const items = [
    { label: '$(play) Preview a full day', cmd: 'skymood.previewCycle' },
    { label: '$(pinned) Pin a phase / follow the sun', cmd: 'skymood.pickPhase' },
    { label: '$(location) Set location (sunrise & sunset)', cmd: 'skymood.setLocation' },
    { label: `$(sparkle) Playful effects: ${playful ? 'on' : 'off'}`, description: 'Flow glow, bug mood, golden hour, moon', cmd: 'skymood.togglePlayful' },
    { label: '$(pass-filled) Celebrate!', description: 'Just because', cmd: 'skymood.celebrate' },
    { label: '$(paintcan) Switch to Skymood Adaptive', cmd: 'skymood.enable' },
    { label: '$(gear) Settings', cmd: 'workbench.action.openSettings', args: ['skymood'] },
    { label: '$(trash) Remove adaptive overrides', cmd: 'skymood.removeOverrides' }
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Skymood' });
  if (choice) vscode.commands.executeCommand(choice.cmd, ...(choice.args || []));
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
  statusItem = vscode.window.createStatusBarItem('skymood.status', vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'Skymood';
  statusItem.command = 'skymood.menu';
  statusItem.show();

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('skymood.enable', enable);
  reg('skymood.previewCycle', previewCycle);
  reg('skymood.pickPhase', pickPhase);
  reg('skymood.setLocation', setLocation);
  reg('skymood.togglePlayful', togglePlayful);
  reg('skymood.celebrate', celebrate);
  reg('skymood.removeOverrides', removeOverrides);
  reg('skymood.menu', menu);

  cleanupLegacy();
  const scan = scanErrors();
  live.errors = scan.count;
  live.errorFiles = scan.files;
  live.bugLevel = FX.bugLevel(scan.count);

  context.subscriptions.push(
    statusItem,
    vscode.workspace.onDidChangeTextDocument(onEdit),
    vscode.languages.onDidChangeDiagnostics(onDiagnostics),
    vscode.window.tabGroups.onDidChangeTabs(e => { if (e.opened.length || e.closed.length) onDiagnostics(); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (WATCHED_SETTINGS.some(s => e.affectsConfiguration(s))) render().then(scheduleLoop);
    }),
    // Fires once the new theme is on screen (the setting can land before the theme does) and when
    // the OS switches between light and dark under window.autoDetectColorScheme.
    vscode.window.onDidChangeActiveColorTheme(() => render()),
    // Gaining focus makes this window the one that writes, so it puts its own colors back.
    vscode.window.onDidChangeWindowState(s => { if (s.focused) render(); }),
    { dispose: () => { clearTimeout(loopHandle); clearInterval(flowHandle); clearTimeout(diagHandle); clearTimeout(cheerHandle); } }
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
}

module.exports = { activate, deactivate };
