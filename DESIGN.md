---
name: TermPilot
description: A surveyor's field book for watching and steering a PC terminal run from the phone.
colors:
  press: "#f2c230"
  press-deep: "#d9a915"
  pencil: "#1a3fa8"
  pencil-light: "#7aa2ff"
  stamp-red: "#7f2214"
  stamp-red-paper: "#a93624"
  stamp-red-light: "#e8735f"
  rule-green: "#6f8f5a"
  stamp-green: "#2c4f23"
  cover: "#c9b98f"
  cover-deep: "#b7a676"
  cover-ink: "#23251d"
  cover-ink-soft: "#4b4a3a"
  graphite: "#1c1e19"
  graphite-2: "#24271f"
  graphite-3: "#30342a"
  graphite-line: "#3a3e32"
  paper: "#efe9d6"
  paper-ink: "#2a2b22"
  paper-ink-soft: "#5a5946"
  paper-rule: "#c9cfb4"
  text: "#ece6d3"
  text-soft: "#a9a593"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.18em"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.02em"
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  body-strong:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.25
  label:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  stamp:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, Roboto Mono, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  badge: "3px"
  stamp: "4px"
  key: "6px"
  field: "10px"
  sheet: "14px"
  round: "24px"
spacing:
  m1: "4px"
  m1-5: "6px"
  m2: "8px"
  m3: "12px"
  m4: "16px"
  m5: "20px"
  m6: "24px"
components:
  button-press:
    backgroundColor: "{colors.press}"
    textColor: "{colors.graphite}"
    typography: "{typography.label}"
    rounded: "{rounded.key}"
    height: "48px"
  button-press-active:
    backgroundColor: "{colors.press-deep}"
    textColor: "{colors.graphite}"
  button-send:
    backgroundColor: "{colors.press}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.field}"
    size: "48px"
  button-mic:
    backgroundColor: "{colors.press}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.round}"
    size: "48px"
  button-mic-listening:
    backgroundColor: "{colors.stamp-red}"
    textColor: "{colors.paper}"
  key:
    backgroundColor: "{colors.graphite-2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.key}"
    height: "44px"
  key-active:
    backgroundColor: "{colors.graphite-3}"
  key-interrupt:
    backgroundColor: "{colors.graphite-2}"
    textColor: "{colors.stamp-red-light}"
  snippet-key:
    backgroundColor: "{colors.graphite-2}"
    textColor: "{colors.text}"
    typography: "{typography.mono}"
    rounded: "{rounded.key}"
    height: "36px"
    padding: "0 12px"
  icon-button-cover:
    backgroundColor: "transparent"
    textColor: "{colors.cover-ink}"
    rounded: "{rounded.key}"
    size: "40px"
  icon-button-cover-active:
    backgroundColor: "{colors.cover-deep}"
  prompt-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    height: "48px"
    padding: "12px 12px 10px"
  paper-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.key}"
    height: "48px"
    padding: "0 12px"
  stamp:
    textColor: "{colors.stamp-red}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "5px 7px 4px"
  stamp-done:
    textColor: "{colors.stamp-green}"
  cover-band:
    backgroundColor: "{colors.cover}"
    textColor: "{colors.cover-ink}"
    padding: "8px 8px 8px 12px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.sheet}"
  sheet-header:
    backgroundColor: "{colors.cover}"
    textColor: "{colors.cover-ink}"
    typography: "{typography.title}"
    padding: "8px 8px 8px 16px"
  command-row:
    backgroundColor: "transparent"
    textColor: "{colors.paper-ink}"
    padding: "10px 8px"
  toast:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.key}"
    padding: "8px 16px"
---

# Design System: TermPilot

## Overview

**Creative North Star: "The Field Book"**

The phone is the all-weather surveyor's field book carried away from the desk, and the agent run on the PC is the entry being checked on. Three materials make the whole world: a khaki cover board with graphite ink across the top, the graphite terminal pane filling the middle, and waterproof paper wherever the user writes (the prompt field and every sheet). Rubber-stamp ink states the run, a green level-book ruling measures it, and field-book yellow marks everything that can be pressed.

