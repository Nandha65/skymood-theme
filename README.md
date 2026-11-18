<div align="center">

<img src="images/icon.png" width="110" alt="Skymood logo" />

# Skymood

### The VS Code theme that lives on your schedule ☀️ 🌅 🌙

A theme that shifts with the real sky, from crisp daylight to warm, low-blue night. In dark and light.
It also notices you: it glows when you're in the flow, breathes a soft red when errors show up, and throws confetti when they hit zero.

![Skymood shifting through a full day](images/day-cycle.gif)

</div>

---

## ✨ Why you'll love it

| | |
|---|---|
| 🌗 **One theme, every hour** | Four hand-tuned palettes (Night, Dawn, Day, Dusk) blend smoothly, minute by minute, with no jarring switch. |
| 🌓 **Dark, light or system** | Dark by default. Choose **Light** for the same four moods on paper, or **System default** to follow your OS. |
| ☀️ **Follows your real sun** | Enter your city's coordinates once. Skymood calculates sunrise and sunset for every day of the year, **offline**. |
| 😌 **Easy on the eyes at night** | Night warmth gently cuts blue light after dark. You choose how strong. |
| 👓 **Readable at every hour** | Every blend is contrast-checked: code text stays at or above WCAG AA, all day. |

## 🎮 Playful touches

![Flow glow, bug mood, victory and golden hour](images/playful.png)

- 🔥 **Flow glow.** Type steadily for 5, 15 or 30 minutes and the accents grow brighter, with a 🔥 badge at each milestone. The status bar counts your streak. Take a break and it calms down.
- 🐞 **Bug mood.** When new errors show up in your open files, the editor slowly fades to a soft red and back, twice, then keeps a subtle warning tint while errors remain. More errors, a slightly deeper red. Errors that only flicker while you type a line don't count, and it pulses at most once every 30 seconds. It's a nudge, never a distraction.
- 🎉 **Victory.** Fix the last error in your open files and confetti bursts over your editor, in the colors of the current hour, around a badge saying how many you fixed. The more you fixed, the bigger the party: 👍 for one or two, 🙌 for a handful, 🏆 and a double burst for ten or more.
- ✨ **Golden hour.** A warm golden shimmer around sunrise and sunset.
- 🌕 **Moon phase.** Tonight's moon in the status bar, and a silver moonlight accent on full-moon nights.

Every effect can be switched off on its own, or all at once with **Skymood: Toggle Playful Effects**. Confetti and the red pulse are skipped when `workbench.reduceMotion` is on.

## 🚀 Try it in 10 seconds

1. Install, then click **Turn on** in the welcome message. Want light mode, or to follow your OS? Click Skymood in the status bar and choose **Appearance**.
2. Run **Skymood: Preview a Full Day** (`Ctrl+Shift+P` / `Cmd+Shift+P`) and watch 24 hours go by in 7 seconds.
3. Optional: **Skymood: Set Location for Sunrise & Sunset** → `12.97, 77.59` (Bengaluru, for example).

## ⌨️ Commands

| Command | What it does |
|---|---|
| Skymood: Turn On Adaptive Theme | Activates Skymood, in the mode set by `skymood.appearance` |
| Skymood: Preview a Full Day | Animates the full 24-hour cycle |
| Skymood: Pin a Phase / Follow the Sun | Locks one palette, or returns to automatic |
| Skymood: Set Location for Sunrise & Sunset | Switches to real solar times |
| Skymood: Toggle Playful Effects | All playful effects on or off |
| Skymood: Celebrate! | Because you deserve it |
| Skymood: Remove Adaptive Overrides from Settings | Cleans up everything Skymood wrote |

Or just click the Skymood item in the status bar, which is also where you switch between dark and light.

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `skymood.appearance` | `dark` | `dark`, `light` or `system` (follow your OS); switches right away |
| `skymood.mode` | `clock` | `clock` uses fixed times, `solar` uses your location |
| `skymood.sunrise` / `skymood.sunset` | `06:30` / `18:30` | Times used in clock mode |
| `skymood.latitude` / `skymood.longitude` | — | Your location for solar mode |
| `skymood.nightWarmth` | `0.4` | Blue-light reduction at night (0–1) |
| `skymood.pinnedPhase` | `auto` | `auto`, `night`, `dawn`, `day` or `dusk` |
| `skymood.playful.enabled` | `true` | Master switch for playful effects |
| `skymood.playful.flowGlow` / `bugMood` / `errorPulse` / `celebrate` / `confetti` / `goldenHour` / `moonPhase` | `true` | Each effect on its own |
| `skymood.updateIntervalMinutes` | `5` | How often the colors refresh |
| `skymood.showStatusBar` | `true` | Show the status bar item |

## 🎨 Also included

Prefer a fixed look? These are included as regular themes:

| Dark | Light |
|---|---|
| Skymood Night | Skymood Night Light (warm cream, low blue) |
| Skymood Dawn | Skymood Dawn Light (rose on lavender-white) |
| Skymood Day | Skymood Daylight (crisp cool white) |
| Skymood Dusk | Skymood Dusk Light (soft peach) |

**Appearance: System default** switches between Skymood Adaptive and Skymood Adaptive Light with your OS. It turns on VS Code's `window.autoDetectColorScheme` for you, and choosing Dark or Light turns it off again. If you already had it on, Skymood starts in System default.

## 🔒 Privacy and how it works

Everything runs locally: no network calls and no telemetry, and your location stays on your machine. Skymood writes its colors into `workbench.colorCustomizations` and `editor.tokenColorCustomizations`, **scoped to `[Skymood Adaptive]` and `[Skymood Adaptive Light]` only**, so your other themes and your own tweaks are untouched. With several windows open, the one you're working in sets the colors.

**Settings Sync on several machines?** Those two settings sync like any other, so machines in different timezones would keep repainting each other. To keep Skymood's colors per machine, add this to your user settings. Note that it also stops syncing any color customizations of your own.

```json
"settingsSync.ignoredSettings": ["workbench.colorCustomizations", "editor.tokenColorCustomizations"]
```

## 💬 Community

Questions, ideas, or a screenshot of your setup at golden hour? Join the [Skymood Discord](https://discord.gg/2jrg7VyS3). Found a bug? [Open an issue](https://github.com/Nandha65/skymood-theme/issues).

## 🧰 Production starter kits

Building a commercial product? **[PlanForge](https://planforge.web.app)** is a TypeScript engine for spatial layout editors and interactive grid planners: drag-and-drop layouts, live pricing and print-ready PDF export. [Try the live demo](https://planforge.web.app), then [get the source code](https://nandha4.gumroad.com/l/planforge) ($49 one-time) or [sponsor on GitHub](https://github.com/sponsors/Nandha65) ($29/month) for repo access and every update.

## ❤️ Support

If Skymood makes your late-night coding a little kinder on the eyes, [sponsor the project](https://github.com/sponsors/Nandha65) or leave a ⭐ on [GitHub](https://github.com/Nandha65/skymood-theme).

<sub>MIT License · Made by Nandha Kumar</sub>
