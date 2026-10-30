---
name: TermPilot
description: An orienteering map for watching and steering a PC terminal and its coding agents from the phone.
colors:
  overprint: "#c4007a"
  overprint-ink: "#ffffff"
  overprint-wash: "#fde7f2"
  paper: "#fbfaf5"
  paper-low: "#f1ede1"
  ink: "#1d1a16"
  ink-soft: "#5c5348"
  rule: "#d9d2c4"
  open-land: "#f7c948"
  thicket: "#9bbf6a"
  contour: "#7a4b2a"
  water: "#1f5f9e"
  ok: "#4f7a23"
  ok-text: "#3f6417"
  bad: "#b3261e"
  bad-text: "#a8231c"
  muted-mark: "#8f8678"
  screen: "#1d1a16"
  screen-text: "#f3efe4"
  screen-signal: "#ff5cb8"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "52px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.18em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  none: "0px"
  control: "50%"
spacing:
  m: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.overprint}"
    textColor: "{colors.overprint-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    height: "52px"
    width: "100%"
  button-send:
    backgroundColor: "{colors.overprint}"
    textColor: "{colors.overprint-ink}"
    rounded: "{rounded.none}"
    size: "50px"
  button-stop:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    size: "50px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "0 16px"
  key:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "46px"
  key-command:
    backgroundColor: "{colors.open-land}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "46px"
  key-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.bad-text}"
    rounded: "{rounded.none}"
    height: "46px"
  input-prompt:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 14px 10px"
    height: "50px"
  status-capsule:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "36px"
  stamp:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "5px 8px"
  tool-step:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "48px"
  tool-step-asking:
    backgroundColor: "{colors.overprint-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  control-number:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.overprint}"
    rounded: "{rounded.control}"
    size: "33px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "10px 16px"
  terminal-screen:
    backgroundColor: "{colors.screen}"
    textColor: "{colors.screen-text}"
    rounded: "{rounded.none}"
---

# Design System: TermPilot

## Overview

**Creative North Star: "The Orienteering Map"**

TermPilot is an orienteering map and its control-description sheet, printed on runnable white paper. Ink draws the structure, map symbol colors (yellow open land, olive thicket, brown contours, blue water) color the few surfaces that need a tint, and course-overprint purple is the one accent, exactly as it is on a real map: the course you are running, the control that needs you, the thing to press. An agent run is a course. Your prompt is the start triangle, each tool step is a numbered control on a purple leg line, and an idle run that used tools ends on the finish double circle.

The chrome is square and printed: 2px ink outlines, zero radius, ruled and numbered lists, and pressables that "pop" off the paper on a hard offset ink shadow and travel into it when pressed. The terminal is the exception: it stays a dark screen ("the map at night") inside an ink frame topped by a scale bar, because agents print bright and truecolor text that would vanish on paper.

Density is phone-instrument density: the terminal view is a fixed full-height column with no page scroll; Home and Chat are scrolling sheets over it.

**Key Characteristics:**
- White map paper, ink line work, overprint purple as the only accent; map symbol colors only as small tints.
- Every pressable is a 2px ink outline with a hard ink offset shadow; pressed, it sits down into the shadow.
- Square corners everywhere; circles only for controls (state marks, control numbers, the finish).
- Barlow Condensed uppercase for labels, titles and buttons; Barlow for anything read as a sentence; IBM Plex Mono for code, paths and commands.
- Lists are control-description sheets: numbered in purple, ruled in ink.

## Colors

Paper and ink carry the structure, overprint purple carries meaning, and the map symbol colors appear only as tints and swatches.

### Primary
- **Course Overprint Purple** (`overprint`): the primary button, Send, Allow, the chosen agent option, focus outlines, input carets, the leg line, control circles and numbers, the start triangle and finish, the 3px rule under view headers, and small accent text such as "needs you" meta and Running / Allow? statuses (5.5:1 on paper, so the same value serves as text). White on it (`overprint-ink`, 5.8:1). **Overprint Wash** (`overprint-wash`) fills the control that is waiting for your OK and the pressed or selected list row.

