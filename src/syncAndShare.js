'use strict';
/**
 * Multi-machine Settings Sync guard, the shareable setup card, and the one-time milestone toast.
 *
 * Offline and private: nothing leaves the machine except what the user explicitly copies or
 * saves. Only durations and counts are stored (never what you type).
 */

const REPO_URL = 'https://github.com/Nandha65/skymood-theme';
const SPONSOR_URL = 'https://github.com/sponsors/Nandha65';
const SYNC_KEYS = ['workbench.colorCustomizations', 'editor.tokenColorCustomizations'];

const STATE = {
  victories: 'skymood.totalVictories',
  flowSeconds: 'skymood.cumulativeFlowSeconds',
  longestFlowMinutes: 'skymood.longestFlowMinutes',
  milestone: 'skymood.milestoneToastShown',
  syncTip: 'skymood.syncTipShown'
};
const MILESTONE_VICTORIES = 10;
const MILESTONE_FLOW_SECONDS = 5 * 3600;

// ---------- Settings Sync guard ----------

/** Existing entries first, in their original order, then whichever of `wanted` were missing. */
function mergeIgnored(existing, wanted = SYNC_KEYS) {
  const list = Array.isArray(existing) ? existing.filter(x => typeof x === 'string') : [];
  const added = wanted.filter(k => !list.includes(k));
  return { list: [...list, ...added], added };
}

/** Adds the two color settings to settingsSync.ignoredSettings, keeping everything already there. */
async function configureSync(vscode) {
  const cfg = vscode.workspace.getConfiguration('settingsSync');
  const current = cfg.inspect('ignoredSettings')?.globalValue;
  const { list, added } = mergeIgnored(current);
  if (!added.length) {
    vscode.window.showInformationMessage('Skymood: Settings Sync already skips your color customizations on this machine. Nothing to change.');
    return false;
  }
  await cfg.update('ignoredSettings', list, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    `Skymood: Settings Sync will no longer sync ${added.join(' and ')}. Your other ignored settings were kept. `
    + 'Each machine now keeps its own sky.'
  );
  return true;
}

function syncAlreadyConfigured(vscode) {
  const current = vscode.workspace.getConfiguration('settingsSync').inspect('ignoredSettings')?.globalValue;
  return mergeIgnored(current).added.length === 0;
}

/**
 * Spots two machines (or windows) repainting each other: Skymood's scoped colors keep getting
 * rewritten by something other than this window. One stray change is normal, so it takes
 * `threshold` of them inside `windowMs` before it says so.
 */
class OverwriteDetector {
  constructor(threshold = 3, windowMs = 30 * 60 * 1000) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.hits = [];
  }
  /** @returns {boolean} true when the ping-pong pattern is confirmed */
  record(now = Date.now()) {
    this.hits = this.hits.filter(t => now - t < this.windowMs);
    this.hits.push(now);
    return this.hits.length >= this.threshold;
  }
}

/** One-time tip, shown after the detector fires and only if sync isn't already guarded. */
async function offerSyncTip(vscode, context) {
  if (context.globalState.get(STATE.syncTip) || syncAlreadyConfigured(vscode)) return;
  await context.globalState.update(STATE.syncTip, true);
  const pick = await vscode.window.showInformationMessage(
    'Skymood: your theme colors keep being changed by another window or machine, which usually means Settings Sync. '
    + 'You can keep each machine’s sky separate.',
    'Configure Settings Sync', 'Not now'
  );
  if (pick === 'Configure Settings Sync') vscode.commands.executeCommand('skymood.configureSync');
}

// ---------- stats and milestone ----------

const stats = context => ({
  victories: context.globalState.get(STATE.victories, 0),
  flowSeconds: context.globalState.get(STATE.flowSeconds, 0),
  longestFlowMinutes: context.globalState.get(STATE.longestFlowMinutes, 0)
});

async function addVictory(context) {
  await context.globalState.update(STATE.victories, stats(context).victories + 1);
}

/** Adds time spent in flow; remembers the longest unbroken streak (minutes). */
async function addFlow(context, seconds, currentStreakMinutes) {
  const s = stats(context);
  await context.globalState.update(STATE.flowSeconds, s.flowSeconds + seconds);
  if (currentStreakMinutes > s.longestFlowMinutes) {
    await context.globalState.update(STATE.longestFlowMinutes, Math.round(currentStreakMinutes * 10) / 10);
  }
}

/** True once, the first time either threshold is crossed. */
const milestoneReached = (s, shown) =>
  shown !== true && (s.victories >= MILESTONE_VICTORIES || s.flowSeconds >= MILESTONE_FLOW_SECONDS);

