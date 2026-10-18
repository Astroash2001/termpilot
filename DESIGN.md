---
name: TermPilot
description: A porcelain instrument for watching and steering a PC terminal run from the phone.
colors:
  signal: "#ff4f00"
  signal-deep: "#e04600"
  signal-ink: "#ffffff"
  signal-text: "#c43c00"
  body: "#ecebe7"
  panel: "#f7f6f3"
  panel-low: "#e4e2dc"
  edge: "#cfccc5"
  rule: "#d9d6cf"
  ink: "#1a1a19"
  ink-soft: "#5f5c56"
  screen: "#121212"
  screen-text: "#e8e6e1"
  screen-dim: "#8b8984"
  bezel: "#0b0b0b"
  capsule: "#000000"
  key-lit: "#2563eb"
  ok: "#2f9e55"
  ok-text: "#22783f"
  bad: "#d6331f"
  bad-text: "#b52a18"
typography:
  display:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "44px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.16em"
    fontFeature: "tnum"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  key:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.1em"
rounded:
  badge: "6px"
  tile: "12px"
  key: "13px"
  plate: "14px"
  banner: "22px"
  screen: "26px"
  sheet: "28px"
  pill: "99px"
spacing:
  m: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-send:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.pill}"
    size: "50px"
  button-send-active:
    backgroundColor: "{colors.signal-deep}"
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.pill}"
    height: "52px"
    width: "100%"
  button-primary-active:
    backgroundColor: "{colors.signal-deep}"
  key:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.key}"
    rounded: "{rounded.key}"
    height: "46px"
  key-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.bad-text}"
    typography: "{typography.key}"
    rounded: "{rounded.key}"
    height: "46px"
  pill:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  pill-active:
    backgroundColor: "{colors.panel-low}"
  input-prompt:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "13px 18px 11px"
    height: "50px"
  command-plate:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "10px 14px"
  status-capsule:
    backgroundColor: "{colors.capsule}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  terminal-screen:
    backgroundColor: "{colors.screen}"
    textColor: "{colors.screen-text}"
    rounded: "{rounded.screen}"
  sheet:
    backgroundColor: "{colors.body}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
---

# Design System: TermPilot

## Overview

**Creative North Star: "The Porcelain Instrument"**

TermPilot is a piece of premium hardware held in one hand: a warm porcelain body, the terminal set into it like a dark glass screen behind a bezel, raised physical keys underneath, and one signal-orange accent. The lineage is Teenage Engineering, Braun and Leica: industrial calm, honest materials, every control looking like something you could press with a thumb.

The screen is the truth and the body serves it. The dark glass takes all the space the column of controls leaves; the porcelain around it is quiet, near-white and warm, with depth carried by light and lips rather than lines. A black status capsule at the top is the instrument's readout: it breathes orange while a run is going, counts time in tabular mono, draws a green check when the run is done, and resizes with a spring as its label changes. When a run ends, a frosted banner drops in from the top and, if the phone is locked, a system notification takes its place.

Density is phone-instrument density: a fixed full-height column (readout, screen, pinned pills, prompt row, key row), no page scroll, everything within thumb reach.

**Key Characteristics:**
- Warm porcelain body, dark glass screen, black readout capsule: three materials, nothing else.
- One signal orange for "happening now" and "press this"; green only for done, red only for offline and interrupt.
- Raised keys built from light and a lip (top inner highlight, edge line, soft cast), never from borders.
- IBM Plex throughout the chrome: Sans for words people read, Mono for keys, codes, commands and readouts.
- Spring motion on physical things (capsule width, banner drop); quick ease-out on presses.

## Colors

A warm neutral body and a near-black screen, with signal orange as the only voice and green/red reserved for state.

### Primary
- **Signal Orange** (`signal`): the running dot and wave in the capsule, the Send key, primary buttons, the desk PC's screen while output arrives, the terminal cursor, focus rings, input carets and the selected command plate. Pressed state deepens to **Signal Ember** (`signal-deep`). Labels and icons on orange are white (`signal-ink`). When orange must be small text on porcelain, use **Signal Rust** (`signal-text`, 4.6:1).

