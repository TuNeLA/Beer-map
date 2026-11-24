// mapcrowd2: the bars list the e2e tests see = the frozen copy tests/e2e/fixtures/bars.json (serve.py serves it as /bars.json).
// A test that reads bars.json from disk uses this path, so it reads the same list as the page. PN_LIVE_DATA=1 = the real file.
const fs = require("fs"), path = require("path");
const FIX = path.join(__dirname, "fixtures", "bars.json");
function barsJsonPath(docsDir) {
  if (process.env.PN_LIVE_DATA !== "1" && fs.existsSync(FIX)) return FIX;
  return path.join(docsDir || path.join(__dirname, "..", "..", "docs"), "bars.json");
}
module.exports = { barsJsonPath, FIX };
