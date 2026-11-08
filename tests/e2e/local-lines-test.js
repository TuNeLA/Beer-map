// tx04 LOCAL LINES: Ludvika-area jokes only near Ludvika. Builds the LIVE ticker 400 times (one night, all hours) for a
// user whose position is in a town; no home town is set (the ticker uses the position). usage: node local-lines-test.js <docs/js>
const { execFileSync } = require("child_process");
const RE = /Väsman|Grangärde|Sunnansjö|Ulriksberg|Fredriksberg|Säfsnäs|Blötberget|Grängesberg|Nyhammar|Saxen|Brunnsvik|Ludvika|Smedjebacken/;
let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m, x === undefined ? "" : JSON.stringify(x).slice(0, 300)); if (!c) fail++; };
function run(town) { return execFileSync("node", [__dirname + "/news-sim.js", (process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : __dirname + "/../../docs/js"), town, "dump"], { encoding: "utf8", maxBuffer: 1 << 26 }); }
for (const town of ["Borlänge", "Stockholm", "Falun"]) {
  const lines = run(town).split("\n").filter((l) => l.startsWith("L\t")).map((l) => l.slice(2));
  const bad = lines.filter((t) => RE.test(t));
  ok(lines.length > 100 && !bad.length, town + ": no Ludvika-area line in " + lines.length + " ticker items", bad.slice(0, 3));
  if (town === "Borlänge") ok(lines.some((t) => /Borlänge|Domnarvet|Kupolen|Brage|Romme|Jussi/.test(t)), "Borlänge: local Borlänge lines do show");
}
const lv = run("Ludvika").split("\n").filter((l) => l.startsWith("L\t")).map((l) => l.slice(2));
ok(lv.some((t) => /Väsman|Grängesberg|Grangärde|Hitachi|Dan Andersson/.test(t)), "Ludvika: Ludvika-area lines still show near Ludvika");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