### Neutral
- **Porcelain** (`body`): the device body, sheets, overlay boxes. Also the browser theme color.
- **Key Face** (`panel`): raised key tops, pills, command plates, inputs (sunk), icon tiles.
- **Key Shadow Face** (`panel-low`): bottom of the key gradient and the pressed state of pills and close buttons.
- **Lip** (`edge`): the 1-2px line under a raised key, and the dashed-feel outline of the add-pin pill.
- **Hairline** (`rule`): dividers between guide rows, zoom readout separators, badge outlines.
- **Graphite Ink** (`ink`, 15.6:1 on porcelain): primary text and icons.
- **Soft Graphite** (`ink-soft`, 5.6:1): metadata, descriptions, placeholders, section labels.
- **Glass** (`screen`): the terminal, the copy-text pane, code boxes, the banner's icon tile.
- **Glass Text** (`screen-text`) and **Glass Dim** (`screen-dim`, 5.6:1 on glass): terminal foreground and dim output.
- **Bezel** (`bezel`): the frame the glass is set into.
- **Readout Black** (`capsule`): the status capsule, small status pills, toasts.

### State
- **Done Green** (`ok`) for the capsule check, done dots and the banner icon; **Done Green Text** (`ok-text`) when it is text on porcelain.
- **Fault Red** (`bad`) for offline dots; **Fault Red Text** (`bad-text`) for the ESC and ^C key labels.