### Secondary
- **Open Land Yellow** (`open-land`): the / CMD key face, the start-triangle box behind your own messages, the handoff bar (30% into paper), attachment chips (45%), inline code badges in help text (55%), and row hover/press tints on Home (18% / 35%).
- **Thicket Olive** (`thicket`): the desk PC figure's side faces and diff additions (at 38% alpha).
- **Contour Brown** (`contour`): the faint contour texture (9-11% alpha) behind Home and the overlay, and diff deletions (16% alpha).
- **Water Blue** (`water`): links in agent replies (6.6:1).

### Neutral
- **Map Paper** (`paper`): the ground, cards, sheets, fields and pressables. The ground and the card surface are the same white; separation is ink line, never tone.
- **Well Paper** (`paper-low`): code blocks, tool output, diffs and plan boxes.
- **Map Ink** (`ink`, 16.6:1): text, every outline, every pop shadow, the toast and Stop fill.
- **Soft Ink** (`ink-soft`, 7.2:1): metadata, placeholders, section labels, the zoom readout.
- **Rule** (`rule`): 1px dividers inside chat content, the grab handle, the compose top rule.
- **Muted Mark** (`muted-mark`): the swatch for a locked or unknown connection.
- **Night Screen** (`screen`) and **Night Text** (`screen-text`): the terminal, the copy pane and the pairing code box. Same ink value as `ink`.
- **Screen Signal** (`screen-signal`): the terminal cursor and the desk PC's screen while output arrives; it lives only on dark ground.

### State
- **Done Olive** (`ok`) swatch for Connected; **Done Olive Text** (`ok-text`) for PUNCHED and completed plan rows.
- **Fault Red** (`bad`) swatch for Offline and stopped chats; **Fault Red Text** (`bad-text`) for ESC / ^C, Deny, MISPUNCH and errors.

### Named Rules
**The Overprint Rule.** Purple is the course: what is running, what needs you, the one thing to press. A screen at rest shows purple on the primary action, the header rule and the course marks, nowhere else.

**The Symbol Tint Rule.** Yellow, olive, brown and blue are map symbols, used as tints, swatches and figure faces. They never become a second accent or a button color (the / CMD key is the single yellow key).

**The Night Screen Rule.** The terminal stays dark in the paper world. Its xterm theme owns color there: background and foreground match `screen` / `screen-text`, the cursor is `screen-signal`, selection is purple at 45%.

### Night Map (dark mode)
The same map printed on dark paper. A moon/sun button on Home switches it (`data-scheme="dark"` on `<html>`); the choice is kept on the phone, and before the first tap the phone's own setting decides. A head script applies it before first paint, and the browser bar color follows (`#fbfaf5` / `#17140f`). Night redefines tokens only; no component has night-specific rules.
- **Night Paper** `#17140f` (ground and paper), **Night Well** `#221e18`, **Night Ink** `#f3efe4` (16.0:1), **Night Soft Ink** `#b5ab9b` (8.1:1), rule `#4a4237`.
- **Overprint** brightens to `#ff5cb8`, with dark ink on it (`#1d1a16`, 6.2:1) and `#ff7cc6` as accent text (7.8:1); the wash is `#3d1531`.
- **Open Land** darkens to ochre `#5c4a12` so light ink sits on it (7.5:1); thicket `#4d6630`, water `#8cc4f0`, done `#a9cf78`, fault `#ff7a63` / `#ff9d8a`, contours in pale brown at 6-8%.
- **Pop shadows** stay hard and switch to light ink with everything else.
- Course marks are SVG data URIs that cannot read tokens, so they are tokens themselves (`--mark-terminal`, `--mark-empty`, `--mark-start`, `--mark-finish`) redrawn in night colors. The sheet scrim (`--scrim`) and deleted diff text (`--del-text`) are tokens for the same reason.
- The terminal is unchanged: it was already the map at night.

