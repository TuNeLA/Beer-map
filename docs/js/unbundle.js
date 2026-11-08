/* PintsNow — bundle safety net (only the bundled Pages build loads this file; scripts/bundle.mjs puts it first).
   CSP allows no inline script, so this is its own small file. A bundle file (js/app.bundle*.js, css/app.bundle.css) that
   fails to LOAD (network, a half-updated cache): reload the page once (fresh copy); if it fails again in this tab, load the
   single files listed in the tag's data-parts, in order (best effort: they may run after later bundles).
   A JS error inside one file does not need this: every file in a bundle runs in its own try/catch. window.OLNU_UNBUNDLED
   counts the fallbacks (pnlog / tests). */
(function () {
  "use strict";
  var KEY = "olnu.unbundleReload", seen = {};
  function parts(t) { return String(t.getAttribute("data-parts") || "").split(",").filter(function (u) { return /^\.\/[\w./-]+\.(js|css)(\?[\w=.-]*)?$/.test(u); }); }
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (!t || t === window || !t.getAttribute || !t.getAttribute("data-parts")) return;
    var id = t.getAttribute("src") || t.getAttribute("href") || ""; if (seen[id]) return; seen[id] = 1;
    var again = false; try { again = sessionStorage.getItem(KEY) === "1"; } catch (x) {}
    if (!again) { try { sessionStorage.setItem(KEY, "1"); } catch (x) {} location.reload(); return; }
    window.OLNU_UNBUNDLED = (window.OLNU_UNBUNDLED || 0) + 1;
    var ref = t;
    parts(t).forEach(function (u) {
      var n;
      if (t.tagName === "LINK") { n = document.createElement("link"); n.rel = "stylesheet"; n.href = u; }
      else { n = document.createElement("script"); n.src = u; n.async = false; }
      ref.parentNode.insertBefore(n, ref.nextSibling); ref = n;
    });
  }, true);
  window.addEventListener("load", function () { setTimeout(function () { try { sessionStorage.removeItem(KEY); } catch (x) {} }, 10000); });
})();