### Named Rules
**The One Signal Rule.** Orange means either "the agent is working right now" or "this is the thing to press". It never decorates. A screen in its resting state shows orange only on Send. The one other hue is **Key Blue** (`key-lit`, #2563eb), which flashes a key on the desk PC as you type and appears nowhere else.

**The State Colors Rule.** Green appears only for a finished run, red only for offline or interrupt. Neither is used as a brand or decorative hue.

**The Glass Palette Rule.** Inside the screen, the xterm theme owns color: background and foreground match `screen` / `screen-text`, the cursor is signal orange, brightBlack is `screen-dim`, and ANSI hues are the softened set tuned for a #121212 ground.

## Typography

**Body Font:** IBM Plex Sans (variable 400-600, self-hosted) with system-ui fallback
**Label/Mono Font:** IBM Plex Mono (400, 500, self-hosted) with ui-monospace fallback
**Terminal Font:** the platform monospace stack (ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas), set by xterm so glyph metrics match the device and the PTY grid fits.

**Character:** Plex is engineered and humane at once, the typeface of a well-made instrument panel. Sans carries the words; Mono carries anything you would read off a dial or press as a key.

### Hierarchy
- **Display** (Mono 500, 44px, 1, 0.16em, tabular): the 6-digit pairing code only.
- **Headline** (Sans 600, 26px, 1.15, -0.01em, balanced): overlay titles (unlock, reconnect).
- **Title** (Sans 600, 20px, 1.25, -0.01em): the current prompt under the capsule (single line, ellipsized; 18px under 360px wide, 24px from 900px) and sheet titles. Guide row titles step down to 16px.
- **Body** (Sans 400, 15px, 1.45): subtitles and descriptions; 14px/1.5 in guide rows, 13px in hints and banner subtext. Prompt input is 16px so iOS does not zoom.
- **Key** (Mono 500, 13px): key row labels, snippet pills, command names (14px).
- **Label** (Mono 500, 11px, 0.1em-0.12em, uppercase): the run metadata line and command-sheet section headings; the wordmark uses 0.14em.

### Named Rules
**The Readout Rule.** Numbers that change (timer, zoom percent, pairing code) are Mono with tabular figures so they never jitter.

**The Sans Speaks Rule.** Anything a person reads as a sentence is Plex Sans. Mono is for keys, commands, codes and readouts, not for prose.

## Layout

A fixed, full-viewport column with no page scroll (`100dvh`, safe-area aware): header (capsule centered, then the prompt line), the bezel-framed screen taking all remaining height, a horizontally scrolling pinned-command row with the desk PC docked at its right end, the prompt row (mic, auto-growing textarea, Send), and the key row of equal-flex keys.

Spacing runs on a 4px module (`--m`), used as multiples: 8px gutters at the screen edge, 12px for row padding and gaps, 16-20px inside sheets and overlays. Sheets are bottom sheets on phones (max 500px wide, grab handle) and become centered dialogs from 600px. From 600px horizontal padding widens; from 900px keys stop stretching (min 88px, arrows 64px), the capsule grows to 40px, and the prompt title to 24px. Short viewports (under 550px tall) drop the metadata line, collapse the grille, and shrink keys to 36px.

**The Screen Takes The Rest Rule.** Every other row is `flex-shrink: 0`; only the screen flexes. New chrome must fit in an existing row or justify taking height from the terminal.

## Elevation & Depth

Depth is physical. Porcelain objects are lit from above: a 1px white inner highlight on the top edge, a hard 1-2px lip in `edge` beneath, and a soft low cast shadow. The screen does the opposite: it is sunk, with a deep inner shadow under the bezel's top edge. Inputs are sunk too (a soft 1px inner shadow). Floating layers (sheets, overlays, banner, capsule, toast) get large, soft ambient shadows. Orange keys carry a warm orange glow instead of a grey cast.

### Shadow Vocabulary
- **Raised key** (`box-shadow: inset 0 1px 0 #fff, 0 2px 0 var(--edge), 0 3px 8px rgba(0,0,0,0.08)`): key row keys, secondary copy action.
- **Raised low** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 0 var(--edge)`): pills, command plates, close buttons, icon tiles.
- **Dial** (`box-shadow: inset 0 1px 0 #fff, 0 3px 8px rgba(0,0,0,0.14), 0 1px 0 var(--edge)` over a 145deg #fbfaf8 to #dddad3 gradient): the mic key.
- **Pressed** (key travels 1-2px down and its lip collapses; dials invert to `inset 0 2px 5px rgba(0,0,0,0.15)`).
- **Sunk field** (`box-shadow: inset 0 1px 3px rgba(0,0,0,0.12)`): all text inputs; focus adds `0 0 0 2px var(--signal)`.
- **Glass well** (`box-shadow: inset 0 0 0 1px #000, inset 0 8px 20px rgba(0,0,0,0.7), 0 1px 0 #fff`): the bezel.
- **Signal glow** (`box-shadow: 0 6px 16px rgba(255,79,0,0.32)`): Send and primary buttons.
- **Float** (`0 8px 20px rgba(0,0,0,0.18)` capsule; `0 14px 34px rgba(0,0,0,0.18)` banner; `0 -10px 40px rgba(0,0,0,0.22)` sheet; `0 24px 60px rgba(0,0,0,0.28)` overlay box).

### Named Rules
**The Light From Above Rule.** Raised porcelain always has the white top highlight and the lip below; a raised element with only a drop shadow is wrong. Shadows are soft and grey (or orange glow on orange), never hard offset blocks.

**The Press Travels Rule.** A pressed key moves down 1-2px and loses its lip. Presses are fast (90-120ms ease-out); nothing scales on tap.

## Shapes

Soft, machined corners and full pills. Round things are controls you turn or tap with a thumb (Send, mic, close: circles; pills, inputs, capsule: 99px). Rectangular keys are gently rounded (13px), command plates 14px, icon tiles 12px, the banner 22px, the bezel 26px with the glass inset at 20px, sheets and overlay boxes 28px. Borders are almost absent: separation comes from tone and the raised/sunk shadow, with `rule` hairlines only between list rows and in the zoom group. The speaker grille, a short centered strip of 10px-pitch dots masked to the middle quarter of the bezel's top, is the screen's one ornament and doubles as the visual top edge of the glass.

## Components

### Buttons
Tactile and certain: each looks like hardware you could press.
- **Send:** 50px orange circle, white 2.4-stroke arrow, signal glow; pressed deepens to `signal-deep` and drops 1px.
- **Primary (overlays, guide):** full-width 52px orange pill, Sans 600 18px, signal glow, same press.
- **Mic:** a 46-50px porcelain dial (Dial shadow). It turns solid orange with an expanding orange ring pulse while listening.
- **Desk PC (chime toggle):** a 76x58px isometric desk PC drawn in porcelain tokens (`panel` tops, `panel-low` fronts, `edge` sides, `ink-soft` hairlines) with a `screen` glass. The key for each typed letter flashes Key Blue; the screen's lines turn orange while output arrives. Tapping it mutes the chime: the figure drops to 50% with a graphite bell-off badge. It greys out while the capsule is offline. Kernel after iso-figure (Tolga Cohce) and iso-glow (April Zhu), MIT.
- **Close:** 40px `panel` circle, raised low, presses to `panel-low`.
- **Secondary action:** a second action next to an orange one becomes a `panel` key with the raised shadow.

### Key Row
Equal-flex rectangular keys, 46px, 13px radius, a top-to-bottom `panel` to `panel-low` gradient, the raised-key shadow, Mono 500 13px labels or 18px icons. ESC and ^C labels are `bad-text`. `/ CMD` is 1.6x wide, arrows 0.85x.

### Chips (pinned commands)
- **Style:** 36px `panel` pills, raised low plus a faint 2px cast, Mono 500 13px command text.
- **Zoom group:** one pill split into A-, a tabular Mono percent readout between hairlines, and A+.
- **Pin:** transparent with a 1.5px inner `edge` outline and a plus icon in `ink-soft`. **Guide:** transparent, no outline, help icon.
- **State:** pressed fills `panel-low` and drops 1px.

### Inputs / Fields
- **Style:** `panel` fill, sunk inner shadow, no border, pill radius (the prompt textarea is 25px so it can grow to 120px), orange caret.
- **Focus:** a 2px signal-orange ring added outside the sunk shadow.

### Command Plates (commands sheet)
Each command is a `panel` key plate (14px radius, raised low): command in Mono 500 14px, one `ink-soft` 13px description that never wraps. Selected or pressed shows a 2px inner orange ring. Groups are headed by Mono 11px uppercase labels in `ink-soft`.

### Sheets / Overlays
Porcelain surfaces with a white top highlight and large soft shadow over a 40-45% graphite scrim with 4-6px blur. Bottom sheets slide up (320ms ease-out) with a grab handle; from 600px they pop in as centered 28px-radius dialogs (240ms spring).

### Status Capsule (signature)
The black readout centered at the top, 36px (40px from 900px), Sans 500 14px white label. States: **Running** (breathing orange dot with glow, Mono tabular timer, a 10-bar orange wave whose heights follow output volume), **Done** (green check that draws itself over 480ms, final time), **Ready / Locked** (grey dot), **Offline / No PC** (red dot). Width is measured and animated on a 520ms spring; each state change pops it (scale 0.92 to 1.04 to 1). The same black-capsule language appears small as status pills (Mono 11px uppercase with a 7px state dot) in the overlay and guide, and as the toast.

### Run-Finished Banner (signature)
When a run ends while the app is open, a frosted porcelain banner (94% opaque, 20px blur, 22px radius, max 480px) drops from the top on a 600ms spring: a 40px glass tile holding a green check, a Sans 600 15px title with the run number and duration, and the prompt as an ellipsized subline. When the page is hidden, the same title and body go out as a service-worker notification, with haptics and the optional chime.

### Terminal Screen
The bezel (black, 26px radius, glass well shadow) holds the grille strip and the xterm glass (`screen`, bottom corners 20px). The terminal is display-only; its column count is pinned to the PC's PTY and the font size scales, so nothing in the chrome may change its width.

## Do's and Don'ts

### Do:
- **Do** keep signal orange (#ff4f00) to running state and the one primary action per view; use `signal-text` when orange must be small text on porcelain.
- **Do** build raised controls from the white top highlight, the `edge` lip and a soft cast (the Raised key / Raised low shadows); build fields as sunk.
- **Do** use the black capsule language (pill, Readout Black, state dot) for status, and Mono with tabular figures for any changing number.
- **Do** use the one inline SVG icon set: 24px grid, 1.75 stroke, round caps and joins, `currentColor`.
- **Do** animate physical things on the spring (`cubic-bezier(0.2, 1.25, 0.35, 1)`) and presses on the ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) at 90-120ms; honor reduced motion.
- **Do** give every new row `flex-shrink: 0` so the screen keeps the remaining height.

### Don't:
- **Don't** add a second accent hue, or use green and red for anything but done and offline/interrupt.
- **Don't** draw borders around porcelain controls; separation is tone and shadow, with `rule` hairlines only between list rows and inset outlines only on ghost pills (Pin) and inline badges.
- **Don't** use hard offset or block shadows; depth here is lit from above and soft.
- **Don't** set prose in Mono or keys and readouts in Sans.
- **Don't** change the terminal's column count or let chrome reflow the grid; scale its font instead.
