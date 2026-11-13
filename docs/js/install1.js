/* PintsNow — "Installera appen" (S5, lane main, 2026-11-10; owner: "the install guide FIRST, on iPhone AND Android, before
   any beer, with a small 'Fortsätt utan att installera' link; shown once more on the 2nd night if they continued").
   ONE rule for the whole install flow (was 4 paths: this card for in-app browsers only, pnui after the 1st beer / a group
   join, a daily sheet and a top banner):
     1st open   (not installed, intro not done, no invite card / deep link, a phone) → this guide BEFORE the intro
     2nd night  (they tapped "Fortsätt utan att installera", and it is a later night, 05:00 → 05:00) → the guide once more
     then       never by itself; Inställningar → "Lägg PintsNow på hemskärmen" stays for anyone who wants it.
   iPhone   Dela → Lägg till på hemskärmen → Lägg till (iOS 26: ⋯ → Dela first) + one line: push only works when installed.
   Android  beforeinstallprompt → ONE primary "Installera appen" (prompt() in the tap); no event yet → ⋮ → Installera app
            → Installera (Samsung Internet: ≡ → Lägg till sida på → Startskärm); a later event switches to the button.
   In-app   (Instagram, Messenger …) → open in Safari/Chrome + Kopiera länk. Desktop (only via show()): the QR code.
   app.js waits for INSTALL1.gate() after JOIN.gate(), so the intro (age, location) runs inside the installed app.
   localStorage olnu.inst1 = {n: times shown, k: night key, how: open|skip|done}. An old timestamp value = shown, no re-show.
   While the flow owns the device (owns()), pnui's later prompts, the daily install sheet and the top banner stay quiet.
   Copy: DIALEKT keys "inst.*" (sv-neutral pack registered here). Styles: pnds.css "lane:main" (.mn-inst-*), tokens only.
   Public: window.INSTALL1 = { gate, kind, show, owns, state, _close }. */
