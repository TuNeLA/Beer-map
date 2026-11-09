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
   row, tap = away. Map credits, ANNAT and the rail: see "Main screen geometry".
5. **Back navigation.** In a sheet: ‹ shows when there is a step back (sub-view, opened sheet, folded list); ✕ stays on
   the right and closes everything (ds55, owner 2026-11-08). A full-screen overlay (games, förfest, party) opened from a
   sheet goes back to that sheet and view when it closes. Android back = ‹.
6. **One primary action per screen** (amber filled). Everything else is a row, a ghost button or a text button.
7. **Grouped lists (Inställningar, Profil, Mer).** Section heading 14 px muted, then a `--ds-card` list with `--r-lg`.
   Row: min 56 px, padding 12 / 16, icon 20 px + 12 px gap, chevron or switch 16 px from the right edge, hint under the
   row 14 px (2 lines; tap shows the rest). Long sub-lists fold behind one row (a back step).
8. **Every data screen has loading, empty, error.** Skeletons only while loading. A sheet that fails shows
   "Det här gick int' att öppna just nu." + "Uppdatera appen".
9. **Targets ≥ 44 px** (48 where there is room). Focus ring 2 px `--ds-amber-t`, offset 2.
10. **Status = icon + word**, never colour alone.

<!-- ds05 layout START -->
## Main screen geometry (ds05, 2026-11-07; tested by `ds-layout-pw.js` at 360 / 390 / 430 px)

