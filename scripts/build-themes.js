'use strict';
// Generates the static theme JSON files from the palette engine.
const fs = require('fs');
const path = require('path');
const { KEYFRAMES, workbenchColors, tokenRules } = require('../src/palette');

const out = path.join(__dirname, '..', 'themes');
fs.mkdirSync(out, { recursive: true });

const themes = [
  ['skymood-adaptive.json', 'Skymood Adaptive', KEYFRAMES.day],
  ['skymood-night.json', 'Skymood Night', KEYFRAMES.night],
  ['skymood-dawn.json', 'Skymood Dawn', KEYFRAMES.dawn],
  ['skymood-day.json', 'Skymood Day', KEYFRAMES.day],
  ['skymood-dusk.json', 'Skymood Dusk', KEYFRAMES.dusk]
];

for (const [file, name, p] of themes) {
  const theme = {
    $schema: 'vscode://schemas/color-theme',
    name,
    type: 'dark',
    semanticHighlighting: true,
    colors: workbenchColors(p),
    tokenColors: tokenRules(p)
  };
  fs.writeFileSync(path.join(out, file), JSON.stringify(theme, null, 2) + '\n');
  console.log('wrote', file);
}
