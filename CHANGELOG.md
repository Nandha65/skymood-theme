# Changelog

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