| Rule | Value |
|---|---|
| Screen edge | `--pn-edge` 12 px, left and right, on everything edge to edge (header, ticker, HUD, rail, banners, dock). |
| Gap | `--pn-gap` 8 px between stacked floating things. |
| Top row | Logo · status pill · 🏆 · profile. Pill and buttons are all 44 px high. Profile = my character's face, else a person icon. |
| Row 2 | The LIVE ticker. **KAOS is inside the ticker** (red, label "KAOS", the headline, tap = Visa, ✕ = away), never a box on top. A call-out replaces the ticker in the same place. |
| HUD row | Left, under row 2: at most one urgent chip ("Kolla till Oskar"). |
| Right rail | Under row 2, top right: **Spökläge · Event · ⋯ Mer**, 44 px, 8 px apart. Mer holds Värme, Senaste dagarna, Taxi hem, Ställen nära dig, Kartstil. Usage data (client_vitals sheet opens, 2026-11-07): Event 10, Taxi 3, Mer 1; toggles are not logged. |
| Banners, toasts, captions | Column left of the rail, under the HUD row. They never cover the rail. |
| Locate | Bottom right, 12 px above the dock's right box (precision), right edges aligned (thumb reach). |
| Dock | Grupper and precision are the same box (88 × 80). Precision = one toggle that shows the current mode (Exakt / Område); a short bubble after a change. ÖL! = viewport centre ± 1 px. |
| ANNAT | A 50 px satellite on the upper-right edge of the ÖL! circle (one family: beer or something else). |
| Map credits | Mapbox wordmark (65 × 20, not styled) + ⓘ (opens © Mapbox © OpenStreetMap, Improve this map) bottom-left at the map edge, quiet. Mapbox: "You may not style the Mapbox logo", the logo may move to another corner but must stay on the map, text attribution "must be legible" (https://docs.mapbox.com/help/dive-deeper/attribution/). |
| Nested radius | Inner radius = outer − inset, or a round (pill) button. |
| Tap targets | ≥ 44 × 44 (ⓘ: 28 px circle, 44 px tap area). |
<!-- ds05 layout END -->

<!-- ds06 sheets START -->
## Sheet rules (ds06, from the design review 2026-11-07; tested by `ds-sheet-pw.js`)

1. **Header:** grid 44 px | title | 44 px, 16 px sides, at least 60 px high, 12 px under the grip.
2. **✕** in the right cell, 16 px from the sheet edge, round 44 px, icon `x`, background `--ds-raised`. Never the character ×.
3. **‹** in the left cell only on sub-screens. Then the title is centred between ‹ and ✕ (ds55: ✕ stays).
4. **Title:** one style. Black Ops One 22/28, amber, sentence case. No icon in the title. Subtitle 14 px grey under it.
5. **Spacing:** 24 px between sections, 8 px between items. Section heading 14 px grey, 8 px under it, no icon.
6. **One card:** `--ds-card`, radius 16, padding 12/16, 1 px `--ds-border`. No card in a card.
7. **Rows:** at least 56 px, padding 12/16, icon 20 px, title 16/600, sub 14 grey, ONE chevron (`chev-right` 16 px grey, 16 px from the right).
8. **Buttons:** 48 px (small 44), radius 12. At most 2 in a row, equal width. ONE amber per sheet.
9. **Go-further things are rows with a chevron,** not buttons in a grid.
10. **No cut label.** Write shorter. At most 2 lines.
11. **Same height for the same thing:** row 56, button 48, chip 32 (not tappable) or 44 (tappable).
12. **Bottom:** 16 px + the safe area (home indicator). The sheet reaches the screen bottom.
13. **Two heights:** half (~50 %) and large (~92 %), like Apple's detents.
14. **ONE segmented control** for every choice between 2–4 things (tabs, filters, map style, Ikväll?, minutes): track `--ds-bg` radius 12, padding 4, items 44 px radius 8, selected `--ds-raised` + amber text.
<!-- ds06 sheets END -->

<!-- ds07 bar START -->
## Krogkortet (bar sheet, ds07)

The bar sheet follows the sheet rules. Order, top to bottom:

1. Header: bar name (Black Ops One 22/28 amber), subtitle "Pub · Öppet till 01:00" (14 grey), ✕ 16 px from the edge.
2. Hero card: crowd meter, then friends here ("Lisa och Ida är här", initials 28 px).
3. Event and call-out lines (only when there are some).
4. One action row: **Checka in** (amber) + **På väg** (ghost), equal width, 48 px, radius 12.
   Checked in: status line + **Checka ut** (amber, full width). På väg is hidden.
5. Photos: one row, 72 × 72, radius 12, swipe.
6. Folk här (row, count badge).
7. "Info": one grouped list, rows 56: hours / Stor stark price, Uteservering, Sport (Ja / Nej), Kö och erbjudanden (row).
8. "Mer" (row, last): Bjud in hit, Incheckade, Stammis & kung, hours/price reports, dansgolv, QR-affisch, Fel plats, Finns inte längre.

Code: `app.js` barPopup passes its HTML through `PNDS.barSheet(html, bar, list)` (js/pnds.js "ds07 bar").
Module parts are moved, never rebuilt, so module repaints (outerHTML in place) keep working.
Kept hooks: `.bs`, `.bs-head`, `.pp-title`, `.pp-act`, `.pp-folds`, `details.pp-fold[data-fold=here|bp|rally]`, all `data-*`.
New: `.pn-bs7`, `.pn-bs-hero`, `.pn-bs-fr`, `.pn-bs-photos`, `.pn-bs-h`, `.pn-bs-info`, `details[data-fold=mer]`.
Removed folds: `ci`, `stam`, `info` (their content is in "Mer" or "Info").
<!-- ds07 bar END -->

<!-- ds08 screens START -->
## Screens after the sheet rules (ds08)

- On / off is always a switch. Never "Namn: På" in the text.
- "Radera mitt konto" is alone in the last group.
- Every row in a list has an icon (20 px), or no row in that list has one.
- A hint under a row shows at most 2 whole lines. Long text goes on the page behind the row.
- Big numbers (Profil tiles): Black Ops One 28/32.
- Medal ribbons are art, not buttons. The whole ribbon row is ONE 44 px button (opens the medals).
- Group page: ÖL! is the only amber block. Spel is an ordinary card. Icons, not characters: dots, send, plus, chev-right.
- No CSS uppercase: "Nu", "Spel", "Kaos i stan", "Chefens val".
- A green number means "out now". 0 is never green.
- `.pn-p` is the map person pin. A paragraph with that class must reset the pin box (ds08 does this for "Nytt i appen").
<!-- ds08 screens END -->

<!-- ds09 fonts START -->
## Type (ds09)

- Two faces. **Chakra Petch** 400 / 600 / 700 for all text. **Black Ops One** 400 for titles, the logo, ÖL! and big numbers.
- No other weight. 500 shows as 400 and 800 / 900 show as 700, so the code says 400 / 700. `font-synthesis: none` everywhere:
  the browser never draws a fake bold (Black Ops One 700 was a fake bold).
- No third face. Share Tech Mono is gone (`--hud` is Chakra Petch with tabular numbers). Share images (canvas) use Chakra Petch 600.
- No CSS uppercase. Write the text as it should read, in sentence case.
<!-- ds09 fonts END -->

<!-- ds10 motion START -->
## Motion (ds10)

Tokens (`docs/pnds.css` "ds10 motion"; Material 3 / Fluent 2 / Apple HIG):

| Token | Value | Use |
|---|---|---|
| `--m-1` | 50 ms | colour on press, focus ring |
| `--m-2` | 100 ms | press scale |
| `--m-3` | 150 ms | small things go out (toast, menu) |
| `--m-4` | 200 ms | tab change, switch, fade, sheet close |
| `--m-5` | 300 ms | sheet open, sub-screen |
| `--m-6` | 450 ms | full screen (takeover, rank up) |
| `--e-std` | cubic-bezier(.2,0,0,1) | moves on screen |
| `--e-in` | cubic-bezier(.05,.7,.1,1) | comes in |
| `--e-out` | cubic-bezier(.3,0,.8,.15) | goes out |
| `--e-spring` | linear(…) ~3 % overshoot | sheet, ÖL! |
| `--e-lin` | linear | meters, countdown, ticker |

Rules:

1. In = `--e-in`; out = `--e-out` and one step shorter (300 in, 200 out).
2. Move only `transform` and `opacity`. Never `transition: all`.
3. No endless loop: 3 cycles, then still. Only spinners and loading skeletons loop while they load.
4. One press: scale .96 in `--m-2`. ÖL!: .92 in 100 ms, spring back 300 ms, foam (7 bubbles, 400 ms), the count ticks up.
5. Sub-screen: shared axis X (24 px + fade, 300 ms; back = from the left). Tabs: marker slides 200 ms; the new pane fades through.
6. Sheets: open 300 ms spring; close 200 ms down (`--e-out`), backdrop fades. The bar sheet too.
7. Toast: in 200 ms, out 150 ms. People pins pop in once (300 ms spring). Bars are map layers.
8. LIVE ticker: tap = stop / go, hold = pause. With reduced motion it is a still list you scroll.
9. Reduced motion: nothing moves; colour and opacity changes stay ≤ 100 ms; no loops.
<!-- ds10 motion END -->

<!-- ds11 banners START -->
## Banners on the map (ds11)

- Bottom banners (Följ mig hem, Skåltimmen, film) start 8 px above the highest dock item (ANNAT, locate, Mapbox logo / ⓘ).
  The base is measured (`--pn-ban-b`), not a constant, because ANNAT moves. Banners stack upwards in 64 px steps.
- A banner never covers ANNAT, locate or the map credits (licence). Its text may wrap to 2 lines; it is never cut.
<!-- ds11 banners END -->

<!-- ds12 icons START -->
<!-- ds13 case START -->
## Sentence case (ds13)

- Text is written as it reads: sentence case. No ALL-CAPS words in buttons, titles, kickers, badges or captions
  (Partyspel, Skapa rum, Jag går, Inbjudan, Följ mig hem, Skåltimmen!, Snurra!, Truppen, Annat, Dagens order, Nytt).
- Short code words that are always capitals stay: LIVE, KAOS, SOS, QR, ÖL!.
<!-- ds13 case END -->

<!-- ds14 back START -->
## One back button (ds14)

- A sub-screen has ONE back: the header ‹ (16 px from the edge). No "← Tillbaka" row in the content.
- An in-place detail view (event detail) registers as a SHEETNAV sub-view, so the header ‹ and Android back go one step back.
<!-- ds14 back END -->

<!-- ds15 seg START -->
## One segmented control, everywhere (ds15)

- Every choice between 2+ options uses the ONE segmented control: tabs, filters, Lek "Sugen!", Truppen tabs, Kungaleken packs,
  Kartstil. No underline tabs, no amber-filled chips, no outlined option buttons.
- 5+ options: the items keep their size and the track scrolls sideways. 2-per-row choices wrap into two rows of the same control.
- A control with ONE option is not shown (the title says it).
<!-- ds15 seg END -->

<!-- ds16 primary START -->
## One primary (ds16)

- One filled amber button per screen: the action that moves forward. Green is a status colour, never a primary button.
- "Skip" (Hoppa över) is never the primary. A second action next to the primary is secondary (raised or ghost).
<!-- ds16 primary END -->

<!-- ds17 switch START -->
## Settings in menus (ds17)

- An on/off setting in a menu ("Jag kör ikväll") is a row with a switch. The label never says ": på".
- A row that opens a sheet ("Följ mig hem") shows its state in the sub-line ("På · 2 följer"), not as a switch.
<!-- ds17 switch END -->

<!-- ds18 motion START -->
## Motion, leftovers (ds18)

- Switch knob moves with `transform`. Progress bars: full width, `transform: scaleX()` from the left (a module still writes
  `style.width = "62%"`; pnds maps it to `--pn-p`). Loading shimmers: opacity breath.
- Tab marker: scales and slides with `transform`; it finds the bar again when a tap rebuilds it (Grupper).
- Sub-screen push: one animation on `#sheet-body` (the axis slide; the smooth.js content fade is skipped then).
- The bar sheet opens with `--e-spring` like the other sheets.
- Never a transform transition on map markers (`[role=button]` pins: audit 01).
- Known left: the ÖL! cooldown bubbles animate `background-position` (the clip box is the moving element itself); they stop
  after 3 cycles. Map-marker easings (mapart, glmap, arenapin, barlit, places, tiers) are map code, not changed here.
<!-- ds18 motion END -->

<!-- ds19 robust START -->
## Robust states (ds19)

- No "0" where a count is unknown: after an empty server answer the toast counts from the local count + 1.
- A loading screen never waits forever: after 12 s it says so, with "Försök igen" (primary) and "Tillbaka".
- A badge must mean something: "Nytt" shows on a game for 14 days after its launch, and only until you open it once.
- A segment label is never cut: the count sits under the label.
<!-- ds19 robust END -->

<!-- ds30 barcl START -->
## Bar clusters on the map (ds30)

- Zoomed out (Leaflet z ≤ 14), the bars that are a dot merge into ONE marker per area: a navy capsule with a foam ring, the
  bar glyph and the count, and a second capsule behind it (stack cue, as on the people cluster). Tap = zoom in until it splits.
- From Leaflet z15 every bar is its own dot again (the old dot rules). Full pills (friends, people, check-ins, call-outs) are
  never in a cluster: they stay on top.
- A busy bar inside = amber ring. A friend at a bar inside = the green friend dot, top-right.
- Built with a Mapbox GL GeoJSON cluster source (supercluster in the map worker): no DOM markers, no per-frame JS, so the
  clusters move with the map in the same frame. Code: `js/glmap.js` "ds30 barcl".
<!-- ds30 barcl END -->

<!-- ds31 friendtot START -->
## Friends at a bar, on the map (ds31)

- A bar with friends shows ONE small chip under its disc: green friend badge + the friend's night total + a beer glyph
  ("15"). Two friends: "15 · 7". More: "15 · 7 +2". Tap = the bar sheet at "Folk här".
- The number is the night total (all drinks tonight, wherever logged), the same as in "Folk här".
- Strangers never get a number (store rule). Only friend pins carry a count from the server.
<!-- ds31 friendtot END -->

<!-- ds32 annat START -->
## ANNAT (ds32)

- 50 px round button, lilac ring (lilac = other drinks, also on the map), navy body. Our glyph `mixed` (wine glass +
  cocktail) 20 px over the word "Annat" 12/14 px. The word fits inside the circle.
- Secondary to ÖL!: no fill colour, smaller, up-left of ÖL! (owner position, ds05c). The 10-min wait ring goes around it.
<!-- ds32 annat END -->

<!-- ds33 toasts START -->
## Toasts and bubbles at the bottom (ds33)

- Every bottom message (toasts, the precision bubble) starts 8 px above the highest of ANNAT, locate, the Mapbox logo / ⓘ
  and the bottom banners. Measured (`--pn-toast-b`, js/pnds.js "ds33"), not a constant.
- The precision bubble sits on the right, over locate. Text wraps (2 lines); it is never cut and never under a button.
- ⓘ map credits (ds34): the 28 px dark disc is the icon box itself, centred in the 44 px tap area. Only the "i" shows on it.
<!-- ds33 toasts END -->

<!-- ds35 ikvall START -->
## Ikväll chip (ds35)

- Top-left under the LIVE ticker, FIRST in the HUD row: my status tonight as icon + word (Ute / Kanske / Hemma, or "Ikväll?")
  + a chevron. 🚗 / walk icons when I drive or Följ mig hem is on. 44 px high.
- Tap = a small menu under it: Ute · Kanske · Hemma (the one segmented control), Jag kör ikväll (switch), Följ mig hem,
  Hämta mig, Vilka ska ut? It reuses pnui (status), skjuts (driving, Hämta mig) and hemfolj (Följ mig hem).
- The urgent chip ("Kolla till …") follows it in the same row; the row and the menu never reach the right rail.
- Placement: the leading edge of the map's chip row (Google Maps chips under the search bar; Apple HIG: controls in the
  corners, the map stays clear).
