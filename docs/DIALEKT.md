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
- `python3 scripts/dialekt-kommun.py` builds `docs/zones/dialekt-kommun.json` (kommuner, town aliases, a lat/lng grid).
  It prints the grid error rate. Hand fixes for towns go in its `FIX` table.
- New country = a new data file with its own `cc` and `lang`, added to `DATA` in `dialekt.js`, plus its packs.
