'use strict';
// Generates the static theme JSON files from the palette engine.
const fs = require('fs');
const path = require('path');
const { KEYFRAMES, LIGHT_KEYFRAMES, workbenchColors, tokenRules } = require('../src/palette');

const out = path.join(__dirname, '..', 'themes');
fs.mkdirSync(out, { recursive: true });

const themes = [
  ['skymood-adaptive.json', 'Skymood Adaptive', KEYFRAMES.day],
  ['skymood-night.json', 'Skymood Night', KEYFRAMES.night],
  ['skymood-dawn.json', 'Skymood Dawn', KEYFRAMES.dawn],
  ['skymood-day.json', 'Skymood Day', KEYFRAMES.day],
  ['skymood-dusk.json', 'Skymood Dusk', KEYFRAMES.dusk],
  ['skymood-adaptive-light.json', 'Skymood Adaptive Light', LIGHT_KEYFRAMES.day, 'light'],
  ['skymood-night-light.json', 'Skymood Night Light', LIGHT_KEYFRAMES.night, 'light'],
  ['skymood-dawn-light.json', 'Skymood Dawn Light', LIGHT_KEYFRAMES.dawn, 'light'],
  ['skymood-daylight.json', 'Skymood Daylight', LIGHT_KEYFRAMES.day, 'light'],
  ['skymood-dusk-light.json', 'Skymood Dusk Light', LIGHT_KEYFRAMES.dusk, 'light']
];

for (const [file, name, p, type = 'dark'] of themes) {
  const theme = {
    $schema: 'vscode://schemas/color-theme',
    name,
    type,
    semanticHighlighting: true,
    colors: workbenchColors(p),
    tokenColors: tokenRules(p)
  };
  fs.writeFileSync(path.join(out, file), JSON.stringify(theme, null, 2) + '\n');
  console.log('wrote', file);
}