## Typography

**Display / Label Font:** Barlow Condensed (600, 700, self-hosted) with Arial Narrow fallback
**Body Font:** Barlow (400, 600, self-hosted) with system-ui fallback
**Mono Font:** IBM Plex Mono (400, self-hosted) with ui-monospace fallback
**Terminal Font:** the platform monospace stack, set by xterm so glyph metrics fit the PTY grid.

**Character:** the condensed caps of a map legend and control sheet over a plain, sturdy grotesque for reading.

Reading text is sized in `--pt` units (1px, or 1/17 of iOS Dynamic Type body), so it follows the phone's text-size setting; keys, fields and the terminal keep fixed px.

### Hierarchy
- **Display** (Condensed 700, 52px, 1, 0.18em, tabular): the 6-digit pairing code, in purple.
- **Headline** (Condensed 700, uppercase, 1-1.1): view titles 44pt, overlay titles 30pt (balanced), sheet titles 24pt, chat title 22pt.
- **Title** (Barlow 600, 20px, 1.25): the current prompt under the capsule (18px under 360px, 16px on short screens, 24px from 900px). List row titles 15-17pt 600.
- **Body** (Barlow 400, 16pt, 1.5): chat messages; 15pt/1.45 subtitles, 14pt/1.5 descriptions, 13pt hints.
- **Button** (Condensed 700, uppercase): primary 20px 0.06em, ask buttons 18pt 0.04em, keys 16px 0.02em (not uppercase), size buttons 17px.
- **Label** (Condensed 600, 13px, 0.06-0.1em, uppercase): capsule (15px), stamps, entry meta, tool kind and status, section and field labels, plan title, Working… and Finish.
- **Mono** (Plex Mono 400, 12-14px): code, diffs, paths, command names, the access key field.

### Named Rules
**The Legend Rule.** Anything that names, labels or stamps is Condensed uppercase; anything read as a sentence is Barlow in sentence case.

**The Readout Rule.** Numbers that change (pairing code, zoom percent) use tabular figures.

## Layout

The terminal view is a fixed, inset-0 column with no page scroll: header (capsule centered, then the prompt line), the framed screen taking all remaining height, the text-size row, the prompt row (mic, auto-growing field, Send) and the key row of equal-flex keys. The desk PC hangs as a tab under the frame's bottom-right corner on a zero-height anchor, over the end of the text-size row, whose 112px right padding keeps clear of it.

Home and Chat are fixed views laid over the terminal, which stays laid out underneath so the PTY never resizes: a header ruled in purple, a scrolling body, a foot.

Spacing runs on a 4px module (`--m`), used in multiples: 8px screen margin, 10-12px gaps and row padding, 16-20px inside sheets and overlays. Sheets are bottom sheets (max 500px, grab handle) that become centered dialogs from 600px. From 600px side padding widens; from 900px keys stop stretching (min 88px, arrows 64px) and the capsule grows to 40px. Under 550px tall the meta line hides, the scale bar shrinks and keys drop to 36px.

**The Screen Takes The Rest Rule.** Every row but the screen is `flex-shrink: 0`; new chrome fits in an existing row or justifies taking height from the terminal.

## Elevation & Depth

Depth is printed, not lit. There are no blurred shadows. Pressables and floating dialogs stand off the paper on hard offset shadows with zero blur; everything else is flat and separated by ink lines. Overlays sit on a contour-textured paper veil; sheets sit on a 38% ink scrim.

### Shadow Vocabulary
- **Pop** (`box-shadow: 3px 3px 0 ink`): keys, size buttons, chips, close/back, secondary actions, agent options.
- **Pop large** (`box-shadow: 4px 4px 0 ink`): primary, Send, mic, ask buttons.
- **Pressed** (`transform: translate(3-4px, 3-4px); box-shadow: 0 0 0 ink`): the element travels exactly its shadow's distance. A chosen agent option stays pressed.
- **Dialog** (`box-shadow: 6px 6px 0 ink`): the unlock/reconnect box and centered sheets from 600px.
- **Notice** (`box-shadow: 3px 3px 0 overprint` toast; `4px 4px 0 overprint` update banner): transient messages that are not pressable.

