# tests/e2e – PintsNow regression suite

Playwright scripts (plain Node, no test runner). Supabase is **mocked** in the browser, so the gating tests never write to live.

## Run locally

```sh
npm ci && npx playwright install chromium          # once, from the repo root
python3 -m http.server --directory docs 8793 &      # map tests
python3 -m http.server --directory docs 8871 &      # UI tests
bash tests/e2e/run-all.sh 8793 8871                 # all; or a 3rd arg = name regex, e.g. '^(ux3|strip)$'
```

Logs: `tests/e2e/out/logs/` (git-ignored). Screenshots: `tests/e2e/out/`.

## Groups

| Group | Tests | In CI |
|---|---|---|
| UI (mocked Supabase) | ux3, social2, strip, av2-wizard, feat, nf, notif, cam, evx, safe, ds, ds-layout | **gating** |
| UI, newer | ds-sheet (DESIGN.md sheet rules), autoci (auto check-in; runs when `docs/js/autoci.js` exists) | **gating** |
| Unit | notif-sw (`notif-sw-test.js`), `scripts/import-sport.test.mjs` | **gating** |
| Map (Mapbox GL) | glmap, tiers2, tiers3, map4, glfix-avpins, zones, mbx | **optional**: needs secret `MAPBOX_TEST_TOKEN`, else "skip" |
| Live (real Supabase, real users) | beta-pw.js, speed-pw.js | **never** in CI. Run by hand only |

## Env vars

- `MAPBOX_TEST_TOKEN` – Mapbox token for the map tests. The map tests load the page as `https://tunela.github.io/Beer-map/`,
  so a URL-restricted token must allow that URL.
- `PW_CHROMIUM_PATH` – optional Chromium binary (default: the Playwright one).
- `TEST_OUT` – optional output folder (default `tests/e2e/out/`).
- `TO` – timeout per test in seconds (default 900).

No secrets are stored in these files. `fixtures/photo-mid.jpg` is a generated noise image.