<!-- ds35 ikvall END -->

<!-- ds36 aclist START -->
## Auto check-in, dense areas (ds36)

- 3+ bars where you could be: a short list toast "Var ä du? Välj krogen." with the 3 nearest (name · metres), then
  "Någon annanstans" (opens Ställen nära dig) and "Inte på krogen" (no question about these bars for 30 min).
- 2 bars: "A eller B?" as before. All thresholds are unchanged (js/autoci.js).
<!-- ds36 aclist END -->

<!-- ds37 start START -->
## Start (ds37)

- First frame = the splash: solid `--ds-bg` (= manifest `background_color`), the app icon and the wordmark, centred. It is
  in `index.html` (inline style), so it paints before any script.
- It fades (280 ms, opacity) when the map has painted and the fonts are ready, at the latest 2.6 s after start. It never
  waits for data, it never blocks a tap (pointer-events: none), and with reduced motion it just goes.
- Heavy work that the user does not see waits for `pn:calm` (1.2 s after the splash): e.g. the style copy for the sheet
  close slide (smooth.js). Chrome that arrives after the splash fades in once (200 ms).
<!-- ds37 start END -->

<!-- ds38 autohome START -->
## Auto hemma (ds38)

- After a night out (a check-in or a drink tonight), 10 min inside the home zone (2+ GPS readings, accuracy ≤ 50 m):
  checked out of the bar, Ikväll = Hemma, Följ mig hem ends with the normal "Hemma ✓". Once per night.