Density is that of a working instrument: one cover row carries the stamp, the prompt that was sent, the elapsed clock and the chime toggle; the terminal takes every remaining pixel; the bottom carries three thumb rows (snippet keys, prompt row, key row). Chrome serves the terminal and never crowds it. Type is a condensed grotesk for everything that is a label, stamp or numeral, a plain grotesk for sentences, and system monospace for anything that is or will become terminal text.

The world explicitly rejects the category default of a black SSH screen with one blue accent and a small "connected" dot. Status is a stamp, not a dot.

**Key Characteristics:**
- Three materials: cover board (header band, sheet headers, unlock card), graphite (terminal and key rows), paper (prompt field, sheets, toast).
- Rubber stamps for run state, re-inked per surface for contrast.
- One 4px spacing module; every gap is a multiple of it.
- Yellow means pressable, and nothing else is yellow.
- Code-led: inline SVG stroke icons, CSS stamps and ruling, self-hosted webfonts; no rasters.

## Colors

An olive-warm palette of khaki, graphite and paper, with two inks (stamp red, ruling green), one signal yellow, and surveyor's blue pencil as the contrast colour, the opposite of khaki on the colour wheel.

### Primary
- **Field-Book Yellow** (press): the fill of every pressable primary action: Send, mic, Unlock/Connect, Copy actions; also the focus ring and (at 42% alpha) the selected command row. **Pressed Yellow** (press-deep) is its active state.

### Secondary
- **Stamp Red, cover ink** (stamp-red): stamp ink on the khaki band (RUNNING, OFFLINE, NO PC) and the mic while listening. Darkened from the brief's #c4412f to clear 4.6:1 on khaki.
- **Stamp Red, paper ink** (stamp-red-paper): the same ink on paper: command-sheet section headings and mini stamps in the guide.
- **Stamp Red, graphite ink** (stamp-red-light): the same ink on graphite: the ESC and ^C interrupt keys and terminal red.

### Tertiary
- **Level-Book Green** (rule-green): the twelve five-minute tick lines of the duration rule. It appears only where it divides measured data.
- **DONE Green** (stamp-green): the DONE stamp on the cover.

### Accent
- **Blue Pencil** (pencil, 4.7:1 on cover): the 10% contrast colour that marks the run. The elapsed clock, the duration rule's run fill and its lower edge, the hairline under sheet headers and the unlock card head. **Blue Pencil Light** (pencil-light, 6.8:1 on graphite): the snippet row's top hairline (40% alpha), the terminal cursor and selection (35% alpha).

### Neutral
- **Khaki Cover Board** (cover): the header band, sheet headers, the unlock/reconnect card, text selection. **Pressed Cover** (cover-deep) is the active state of icon buttons on cover.
- **Cover Graphite Ink** (cover-ink) and **Cover Soft Ink** (cover-ink-soft, 7:1 on cover): primary and secondary text, borders and dividers on khaki.
- **Graphite** (graphite): app ground and terminal pane. **Raised Key** (graphite-2) and **Pressed Key** (graphite-3): key and snippet surfaces at rest and pressed. **Graphite Line** (graphite-line): key borders, scrollbars.
- **Waterproof Paper** (paper), **Paper Ink** (paper-ink), **Paper Soft Ink** (paper-ink-soft): writing surfaces and their text. **Paper Ruling** (paper-rule): hairline row dividers on paper.
- **Graphite Text** (text) and **Graphite Soft Text** (text-soft): text on graphite; soft for readouts and secondary keys (Pin, Guide, zoom %).

### Named Rules
**The Pressables-Only Rule.** Field-book yellow fills only things that can be pressed (plus the focus ring). Never yellow for decoration, status or headings.

**The Re-Inked Stamp Rule.** Stamp red has one meaning and three inks; pick the ink by the surface it lands on (stamp-red on cover, stamp-red-paper on paper, stamp-red-light on graphite), never the other way round.

**The Blue Pencil Rule.** Blue contrasts with the khaki and graphite pair instead of matching it, so it stays scarce: the clock, the run fill, hairlines and the cursor only. Never a blue button, never a blue surface, never blue body text.

**The Three Materials Rule.** Every surface is cover, graphite or paper. A new surface picks one of the three; it does not invent a fourth tint.

## Typography

