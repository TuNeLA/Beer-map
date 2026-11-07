# PintsNow – DESIGN.md

The design rules for the PintsNow web app (`docs/`). Read this first before you change UI.
Precedence: the owner's words > this file > the TuNeLA kit > habits.
Language in the app: Swedish only (du-form, dalmål "ä" is part of the voice).

## Files

| File | What |
|---|---|
| `docs/ds.css` | Base components (`.ds-list`, `.ds-row`, `.ds-seg`, `.ds-card`, settings sections). |
| `docs/pnds.css` | The token scale + the last word. Loaded **last** (`js/ds.js` keeps it after `ds.css`). |
| `docs/js/pnicons.js` | `window.PNI`: our own icon set (SVG, drawn for PintsNow). |
| `docs/js/pnds.js` | `window.PNDS`: emoji → icon in UI chrome, back navigation for overlays, Inställningar groups, "Ute ikväll" card, empty-sheet guard. |
| `docs/js/pnui.js` | `window.PNUI`: the earlier UI pass (Krogmätaren, Ikväll?, onboarding, Profil). |

## Tokens

Use tokens only. No hex, px font size, radius or spacing in component code.

### Colour (dark only; every text pair ≥ 4.5:1, icons/edges ≥ 3:1)

| Token | Value | Use |
|---|---|---|
| `--ds-bg` | `#0a0f1c` | App + the solid top area (status bar, header). |
| `--ds-sheet` | `#121a2a` | Sheets. |
| `--ds-card` | `#19233a` | Cards, grouped lists. |
| `--ds-raised` | `#222e48` | Selected segment, icon tiles, pressed rows. |
| `--ds-text` / `--ds-text-2` / `--ds-muted` | `#eef0ec` / `#c9d0cd` / `#a7b0ac` | Text levels. |
| `--ds-amber` / `--ds-amber-t` | `#f5a623` / `#ffc24d` | THE action colour (ÖL!, primary button, selected). |
| `--ds-green` | `#3ddc84` | Live / out now / on. |
| `--ds-red` / `--ds-red-t` | `#c8202a` / `#ff7b73` | Alarm, delete. |
| `--ds-blue` | `#4aa3ff` | Info only. |
| `--pn-float` / `--pn-float-2` | navy 94 % / 97 % | Things that float on the map. **Solid, no blur.** |

### Radius: 4 · 8 · 12 · 16 · 24 · pill

`--r-xs 4` badges · `--r-sm 8` small chips inside cards · `--r-md 12` buttons, inputs, toasts, icon tiles ·
`--r-lg 16` cards, grouped lists, dock buttons · `--r-xl 24` sheet top corners · `--r-pill` round buttons, pills, chips, switches.
Inner radius = outer radius − padding.

### Spacing: 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48

`--sp-0 … --sp-7`. Sheet sides 16. Between items 8. Between sections 24. Row padding 12 / 16.

### Type: ONE scale

| Token | Size / line | Use |
|---|---|---|
| `--fs-12` | 12 / 16 | Badges, the precision control, meta. Minimum size. |
| `--fs-14` | 14 / 20 | Secondary text, hints, section headings, tabs. |
| `--fs-16` | 16 / 22–24 | Body, row titles, buttons. |
| `--fs-18` | 18 / 24 | Card titles. |
| `--fs-22` | 22 / 28 | Sheet titles (stencil), brand in the top bar. |
| `--fs-28` | 28 / 32 | Big numbers. |
| `--fs-34`, `--fs-44` | display | ÖL! and hero numbers only. |

Faces: Chakra Petch (UI) · Black Ops One (stencil: brand, ÖL!, sheet titles, big numbers). Self-hosted.
Sentence case everywhere. No ALL CAPS labels (the stencil titles are written in sentence case too).
`ds04-tokens-codemod.py` moved every `border-radius` and `font-size` in `docs/*.css` onto these steps (map marker rules
and `avatar.css` excluded).

### Depth + motion

`--ds-sh-1` (floating chrome), `--ds-sh-2` (popovers, bubbles). Motion 120 / 200 / 320 ms, transform + opacity only,
none with reduced motion. No endless animations (skeletons breathe 3 times, then stop).

## Rules

1. **The top is solid.** iOS home-screen app: `black-translucent` + `viewport-fit=cover`; the header paints a solid
   `--ds-bg` from y = 0 under the status bar / Dynamic Island. No `backdrop-filter` on anything at the top (iOS 26 blurs
   and tints the status bar from fixed elements that are not solid). The sheet backdrop dims, it does not blur.