- One calm toast: "Välkommen hem 🏠 — vi satte dig som Hemma" + Ångra (the check-in and the old status come back).
- The home point stays on the phone (home zone, `olnu.home`). The log gets only a distance bucket, never a coordinate.
- Setting: Karta – incheckning → "Sätt mig som hemma automatiskt" (on by default once a home is set), or "Ställ in hem".
- Nothing without a home, in spökläge, or before any activity tonight. Web: only while the app is open.
<!-- ds38 autohome END -->

<!-- ds39 ux2 START -->
## Usability test fixes (ds39, ux2/REVIEW.md)

- Safety in reach: Följ mig hem + Hämta mig are in the Ikväll chip menu and in "⋯ Mer på kartan" ("Säker hem").
- ONE home zone (homezone.js) for Följ mig hem, the drink privacy and Auto hemma. The sheet has an address search, a pin at
  once (the map centre until you tap or search), "Använd nuvarande plats". After Spara you go back to where you came from.
- Never colour only on the map: MEDEVAC = dashed white ring; my own dot = a target (blue core, white ring, outer ring).
  Crowd = the word (Lugnt / Livligt / Packat) + the 3-bar meter.
- Labels inside round buttons (ÖL!, Annat) use px sizes: 130 % system text never spills out of the circle.
- Every tappable map chip has a ≥ 44 px hit area (invisible padding).
- No data in view: one quiet caption "Ingen data här ikväll än" (once per area), not an empty map.
<!-- ds39 ux2 END -->