**Display / Label Font:** Barlow Condensed 500/600/700 (fallback Barlow, system-ui)
**Body Font:** Barlow 400/500/600 (fallback system-ui, -apple-system, Segoe UI)
**Mono Font:** system monospace stack (ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, Roboto Mono)

**Character:** A surveyor's lettering pair: the condensed cut stamps, labels and counts things; the regular cut says sentences. Mono is reserved for literal terminal text so the phone matches the PTY.

### Hierarchy
- **Display** (Condensed 700, 48px, 1, 0.18em, tabular): the 6-digit pairing code only.
- **Headline** (Condensed 600, 24px, 32px at 900px+, tabular): the elapsed clock; also the unlock card title (24px, 1.1).
- **Title** (Condensed 700, 18-20px, 1.15): sheet titles (20px), guide entries (18px), primary button labels (18px).
- **Body** (Barlow 400, 15-16px, 1.4): subtitles, prompt field (16px, so iOS never zooms); descriptions at 13-14px in paper-ink-soft. **Body Strong** (Barlow 600, 15px, 18px at 900px+) is the sent prompt on the cover, single line, ellipsized.
- **Label** (Condensed 600, 15px, 0.04em): keys, zoom readout, Pin/Guide. Command-sheet section headings are Condensed 700, 14px, 0.06em, uppercase, in stamp-red-paper over a 1.5px paper-ink rule.
- **Stamp** (Condensed 700, 15px, 0.08em, uppercase text): run-state stamps; 12px for mini stamps, 18px at 900px+.
- **Mono** (13px, 500): snippet keys, command names (14px 600), copy sheet (12px, 1.5), code box; the terminal itself is xterm at a fitted size.

### Named Rules
**The Numerals-Are-Condensed Rule.** Every count, clock and readout is Barlow Condensed with tabular numerals, so digits never jitter as they tick.

**The Mono-Is-Terminal Rule.** Monospace marks text that is, or will be sent to, the shell (snippets, slash commands, copied output). Prose never sets in mono.

## Layout

A single full-height column pinned to the dynamic viewport: cover band (min 56px; 68px at 900px+) with the duration rule under it, the terminal flexing to fill, then the snippet row, prompt row and key row, all respecting safe-area insets. The page never scrolls; only the terminal, sheets and the snippet row do.

Spacing is one 4px module (`--m`); paddings and gaps are 1, 1.5, 2, 3, 4, 5 or 6 modules. Touch targets are 44-48px (36px snippet keys, 40px cover icon button), shrinking one step under 360px wide and under 550px tall, where the cover meta line also hides.

Sheets are bottom sheets (max 500px wide, 78-86vh) on phones and become centered dialogs at 600px+ (560-640px wide). At 900px+ the key row stops stretching: keys keep a working width (88px, arrows 64px) left-aligned.

## Elevation & Depth

Mostly flat material with soft, ambient shadows on things that lift off the page. Depth inside the world is tonal (raised key graphite-2, pressed key graphite-3) and ruled (1-1.5px ink borders), not shadowed.

### Shadow Vocabulary
- **Press** (`box-shadow: 0 2px 4px rgba(0,0,0,0.35)`): the one soft depth under every yellow pressable.
- **Toast** (`box-shadow: 0 6px 18px rgba(0,0,0,0.35)`): the floating paper slip.
- **Sheet** (`box-shadow: 0 -8px 28px rgba(0,0,0,0.4)`; centered dialog `0 20px 60px rgba(0,0,0,0.55)`): sheets over a graphite scrim (rgba(20,21,17,0.72)).
- **Card** (`box-shadow: 0 18px 40px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.25)`): the unlock/reconnect cover card over a denser scrim (0.88).

### Named Rules
**The One Press Shadow Rule.** Every yellow pressable carries the same soft press shadow and drops 1px on press; nothing else on the key rows has a shadow.

## Shapes

Gently rounded, never pill-soft except the mic. Corners step by role: badge 3px, stamp 4px, keys/inputs/toast 6px, prompt field, Send and unlock card 10px, sheets 14px (top corners only on phones), mic fully round (24px on 48px). Borders are ink rules: 1.5px cover-ink or paper-ink for structure, 1px paper-rule or graphite-line for row dividers. A dashed border means "not yet" or "off": the READY stamp, the muted chime button, the Pin key.

