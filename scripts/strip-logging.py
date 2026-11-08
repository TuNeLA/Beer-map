#!/usr/bin/env python3
"""PintsNow — make the STORE bundle: usage logging is REMOVED from the code, only crash / error reports stay.
Owner decision 2026-11-08: the Android / iOS store apps and the stable web channel at the store launch carry no usage
logging. The beta channel (big-update → pintsnow-beta) keeps full logging (the user opts in by turning on "Betaversion").

usage:  python3 scripts/strip-logging.py <docs dir>          strip in place (run on the store / stable branch before deploy)
        python3 scripts/strip-logging.py <docs dir> --check  only check; exit 1 if usage logging is still in the bundle

What it does (idempotent):
 1. index.html: the js/pnlog.js tag becomes js/pnlog-crash.js (crash reports only); the js/pnlog-hooks.js tag goes.
 2. the files js/pnlog.js and js/pnlog-hooks.js are taken out of the bundle.
 3. integritet.html #pnlog: the store text (error reports only + the optional beta).
 4. js/i18n.js: the intro / privacy lines say "only error reports" (no beta-logging sentence).
 5. sw.js: a new VERSION, so phones install the new shell (the precache list is read from index.html).
Server: nothing to change for the store bundle (pnlog_ingest accepts err.* in every mode except 'none').
"""
import sys, os, re, hashlib
D = sys.argv[1]; CHECK = "--check" in sys.argv[2:]
HERE = os.path.dirname(os.path.abspath(__file__))
def rd(p): return open(os.path.join(D, p), encoding="utf-8").read()
def wr(p, s): open(os.path.join(D, p), "w", encoding="utf-8").write(s)
def h(p): return hashlib.sha256(open(os.path.join(D, p), "rb").read()).hexdigest()[:10]
problems = []
def check():
    s = rd("index.html")
    if "pnlog-hooks.js" in s: problems.append("index.html still loads pnlog-hooks.js")
    if re.search(r'src="\./js/pnlog\.js', s): problems.append("index.html still loads pnlog.js")
    if "js/pnlog-crash.js" not in s: problems.append("index.html does not load pnlog-crash.js")
    for f in ("js/pnlog.js", "js/pnlog-hooks.js"):
        if os.path.exists(os.path.join(D, f)): problems.append(f + " is still in the bundle")
    if not os.path.exists(os.path.join(D, "js", "pnlog-crash.js")): problems.append("js/pnlog-crash.js missing")
    for f in os.listdir(os.path.join(D, "js")):
        if f.endswith(".js") and f != "pnlog-crash.js":
            t = open(os.path.join(D, "js", f), encoding="utf-8").read()
            if "PNLOG_HOOKS" in t or "pnlog_ping" in t: problems.append("js/" + f + " has usage-logging code")
if CHECK:
    check(); print("\n".join(problems) or "store bundle: crash reports only (ok)"); sys.exit(1 if problems else 0)

if not os.path.exists(os.path.join(D, "js", "pnlog-crash.js")): raise SystemExit("js/pnlog-crash.js missing in " + D)
s = rd("index.html"); o = s
s = re.sub(r'<script defer src="\./js/pnlog-hooks\.js[^"]*"></script>\n?', "", s)
s = re.sub(r'<script defer src="\./js/pnlog\.js[^"]*"></script>', '<script defer src="./js/pnlog-crash.js?v=%s"></script>' % h("js/pnlog-crash.js"), s)
if s != o: wr("index.html", s); print("index.html: pnlog.js → pnlog-crash.js, hooks out")
for f in ("js/pnlog.js", "js/pnlog-hooks.js"):
    p = os.path.join(D, f)
    if os.path.exists(p): os.remove(p); print("removed", f)

STORE_PNLOG = open(os.path.join(HERE, "strip-logging-integritet.html"), encoding="utf-8").read().strip()
s = rd("integritet.html"); o = s
s = re.sub(r'<section id="pnlog">.*?</section>', lambda m: STORE_PNLOG, s, count=1, flags=re.S)
if s != o: wr("integritet.html", s); print("integritet.html: store text")

s = rd("js/i18n.js"); o = s
s = re.sub(r'introPrivacy: "Ingen reklam\.[^"\n]*",', 'introPrivacy: "Ingen reklam. Vi sparar bara felrapporter (fel i appen, utan position). Okända ser bara ungefär var du ä – utan namn och antal. Läs mer under 🔒 Integritet.",', s, count=1)
s = re.sub(r'introPrivacy: "No e-mail, no ads\. We log errors[^"\n]*",', 'introPrivacy: "No e-mail, no ads. We only keep error reports (no position). Strangers only see roughly where you are. Read more under 🔒 Privacy.",', s, count=1)
s = s.replace("Vi sparar fel och hur appen används (inga texter, inga namn) – stäng av i ⚙️ Inställningar.", "Vi sparar bara felrapporter (utan position).")
s = s.replace("We log errors and how the app is used (no texts, no names) – turn it off in ⚙️ Settings.", "We only keep error reports (no position).")
if s != o:
    wr("js/i18n.js", s); print("js/i18n.js: store texts")
    x = rd("index.html"); n = re.sub(r'(src="\./js/i18n\.js)(\?v=[^"]*)?"', r'\1?v=%s"' % h("js/i18n.js"), x)
    if n != x: wr("index.html", n)

s = rd("sw.js"); base = re.sub(r'var VERSION = "[^"]*";', "", s, count=1)
v = hashlib.sha256(open(os.path.join(D, "index.html"), "rb").read() + base.encode()).hexdigest()[:10]
n = re.sub(r'var VERSION = "[^"]*";', 'var VERSION = "olnu-%s-store";' % v, s, count=1)
if n != s: wr("sw.js", n); print("sw.js VERSION", v)
check()
if problems: print("\n".join(problems)); sys.exit(1)
print("store bundle: crash reports only (ok)")
