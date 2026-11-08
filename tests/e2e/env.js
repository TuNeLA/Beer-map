// Shared settings for the e2e suite. No secrets in this file: everything comes from env vars.
//   PW_CHROMIUM_PATH   optional: a Chromium binary. Empty = the one "npx playwright install chromium" put in place.
//   TEST_OUT           optional: where screenshots and logs go (default tests/e2e/out/, git-ignored).
//   MAPBOX_TEST_TOKEN  optional: Mapbox token for the map tests. Empty = map tests are skipped by run-all.sh.
const fs = require("fs"), path = require("path");
const OUT = (process.env.TEST_OUT || path.join(__dirname, "out")).replace(/\/?$/, "/");
for (const d of ["", "ui-testshots", "ds-shots/test", "ds-shots/sheets", "nf-shots", "feat-shots", "beta-shots", "logs"]) fs.mkdirSync(OUT + d, { recursive: true });
module.exports = {
  OUT,
  FIX: path.join(__dirname, "fixtures") + "/",
  CHROME: process.env.PW_CHROMIUM_PATH || undefined,
  MAPBOX_TOKEN: process.env.MAPBOX_TEST_TOKEN || "",
};
