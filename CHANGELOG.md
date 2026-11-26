# Changelog

## 2.0.1
- The celebration badge is smaller (18px text, tighter padding), so it sits better in narrow editors.
- README: the Studio comparison table no longer mentions a Discord role.

## 2.0.0
- 🌦️ **Atmosphere profiles**: Clear (default), Overcast, Arctic and Amber, layered over the four solar phases in dark and light. New setting `skymood.atmosphere` and command **Select Atmosphere Profile**.
- 📍 **City picker**: **Set Location** now lists 350 major cities (offline), or accepts coordinates as before. Picking a city sets latitude, longitude and the new `skymood.cityName`, switches to solar mode and repaints right away.
- 🧭 The status bar menu is regrouped (Appearance, Atmosphere, Time & place, Playful, Share & sync) with live status in the placeholder, such as `Dusk · Clear · 🌕 Full moon · 🔥 18m`.
- 📋 **Copy Setup Card (Share Your Sky)**: a Markdown card for your phase, location, atmosphere, moon and longest flow streak, with an optional 600×240 SVG.
- 🔄 **Configure Settings Sync for Multi-Machine**: adds Skymood's two color settings to `settingsSync.ignoredSettings` without touching your other entries, and offers a one-time tip if another machine keeps rewriting your colors.
- A single, one-time thank-you after 10 celebrations or 5 hours in flow. Only counts and durations are stored, locally.
- Phases now blend in OKLab for cleaner in-between colors, and a WCAG contrast clamp runs after atmosphere, warmth and playful tints. `npm test` verifies sunrise/sunset, moon phase and contrast across every minute of the day.
- The sky math moved to `src/solar.js` (`src/sun.js` re-exports it). All command IDs, settings and theme files are unchanged.

## 1.2.0
- 🌓 Light versions. **Skymood Adaptive Light** blends four light palettes through the day, just like the dark one: warm cream at night, rose at dawn, crisp white by day, peach at dusk. Every effect works on it, retuned so accents stay readable on a light background, and code text stays at or above WCAG AA all day. Static **Skymood Night Light**, **Dawn Light**, **Daylight** and **Dusk Light** themes are included too.
- New setting `skymood.appearance`: **Dark** (the default, as before), **Light** or **System default**, which follows your OS. Switch it from the Skymood menu in the status bar (**Appearance**) or in settings, and the theme changes right away. System default turns on VS Code's `window.autoDetectColorScheme`; Dark and Light turn it off. If you already follow your OS appearance, Skymood starts in System default. Picking a Skymood theme from VS Code's theme picker updates the setting to match.
- 🐞 Errors now get a gentle heads-up: when new errors appear in your open files and stay for a few seconds, the editor slowly fades to a soft red and back, twice. The more errors, the deeper the red, but it stays mild. It pulses at most once every 30 seconds and only for errors from your own typing, so opening a file with old errors stays quiet. Nothing is written to your settings.
- New setting `skymood.playful.errorPulse`. Skipped when `workbench.reduceMotion` is on; the steady bug-mood tint still shows.
- The Marketplace page now describes the confetti celebrations from 1.1.0 and the light versions.

## 1.1.0
- 🎉 Celebrations are now confetti. It bursts over your editor in the colors of the current hour, around a badge that says what you did ("🙌  3 errors fixed!"). This replaces the slow status bar fade: it starts about a second after your fix, and nothing is written to your settings.
- Bigger fixes get bigger parties: more confetti for three or more errors, and a double burst for ten or more. The badge emoji changes each time.
- A 🔥 badge when you reach a flow milestone (5, 15 and 30 minutes).
- **Skymood: Celebrate!** pops a big 🎉 with a double burst of confetti.
- New setting `skymood.playful.confetti`. Confetti is skipped when `workbench.reduceMotion` is on; the status bar still cheers.

## 1.0.1
- Only the focused window writes colors, so windows no longer repaint each other with their own flow and error state.
- Runs on your machine in Remote SSH, WSL and Codespaces, so the day follows your local clock instead of the server's.
- Works with `window.autoDetectColorScheme`: **Turn On** sets Skymood as your preferred dark theme, and colors apply when it's on screen.
- Bug mood and the victory celebration count errors in your open files only. Closing a file or a language server restart no longer sets off a false celebration.
- Smaller package: README images and build scripts are no longer included.

## 1.0.0
First public release of Skymood.
- Adaptive theme that blends Night, Dawn, Day and Dusk palettes through the day.
- Real sunrise/sunset from your location, calculated offline.
- Night warmth (blue-light reduction), phase pinning, 24-hour preview, status bar indicator.
- 🔥 Flow glow, 🐞 bug mood, ✅ victory celebration, ✨ golden hour, 🌕 moon phase.
- Static Night, Dawn, Day and Dusk themes.
