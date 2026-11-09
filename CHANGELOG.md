# Changelog

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
