# Static test server for docs/ with ONE switch for the Supabase target.
# usage: python3 tests/e2e/serve.py <port> [docs-dir] [--cors]
#   env PN_TARGET = staging (default) | live
#     staging: GET /config.js is served with SUPABASE_URL + SUPABASE_ANON_KEY of the staging project (pintsnow-staging).
#     live:    config.js is served as it is in the repo (the live project).
#   The file docs/config.js on disk is NEVER changed. Only the served copy differs.
#   Optional overrides: PN_STAGING_URL, PN_STAGING_KEY (public anon/publishable key, not a secret).
#   --cors: add Access-Control-Allow-Origin: * (like GitHub Pages; beta-pw.js needs it).
# Check what a running server serves:  curl -sI http://127.0.0.1:<port>/config.js | grep -i x-pn-target
import functools, http.server, os, re, sys

STAGING_URL = os.environ.get("PN_STAGING_URL", "https://vdtmzsxajpvzwwbhnfmr.supabase.co")
# legacy anon JWT of pintsnow-staging (public, like the live anon key in docs/config.js)
STAGING_KEY = os.environ.get("PN_STAGING_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdG16c3hhanB2end3YmhuZm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwOTIxNzQsImV4cCI6MjEwOTY2ODE3NH0.bk45yZXL0OrHWSrZrAhFJpbtBXgzD_CDVbnoZrKCS-w")
TARGET = os.environ.get("PN_TARGET", "staging").strip().lower() or "staging"
if TARGET not in ("staging", "live"):
    sys.exit("PN_TARGET must be staging or live, not " + TARGET)

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8871
DOCS = os.path.abspath(args[1] if len(args) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs"))
CORS = "--cors" in sys.argv


def config_js():
    with open(os.path.join(DOCS, "config.js"), encoding="utf-8") as f:
        s = f.read()
    if TARGET == "staging":
        s, n1 = re.subn(r'(SUPABASE_URL\s*:\s*)"[^"]*"', lambda m: m.group(1) + '"' + STAGING_URL + '"', s, count=1)
        s, n2 = re.subn(r'(SUPABASE_ANON_KEY\s*:\s*)"[^"]*"', lambda m: m.group(1) + '"' + STAGING_KEY + '"', s, count=1)
        if n1 != 1 or n2 != 1:
            raise RuntimeError("config.js: SUPABASE_URL / SUPABASE_ANON_KEY not found, cannot point at staging")
    return s.encode("utf-8")


# mapcrowd2 (24 Nov): the e2e tests must not depend on the weekly OSM refresh of docs/bars.json (the bot turned the place
# "O'Learys Borlänge" into a bar and broke night3 I-98 + uifix4 I-95). /bars.json is served from the frozen copy
# tests/e2e/fixtures/bars.json (= docs/bars.json before 23 Nov). PN_LIVE_DATA=1 = serve the real file (to see what a refresh changes).
FIXED = {} if os.environ.get("PN_LIVE_DATA") == "1" else {
    "/bars.json": os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "bars.json")}


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("X-PN-Target", TARGET)
        self.send_header("Cache-Control", "max-age=0")
        if CORS:
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _cfg(self, head):
        try:
            body = config_js()
        except Exception as e:  # never fall back to the live file in staging mode
            self.send_error(500, str(e)); return
        self.send_response(200)
        self.send_header("Content-Type", "text/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _fixed(self, f, head):
        with open(f, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-PN-Fixed", "1")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/config.js":
            return self._cfg(False)
        if p in FIXED and os.path.exists(FIXED[p]):
            return self._fixed(FIXED[p], False)
        return super().do_GET()

    def do_HEAD(self):
        p = self.path.split("?")[0]
        if p == "/config.js":
            return self._cfg(True)
        if p in FIXED and os.path.exists(FIXED[p]):
            return self._fixed(FIXED[p], True)
        return super().do_HEAD()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("serving %s on 127.0.0.1:%d, PN_TARGET=%s" % (DOCS, PORT, TARGET), flush=True)
    # cifix1: the GL tests (map-pw, popfix, d4map …) open the page on the github.io URL and fetch EVERY file through a
    # Playwright route (Node fetch, ~100 files at once). The default listen backlog (5) dropped the extra connections:
    # the kernel retried them after 1, 3, 7, 15 s … (probe: files at 4 / 7 / 13 / 26 s) → page.goto "Timeout 60000ms".
    class Server(http.server.ThreadingHTTPServer):
        request_queue_size = 256
        daemon_threads = True

    Server(("127.0.0.1", PORT), functools.partial(H, directory=DOCS)).serve_forever()
