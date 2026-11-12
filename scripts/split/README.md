# scripts/split — app parts tooling

## Guards (what CI runs)
- `bash scripts/split/ci.sh [before-sha]` is the CI entry (job `unit`, step "split guard").
- ALWAYS: `move.mjs . --check` and `verify.mjs --structure`. They are valid for normal edits. They check:
  PN.s fields and writers = `scripts/split/plan.json` (`state.<field>.writers`), generated headers + index.html tags in sync,
  `node --check` of every part, load-order hazards of the current tree, listener order of old code (SPEC 4.4 pairs allowed).
- ONLY for a move commit (subject starts with `W2 step`, or it changes `scripts/split/steps/`): `verify.mjs --base <parent>`.
  This is the move-only proof (names, statements and comments byte-equal). A normal commit never runs it.
- Quality guard: `node tests/quality/check.mjs .`. The top-level module wrapper `(function () { ... })()` is not counted as a function.

## Lane guide: how to work in the new structure
1. App code lives in `docs/js/app-<area>.js` (14 parts). `docs/app.js` = boot only (start, routeOpen, appApi). Do not add features to app.js.
2. Pick the part by job: net=RPC, ui=toast/sheet/el, map=map/heat/locate, pins=markers/bar sheet, checkin, ticker=LIVE+kaos,
   crowd=Skal+crowd, hud=counts/my night, poll=live poll, beer=OL! flow, account=sign-in/flytt/intro, groups, settings.
3. Never edit between `<split:imports>` ... `</split:imports>`, `<split:core>` or `<split:put/>`. They are generated.
4. Find the real function: `grep -n "function NAME(" docs/js/app-*.js | grep -v "return PN\."` (other hits are stubs).
5. Call a function of another part: call it by name, then run `node scripts/split/move.mjs . --regen` (adds stub + export).
6. Shared mutable state = `PN.s.name` only. Only the writer parts in plan.json may assign it.
   New writer or new field: add it to `scripts/split/plan.json` `state.<name>` on purpose (the guard tells you where). Say so in the commit message.
7. Load time: core, net, ui load before map. A part may use another part at load time only if it loads earlier. The guard fails on a hazard.
8. New part: add it to plan.json order + purpose, create the file with the template (SPLIT-SPEC 1.6), run `move.mjs --regen` (adds the index.html tag).
9. A new module (not a part): one line after `window.NAME = ...`: `if (window.PN) PN.mod("NAME");`. Never edit the BASE list in pn.js.
10. Never write `?v=` or a sw.js VERSION by hand. The deploy stamps (scripts/stamp.mjs).
11. Before delivery run: `node scripts/split/move.mjs . --regen` (if you added a call to another part) then
    `bash scripts/split/ci.sh` (needs `npm i --no-save acorn@8.12.1`, full git history) - `node tests/quality/check.mjs .` -
    `node --test "tests/unit/*.test.mjs"` - `node scripts/ci/stamp-guard.mjs docs` - the e2e shards for your part.
12. Quality fails on a grown or new legacy item (a function over 150 lines, a part over its size limit): shrink it. Never hand-edit
    `quality-baseline.json`; only `check.mjs . --shrink` (lowers or removes entries).

## Recipes (copy these steps)
Where the data lives: `scripts/split/plan.json` = `order` (load order of parts), `purpose` (one line per part), `state` (every PN.s field:
`start`, `writers`, `readers`, `step`), `stays`, `sections`. `scripts/split/steps/step-N.json` = the W2 move commits (history; a normal lane never
edits a step file and never adds one: a step file makes CI run the move-only proof `verify.mjs --base`, which a normal edit fails).
Generated, never hand-edited: `<split:imports>` (stubs, one line per call of another part), `<split:core>` (PN.put / PN.link / PN.s), every
`// <split:put/>` line, the `<script>` part tags in docs/index.html. A stub is NOT the function: edit the real one (see 4 above).
- Cheap check after any edit: `node scripts/split/move.mjs . --check` (blocks in sync?) then `node scripts/split/verify.mjs --structure`.
- A guard message names the file and the plan.json key to change. Fix what it names; do not silence it.

### A. Add a PN.s field (new shared state)
1. Add the line in the `PN.s = { ... }` block of docs/js/app-core.js: `name: <literal start>,   // what it is`. Only a literal start value
   (null, false, 0, "", [], {}, a number, a string) is allowed there. A start value that is computed: set it in the writer part at load time.
2. Add `state.name` in plan.json: `{ "start": "<same literal as text>", "writers": ["part", ...], "readers": ["part", ...], "step": <last step number> }`.
   `start` must equal the literal in app-core.js (as source text). `writers` = parts that assign `PN.s.name = ...`, `.push` / `++` count as writes.
   `readers` = parts that only read.
3. Use it as `PN.s.name` in the parts (never a bare `name`, never a copy in a local var).
4. `node scripts/split/move.mjs . --check` and `verify.mjs --structure`. Say in the commit message: "new PN.s.name, writers X".

### B. Add a writer (a part that assigns an existing field)
1. Make the assignment `PN.s.name = ...` in the part.
2. Add that part to `state.name.writers` in plan.json (keep the list short: a field with many writers is the shared-state hub risk; prefer a
   setter function in the owner part and call it from the other part, then run `--regen` so the stub is made).
3. Run the 2 guard commands. Write the new writer in the commit message.

### C. Add a part (a new docs/js/app-<name>.js)
1. Pick a load position. A part may use another part at load time only if it loads earlier (core, net, ui before map). Prefer a late position.
2. plan.json: add `<name>` to `order` (before `"app"`) and one line to `purpose`.
3. Create docs/js/app-<name>.js with the template of an existing small part: first line `/* PintsNow app part: <purpose>. ... */`, then
   `(function () {`, `"use strict";`, `var PN = window.PN;`, your code, `})();`. Keep it under the quality size limit (tests/quality: 600 lines).
4. `node scripts/split/move.mjs . --regen` writes the `<split:imports>` block, the `PN.put` lines and the `<script>` tag in docs/index.html.
5. Run: `bash scripts/split/ci.sh` - `node tests/quality/check.mjs .` - `node --test "tests/unit/*.test.mjs"` - `node scripts/ci/stamp-guard.mjs docs`.
6. Add a unit test in tests/unit/parts.test.mjs for its pure functions (loader: `loadFunctions(["name"], { ...scope })` in tests/unit/load.mjs).

### D. Export a name to other parts / modules
- A function or constant that another part calls: just call it by name there, then `move.mjs . --regen` (stub + `PN.put` line are generated).
- `PN.put` refuses these names: `mod hookNames hookList reserved putBad s put link load` (list = `PN.reserved` in docs/js/pn.js). Dev, tests and localhost
  throw; production logs `console.error` and skips the name. Rename your export. Single-letter names on PN today: `$ U I t`.
- A new module in docs/js/ (not a part): after `window.NAME = ...` add `if (window.PN) PN.mod("NAME");`.

### E. Lazy scripts
Load a lazy file with `PN.load(src)` (docs/js/boot.js), never with your own `createElement("script")`. The src must carry the deploy stamp:
take it from an index.html tag (`<script type="text/x-lazy" src="./js/x.js">` is read by party / spel / forfest; filmfx uses `stampedSrc`), or the file
is loaded unversioned and an old copy can run for up to 10 minutes (GitHub Pages max-age) after a deploy. Never write `?v=` by hand.

