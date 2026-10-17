---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: ["web/styles.css","web/app.js"]
---

## Scope

`web/index.html` (+ `styles.css`, `app.js`): the single phone screen of TermPilot. Mode: Operate. Build path: code-led (no image generation).

## Audience and job

The author, on their phone away from the desk, checking on and steering a long agent run on their PC. Jobs in order: watch the run, send prompts (typed or voice), fire quick shell commands. Must stay: every existing feature, element ID and onclick hook; terminal columns pinned to the PTY.

## Direction contract

THESIS: The phone is the field book you carry away from the desk, and the run is the entry you check on. It refuses the category default of a black SSH screen with one blue accent and a tiny "connected" dot.

OWN-WORLD: Khaki cover-board band (#c9b98f) with graphite ink; graphite terminal pane (#1c1e19); green level-book ruling (#6f8f5a) only where it separates data; red rubber-stamp ink (#c4412f) for state stamps and interrupt keys; field-book yellow (#f2c230) only on what can be pressed; waterproof paper (#efe9d6) for the prompt box and sheets. Condensed grotesk (Barlow Condensed) for labels, stamps and numerals; Barlow for UI text; system monospace for the terminal.

STORY: In one glance the user reads the stamp (READY, RUNNING, DONE, OFFLINE, NO PC, LOCKED), the elapsed time, and what was asked. They understand whether to act, then answer by voice or one tap, and pocket the phone.

FIRST VIEWPORT: Khaki cover band at the top, one row: rotated red stamp left, prompt text with "TERMPILOT  started 14:28" beneath, big tabular elapsed time, and the chime toggle right; under it the ruled duration line, filled in graphite in proportion to elapsed time. Graphite terminal fills the middle. Bottom: one ruled row of snippet keys (A− 100% A+ readout first, Guide last), then mic, paper prompt box, yellow Send; then the touch bar of condensed keys with ESC and ^C in stamp red.

FORM: Field Book (all-weather surveyor's field book), candidate 7 of 7 on the grounded list, seed key bb07f754. Raises: yellow only on pressables (warm consumer app); duration drawn as length (labanotation); one 4px module (Crouwel); fixed one-line command rows (character catalog); live size readout (variable font).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction

The run entry: sending a prompt stamps RUNNING (stamp presses in once), the elapsed clock ticks and the duration rule fills (one hour = full); when the shell prompt returns the stamp changes to DONE in green ink with the chime. Offline/locked states stamp OFFLINE / LOCKED.

## Unresolved

None.
