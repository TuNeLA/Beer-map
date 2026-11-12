# Quality guard layer 1

Run: `node tests/quality/check.mjs .` (about 3 s, node only). CI job `quality` runs it.
Baseline: `quality-baseline.json` = today's problems. It may only shrink.
Fix a problem: fix the code, then run `node tests/quality/check.mjs . --shrink` and commit the baseline.
Never add an entry by hand. If a new entry is really needed, the owner decides.
Output: `report.json` (also uploaded by CI as an artifact).
