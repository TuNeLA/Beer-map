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
