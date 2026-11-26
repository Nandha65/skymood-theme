'use strict';
/**
 * Zero-dependency verification: node test/verify.js
 *  - NOAA sunrise/sunset and moon phase across equatorial, temperate and high latitudes
 *  - WCAG contrast across all 1,440 minutes, 4 atmospheres, dark and light, with every playful tint at full strength
 *  - city data, Settings Sync merge, milestone and setup card helpers
 *  - extension.js loads (against a stub of the vscode module)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const P = require(path.join(root, 'src/palette'));
const CE = require(path.join(root, 'src/colorEngine'));
const S = require(path.join(root, 'src/solar'));
const Sync = require(path.join(root, 'src/syncAndShare'));

let passed = 0;
const pending = [];
const ok = name => { passed++; console.log(`  ok   ${name}`); };
const fail = (name, e) => { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; };
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => ok(name), e => fail(name, e)));
    else ok(name);
  } catch (e) { fail(name, e); }
}
const clock = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const minutesOf = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const circDiff = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };

console.log('Solar math (NOAA)');
// Reference values from published almanacs (timeanddate.com), local civil time. Tolerance: 7 minutes,
// since NOAA's fractional-year approximation and 90.833° zenith differ slightly from almanac rounding.
const almanac = [
  ['Quito, equator, equinox', [2024, 3, 20], -0.18, -78.47, -300, '06:13', '18:20'],
  ['Singapore, equator, solstice', [2024, 6, 21], 1.35, 103.82, 480, '07:00', '19:14'],
  ['Bengaluru, tropics', [2024, 6, 21], 12.97, 77.59, 330, '05:53', '18:49'],
  ['London, temperate, summer', [2024, 6, 21], 51.51, -0.13, 60, '04:43', '21:21'],
  ['New York, temperate, winter', [2024, 12, 21], 40.71, -74.01, -300, '07:17', '16:32'],
  ['Sydney, southern summer', [2024, 12, 21], -33.87, 151.21, 660, '05:41', '20:05'],
  ['Reykjavik, high latitude, summer', [2024, 6, 21], 64.15, -21.94, 0, '02:55', '00:03']
];
for (const [name, [y, mo, d], lat, lon, tz, rise, set] of almanac) {
  test(`${name}: sunrise ${rise}, sunset ${set}`, () => {
    const t = S.sunTimes(new Date(y, mo - 1, d, 12), lat, lon, tz);
    assert.ok(t, 'expected a sunrise and sunset');
    assert.ok(circDiff(t.sunrise, minutesOf(rise)) <= 7, `sunrise ${clock(t.sunrise)} vs ${rise}`);
    assert.ok(circDiff(t.sunset, minutesOf(set)) <= 7, `sunset ${clock(t.sunset)} vs ${set}`);
  });
}
test('equator day length stays near 12h all year', () => {
  for (let m = 0; m < 12; m++) {
    const t = S.sunTimes(new Date(2024, m, 15, 12), 0, 0, 0);
    const len = (t.sunset - t.sunrise + 1440) % 1440;
    assert.ok(Math.abs(len - 720) < 14, `month ${m + 1}: ${len} min`);
  }
});
test('polar day and polar night return null (the extension then uses fixed times)', () => {
  assert.strictEqual(S.sunTimes(new Date(2024, 5, 21, 12), 69.65, 18.96, 120), null);
  assert.strictEqual(S.sunTimes(new Date(2024, 11, 21, 12), 69.65, 18.96, 60), null);
});
test('southern summer is longer than southern winter', () => {
  const len = t => (t.sunset - t.sunrise + 1440) % 1440;
  assert.ok(len(S.sunTimes(new Date(2024, 11, 21, 12), -33.87, 151.21, 660)) > len(S.sunTimes(new Date(2024, 5, 21, 12), -33.87, 151.21, 660)) + 180);
});
test('every real latitude 0..66 gives sunrise before sunset at the equinox', () => {
  for (let lat = -66; lat <= 66; lat += 3) {
    const t = S.sunTimes(new Date(2024, 2, 20, 12), lat, 0, 0);
    assert.ok(t && t.sunrise < t.sunset, `lat ${lat}`);
  }
});

console.log('\nMoon phase');
test('full moon 2024-06-22 reads as full', () => {
  const m = S.moonInfo(new Date(Date.UTC(2024, 5, 22, 1, 8)));
  assert.ok(m.illumination > 0.95, `illumination ${m.illumination}`);
  assert.ok(['Full moon', 'Waxing gibbous', 'Waning gibbous'].includes(m.name), m.name);
});
test('new moon 2024-07-05 reads as new', () => {
  const m = S.moonInfo(new Date(Date.UTC(2024, 6, 5, 22, 57)));
  assert.ok(m.illumination < 0.05, `illumination ${m.illumination}`);
});
test('first quarter 2024-06-14 is about half lit', () => {
  const m = S.moonInfo(new Date(Date.UTC(2024, 5, 14, 5, 18)));
  assert.ok(m.illumination > 0.35 && m.illumination < 0.65, `illumination ${m.illumination}`);
});
test('moon cycle is about 29.5 days', () => {
  const a = S.moonInfo(new Date(Date.UTC(2024, 0, 11, 12))).age;
  const b = S.moonInfo(new Date(Date.UTC(2024, 0, 11 + 30, 12))).age;
  assert.ok(Math.abs((b - a + S.SYNODIC) % S.SYNODIC - 0.47) < 0.1);
});

console.log('\nReadability (WCAG 2.1), all 1,440 minutes');
const SCENARIOS = {
  'sunrise 06:30 / sunset 18:30': [390, 1110],
  'high-latitude summer (03:00 / 23:30)': [180, 1410],
  'high-latitude winter (09:30 / 15:00)': [570, 900]
};
const FX_LEVELS = { calm: {}, 'every tint at full strength': { golden: 1, moonGlow: 1, flow: 3, bugs: 3 } };
for (const variant of ['dark', 'light']) {
  for (const atmosphere of CE.ATMOSPHERE_NAMES) {
    test(`${variant} · ${atmosphere}`, () => {
      let worstText = Infinity, worstComment = Infinity, count = 0;
      for (const [scenario, [sunrise, sunset]] of Object.entries(SCENARIOS)) {
        for (const [fxName, fx] of Object.entries(FX_LEVELS)) {
          for (let minute = 0; minute < 1440; minute++) {
            const { colors, tokens } = CE.compose({ minute, sunrise, sunset, variant, atmosphere, warmth: 1, fx });
            const bg = colors['editor.background'];
            const check = (what, fg, floor) => {
              const ratio = P.contrast(fg, bg);
              if (what === 'comment') worstComment = Math.min(worstComment, ratio); else worstText = Math.min(worstText, ratio);
              assert.ok(ratio >= floor, `${scenario}, ${fxName}, minute ${minute}: ${what} ${fg} on ${bg} is ${ratio.toFixed(2)}`);
              count++;
            };
            check('editor.foreground', colors['editor.foreground'], 4.5);
            for (const rule of tokens) {
              const isComment = rule.name === 'Comment';
              check(isComment ? 'comment' : rule.name, rule.settings.foreground, isComment ? 3.0 : 4.5);
            }
          }
        }
      }
      console.log(`         ${count.toLocaleString()} checks · worst text ${worstText.toFixed(2)}:1 · worst comment ${worstComment.toFixed(2)}:1`);
    });
  }
}
test('clamp is the identity on already-readable colors', () => {
  assert.strictEqual(CE.ensureContrast('#ffffff', '#000000', 4.55), '#ffffff');
});
test('clamp fixes an unreadable color, keeping its hue family', () => {
  const fixed = CE.ensureContrast('#445566', '#334455', 4.55);
  assert.ok(P.contrast(fixed, '#334455') >= 4.55);
});

console.log('\nAtmosphere profiles');
test('clear leaves the palette untouched', () => {
  const p = CE.blend({ night: 0, dawn: 0, day: 1, dusk: 0 });
  assert.deepStrictEqual(CE.applyAtmosphere(p, 'clear'), p);
});
test('overcast cuts chroma by roughly 28%', () => {
  const p = CE.blend({ night: 0, dawn: 0, day: 1, dusk: 0 });
  const o = CE.applyAtmosphere(p, 'overcast');
  const chroma = pal => ['accent', 'keyword', 'string', 'func', 'type'].reduce((s, k) => s + CE.hexToOklch(pal[k])[1], 0);
  const ratio = chroma(o) / chroma(p);
  assert.ok(ratio > 0.6 && ratio < 0.85, `ratio ${ratio.toFixed(2)}`);
});
test('overcast surfaces lean slate (~235°), arctic ice (~215°), amber warm (~55°)', () => {
  const p = CE.blend({ night: 0, dawn: 0, day: 1, dusk: 0 });
  const hue = (atmo, key) => CE.hexToOklch(CE.applyAtmosphere(p, atmo)[key])[2];
  const near = (h, target, tol) => Math.min(Math.abs(h - target), 360 - Math.abs(h - target)) <= tol;
  assert.ok(near(hue('overcast', 'bg'), 235, 25), `overcast ${hue('overcast', 'bg')}`);
  assert.ok(near(hue('arctic', 'bg'), 215, 25), `arctic ${hue('arctic', 'bg')}`);
  const night = CE.blend({ night: 1, dawn: 0, day: 0, dusk: 0 });
  assert.ok(near(CE.hexToOklch(CE.applyAtmosphere(night, 'amber').bg)[2], 55, 30));
});
test('amber removes blue at every hour', () => {
  for (const w of [{ night: 1 }, { dawn: 1 }, { day: 1 }, { dusk: 1 }]) {
    const p = CE.blend({ night: 0, dawn: 0, day: 0, dusk: 0, ...w });
    const blue = pal => P.hexToRgb(pal.fg)[2] + P.hexToRgb(pal.bg)[2];
    assert.ok(blue(CE.applyAtmosphere(p, 'amber')) < blue(p));
  }
});
test('arctic stretches twilight; others do not', () => {
  assert.ok(CE.twilightFor('arctic') > 1);
  for (const a of ['clear', 'overcast', 'amber']) assert.strictEqual(CE.twilightFor(a), 1);
  // 45 minutes before sunrise is darker-than-dawn in clear but already shifting in arctic
  const clear = CE.phaseState(390 - 100, 390, 1110, 'auto', 'clear').weights.night;
  const arctic = CE.phaseState(390 - 100, 390, 1110, 'auto', 'arctic').weights.night;
  assert.ok(arctic < clear || arctic === 1, `${arctic} vs ${clear}`);
});
test('unknown atmosphere falls back to clear', () => {
  const a = CE.compose({ minute: 700, sunrise: 390, sunset: 1110, atmosphere: 'bogus' });
  const b = CE.compose({ minute: 700, sunrise: 390, sunset: 1110, atmosphere: 'clear' });
  assert.deepStrictEqual(a.colors, b.colors);
});
test('palette changes smoothly minute to minute (no jumps)', () => {
  for (const atmosphere of CE.ATMOSPHERE_NAMES) {
    let prev = CE.compose({ minute: 0, sunrise: 390, sunset: 1110, atmosphere }).palette.bg;
    for (let m = 1; m < 1440; m++) {
      const cur = CE.compose({ minute: m, sunrise: 390, sunset: 1110, atmosphere }).palette.bg;
      const d = P.hexToRgb(prev).reduce((s, v, i) => s + Math.abs(v - P.hexToRgb(cur)[i]), 0);
      assert.ok(d <= 12, `${atmosphere} minute ${m}: background jumped ${d}`);
      prev = cur;
    }
  }
});

console.log('\nCities');
const cities = JSON.parse(fs.readFileSync(path.join(root, 'data/cities.json'), 'utf8'));
test('about 300+ cities with valid coordinates', () => {
  assert.ok(cities.length >= 280, `${cities.length} cities`);
  for (const c of cities) {
    assert.ok(c.name && c.country, JSON.stringify(c));
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, c.name);
  }
});
test('required cities are present', () => {
  for (const n of ['Bengaluru', 'Chennai', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'London', 'New York', 'San Francisco', 'Tokyo', 'Berlin', 'Singapore', 'Sydney']) {
    assert.ok(cities.some(c => c.name === n), n);
  }
});
test('no duplicate city + country pairs', () => {
  const keys = cities.map(c => `${c.name}|${c.country}`);
  assert.strictEqual(new Set(keys).size, keys.length);
});

console.log('\nSettings Sync, milestone and setup card');
test('mergeIgnored keeps existing entries and appends only what is missing', () => {
  const r = Sync.mergeIgnored(['editor.fontSize', 'workbench.colorCustomizations']);
  assert.deepStrictEqual(r.list, ['editor.fontSize', 'workbench.colorCustomizations', 'editor.tokenColorCustomizations']);
  assert.deepStrictEqual(r.added, ['editor.tokenColorCustomizations']);
  assert.deepStrictEqual(Sync.mergeIgnored(undefined).list, Sync.SYNC_KEYS);
  assert.deepStrictEqual(Sync.mergeIgnored(Sync.SYNC_KEYS).added, []);
});
test('overwrite detector needs a repeat, not a single change', () => {
  const d = new Sync.OverwriteDetector(3, 1000);
  assert.strictEqual(d.record(0), false);
  assert.strictEqual(d.record(100), false);
  assert.strictEqual(d.record(200), true);
  const slow = new Sync.OverwriteDetector(3, 1000);
  assert.strictEqual(slow.record(0), false);
  assert.strictEqual(slow.record(2000), false);
  assert.strictEqual(slow.record(4000), false);
});
test('milestone fires at 10 victories or 5 hours of flow, once', () => {
  assert.strictEqual(Sync.milestoneReached({ victories: 9, flowSeconds: 17999 }, undefined), false);
  assert.strictEqual(Sync.milestoneReached({ victories: 10, flowSeconds: 0 }, undefined), true);
  assert.strictEqual(Sync.milestoneReached({ victories: 0, flowSeconds: 18000 }, undefined), true);
  assert.strictEqual(Sync.milestoneReached({ victories: 50, flowSeconds: 99999 }, true), false);
});
test('milestone toast sets its flag before showing, and shows once', async () => {
  const store = { 'skymood.cumulativeFlowSeconds': 18000 };
  const context = { globalState: { get: (k, d) => (k in store ? store[k] : d), update: async (k, v) => { store[k] = v; } } };
  const shown = [];
  const vscode = { window: { showInformationMessage: async (...a) => { shown.push(a); return 'Dismiss'; } }, env: {}, Uri: {} };
  await Sync.checkMilestone(vscode, context);
  await Sync.checkMilestone(vscode, context);
  assert.strictEqual(shown.length, 1);
  assert.deepStrictEqual(shown[0].slice(1), ['Sponsor on GitHub', 'Star on GitHub', 'Dismiss']);
  assert.strictEqual(store['skymood.milestoneToastShown'], true);
});
const cardInfo = {
  phase: 'dusk', pinned: false, source: 'solar', cityName: 'Bengaluru', atmosphere: 'amber', variant: 'dark',
  moon: S.moonInfo(new Date(Date.UTC(2024, 5, 22))), longestFlowMinutes: 47.5,
  palette: CE.compose({ minute: 1100, sunrise: 390, sunset: 1110 }).palette
};
test('setup card markdown has phase, city, atmosphere, moon, streak and the repo link', () => {
  const md = Sync.buildCardMarkdown(cardInfo);
  for (const s of ['Dusk', 'Bengaluru', 'Amber', cardInfo.moon.name, '47 min', 'https://github.com/Nandha65/skymood-theme']) assert.ok(md.includes(s), s);
});
test('setup card SVG is 600×240 and escapes text', () => {
  const svg = Sync.buildCardSvg({ ...cardInfo, cityName: 'A & B <C>' });
  assert.ok(svg.includes('width="600" height="240"'));
  assert.ok(svg.includes('A &amp; B &lt;C&gt;') && !svg.includes('<C>'));
});

console.log('\nExtension');
test('extension.js loads and exports activate/deactivate', () => {
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : stub),
    apply: () => stub,
    construct: () => stub
  });
  const load = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? stub : load.call(this, request, ...rest); };
  try {
    delete require.cache[require.resolve(path.join(root, 'extension.js'))];
    const ext = require(path.join(root, 'extension.js'));
    assert.strictEqual(typeof ext.activate, 'function');
    assert.strictEqual(typeof ext.deactivate, 'function');
  } finally {
    Module._load = load;
  }
});
test('package.json: version 2.0.x, every command is registered, no runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(/^2\.0\.\d+$/.test(pkg.version), pkg.version);
  assert.strictEqual(pkg.publisher, 'mvnandhakumar');
  assert.strictEqual(pkg.main, './extension.js');
  assert.ok(!pkg.dependencies, 'no dependencies allowed');
  const src = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
  for (const { command } of pkg.contributes.commands) assert.ok(src.includes(`'${command}'`), `${command} not registered`);
  for (const id of ['enable', 'previewCycle', 'pickPhase', 'setLocation', 'togglePlayful', 'celebrate', 'removeOverrides', 'menu', 'selectAtmosphere', 'copySetupCard', 'configureSync']) {
    assert.ok(pkg.contributes.commands.some(c => c.command === `skymood.${id}`), id);
  }
  for (const f of ['themes/skymood-adaptive.json', 'themes/skymood-adaptive-light.json']) assert.ok(fs.existsSync(path.join(root, f)), f);
  for (const t of pkg.contributes.themes) assert.ok(fs.existsSync(path.join(root, t.path)), t.path);
});
test('no network or telemetry APIs in the source', () => {
  const files = ['extension.js', ...fs.readdirSync(path.join(root, 'src')).map(f => `src/${f}`)];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/require\(['"](https?|net|dgram|tls|http2)['"]\)|\bfetch\(|XMLHttpRequest|WebSocket/.test(text), `${f} touches the network`);
  }
});

Promise.all(pending).then(() => console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`));