<!-- ds40 ux START -->
## Calm messages (ds40, ux/REVIEW.md)

- A sheet or a full-screen dialog is open → toasts show at the TOP (never over a shutter or a primary button); fun cards
  (Visste du?, captions) wait and come one at a time when the sheet is closed and the map has been still for 1.5 s.
- Start: the splash is the ONE intro. No "Systemstart" card. KAOS in the ticker and fun cards wait 5 s after the splash.
- LIVE ticker: real events (the gang, the town) first, with a small green dot; jokes after, without a dot.
- Precision shows its state: "Exakt plats · På" / "Exakt plats · Av". ANNAT keeps its sheet title "Sidospår" (owner).
- After ÖL!: an amber chip "Öl #N registrerad · syns för gänget" for 2.2 s above the dock.
- Auto check-in samples GPS only after the user said yes to location in the app (`olnu.locOk`).
<!-- ds40 ux END -->

<!-- ds41 zonefr START -->
## Zones and friends (ds41)

- No marker ever covers a zone pill. While the zones show, people pins and clusters are hidden; the friends (and you) are in
  the pill: green initial discs + "Oskar +2" (the Sweden chips: a green friend count). Snap Map / Zenly do the same at city
  zoom: faces with the place, never on top of the place name.
- The zone pills use our glyphs (beer, crown), no emoji. Every pill is sized to its text: never cut.
<!-- ds41 zonefr END -->

