// 🔔 sw.js push/notificationclick unit test in a fake worker scope. Usage: node notif-sw-test.js <site-dir>
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync((process.argv[2] || "notif-site") + "/docs/sw.js", "utf8");
let pass = 0, fail = 0;
const ok = (n, c, i) => { console.log(c ? "PASS" : "FAIL", n, c ? "" : JSON.stringify(i)); c ? pass++ : fail++; };
const L = {}, shown = [], badges = [], opened = [];
const store = {};
const caches = { open: async () => ({ match: async (k) => (k in store ? { text: async () => store[k] } : undefined), put: async (k, r) => { store[k] = await r.text(); }, delete: async (k) => delete store[k] }), keys: async () => [], delete: async () => true, match: async () => undefined };
const notifs = [];
const self = {
  addEventListener: (t, f) => { L[t] = f; },
  registration: {
    scope: "https://pintsnow.example/",
    showNotification: async (title, opts) => { const i = notifs.findIndex((n) => n.tag === opts.tag); const n = { title, ...opts, close() { const j = notifs.indexOf(n); if (j >= 0) notifs.splice(j, 1); } }; if (i >= 0) notifs[i] = n; else notifs.push(n); shown.push(n); },
    getNotifications: async (o) => notifs.filter((n) => !o || !o.tag || n.tag === o.tag),
  },
  navigator: { setAppBadge: async (n) => badges.push(n) },
  clients: { matchAll: async () => [], openWindow: async (u) => opened.push(u) },
  skipWaiting: () => {}, location: { origin: "https://pintsnow.example" },
};
const ctx = { self, caches, Response: class { constructor(b) { this.b = String(b); } async text() { return this.b; } }, URL, Promise, setTimeout, clearTimeout, console, fetch: async () => ({}), Date, JSON, Math, Intl, isFinite, MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } } };
vm.createContext(ctx); vm.runInContext(src, ctx);
const fire = async (t, ev) => { let w = []; ev.waitUntil = (p) => w.push(p); L[t](ev); await Promise.all(w); };
const push = (d) => fire("push", { data: { json: () => d, text: () => JSON.stringify(d) } });
(async () => {
  const P = (b) => ({ title: "💬 Bosse: " + b, body: "i Gänget", url: "/?chat=g1", tag: "olnu-msg-g1", renotify: true,
    stack: { title: "💬 {n} nya i Gänget", line: "Bosse: " + b }, actions: [{ action: "reply", title: "💬 Svara", url: "/?chat=g1&reply=1" }] });
  await push(P("hej"));
  ok("1st chat push: own title, renotify (buzz)", shown[0].title === "💬 Bosse: hej" && shown[0].renotify === true && !shown[0].silent, shown[0]);
  ok("1st: reply button kept, url map in data", shown[0].actions[0].action === "reply" && shown[0].data.acts.reply === "/?chat=g1&reply=1", shown[0].data);
  await push(P("kommer ni?"));
  await push(P("La Parma!"));
  const n3 = shown[2];
  ok("3rd chat push folds: '💬 3 nya i Gänget'", n3.title === "💬 3 nya i Gänget", n3.title);
  ok("folded body has the 3 lines", n3.body.split("\n").length === 3 && /La Parma!$/.test(n3.body), n3.body);
  ok("2nd/3rd within 60 s are silent replaces", shown[1].silent === true && shown[1].renotify === false && n3.silent === true, [shown[1].silent, n3.silent]);
  ok("one notice on screen for the chat", notifs.filter((n) => n.tag === "olnu-msg-g1").length === 1);
  ok("badge counts 1,2,3", JSON.stringify(badges) === "[1,2,3]", badges);
  ok("PintsNow default title", (await push({ body: "x" }), shown[3].title === "PintsNow 🍺"   /* suite: v28 (6bdae73) short title, who/what first */), shown[3].title);
  // button with its own url
  await fire("notificationclick", { action: "reply", notification: { data: n3.data, close() {} } });
  ok("'💬 Svara' opens chat with reply=1", opened[0] === "https://pintsnow.example/?chat=g1&reply=1", opened);
  await push({ title: "🍺 Oskar är ute", body: "x", url: "/?focus=12", tag: "olnu-12-1", actions: [{ action: "coming", title: "🍺 Kommer!", url: "/?focus=12&act=coming" }, { action: "skal", title: "🍻 Skåla", url: "/?focus=12&act=skal" }] });
  const fo = shown[shown.length - 1];
  await fire("notificationclick", { action: "coming", notification: { data: fo.data, close() {} } });
  await fire("notificationclick", { action: "", notification: { data: fo.data, close() {} } });
  ok("'🍺 Kommer!' opens &act=coming; plain tap opens the pin", opened[1] === "https://pintsnow.example/?focus=12&act=coming" && opened[2] === "https://pintsnow.example/?focus=12", opened);
  // old behaviour: rally yes / invite answer
  await push({ title: "🪖 x", url: "/?rally=5", tag: "olnu-rally-5", rally_id: 5, actions: [{ action: "yes", title: "✅" }, { action: "no", title: "❌" }] });
  await fire("notificationclick", { action: "yes", notification: { data: shown[shown.length - 1].data, close() {} } });
  ok("rally yes unchanged", opened[3] === "https://pintsnow.example/?rally=5&answer=yes", opened[3]);
  await push({ title: "inv", url: "/?inv=9", tag: "olnu-inv-9", actions: [{ action: "yes", title: "✅ Kommer" }, { action: "no", title: "❌" }] });
  await fire("notificationclick", { action: "no", notification: { data: shown[shown.length - 1].data, close() {} } });
  ok("invite no unchanged", opened[4] === "https://pintsnow.example/?inv=9&ans=no", opened[4]);
  ok("a bad button url is ignored", (await push({ title: "t", url: "/?x=1", tag: "olnu-x", actions: [{ action: "a", title: "A", url: "https://evil.example/" }] }), !shown[shown.length - 1].data.acts.a));
  ok("SOS keeps requireInteraction", (await push({ title: "🆘", url: "/?sos=1,2", tag: "olnu-sos-1", sos: true }), shown[shown.length - 1].requireInteraction === true));
  // ---- ntf v2: log queue, face icon, image, timestamp, fold, Ikväll? buttons ----
  const q = () => JSON.parse(store["./__pnq"] || "[]");
  store["./__face/a980c8c7ce2e"] = "data:image/png;base64,iVBORw0KGgo=";
  const F = (n, b, id) => ({ title: n + " på " + b + " 🍺", body: "Sedan 21:04.", url: "/?focus=" + id, tag: "olnu-" + id + "-f1", k: "ute", v: "fo.1", ts: 1762547040000,
    face: "a980c8c7ce2e", fold: { key: "ute-2026-11-07", title: "{n} vänner ute ikväll 🍻", line: n + " · " + b + " · 21:04" },
    actions: [{ action: "coming", title: "🏃 Jag kommer", url: "/?focus=" + id + "&act=coming" }, { action: "skal", title: "🍻 Skål", url: "/?focus=" + id + "&act=skal" }] });
  await push(F("Lisa", "Pitchers", 71));
  let f1 = shown[shown.length - 1];
  ok("v2: face → icon is the cached avatar", f1.icon === "data:image/png;base64,iVBORw0KGgo=", f1.icon);
  ok("v2: timestamp = event time, tag = one per night", f1.timestamp === 1762547040000 && f1.tag === "olnu-fold-ute-2026-11-07", [f1.timestamp, f1.tag]);
  ok("v2: push.shown queued with kind + variant", q().some((x) => x.n === "push.shown" && x.k === "ute" && x.v === "fo.1"), q());
  await push({ ...F("Oskar", "Tegera", 72), face: "000000000000" });
  const f2 = shown[shown.length - 1];
  ok("v2: 2nd friend folds into ONE notice '2 vänner ute ikväll 🍻'", f2.title === "2 vänner ute ikväll 🍻" && notifs.filter((n) => n.tag === "olnu-fold-ute-2026-11-07").length === 1, f2.title);
  ok("v2: folded body lists both, newest last", /Lisa · Pitchers · 21:04\nOskar · Tegera · 21:04$/.test(f2.body), f2.body);
  ok("v2: folded notice opens the map, no per-friend buttons", f2.data.url === "/" && (!f2.actions || f2.actions.length === 0), f2.data);
  ok("v2: unknown face → app icon", /icon-192/.test(f2.icon), f2.icon);
  await push({ title: "Gårdagens film är framkallad 📸", body: "3 bilder", url: "/?film=g1", tag: "olnu-film-g1", k: "film", v: "fi.1", image: "./icons/ntf-film.png?v=1" });
  ok("v2: film image (own icons only)", shown[shown.length - 1].image === "./icons/ntf-film.png?v=1");
  await push({ title: "x", url: "/", tag: "olnu-x2", k: "kul", v: "a", image: "https://evil.example/a.png" });
  ok("v2: a foreign image is ignored", !shown[shown.length - 1].image);
  await push({ title: "Bosse och Cecilia ska ut ikväll", body: "Hänger du med?", url: "/?ikvall=1", tag: "olnu-ikvall-2026-11-07", k: "ikvall", v: "ik.1",
    actions: [{ action: "ute", title: "🍺 Jag kommer", url: "/?ikvall=1&st=ute" }, { action: "kanske", title: "🤔 Kanske", url: "/?ikvall=1&st=kanske" }] });
  const ik = shown[shown.length - 1];
  const before = opened.length;
  await fire("notificationclick", { action: "ute", notification: { data: ik.data, close() {} } });
  ok("v2: Ikväll? '🍺 Jag kommer' opens ?ikvall=1&st=ute", opened[before] === "https://pintsnow.example/?ikvall=1&st=ute", opened[before]);
  ok("v2: push.action queued (k ikvall, a ute, hour)", q().some((x) => x.n === "push.action" && x.k === "ikvall" && x.a === "ute" && x.h >= 0 && x.h <= 23), q().slice(-1));
  await fire("notificationclick", { action: "", notification: { data: f2.data, close() {} } });
  ok("v2: plain tap queues push.open", q().some((x) => x.n === "push.open" && x.k === "ute"), q().slice(-1));
  ok("v2: old payloads (no k) are not logged", !q().some((x) => x.k === ""));
  for (let i = 0; i < 70; i++) await push({ title: "t" + i, url: "/", tag: "olnu-z" + i, k: "kaos", v: "k" });
  ok("v2: the queue keeps max 60", q().length === 60, q().length);
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
