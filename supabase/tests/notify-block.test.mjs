// secaudit: notify-group mateNames must leave out blocked people (both ways). usage: node notify-block.test.mjs <index.ts>
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const src = readFileSync(process.argv[2], "utf8");
const a = src.indexOf("async function mateNames("), b = src.indexOf("async function subsOf(");
const code = "type Admin = any;\nexport " + src.slice(a, b).replace(/\nasync function dropBlocked/, "\nexport async function dropBlocked");
const tmp = join(mkdtempSync(join(tmpdir(), "nb-")), "m.ts"); writeFileSync(tmp, code);
const m = await import(pathToFileURL(tmp).href);
const T = { group_members: [ { group_id: "g", user_id: "V", display_name: "Vic" }, { group_id: "g", user_id: "K", display_name: "Klot" }, { group_id: "g", user_id: "M", display_name: "Mate" } ],
  user_blocks: [ { blocker: "V", blocked: "K", active: true } ] };
function q(rows) { const f = []; const o = { select() { return o; }, eq(c, v) { f.push((r) => r[c] === v); return o; }, neq(c, v) { f.push((r) => r[c] !== v); return o; },
  in(c, vs) { f.push((r) => vs.includes(r[c])); return o; }, or(s) { const [x, y] = s.split(","); const p = (t) => { const [c, , v] = t.split("."); return (r) => r[c] === v; }; const px = p(x), py = p(y); f.push((r) => px(r) || py(r)); return o; },
  then(res) { res({ data: rows.filter((r) => f.every((g) => g(r))), error: null }); } }; return o; }
const admin = { from: (t) => q(T[t] ?? []), rpc: async () => ({ data: [], error: null }) };
const v = await m.mateNames(admin, "V"), k = await m.mateNames(admin, "K");
const ok1 = !v.has("K") && v.has("M"), ok2 = !k.has("V") && k.has("M");
console.log(`V's pushes skip K (blocked), M kept|${ok1}|${[...v.keys()]}`);
console.log(`K's pushes skip V (blocked K), M kept|${ok2}|${[...k.keys()]}`);
process.exit(ok1 && ok2 ? 0 : 1);