<!-- ds42 ux3 START -->
## Synlighet and ÖL! without GPS (ds42, ux3/REVIEW.md)

- The rail eye button = "Synlighet": Alla · Bara vänner · Spöke (one segmented control in a small menu, the current state on
  the button icon, one line of explanation under it). "Bara vänner" shows only when the server has migration 0340.
- ÖL! without a location: the error toast offers "Räkna ölen ändå". Checked in = the pin is at your bar; else no pin (the
  drink counts for you and your group).
- Följ mig hem on iPhone says it up front: keep the screen on (iPhone stops GPS when it locks).
- The splash shows "Laddar PintsNow…" before any script runs.
<!-- ds42 ux3 END -->

<!-- avt avatar START -->
## Avatar v4 (avt)

- **Skin:** 10 real tones, evenly spaced (CIE Lab, min ΔE 8.4), light → deep, plus 6 fun reward tones. **Hair colour:** 12 natural + 7 fun. Natural first.
- **No near-twins.** An item that looks like another item at 40 px is retired (hidden, drawn as the kept item; the saved number stays). Never reorder the catalog; add at the end.
- **Hats own the hair line.** Cover hats cut all hair at the brim (HCLIP), band hats at HAIRTOP, tall parts (bun, crest, space buns) go away under any hat. Glasses sit over the brim; the balaclava hides hair, ears and beard.
- **Clothes stay in the body.** Tops are clipped to shoulders + collar zone. Neckwear: Utanpå (default) or Instoppad (only the neck part shows) for scarves and chains (`nl`).
- **Checks:** avt-tools/clip.js (every hair × hat × face shape) and fit.js (every top × face, top × neckwear × layer, top × beard, frame crop) must report 0 fails.
- **Small sizes** (chat, pins) use the small style; pins zoom on the head (viewBox 12 8 76 76).
<!-- avt avatar END -->

## Icons, not emoji (ds12)

- In UI chrome (buttons, tabs, headings, labels, banners, overlays) an emoji becomes a PNI icon, or goes when no icon fits.
  The rule covers the overlays outside the sheet too: party lobby, förfest, Truppen tabs, chat composer, intro, invite page.
- Characters are not icons: ✕ → `x`, ⋯ → `dots`, the letter i → `info`, › → `chev-right`.
- Coloured dots (🟢) become `.pn-dot` (green = out now).
- Emoji stay as art: game cards, the drink picker, chat text, KAOS lines, medal ribbons, map pins.
- New PNI icons: `mic`, `bus`.
<!-- ds12 icons END -->

<!-- ds50 icons START -->
## Icons, 2026-11-08 (ds50)

- `gear` is drawn again: 8 flat teeth, round base, round hole (r 3), stroke 2. It is the icon for Inställningar and
  Chattinställningar. Checked at 16 / 20 / 24 / 40 px.
- New: `thumb-up`, `thumb-down` (the sport vote on the bar sheet; the button says "Ja" / "Nej" to screen readers).
- Set review at 20 / 24 / 40 px (contact sheets `fxg-shots/icons-before.png`, `icons-after.png`): `beer` (mug, foam,
  two lines; the chevrons inside were noise at 16–20 px), `drink` (tumbler + straw), `coins` (a coin in front of a coin),
  `megaphone` (cleaner cone) are redrawn. The rest keep stroke 2, round caps / joins, live area 2…22, radius 1–3.5.
- Emoji map additions: 👍 👎, 🪖 / 🎗️ → `medal`, every clock face → `clock`.
<!-- ds50 icons END -->

<!-- ds51 bar START -->
## Krogkortet, friends here (ds51)