### Named Rules
**The Pop Rule.** A pressable is a 2px ink outline plus a hard ink offset shadow, and pressing moves it into the shadow over 120ms ease-out. Nothing scales on tap; nothing gets a blurred shadow.

**The Flat Content Rule.** Content (rows, tool steps, code wells) never pops. Only things you press, and dialogs, stand off the paper.

## Shapes

Square and printed. Every surface has zero radius: buttons, keys, fields, cards, sheets, the terminal frame. Outlines are the form language: 2px ink on pressables, fields, the frame and sheets; 1.5px ink on stamps, tool cards and the folder list; 1px ink rules in numbered lists, with every third row 2.5px like a real control-description sheet. Circles are reserved for the course: state marks, numbered controls, the finish, the mute badge. Triangles mark the start. The strip above the terminal is a map scale bar with alternate segments filled.

## Components

### Buttons
Printed and tactile: each pops off the paper and presses in.
- **Primary:** full-width 52px overprint block, white Condensed 700 20px uppercase, Pop large. Disabled at 45% opacity.
- **Send:** 50px overprint square, white 2.4-stroke arrow. While the agent works it becomes an ink Stop square; the icons cross-fade with a 2px blur over 200ms.
- **Mic:** 50px paper square, Pop large; listening fills it purple with a purple outline ring breathing out (1.2s).
- **Secondary / close / back:** 44px paper squares or blocks, Pop. Deny-type ask buttons keep paper with `bad-text` labels.

### Key Row
Equal-flex 46px paper keys, Pop, Condensed 700 16px or 18px icons. / CMD is 1.6x wide on open-land yellow; arrows are 0.85x; ESC and ^C labels are `bad-text`.

### Inputs / Fields
- **Style:** paper, 2px ink outline, square, purple caret, 16px text so iOS does not zoom. The prompt field grows from 50px to 120px (chat: 48-140px).
- **Focus:** a 2px overprint outline drawn over the ink at zero offset. Other controls focus with a 2px overprint outline at 3px offset.

### Status Capsule and Stamps (signature)
A legend box: 36px paper block with a 2px ink outline, a 12px square swatch outlined in ink, and a Condensed 600 15px uppercase label. Swatch is olive for Connected, red for Offline, muted for Locked. JS animates its width (240ms) and it pops from 0.95 on change. Small **stamps** repeat the language (13px, 1.5px outline, 10px swatch) on the overlay, guide and Home.

### Control-Description Lists
Chats on Home, folders, commands, files, sessions and devices are ruled ink lists numbered in a 40px purple Condensed 700 column separated by a 1px ink rule. Home's chat list is boxed in 2px ink (dashed when empty, with a start-leg-control drawing). Row press fills `overprint-wash`. The Command window row above it is outlined and marked with the start triangle.

### Home, top to bottom
Home is ordered for someone who is not technical: what is running, who is in control, then everything else as plain rows.
1. **Running on your PC** (only while an agent session runs on the PC): a purple Condensed title, then one card per session.
2. **The Phone/PC slider** for the terminal, under a line that says who is in control.
3. **Command window**, **Your chats** (a banner), **Earlier chats**, **Phones**, as outlined rows; **New chat** is the foot's primary button.

### Phone / PC Slider (signature)
A 64px two-sided track (`paper-low`, 2px ink outline) with PHONE and PC labels, and a thumb that is a popping overprint plate carrying the icon and name of the side in control. Drag it (it follows the finger, then lands on the nearer side over 240ms ease-out) or tap it (it flips). Any travel over 6px, sideways or up and down, means a drag, so a scroll that starts on it never flips it. The same component, 48px and right-aligned, sits at the foot of each running card. It is a `role="switch"` button; Enter and Space flip it.