/** A single, non-intrusive thank-you; never shown twice. */
async function checkMilestone(vscode, context) {
  const s = stats(context);
  if (!milestoneReached(s, context.globalState.get(STATE.milestone))) return;
  await context.globalState.update(STATE.milestone, true); // set first: it must never repeat
  const hours = s.flowSeconds / 3600;
  const message = s.flowSeconds >= MILESTONE_FLOW_SECONDS
    ? `You've logged ${Math.floor(hours)}+ hours of flow with Skymood! If it's been kind to your eyes, consider starring or sponsoring the project.`
    : `You've fixed your way to ${s.victories} celebrations with Skymood! If it's been kind to your eyes, consider starring or sponsoring the project.`;
  const pick = await vscode.window.showInformationMessage(message, 'Sponsor on GitHub', 'Star on GitHub', 'Dismiss');
  if (pick === 'Sponsor on GitHub') vscode.env.openExternal(vscode.Uri.parse(SPONSOR_URL));
  if (pick === 'Star on GitHub') vscode.env.openExternal(vscode.Uri.parse(REPO_URL));
}

// ---------- setup card ----------

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function describe(info) {
  const mode = info.source === 'solar'
    ? (info.cityName ? `Solar · ${info.cityName}` : 'Solar · custom location')
    : 'Clock · fixed sunrise & sunset';
  const flow = info.longestFlowMinutes >= 1 ? `${Math.floor(info.longestFlowMinutes)} min` : 'just getting started';
  return {
    phase: `${cap(info.phase)}${info.pinned ? ' (pinned)' : ''}`,
    mode,
    atmosphere: cap(info.atmosphere),
    appearance: cap(info.variant),
    moon: `${info.moon.emoji} ${info.moon.name}`,
    flow
  };
}

/** Markdown card, with a small text sky strip so it reads well pasted into chat, READMEs and posts. */
function buildCardMarkdown(info) {
  const d = describe(info);
  return [
    `### 🌗 My Skymood sky`,
    '',
    `| | |`,
    `|---|---|`,
    `| **Phase** | ${d.phase} (${d.appearance}) |`,
    `| **Location** | ${d.mode} |`,
    `| **Atmosphere** | ${d.atmosphere} |`,
    `| **Moon** | ${d.moon} |`,
    `| **Longest flow streak** | 🔥 ${d.flow} |`,
    '',
    `Make your editor follow the real sky: ${REPO_URL}`
  ].join('\n');
}

/** A 600×240 SVG badge painted with the current palette. */
function buildCardSvg(info) {
  const d = describe(info);
  const p = info.palette;
  const swatches = ['accent', 'keyword', 'string', 'func', 'type', 'number']
    .map((k, i) => `<rect x="${32 + i * 40}" y="196" width="32" height="12" rx="6" fill="${p[k]}"/>`).join('');
  const row = (y, label, value) =>
    `<text x="32" y="${y}" font-size="13" fill="${p.muted}">${esc(label)}</text>`
    + `<text x="170" y="${y}" font-size="15" fill="${p.fg}" font-weight="600">${esc(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240" role="img" aria-label="My Skymood sky">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bgAlt}"/><stop offset="1" stop-color="${p.bg}"/></linearGradient></defs>
  <rect width="600" height="240" rx="16" fill="url(#g)"/>
  <rect x="0.5" y="0.5" width="599" height="239" rx="16" fill="none" stroke="${p.border}"/>
  <g font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">
    <text x="32" y="46" font-size="22" font-weight="700" fill="${p.accent}">Skymood</text>
    <text x="568" y="46" font-size="30" text-anchor="end">${esc(info.moon.emoji)}</text>
    ${row(84, 'Phase', `${d.phase} · ${d.appearance}`)}
    ${row(110, 'Location', d.mode)}
    ${row(136, 'Atmosphere', d.atmosphere)}
    ${row(162, 'Longest flow', `🔥 ${d.flow}`)}
    ${swatches}
    <text x="568" y="208" font-size="12" text-anchor="end" fill="${p.muted}">github.com/Nandha65/skymood-theme</text>
  </g>
</svg>
`;
}

/** Copies the Markdown card and offers to save the SVG badge. */
async function copySetupCard(vscode, info) {
  await vscode.env.clipboard.writeText(buildCardMarkdown(info));
  const pick = await vscode.window.showInformationMessage('Skymood: setup card copied. Paste it anywhere.', 'Save SVG Card');
  if (pick !== 'Save SVG Card') return;
  const target = await vscode.window.showSaveDialog({
    saveLabel: 'Save SVG Card',
    filters: { 'SVG image': ['svg'] },
    defaultUri: vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'skymood-card.svg')
      : undefined
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(buildCardSvg(info), 'utf8'));
  vscode.window.showInformationMessage(`Skymood: card saved to ${target.fsPath}`);
}

module.exports = {
  REPO_URL, SPONSOR_URL, SYNC_KEYS, STATE, MILESTONE_VICTORIES, MILESTONE_FLOW_SECONDS,
  mergeIgnored, configureSync, syncAlreadyConfigured, OverwriteDetector, offerSyncTip,
  stats, addVictory, addFlow, milestoneReached, checkMilestone,
  buildCardMarkdown, buildCardSvg, copySetupCard
};
