# DIALEKT — how a lane uses the dialect layer

`docs/js/dialekt.js` gives `window.DIALEKT`. It picks the fun copy for the user's dialect region.
It sits on top of `i18n.js`. Keep `L(sv, en)`. Put `DIALEKT.t()` in the Swedish part.

## Use it

```js
var D = window.DIALEKT;
L(D.t("grp.empty"), "Nobody out yet – you decide when you go");
A.toast(L(D.t("toast.skal", { name: who }), "Cheers, " + who + "!"));
el.textContent = D.t("kaos.head", { bar: bar.name }, "KAOS på {bar}!");   // 3rd arg = default if no pack has the key
```

- `t()` returns plain text. Escape it before `innerHTML` (`U.esc`).
- Always guard: `window.DIALEKT ? DIALEKT.t(k, v) : "…"` in code that can run before the module.
- New copy in a new feature (Stage 3+): add the key to the `sv-neutral` pack and use `t()`. The dialect lane adds the regions.

## Keys and packs

- Key names: `<area>.<what>` — `grp.empty`, `live.quiet`, `kaos.head`, `toast.skal`, `rank.up`, `game.card`, `loc.far`.
- A pack = `DIALEKT.register("sv-dalarna", { "grp.empty": "…" })`. Locale codes:
  - A regions: `sv-neutral`, `sv-syd`, `sv-vast`, `sv-sthlm`, `sv-dalarna`, `sv-norr`.
  - B packs (later): `sv-smaland`, `sv-varmland`, `sv-norr-ovre`, `sv-norr-mitt`, `sv-gotland`.
  - Other countries (later): `nb-neutral`, `nb-…`, `da-…`, `fi-…`.
- A value is one of:
  - `"text"`
  - `["variant 1", "variant 2"]` — one is picked per key per night (05:00 to 05:00). It does not change on a re-render.
  - `{ t: "text", not: ["sv-smaland"] }` — skip this variant there (for example Skåne-only words in Småland).
  - `{ t: "text", only: ["sv-gotland"] }` — use it only there.
  - `function (vars) { return … }` — for plural forms.
- `{name}` in the text = `vars.name`. A missing var becomes "". `vars._seed` gives another variant (for example a counter).

## Lookup order

`chain()` shows it. The first pack that has the key wins:

1. Scheme B only: the kommun's B pack (`sv-smaland`). A B code "neutral" stops here (Gästrikland in B).
2. The kommun's A pack (`sv-syd`).
3. `sv-neutral`.
4. The `def` argument.
5. The key itself (and `DIALEKT.stats.miss[key]++`).

Mode "off" = neutral only. Scheme A is the default (the data file says `"scheme": "A"`). The owner picks A or B.

## The region

`region()` = the first code in `chain()`. `area()` = `{cc, lang, code, name, a, b, src}`.
Sources, first hit wins:

1. `DIALEKT.setArea({lat, lng} | {code} | {name})` from a call site, then `api.lastLoc()` (the app's position; `src: "loc"`).
2. `olnu.pushLoc` (push.js, under 12 h old).
3. The home town (`HOMETOWN.mine()` / `olnu.homeTown`). Town names that are not kommuner are aliases (Grängesberg → Ludvika).
4. The home zone `olnu.home`, then `olnu.htPos`.
5. Nothing: neutral.

Before the data file is in, the last region (`olnu.dialekt.r`) is used, so the text does not jump at start.

## Other calls

| Call | What it does |
|---|---|
| `DIALEKT.onChange(cb)` | `cb({region, area, mode, chain})` on a real change. Returns an `off()` function. Also the window event `dialekt:change`. |
| `DIALEKT.setMode("auto" \| "off")`, `mode()` | The user switch. Stored in `localStorage` `olnu.dialekt`. |
| `DIALEKT.settingsRow()` | The Inställningar row "Dialekt" with a switch (on = Auto). The social lane places it. |
| `DIALEKT.preview("sv-syd")`, `preview(null)` | Owner and reviewers: show one region anywhere. Stored. |
| `DIALEKT.setScheme("A" \| "B")` | Preview scheme B before the owner decides. |
| `DIALEKT.ready()` | A promise: the data file is in. |

## Data

- `scripts/dialekt-kommuner.csv` = the D1 list (290 kommuner, `regionA`, `regionB`). The owner's changes go here.
- `python3 scripts/dialekt-kommun.py` builds `docs/data/dialekt-kommun.json` (kommuner, town aliases, a lat/lng grid).
  It prints the grid error rate. Hand fixes for towns go in its `FIX` table.
- New country = a new data file with its own `cc` and `lang`, added to `DATA` in `dialekt.js`, plus its packs.

## Phase 2: the call sites (live since 2026-11-11)

The fun copy in the content files is read through the layer. `dialect-patches/31-callsites.py` wrote these calls from the
inventory; do not edit them by hand, change the line in the pack (`scratchpad/dialect/regions/*.txt`) or the def.

```js
// a string built when it is shown (row 3 of the key, 40 rows in all):
return DIALEKT.v("live.checkin", 3, { name: d.name, bar: d.bar }, "📺 {name} har landat på {bar}.", 40);
// a content array (same length, order and Array type; each element is read through v() when it is read):
bpTooFar: DIALEKT.list("loc.far", ["📍 Du är för långt bort…", "…"], { n: 10 }),
// a game deck: one key per card ({i} = the index), or a card made of parts ("MODES|text|end|N"):
white: DIALEKT.list("spel.white.{i}", ["…", "…"]),
// a string property: a getter, so it is read when it is used
get bpOwnerMine() { return DIALEKT.v("bar.owner.mine", 0, null, "Det är ni! Håll krogen."); },
```

- `v(key, row, vars, def, n)`: the region packs in `chain()` order, then `def`. The `sv-neutral` pack is NOT read: the def
  IS the neutral line (plain Swedish). So Dialekt **Av**, a neutral area, "no pack yet" and "pack failed" all give the def.
- `{mix: p}` in a region value: the def shows exactly `p` of the time (hash of key + row + night). No `{mix}` = always the
  region line (game cards, Dalarna).
- `sv-dalarna` holds today's lines in the inventory order. When its list is as long as the call site's `n`, row i = line i
  (Dalarna users see the app as before).
- `vars` null = the raw line (the caller fills its own `{x}`). With `vars`, only those are filled; a region line that needs
  a var the call site does not pass is skipped.
- UI text (buttons, errors, rules, privacy, 112 / safety / taxi) is not dialect. It is plain Swedish in the code.

### Loading

- `index.html` loads only `dialekt.js` (before `i18n.js`). The packs are NOT `<script>` tags.
- After the load event + one idle slot, `dialekt.js` adds `./js/dialekt-packs/<region>.js`, then `<region>-lek.js`.
  Only the user's region; nothing for Av or a neutral area. A new region later (the user moves) loads that file then.
- `sw.js` `DATA_RE` lists `js/dialekt-packs/*` (not `*-neutral*`): stale-while-revalidate in `olnu-data`, so the next
  start and offline use the cached pack.
- A loaded pack fires `dialekt:change`; `app.js` then rebuilds the LIVE ticker queue. Other surfaces read the new lines
  the next time they render.
