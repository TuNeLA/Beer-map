// Add one e2e shard line to tests/e2e/shards.txt (idempotent): node scripts/ci/add-shard.mjs <name> '<regex>' [browsers...]
import { readFileSync, writeFileSync } from "node:fs";
import { parseShards } from "./plan.mjs";
const [name, filter, ...br] = process.argv.slice(2);
if (!name || !filter) { console.error("usage: node scripts/ci/add-shard.mjs <name> '<regex>' [browsers...]"); process.exit(2); }
if (!/^[A-Za-z0-9_-]+$/.test(name)) { console.error("bad name (letters, digits, - _ only)"); process.exit(2); }
const f = new URL("../../tests/e2e/shards.txt", import.meta.url), txt = readFileSync(f, "utf8");
if (parseShards(txt).some((s) => s.name === name)) { console.log("shard " + name + " exists: no change"); process.exit(0); }
const line = [name, filter, ...br].join(" ");
parseShards(txt + line + "\n");   // validates name and regex
writeFileSync(f, (txt.endsWith("\n") ? txt : txt + "\n") + line + "\n");
console.log("added: " + line);