- Each friend here is ONE row (max 3, then "+ N till här"): own character 40 px (no saved character = the initial),
  name 16/600, "1 [beer] ikväll" 14 grey (the night total, friends only), then two 44 px round buttons:
  **Chatta** (opens the 1:1 chat through the pin) and **Skål** (the app's skål; amber + count after).
- Strangers never get a count. The row needs a friend pin (`friend_name`).
- The ✕ is the popup close button: 44 px round, `--ds-raised`, icon `x`. The popup code watches the popup pane, never
  `window.__map` (that only exists in the tests; the hook never ran in the app before ds51).
- Info rows: a leading emoji becomes the PNI icon (🕐 → `clock`, 🍺 → `beer`). Sport vote: `thumb-up` / `thumb-down` + count.
<!-- ds51 bar END -->

<!-- ds52 group START -->
## Accent colours + the group page (ds52, 2026-11-08)

Accent tokens (`docs/pnds.css` "ds52 group"). An accent says WHAT a thing is. It goes on a 40 px icon tile
(`.pn-gp-ti.pn-acc-*`: radius 12, tinted background, icon 24 in the accent) or on a list icon. Never on body text,
never as a filled button. Amber is still THE action colour (one filled amber per screen); green is still "out now".

| Token | Value | Use |
|---|---|---|
| `--pn-acc-live` | `#3ddc84` | Out now, Ikväll, the Nu card |
| `--pn-acc-chat` | `#6cb2ff` | Chatten, Jag kör |
| `--pn-acc-games` | `#c79bff` | Spel, Gänget, Truppen |
| `--pn-acc-cam` | `#3fd8c6` | Engångskamera, Följ mig hem |
| `--pn-acc-skal` | `#ffc24d` | Skåltimmen, Kalla in |
| `--pn-acc-event` | `#ff8ccf` | Event |
| `--pn-acc-safe` | `#ff8a80` | Hämta mig, safety |
| `--pn-acc-money` | `#b5e66a` | Kvällens nota |

Each has a `-bg` (≈16 % tint). Every accent is ≥ 4.5:1 on `--ds-card`.

Group page (home), top to bottom: "1 av 15 dricker nu" + **Bjud in** (tonal amber pill, person-plus, opens the invite) ·
Nu card (green) · Chatten (blue tile, "Öppna" grey) · Spel (purple tile, "15 spel · Skämskort, Kungaleken…") ·
Engångskamera (teal) · Om gruppen (row: members, code, chief, leave) · **Ikväll** (one labelled bottom button: Jag kör,
Följ mig hem, Skåltimmen …). No ÖL! on the group page: ÖL! lives on the map.
- A sheet body that scrolls fades out (16 px) under the header line; nothing looks cut by it.
- Instant group page: after a write, the calls that patch their screen (group_now, group_msgs, avatars_for)
  show the cached answer 4 s after the write and re-fetch it at once (warm.js `STALE_OK`).
<!-- ds52 group END -->

<!-- ds53 members START -->
## Medlemmar (ds53)

- ONE grouped list (card, radius 16, 1 px dividers). No coloured left border.
- Row: padding 12 / 16, avatar 40 (green ring = out now) | name 16/600 (+ "Du" pill) · rank · meriter 14 grey ·
  role pills (Ägare, Chef: neutral, `--ds-raised`, 12/600) and home town 12 grey · medal ribbons | right: tonight's
  count "2 [beer]" or "Inga öl" in grey. Order = the server (meriter, most first).
- "Lägg till vän" is a text button (44 px tap height). "✓ Vän" is a small chip.
<!-- ds53 members END -->

<!-- ds54 chat START -->
## Chat (ds54)

- **One name rule:** a person is called by the group nickname (`group_members.display_name`), else the account name
  (temp groups, DMs). Chat, chat preview, Medlemmar, the Nu card and avatars all use the name the server sends. No rank
  in the bubble (tap the name → the uniform shows rank and meriter).
- Runs (iMessage / WhatsApp): the name (their colour, 14/600) + tonight's "3 [beer]" on the FIRST bubble; the avatar
  (32 px, bottom-aligned) on the LAST bubble; 2 px between bubbles of a run, 12 px between runs; inner corners 4 px.
  My bubbles: right, amber tint, no name. A person with no saved character shows the initial (never a random face).
- Time: 12 px grey inside the bubble, bottom right.
- Chat settings: one round 44 px button with the `gear` icon, right side.
<!-- ds54 chat END -->

<!-- ds55 back START -->
## ‹ and ✕ together (ds55, owner 2026-11-08 — replaces "then ✕ hides" in rule 5 and sheet rule 3)

- A sub-screen shows BOTH: ‹ in the left cell (one step back, Android back = ‹) and ✕ in the right cell (closes the
  sheet). The title is centred between them. The first screen shows ✕ only.
- Why: the owner, in Vänner: "there is a back button but no X". The 2026-11-07 problem ("✕ throws me out of all the
  groups") came from ✕ being the only way out; ‹ is always there now.
- Vänner rows: own character 40 px (green ring = out), status word "Ute ikväll" / "Int' ute" (no emoji).
<!-- ds55 back END -->

<!-- ds56 emoji START -->
## Emoji sweep, social screens (ds56)

- Group info, Medlemmar, Vänner, the invite sheet: 🎖️ / 🪖 → `medal`, 🔒 → `lock`, 📷 → `camera`, ✅ → `check`,
  🚗 → `taxi` (a leading emoji in the label becomes the icon; an emoji with no icon is dropped).
- Kept as emoji: chat text and reactions, game card art, the LIVE ticker, toasts (fun copy).
<!-- ds56 emoji END -->

<!-- ds57 social START -->
## Who is out, invite (ds57, usability round 2)

- **"Ute" = out now.** The Grupper card "N vänner ute nu" opens **Ute nu** (who, tonight's count, tap = the pin on the
  map) and then "Ska ut ikväll". Ikväll? (Ute / Kanske / Hemma) is the last row, optional, never a lock.
- **One source for "who is out":** the pins (live_beers / group_now). The group status line "N av M dricker nu"
  follows group_now, the same data as the Nu card.
- **Every list has an empty state** (Medlemmar: "Inga medlemmar att visa just nu …"; Ute nu: "Ingen av dina vänner är ute just nu.").
- **Invite after "Skapa grupp":** ‹ goes to the new group. The code is text under the QR ("Gruppkod ABC234", tap = copy).
<!-- ds57 social END -->

<!-- ds58 nav START -->
## One stack rule + the gang on the group page (ds58, usability round 1)

- **‹ = the previous real screen, never a finished form.** Ditt namn, Byt namn, Skapa grupp and Gå med are forms: the sheet
  that opens after them replaces them in the stack (`sheetnav.js FORMS`). Example: Skapa grupp → invite → ‹ = the new group.
- **Gänget ikväll** (group page, under Nu): every member's face 40 px (green ring = out, amber = me), name 12 px and
  tonight's count "3 [beer]" (or "–"). Live first, then most drinks. Tap = Medlemmar. Same data as Medlemmar.
- Info cards (Gruppchef, Nätter tillsammans, streak) span the full width; roles stack. No raw "?" ("ingen än").
- Tap your own avatar (Medlemmar, Gänget ikväll) = the character editor.
- The open group page follows the group: the strip reloads with the Nu card (30 s); a new member gives one toast "Cissi gick med i gruppen".
<!-- ds58 nav END -->

<!-- ds59 join START -->
## Joining a group (ds59, night-3 sim)

- ONE join form everywhere: "Klistra in länken eller skriv koden" (placeholder "t.ex. ABC234"). A pasted invite link
  works (`U.codeFrom`: join= / id= / code= / the last path part).
- After a good join, Grupper is fresh and the new group opens. Writes on groups (join, create, leave, rename, kick,
  name) always make the instant-screen cache dirty (`warm.js WRITES`): a screen never shows a group you left or misses one you joined.
- "Nytt i appen / Öl Nu heter nu PintsNow" shows only to people who used the app before; never to a brand-new user.
- A link join never shows a second "Gå med" form: the welcome card handles the link, and a member is never asked again.
- After a join: the group first; the home-screen tip is a toast with "Visa hur".
- 18+ first: "Jag hänger med" asks the birth year (when this phone has no 18+ answer) BEFORE the join; member names on
  the invite card show only after 18+.
- A failed join never leaves a dead button: my_groups is asked first (already a member = success), one automatic retry,
  then the error and the button works again.
<!-- ds59 join END -->

<!-- ds60 polish START -->
## Group / join polish (ds60)

- Grupper always shows group cards; a group opens on its own page (no "Skapa grupp / Har du en kod?" under it).
- The group code is on the group page, under "Bjud in" (tap = copy).
- Invite card: the preview and the count keep their space (no jump); the count is asked again every 20 s; two clear
  buttons: "Jag hänger med" (primary) and "Bara titta på kartan" (secondary).
- Hämta mig always offers the group you came from; "inga vänner" only when there are no groups and no people.
- Ikväll? is a radio: tapping your answer keeps it; "Ta bort mitt svar" clears it.
<!-- ds60 polish END -->

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