2. **ÖL! is always in the exact centre.** The dock is a 3-column grid `minmax(0,1fr) auto minmax(0,1fr)`. Side content
   never changes the centre (tested at 320–430 px, both precision modes).
3. **Precision = a fixed-size segmented control** (Exakt plats / Bara område, both visible). Its helper text is a short
   bubble after a change and before the first beer. Never a permanent line.
4. **The main map stays clean.** One HUD row (my night + at most one urgent chip). Who is out lives in Grupper
   ("Ute ikväll" card) and as "● N ute" under the Grupper button. Captions ("Visste du?") are small toasts under the HUD
   row, tap = away. Map credits (Mapbox logo + ⓘ) sit in the bottom-right corner, ANNAT on the left shoulder of ÖL!.
5. **Back navigation.** In a sheet: ‹ shows when there is a step back (sub-view, opened sheet, folded list); then ✕ hides.
   ✕ shows only on the first screen and closes everything. A full-screen overlay (games, förfest, party) opened from a
   sheet goes back to that sheet and view when it closes. Android back = ‹.
6. **One primary action per screen** (amber filled). Everything else is a row, a ghost button or a text button.
7. **Grouped lists (Inställningar, Profil, Mer).** Section heading 14 px muted, then a `--ds-card` list with `--r-lg`.
   Row: min 56 px, padding 12 / 16, icon 20 px + 12 px gap, chevron or switch 16 px from the right edge, hint under the
   row 14 px (2 lines; tap shows the rest). Long sub-lists fold behind one row (a back step).
8. **Every data screen has loading, empty, error.** Skeletons only while loading. A sheet that fails shows
   "Det här gick int' att öppna just nu." + "Uppdatera appen".
9. **Targets ≥ 44 px** (48 where there is room). Focus ring 2 px `--ds-amber-t`, offset 2.
10. **Status = icon + word**, never colour alone.

## Icons (`window.PNI`)

Our own set, drawn for PintsNow on a 24 px grid: stroke 2, round caps and joins, no fill (small dots filled),
`currentColor`. Use `PNI.svg(name, cls, label)`; icon-only buttons need `aria-label`.

| Group | Names |
|---|---|
| Navigation | chev-left, chev-right, chev-down, chev-up, x, plus, check, dots, swap, refresh, share, link, copy, qr, download, info, help, search, filter, sliders, gear, home, eye, eye-off |
| People | user, users, user-plus, crown, hand |
| Night | beer, drink, cheers, cap, moon, sun, clock, history, fire, sparkle, trophy, medal, star, game, ticket, calendar, tv, food, tag, receipt, coins, passport |
| Map | map, pin, area, locate, globe, layers, compass, taxi, walk, door |
| Talk + media | chat, send, inbox, bell, bell-off, megaphone, mail, camera, image, speaker, vibrate, phone, bulb, bug |
| Safety | shield, lock, key, rules, block, flag, trash, sos, heart |

New icon: add its parts to `pnicons.js` (same grid, same stroke), add the emoji it replaces to `PNI.EMOJI`, check it at
16, 20 and 40 px.

### Emoji we keep (and why)

Emoji are not UI icons. They stay where the emoji **is** the content or the joke:
chat messages and reactions (user text) · the LIVE ticker lines (fun copy) · game card art and game rules in the
Spel hub (🃏 👉 🙊 ⚖️ 🧠 👑) · takeovers, level-up and medal pop-ups · the drink picker (ANNAT) art · map pins and
crowd badges (map agent) · toast body text (fun copy) · flags in place names (🇸🇪) · the "my night" state in the HUD pill.

## App-specific decisions

- 2026-11-07 — Friends strip off the main map; "Ute ikväll" card in Grupper — owner: "the bottle caps are in the way".
- 2026-11-07 — ✕ only on the first screen of a sheet, ‹ on every sub-screen; overlays go back to their sheet — owner: "I press the X and I get thrown out of all the groups".
- 2026-11-07 — Solid top, no blur near the status bar — owner: "the Dynamic Island area is blurring the app".
- 2026-11-07 — One radius / spacing / type scale (this file) — owner: "radiuses … padding … designs inconsistent".
- 2026-11-07 — Own icon set, no emoji as icons — owner: "Stop using actual emojis as our icons".
- 2026-11-07 — Shorter Inställningar + one text-size scale — owner approved.
