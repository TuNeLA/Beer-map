/* PintsNow — CHATKB (lane calm2, owner 13 Nov). Every chat sheet (DM, group, event: social.js openChat = #sheet-body > .chat-input).
   I-80 Android (Chrome PWA, Samsung keyboard): the keyboard covered the input row. While the chat input has focus and the
        keyboard is up (visualViewport smaller than the window), the sheet ends right at the top of the keyboard, the list
        gives up its min height and scrolls to the last message, and the sheet body shows the input row. iOS: unchanged
        (social.js --of-kb / --of-vvh already fits it there; no inline sizes, so no jump).
   I-87 the two lines under the input ("🔒 Privat linje …" and the "Tryck på ett meddelande …" tip) are gone; in a DM the
        7-day fact moves to the header card ("Bara ni två · försvinner efter 7 dagar"). While typing (focus + text) the
        mic and camera buttons fold away (short width transition, none with reduced motion), the field takes the width and
        the field takes the width. Empty field = they come back. The send button is ALWAYS a round paper-plane icon
        (44 x 44, owner 17:35), its label stays as aria-label "Skicka" / "Send".
   Public: PN.chatkb = { fit } (tests). No RPC, no storage. */
(function () {
  "use strict";
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var baseH = window.innerHeight || 0, raf = 0;
  var CSS = "#sheet-body > .chat-note,#sheet-body > .cmx-tip{display:none !important}" +
    "#sheet.ck-kb .chat-list{min-height:0 !important}" +
    ".chat-input .af-mic,.chat-input .ph-btn{transition:width .18s ease,opacity .15s ease,margin .18s ease,border-width .18s ease}" +
    ".chat-input.ck-typing .af-mic,.chat-input.ck-typing .ph-btn{width:0 !important;min-width:0 !important;padding:0 !important;border-width:0 !important;" +
    "opacity:0;overflow:hidden;pointer-events:none;margin-left:calc(-1 * var(--sp-2,8px))}" +
    // owner 17:35: the send button is ALWAYS a round paper-plane icon (44 x 44 tap target), the label is the aria-label
    ".chat-input .chat-send.ck-ic{flex:0 0 44px;width:44px;min-width:44px;height:44px;min-height:44px;padding:0 !important;display:grid;place-items:center;border-radius:50% !important}" +
    ".chat-input .chat-send.ck-ic > span{display:none}.chat-input .chat-send.ck-ic svg{margin:0 !important;width:20px;height:20px}" +
    "#sheet-body .dm-cwho{min-width:0;flex:1 1 auto}#sheet-body .dm-cwho > span{min-width:0}" +   // the longer DM subtitle wraps, never under the bell
    "#sheet-body .dm-cwho small.dm-cpriv{white-space:normal !important;align-items:flex-start !important}#sheet-body .dm-cpriv-i{flex:0 0 auto;margin-top:3px}" +
    "@media (prefers-reduced-motion: reduce){.chat-input .af-mic,.chat-input .ph-btn,.chat-input .chat-send{transition:none}}";
  function css() { if (document.getElementById("chatkb-css")) return; var s = document.createElement("style"); s.id = "chatkb-css"; s.textContent = CSS; document.head.appendChild(s); }
  function sheet() { return document.getElementById("sheet"); }
  function row() { return document.querySelector("#sheet-body > .chat-input"); }
  function field(r) { return r && r.querySelector("input, textarea"); }
  function clear(sh) {
    if (!sh) return;
    sh.classList.remove("ck-kb");
    ["bottom", "height", "max-height"].forEach(function (p) { sh.style.removeProperty(p); });
  }
  function toBottom(r) {
    var list = document.querySelector("#sheet-body > .chat-list"), body = document.getElementById("sheet-body");
    if (list) list.scrollTop = list.scrollHeight;
    if (body && r) { var b = body.getBoundingClientRect(), x = r.getBoundingClientRect(); if (x.bottom > b.bottom - 2) body.scrollTop += x.bottom - b.bottom + 4; }
  }
  function fit() {
    raf = 0;
    var sh = sheet(), r = row();
    if (!sh || sh.hidden || !r) { clear(sh); if (!document.activeElement || document.activeElement === document.body) baseH = Math.max(baseH, window.innerHeight || 0); return; }
    var vv = window.visualViewport, ih = window.innerHeight || 0, vh = vv ? vv.height : ih, top = vv ? vv.offsetTop : 0;
    var kb = Math.max(0, Math.round(ih - vh - top)), f = field(r), focus = !!(f && document.activeElement === f);
    var open = focus && (kb > 80 || (baseH && ih < baseH - 120));
    if (!focus) baseH = Math.max(ih, IOS ? baseH : 0) || ih;
    if (!open) { clear(sh); return; }
    sh.classList.add("ck-kb");
    if (!IOS) {   // Android: the sheet ends at the top of the keyboard (layout viewport stays, the visual one shrinks)
      sh.style.setProperty("bottom", kb + "px", "important");
      sh.style.setProperty("height", Math.max(200, Math.round(vh - 8)) + "px", "important");
      sh.style.setProperty("max-height", "none", "important");
    }
    toBottom(r);
    setTimeout(function () { toBottom(row()); }, 60);
  }
  function later() { if (!raf) raf = requestAnimationFrame(fit); }
  function typing(r) {
    var f = field(r); if (!f) return;
    var on = document.activeElement === f && String(f.value || "").trim() !== "";
    r.classList.toggle("ck-typing", on);
  }
  function setup(r) {
    if (!r || r.__ck) return; r.__ck = 1;
    css();
    var f = field(r), send = r.querySelector(".chat-send");
    if (send) {
      var en = !!(window.I18N && window.I18N.lang === "en");
      send.setAttribute("aria-label", (send.textContent || "").trim() || (en ? "Send" : "Skicka"));
      if (!send.querySelector("svg") && window.PNI && window.PNI.has && window.PNI.has("send-r")) { try { send.insertAdjacentHTML("afterbegin", window.PNI.svg("send-r", "pi-lead")); } catch (e) {} }
      if (send.querySelector("svg")) send.classList.add("ck-ic");   // no icon set loaded: the text stays
    }
    if (f) {
      ["input", "focus", "blur", "change"].forEach(function (ev) { f.addEventListener(ev, function () { typing(r); }); });
      f.addEventListener("focus", function () { [0, 120, 350, 700].forEach(function (ms) { setTimeout(later, ms); }); });
      f.addEventListener("blur", function () { setTimeout(later, 120); });
      // a sent message empties the field by code (no input event): check after a send tap / Enter
      r.addEventListener("click", function () { setTimeout(function () { typing(r); }, 60); });
      f.addEventListener("keyup", function () { typing(r); });
    }
    dmFact();
  }
  function dmFact() {   // I-87: the 7-day fact in the DM header card (the line under the input is hidden)
    var p = document.querySelector("#sheet-body .dm-cpriv > span"); if (!p || p.__ck) return; p.__ck = 1;
    var en = !!(window.I18N && window.I18N.lang === "en");
    p.textContent = en ? "Just you two · gone after 7 days" : "Bara ni två · försvinner efter 7 dagar";
  }
  function scan() { var r = row(); if (r) { setup(r); dmFact(); } later(); }
  function start() {
    var body = document.getElementById("sheet-body"), sh = sheet();
    if (!body || !sh) { setTimeout(start, 800); return; }
    if (window.MutationObserver) {
      new MutationObserver(scan).observe(body, { childList: true });
      new MutationObserver(later).observe(sh, { attributes: true, attributeFilter: ["hidden"] });
    }
    if (window.visualViewport) { window.visualViewport.addEventListener("resize", later); window.visualViewport.addEventListener("scroll", later); }
    window.addEventListener("resize", later);
    scan();
  }
  if (window.PN) window.PN.chatkb = { fit: fit };   // no new window.* global
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
