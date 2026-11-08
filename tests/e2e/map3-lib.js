// map3 helpers: a page served as https://tunela.github.io/Beer-map/ (token origin), Mapbox load counting.
const H = require("./d2-helpers.js");
const fs = require("fs");
const SP = require("./env.js").OUT;
const TOKEN = require("./env.js").MAPBOX_TOKEN; // from env MAPBOX_TEST_TOKEN, never hard-coded
const CHROME = require("./env.js").CHROME;
const LOADLOG = SP + "map3-mbloads.log";
function launchOpts(extra) {
  return { executablePath: CHROME, ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "<-loopback>,127.0.0.1,localhost" } } : {}), args: ["--ignore-certificate-errors"].concat(extra || []) };
}
async function ghPage(b, port, o = {}) {
  const { ctx, page } = await H.ctxFor(b, o.vp || { width: 412, height: 915 }, o);
  if (o.style) await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem("m3")) { sessionStorage.setItem("m3", 1); localStorage.setItem("olnu.mapStyle", s); } } catch (e) {} }, o.style);
  await page.route(/rest\/v1\/rpc\/public_config/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, mapbox_token: o.noToken ? "" : TOKEN }) }));
  await page.route(/^https:\/\/tunela\.github\.io\/Beer-map\//, async (r) => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/Beer-map\//, "/"); if (p === "/") p = "/index.html";
    const res = await fetch("http://127.0.0.1:" + port + p + u.search);
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") || "text/html" } });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("https://tunela.github.io/Beer-map/");
  await page.waitForFunction(() => window.__map && document.querySelectorAll(".pill").length > 3, null, { timeout: 30000 }).catch(() => console.log("no pills"));
  return { ctx, page, errs };
}
async function closeCounted(ctx, page, tag) {
  let n = 0; try { n = await page.evaluate(() => (window.BASEMAP && BASEMAP.mapboxLoads()) || 0); } catch (e) {}
  if (n) fs.appendFileSync(LOADLOG, new Date().toISOString() + " " + tag + " " + n + "\n");
  await ctx.close();
  return n;
}
function totalLoads() { try { return fs.readFileSync(LOADLOG, "utf8").trim().split("\n").filter(Boolean).reduce((s, l) => s + (+l.split(" ").pop() || 0), 0); } catch (e) { return 0; } }
module.exports = { H, TOKEN, launchOpts, ghPage, closeCounted, totalLoads, SP };
