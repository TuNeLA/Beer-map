# tests/e2e – PintsNow regression suite

Playwright scripts (plain Node, no test runner). Supabase is **mocked** in the browser, so the gating tests never write to live.
Anything that is not mocked goes to the **staging** project (`pintsnow-staging`), not to live: see "Supabase target" below.

## Run locally

```sh
npm ci && npx playwright install chromium          # once, from the repo root
python3 tests/e2e/serve.py 8793 docs &              # map tests   (PN_TARGET=staging is the default)
python3 tests/e2e/serve.py 8871 docs &              # UI tests
bash tests/e2e/run-all.sh 8793 8871                 # all; or a 3rd arg = name regex, e.g. '^(ux3|strip)$'
```

Logs: `tests/e2e/out/logs/` (git-ignored). Screenshots: `tests/e2e/out/`.

## Groups

| Group | Tests | In CI |
|---|---|---|
| UI (mocked Supabase) | ux3, social2, strip, av2-wizard, feat, nf, notif, cam, evx, safe, ds, ds-layout | **gating** |
| UI, newer | ds-sheet (DESIGN.md sheet rules), autoci (auto check-in; runs when `docs/js/autoci.js` exists) | **gating** |
| Mock cover | rpc-cover (`rpc-cover-pw.js`): opens the main screens and fails when the app calls an RPC the mock does not answer | **gating** |
| Unit | notif-sw (`notif-sw-test.js`), `scripts/import-sport.test.mjs` | **gating** |
| UI, ntf v2 | ntf (`ntf-pw.js`: notification settings v2, priming, in-app feed, deep links, log drain, real sw.js push + notificationclick) | **gating** |
| Map (Mapbox GL) | glmap, tiers2, tiers3, map4, glfix-avpins, zones, mbx | **optional**: needs secret `MAPBOX_TEST_TOKEN`, else "skip" |
| Real server (fresh anonymous users) | beta-pw.js | **never** in CI. By hand only. Serve with `serve.py --cors` (staging by default) |
| Probe (mocked) | speed-pw.js | not gating, by hand |

## Shared mock answers

`d2-helpers.js` / `ds-helpers.js` answer the old RPCs in their switch and every other main-screen RPC from
`fixtures/rpc.js` (one calm night in Ludvika: group members, friends, a fresh film, a game lobby). A test's own
`page.route` wins. An RPC nobody answers gets `[]` and is recorded (`unmocked(page)`); `rpc-cover-pw.js` fails on it.
When the app starts to call a new RPC: add its answer to `fixtures/rpc.js`, in the shape its reader in `docs/js` expects.

## Supabase target (one switch)

`PN_TARGET=staging` (default) or `PN_TARGET=live`. Set it for **both** `serve.py` and `run-all.sh`.

- `serve.py` serves `docs/` and rewrites only the **served** `config.js` (SUPABASE_URL + anon key of `pintsnow-staging`).
  The file `docs/config.js` in git is not changed. The response header `X-PN-Target` says the target.
- `run-all.sh` stops (exit 2) if a port serves a `config.js` for another project. A plain `python3 -m http.server`
  serves the live config, so it is refused when `PN_TARGET=staging`.
- Staging data: `supabase/staging-seed/seed.sql` (safe to run again). Load it with the Supabase SQL editor or MCP `execute_sql`
  on the staging project only.

## Env vars

- `PN_TARGET` – `staging` (default) or `live`. See above.
- `MAPBOX_TEST_TOKEN` – Mapbox token for the map tests. The map tests load the page as `https://tunela.github.io/Beer-map/`,
  so a URL-restricted token must allow that URL.
- `PW_CHROMIUM_PATH` – optional Chromium binary (default: the Playwright one).
- `TEST_OUT` – optional output folder (default `tests/e2e/out/`).
- `TO` – timeout per test in seconds (default 900).

No secrets are stored in these files. `fixtures/photo-mid.jpg` is a generated noise image.
