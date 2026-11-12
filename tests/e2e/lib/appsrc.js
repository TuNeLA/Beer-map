// W2 app.js split: the app's own source = docs/app.js + docs/js/app-*.js (SPLIT-SPEC 2.6). A test that greps the app source
// text uses appSrc(page) (all files, joined) or appFiles() (the file names, app.js first), never fetch("app.js") alone.
const fs = require("fs"), path = require("path");
const DOCS = path.join(__dirname, "../../../docs");
function appFiles() {
  return ["app.js"].concat(fs.readdirSync(path.join(DOCS, "js")).filter((f) => /^app-[a-z]+\.js$/.test(f)).sort().map((f) => "js/" + f));
}
async function appSrc(page) {
  return page.evaluate((files) => Promise.all(files.map((f) => fetch(f).then((r) => r.text()))).then((a) => a.join("\n")), appFiles());
}
module.exports = { appFiles, appSrc };