The duration rule is the signature silhouette: a 7px band between a 1.5px cover-ink top line and a cover-deep bottom line, ticked in rule-green into 12 cells, filled from the left in cover-ink as the run ages (one hour = full).

## Components

### Buttons
Tactile, few, and unmistakably pressable.
- **Shape:** 6px keys; Send 10px; mic round.
- **Primary (press):** field-book yellow with graphite text, Condensed 700 at 16-18px, 48px tall full-width in cards and sheets, 40px inline in the copy sheet. Press shadow.
- **Active / Focus:** active swaps to press-deep and translates 1px down (120ms ease-out). Focus-visible is a 2px yellow outline offset 2px everywhere.
- **Mic listening:** turns stamp-red with paper icon and a red ring pulse (1.4s).
- **Cover icon button:** 40px, transparent, 1.5px cover-ink border at 55%; active fills cover-deep; muted state goes dashed and soft.

### Keys (touch bar and snippet row)
- **Style:** raised graphite-2 with a 1px graphite-line border; active graphite-3 (100-120ms). Key labels Condensed 600 15px; snippet keys in mono 13px.
- **Interrupt keys:** ESC and ^C set their label in stamp-red-light.
- **Secondary keys:** Pin (dashed, transparent) and Guide (transparent) in text-soft, each with a 16-17px stroke icon.
- **Zoom group:** A-, a tabular % readout between hairlines, A+, sharing one bordered 36px housing.

### Inputs / Fields
- **Prompt field:** paper, 10px radius, transparent 1.5px border, Barlow 16px, stamp-red caret; focus turns the border yellow. Auto-grows from 48px to 110px.
- **Paper input / search:** 1.5px ink border, 6px radius, 44-48px; the unlock input sets typed text in mono with a Barlow placeholder.

### Sheets
- **Corner Style:** 14px.
- **Background:** paper body under a cover-colored header (Condensed 700 20px title, 44px close button) separated by a 1.5px cover-ink rule.
- **Rows:** command rows are fixed furniture: mono command name, then a one-line paper-ink-soft note that ellipsizes and never wraps; 1px paper-rule dividers; selected or pressed fills yellow at 42%.

### Run Entry (signature)
The cover band reads the run at a glance: a rotated stamp (RUNNING, DONE, READY, OFFLINE, NO PC, LOCKED), the sent prompt with "TERMPILOT No. n · time" beneath, the big tabular clock, and the chime toggle; the duration rule fills under it. Each new state re-stamps at a fresh tilt between -3deg and -1deg and plays the one authored motion: a 420ms press-in (rotate -6deg, scale 1.35, fade in, settle). READY is dashed graphite ink; DONE is green; LOCKED is graphite.

### Stamp
Condensed 700 uppercase in a 2px currentColor border, 4px radius, tilted (default -2deg). Mini stamp (12px, stamp-red-paper) is the same object on paper.

### Terminal
xterm on graphite with an olive-warm theme: foreground #e4e0d2, cursor blue pencil #7aa2ff, selection blue at 35%, red #e8735f, green #9cc27f, yellow #f2c230; 4px thin graphite-line scrollbar.

## Do's and Don'ts

### Do:
- **Do** keep yellow (#f2c230) on pressables, the focus ring and the cursor only.
- **Do** pick the stamp-red ink by surface: #7f2214 on cover, #a93624 on paper, #e8735f on graphite.
- **Do** build every gap from the 4px module and keep touch targets 44-48px.
- **Do** set every count, clock and readout in Barlow Condensed with tabular numerals.
- **Do** use dashed borders to mean "not yet" or "off" (READY, muted, Pin).
- **Do** let the stamp press-in be the only authored motion; other transitions stay at 100-280ms ease-out and honor reduced motion.

### Don't:
- **Don't** add a status dot or a blue accent; state is a stamp on the cover band.
- **Don't** introduce a fourth surface tint beyond cover, graphite and paper.
- **Don't** use rule-green for decoration; it divides measured data only.
- **Don't** set prose in monospace, or terminal text in Barlow.
- **Don't** let command rows wrap; one name line, one ellipsized note line.
- **Don't** change terminal columns for the phone; font size fits, columns stay pinned to the PTY.