### Running Cards
One per agent session the PC holds: a 2px ink card with the Pop shadow. The project folder in Condensed 700 22pt uppercase, Claude's latest reply in two clamped lines, then "Claude · working on the PC", "waiting on the PC", "on your phone" or "Moving to your phone…" in soft ink. Tapping the card opens the chat view as a read-only preview of the latest messages, refreshed whenever the latest reply changes; sliding its slider to Phone takes the session over, back to PC returns it.

### Chats Banner
"Your chats" is a `<details>` row like the others: a speech-bubble icon, the title, and a one-line summary of what is folded inside ("1 needs your OK", "2 working", "3 chats", "None yet"), which turns accent when a chat needs you. The chevron turns 180 degrees when open; open or folded is kept on the phone.

### State Marks
24px control circles in a 2.5px purple ring: idle open, thinking dashed and turning (3s), needs-you filled purple with a halo, stopped red with a diagonal strike.

### The Course (chat)
A 2.5px purple leg line runs down the left margin, each row painting its own piece. Your message is a start triangle beside an open-land yellow box. Each tool step is a 1.5px ink card on paper with a 33px numbered control circle on the leg; its status reads PUNCHED (olive), RUNNING (purple), MISPUNCH (red) or ALLOW? (purple). A step waiting for permission gets a dashed pulsing control and a 2.5px purple card on wash. While the agent thinks, the leg runs on dashed into a shimmering WORKING… line; an idle run with tools ends at FINISH. Agent replies are plain Markdown prose; code, output and diffs sit in well-paper boxes with rule outlines.

### Sheets / Overlays
Paper sheets with a 2px ink outline (no bottom edge on phones), sliding up 280ms on the drawer curve, header draggable, rows rising in 35ms apart. From 600px they become centered square dialogs with the Dialog shadow, scaling in from 0.96. The unlock/reconnect overlay is a 380px paper box with the Dialog shadow over contour-textured paper.

### Terminal Screen
An ink-framed paper bezel (2px outline, 4px total per side so the PTY keeps its columns), the scale bar on top, and the night screen inside. The terminal is display-only; its column count is pinned to the PC's PTY and its font size scales.

### Desk PC
A 76x58 isometric figure drawn in map colors (paper top, open-land front, thicket sides, night glass, ink 0.8 outlines). Typed keys flash purple; the screen lights `screen-signal` as output arrives. Muted it dims to 50% with an ink bell-off badge; offline it greys out.

## Do's and Don'ts

### Do:
- **Do** keep overprint purple (#c4007a) to the course, what needs you, and the one thing to press per view.
- **Do** build every pressable from the Pop: 2px ink outline, hard ink offset shadow (3px, 4px for primary-weight actions), press travels into the shadow at 120ms `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Do** keep corners square; use circles only for course marks and triangles only for the start.
- **Do** number and rule lists like a control-description sheet, numbers in purple Condensed.
- **Do** set labels, titles and buttons in Barlow Condensed uppercase and sentences in Barlow.
- **Do** size reading text in `--pt` units and give fields 16px text.
- **Do** keep the terminal dark and give every non-screen row `flex-shrink: 0`.
- **Do** honor reduced motion and increased contrast (`ink-soft` #46403a, `rule` #8a877f; at night #d3cbbd and #8a8072).
- **Do** add color through tokens only, so night mode follows without extra rules; a new SVG mark in CSS becomes a `--mark-*` token with a night copy.
- **Do** use the Phone/PC slider for anything that moves control between phone and PC.

### Don't:
- **Don't** use blurred or soft shadows; depth here is printed.
- **Don't** round corners on buttons, keys, fields, cards or sheets.
- **Don't** add a second accent hue or promote a map symbol color to a button color.
- **Don't** give content (rows, tool steps, code wells) a pop shadow.
- **Don't** put the terminal on paper or let chrome change its column count.