(function () {
  "use strict";
  var U = window.U;
  var KEY = "olnu.inst1";
  var prompt = null, installed = false, root = null, act = null, resolveGate = null, cur = null;
  var P = {
    "inst.title": "Installera appen",
    "inst.lead": "Då startar PintsNow som en riktig app, och du får notiser när gänget drar ut. Tar 10 sekunder.",
    "inst.lead2": "Andra kvällen! På hemskärmen startar appen snabbare, och du missar inga notiser.",
    "inst.ios1": "Tryck på {i} Dela", "inst.ios1s": "Nere i mitten av Safari",
    "inst.ios1n": "Tryck på {i} nere till höger", "inst.ios1ns": "Sen på Dela",
    "inst.ios2": "Välj {i} Lägg till på hemskärmen", "inst.ios2s": "Scrolla ner i listan om du int' ser den",
    "inst.ios3": "Tryck Lägg till", "inst.ios3s": "Öppna sen PintsNow från hemskärmen",
    "inst.iospush": "På iPhone kommer notiser bara när appen ligger på hemskärmen.",
    "inst.and1": "Tryck på {i} uppe till höger", "inst.and1s": "Menyn i Chrome",
    "inst.and2": "Välj {i} Installera app", "inst.and2s": "Eller Lägg till på startskärmen",
    "inst.and3": "Tryck Installera", "inst.and3s": "Öppna sen PintsNow från startskärmen",
    "inst.sam1": "Tryck på {i} nere till höger", "inst.sam1s": "Menyn i Samsung Internet",
    "inst.sam2": "Välj {i} Lägg till sida på", "inst.sam2s": "Sen Startskärm",
    "inst.sam3": "Tryck Lägg till", "inst.sam3s": "Öppna sen PintsNow från startskärmen",
    "inst.btn": "Installera appen", "inst.btns": "Ett tryck, sen ligger den på startskärmen.",
    "inst.done": "Klart! PintsNow ligger på hemskärmen.", "inst.dones": "Öppna appen därifrån. Du kan stänga den här fliken.",
    "inst.inapp": "Den här appen kan int' installera PintsNow. Öppna länken i {b}:",
    "inst.inapp1": "Tryck på {i} uppe i hörnet", "inst.inapp2": "Välj Öppna i webbläsaren",
    "inst.copy": "Kopiera länk", "inst.copied": "Kopierad!",
    "inst.desk": "PintsNow bor i mobilen", "inst.deskp": "Skanna koden med mobilkameran. Funkar på iPhone och Android.",
    "inst.skip": "Fortsätt utan att installera"
  };
  try { if (window.DIALEKT && window.DIALEKT.register) window.DIALEKT.register("sv-neutral", P); } catch (e) {}
  function T(k, v) { try { if (window.DIALEKT && window.DIALEKT.t) return window.DIALEKT.t(k, v || {}, P[k]); } catch (e) {} return String(P[k] || k).replace(/\{(\w+)\}/g, function (m, n) { return v && v[n] != null ? v[n] : ""; }); }
  function ua() { return navigator.userAgent || ""; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function standalone() { try { return U && U.isStandalone ? U.isStandalone() : false; } catch (e) { return false; } }
  function isIOS() { try { return U && U.isIOS ? U.isIOS() : /iPad|iPhone|iPod/.test(ua()); } catch (e) { return false; } }
  function inApp() { return /FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|Messenger|TikTok|musical_ly|LinkedInApp|Twitter|; wv\)/i.test(ua()); }
  function kind() {
    if (inApp()) return "inapp";
    if (isIOS()) return "ios";
    if (/Android/i.test(ua())) return "android";
    if (/Mobi/i.test(ua())) return "android";
    return "desktop";
  }
  function nightKey() {   // the app's night: 05:00 → 05:00 (Stockholm), same as fx.js
    try { if (U && U.next5am) return U.next5am().toISOString().slice(0, 10); } catch (e) {}
    return new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  }
  function state() {
    var v = lsGet(KEY); if (!v) return null;
    try { var o = JSON.parse(v); if (o && typeof o === "object") return o; } catch (e) {}
    return { n: 2, how: "old" };   // the old value (a timestamp): shown before, never again by itself
  }
  function save(o) { lsSet(KEY, JSON.stringify(o)); }
  function appLink() { return location.origin + location.pathname; }
  window.addEventListener("beforeinstallprompt", function (e) { try { e.preventDefault(); } catch (x) {} prompt = e; if (root) render(); });
  window.addEventListener("appinstalled", function () { installed = true; prompt = null; mark("done"); if (root) render(); });

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k]; else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var MENU = '<svg class="pi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';   // Samsung Internet ≡ (a picture of the phone's button)
  var PLUSSQ = '<svg class="pi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/></svg>';   // iOS "Lägg till på hemskärmen"
  function ic(name, cls) { if (name === "menu") return MENU; if (name === "plussq") return PLUSSQ; try { return window.PNI ? window.PNI.svg(name, cls || "") : ""; } catch (e) { return ""; } }
  // "Tryck på {i} Dela" → text + an icon tile that looks like the phone's own button
  function withIcon(key, icon, iconCls) {
    var parts = T(key, { i: "\u0001", b: "" }).split("\u0001"), b = h("b", { class: "mn-inst-st" });
    b.appendChild(document.createTextNode(parts[0] || ""));
    if (parts.length > 1 && icon) { b.appendChild(h("span", { class: "mn-inst-key" + (iconCls ? " " + iconCls : ""), "aria-hidden": "true", html: ic(icon) })); b.appendChild(document.createTextNode(parts.slice(1).join(""))); }
    return b;
  }
  function step(n, key, icon, sub, iconCls) {
    return h("li", { class: "mn-inst-step" }, [h("span", { class: "mn-inst-n", "aria-hidden": "true", text: String(n) }),
      h("span", { class: "mn-inst-tx" }, [withIcon(key, icon, iconCls), sub ? h("small", { text: T(sub) }) : null])]);
  }
  function steps(list) { var ol = h("ol", { class: "mn-inst-steps" }); list.forEach(function (s, i) { ol.appendChild(step(i + 1, s[0], s[1], s[2], s[3])); }); return ol; }
  function primary(text, fn) { return h("button", { type: "button", class: "ds-btn ds-btn-primary ds-btn-block mn-inst-go", text: text, onclick: fn }); }

  function render() {
    if (!act) return;
    act.innerHTML = "";
    var k = kind();
    if (root) root.className = "mn-inst mn-inst-" + k;
    if (installed) {
      act.appendChild(h("div", { class: "mn-inst-done", role: "status" }, [h("span", { class: "mn-inst-done-i", html: ic("check") }),
        h("span", { class: "mn-inst-tx" }, [h("b", { text: T("inst.done") }), h("small", { text: T("inst.dones") })])]));
      return;
    }
    if (k === "android" && prompt) {
      act.appendChild(primary(T("inst.btn"), function () {
        var p = prompt; if (!p) return;
        try { p.prompt(); } catch (e) {}
        Promise.resolve(p.userChoice).catch(function () {}).then(function (c) {
          prompt = null;
          if (c && c.outcome === "accepted") { installed = true; mark("done"); }
          render();
        });
      }));
      act.appendChild(h("p", { class: "mn-inst-sub", text: T("inst.btns") }));
      return;
    }
    if (k === "android") {
      act.appendChild(/SamsungBrowser/i.test(ua())
        ? steps([["inst.sam1", "menu", "inst.sam1s"], ["inst.sam2", "plus", "inst.sam2s"], ["inst.sam3", null, "inst.sam3s"]])
        : steps([["inst.and1", "dots", "inst.and1s", "mn-inst-key-v"], ["inst.and2", "download", "inst.and2s"], ["inst.and3", null, "inst.and3s"]]));
    } else if (k === "ios") {
      var v26 = /OS 26_|Version\/26/.test(ua());
      act.appendChild(steps([v26 ? ["inst.ios1n", "dots", "inst.ios1ns"] : ["inst.ios1", "share", "inst.ios1s"], ["inst.ios2", "plussq", "inst.ios2s"], ["inst.ios3", null, "inst.ios3s"]]));
      act.appendChild(h("p", { class: "mn-inst-push" }, [h("span", { class: "mn-inst-push-i", "aria-hidden": "true", html: ic("bell") }), h("span", { text: T("inst.iospush") })]));
      if (root && !root.querySelector(".mn-inst-arrow")) root.appendChild(h("span", { class: "mn-inst-arrow" + (v26 ? " mn-inst-arrow-r" : ""), "aria-hidden": "true", html: ic("chev-down") }));
    } else if (k === "inapp") {
      var and = /Android/i.test(ua());
      act.appendChild(h("p", { class: "mn-inst-sub", text: T("inst.inapp", { b: and ? "Chrome" : "Safari" }) }));
      act.appendChild(steps([["inst.inapp1", "dots", null], ["inst.inapp2", null, null]]));
      act.appendChild(primary(T("inst.copy"), function (e) {
        var b = e.currentTarget;
        try { navigator.clipboard.writeText(appLink()).then(function () { b.textContent = T("inst.copied"); }, function () {}); } catch (x) {}
      }));
    } else {
      var qb = h("div", { class: "mn-inst-qr", "aria-hidden": "true" });
      act.appendChild(h("div", { class: "mn-inst-qrw" }, [qb]));
      try { if (window.QRCode) new window.QRCode(qb, { text: appLink(), width: 200, height: 200, colorDark: "#0a0f1c", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) {}
    }
  }
  function mark(how) { var s = state() || { n: 1 }; s.how = how; s.at = Date.now(); if (!s.k) s.k = nightKey(); save(s); }
  function close() {
    mark(installed ? "done" : "skip");
    lsSet("olnu.guideSeen", String(Date.now()));   // the old install sheet does not come right after
    if (root) { var r0 = root; root = null; act = null; r0.classList.add("mn-inst-out"); setTimeout(function () { r0.remove(); }, 160); }
    var r = resolveGate; resolveGate = null; if (r) r();
  }
  function show() {
    if (root) return;
    var k = kind(), s = state(), n = (s && s.n ? s.n | 0 : 0) + 1;
    cur = { n: n, k: nightKey(), how: "open", at: Date.now() }; save(cur);
    // the flow owns the install prompts now: pnui (after the 1st beer / a join), the top banner, the daily sheet wait
    lsSet("olnu.pnInst", String(Date.now())); lsSet("olnu.installSeen", String(Date.now())); lsSet("olnu.guideSeen", String(Date.now()));
    try { if (window.PNPROMPT && window.PNPROMPT.mark) window.PNPROMPT.mark("install"); } catch (e) {}
    root = h("div", { id: "ux-inst", class: "mn-inst mn-inst-" + k, role: "dialog", "aria-modal": "true", "aria-labelledby": "mn-inst-h" });
    act = h("div", { class: "mn-inst-act" });
    var col = h("div", { class: "mn-inst-col" }, [
      h("img", { class: "mn-inst-icon", src: "./icons/icon-192.png", alt: "", width: "64", height: "64" }),
      h("h2", { class: "mn-inst-h", id: "mn-inst-h", text: k === "desktop" ? T("inst.desk") : T("inst.title") }),
      h("p", { class: "mn-inst-p", text: k === "desktop" ? T("inst.deskp") : n > 1 ? T("inst.lead2") : T("inst.lead") }),
      act,
      h("button", { type: "button", class: "mn-inst-skip", text: T("inst.skip"), onclick: close })
    ]);
    root.appendChild(col);
    document.body.appendChild(root);
    try { var ib = document.getElementById("install-banner"); if (ib) ib.hidden = true; } catch (e) {}
    render();
  }
  function want() {
    if (standalone()) return false;
    var k = kind(); if (k === "desktop") return false;
    if (window.JOIN && window.JOIN.handled && window.JOIN.handled()) return false;   // the invite card has its own install step
    if (/[?&](flytt|chat|sos)=/.test(location.search)) return false;
    if (lsGet("olnu.jn.done")) return false;   // uxfix P1-6: joined from an invite link (that card had its own optional guide): no install wall later
    var s = state();
    if (!s) return lsGet("olnu.intro") !== "1";   // the first open (a returning user keeps the after-the-aha prompt)
    // once more, on a later night (fixJ T-22: and ≥ 12 h after the skip, so 04:30 → 05:06 is not "Andra kvällen!")
    return (s.n | 0) === 1 && s.how === "skip" && !!s.k && s.k !== nightKey() && !(s.at && Date.now() - s.at < 12 * 3600e3);
  }
  function gate() {
    if (!want()) return Promise.resolve();
    return new Promise(function (r) { resolveGate = r; show(); });
  }
  function owns() { return !!state() && !standalone(); }
  window.INSTALL1 = { gate: gate, kind: kind, show: show, owns: owns, state: state, want: want, _close: close, _night: nightKey };
})();
