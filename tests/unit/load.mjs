// Tiny loader for the unit tests: runs the REAL docs/ code in a vm sandbox. Nothing is copied.
//   loadScript("js/util.js", extra)  -> runs a whole file with a stub window, returns the window
//   loadFunctions(["crowdSort"], scope) -> finds each "function name(" in docs/app.js or docs/js/*.js (so it still works
//                                          after the app.js split), runs it in a sandbox, returns the functions
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), "utf8");

function stubWindow(extra) {
  const store = {};
  const w = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    addEventListener() {}, removeEventListener() {}, location: { href: "http://x/", search: "", pathname: "/", hash: "" },
    document: { addEventListener() {}, visibilityState: "visible", documentElement: { lang: "sv" } },
    navigator: { language: "sv-SE" }, console,
  };
  w.window = w; w.self = w; w.globalThis = w;
  return Object.assign(w, extra || {});
}

export function loadScript(rel, extra) {
  const w = stubWindow(extra);
  vm.runInNewContext(read(rel), vm.createContext(w), { filename: rel });
  return w;
}

// source of "function name(...) { ... }" by balanced braces (skips strings, comments; a regex literal with a lone brace is not supported)
export function functionSource(src, name) {
  const m = new RegExp("(^|[^\\w$.])function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  let i = m.index + m[1].length, depth = 0, started = false;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; continue; }
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

export function findFunction(name) {
  const files = ["app.js"].concat(fs.readdirSync(path.join(DOCS, "js")).filter((f) => f.endsWith(".js")).map((f) => "js/" + f));
  for (const f of files) { const s = functionSource(read(f), name); if (s) return { file: f, src: s }; }
  throw new Error("function " + name + " not found in docs/");
}

export function loadFunctions(names, scope) {
  const ctx = vm.createContext(Object.assign({ console }, scope || {}));
  const where = {};
  for (const n of names) { const f = findFunction(n); where[n] = f.file; vm.runInContext(f.src, ctx, { filename: f.file }); }
  const out = {}; names.forEach((n) => { out[n] = ctx[n]; });
  out.ctx = ctx; out.where = where;
  return out;
}
