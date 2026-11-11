#!/usr/bin/env python3
"""PintsNow TEST BOTS — fake friends for the owner's hand test. STAGING ONLY (project vdtmzsxajpvzwwbhnfmr).

Six clearly named bots (Bot-Oskar, Bot-Lisa, ...) are anonymous staging users in the group "Testgänget". They use the
same RPCs as the app: chat + DM replies, Ikväll, check-ins at Ludvika bars, pins, calm beers, Spel + Party rooms,
moments, Skål, and Bot-Erik drives ("Jag kör ikväll") and takes "Hämta mig" rides.

Run:   python3 scripts/bots/runner.py --minutes 60 [--friend ABC123] [--state FILE] [--quiet]
Stop:  Ctrl+C, or write "bots: stopp" in Testgänget, or cancel the GitHub Actions run.
Chat commands (in Testgänget):  bots: kom till Pitchers · bots: spela · bots: tyst · bots: prata · bots: hem ·
  bots: ute · bots: skjuts · bots: kör · bots: kör inte · bots: vänner · bots: moment vad|halvtid|bord|agent · bots: status · bots: stopp

Safety: only the staging URL + the public anon key (no service key, no password). The script refuses any other
Supabase URL. Bots act only in Testgänget, in rooms of Testgänget and in DM threads that people open with them.
Python 3.8+, standard library only.
"""
import argparse, json, os, random, re, sys, time, urllib.request, urllib.error, unicodedata, uuid

STAGING_REF = "vdtmzsxajpvzwwbhnfmr"
LIVE_REF = "wcdskpcevbhouvbytkhv"
URL = "https://%s.supabase.co" % STAGING_REF
# Public anon key of the STAGING project (role "anon", same kind of key as docs/config.js). Not a secret.
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdG16c3hhanB2end3YmhuZm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwOTIxNzQsImV4cCI6MjEwOTY2ODE3NH0.bk45yZXL0OrHWSrZrAhFJpbtBXgzD_CDVbnoZrKCS-w"
GROUP_LABEL = "Testgänget"

BARS = [  # Ludvika (bars.json / bars-extra.json ids)
    {"id": "n3472634175", "name": "Pitchers", "lat": 60.14997, "lng": 15.18679, "keys": ["pitchers", "pitcher"]},
    {"id": "x-lobbybaren-ludvika", "name": "Lobbybaren (Grand Hotel Elektra)", "lat": 60.15098, "lng": 15.18663, "keys": ["lobby", "lobbybaren", "elektra"]},
    {"id": "x-la-parma-ludvika", "name": "La Parma Pub & Restaurang", "lat": 60.15124, "lng": 15.18797, "keys": ["parma", "la parma"]},
    {"id": "x-grekiska-grill-bar-ludvika", "name": "Grekiska Grill & Bar", "lat": 60.15205, "lng": 15.18059, "keys": ["grekiska", "grill"]},
    {"id": "x-blackstone-ludvika", "name": "Blackstone Steakhouse", "lat": 60.15038, "lng": 15.18507, "keys": ["blackstone"]},
]
HOME = {"lat": 60.1440, "lng": 15.1700}

BOTS = [  # label, bar index, avatar spec (avatar.js v1 fields), role
    ("Bot-Oskar", 0, {"v": 1, "sk": 1, "fs": 0, "ey": 2, "br": 2, "mt": 1, "hr": 3, "hc": 1, "fh": 2, "hw": 0, "gl": 0, "up": 1, "uc": 3, "bg": 2, "ms": 1}, "leader"),
    ("Bot-Lisa", 0, {"v": 1, "sk": 2, "fs": 1, "ey": 4, "br": 1, "mt": 3, "hr": 6, "hc": 4, "fh": 0, "hw": 0, "gl": 1, "up": 2, "uc": 6, "bg": 5, "ms": 1}, "friend"),
    ("Bot-Erik", 1, {"v": 1, "sk": 0, "fs": 2, "ey": 1, "br": 3, "mt": 0, "hr": 1, "hc": 2, "fh": 4, "hw": 2, "gl": 0, "up": 0, "uc": 1, "bg": 0, "ms": 1}, "driver"),
    ("Bot-Sara", 1, {"v": 1, "sk": 4, "fs": 1, "ey": 0, "br": 2, "mt": 4, "hr": 7, "hc": 5, "fh": 0, "hw": 0, "gl": 0, "up": 1, "uc": 7, "bg": 3, "ms": 1}, "rider"),
    ("Bot-Johan", 2, {"v": 1, "sk": 3, "fs": 0, "ey": 3, "br": 4, "mt": 2, "hr": 2, "hc": 0, "fh": 1, "hw": 1, "gl": 2, "up": 2, "uc": 2, "bg": 6, "ms": 1}, "friend"),
    ("Bot-Mia", 2, {"v": 1, "sk": 5, "fs": 2, "ey": 5, "br": 1, "mt": 5, "hr": 8, "hc": 6, "fh": 0, "hw": 0, "gl": 0, "up": 1, "uc": 4, "bg": 7, "ms": 1}, "plain"),
]

# ---------- copy (the app's tone: short, dalmål-light, no drink counts) ----------
LINES = {
    "hello": ["Tjena {name}! 🍻", "Tja tja!", "Hallå där {name}", "Tjenixen 👋", "Äntligen nån som skriver"],
    "beer": ["Nu blir det bärs!", "En stor stark tack 🍺", "Jag tar en till sen", "Bärs ä alltid rätt", "Skål på er!"],
    "where": ["Vi ä på {bar}! Kom hit", "{bar}. Bästa bordet ä vårt", "Sitter på {bar}, kom!", "{bar} ju, var annars?"],
    "ikvall": ["Jag ä ute ikväll 🙌", "Kanske, beror på vem som kommer", "Klart man ä ute!", "Ute! Ses på {bar}"],
    "game": ["Kör! Öppna ett spel så hoppar vi in 🎉", "Spel? Jag ä med", "Starta så kör vi", "Jag vinner, bara så du vet"],
    "skal": ["Skååål! 🍻", "Skål {name}!", "Skål och tack", "🍻🍻"],
    "food": ["Kebabtallrik klockan 03:12 😅", "Pizza efter, inget snack", "Grekiska grillen sen?"],
    "home": ["Natti! 😴", "Hemma snart", "Jag drar hem nu"],
    "question": ["Bra fråga.", "Ja!", "Nej int' nu", "Kanske 🤔", "Fråga Oskar", "Absolut"],
    "filler": ["Haha 😂", "Sant", "Lugnt", "👍", "Klockrent", "Snyggt!", "Hehe", "Jao"],
    "dm": ["Tjena! Vad händer?", "Ja, vad ä läget?", "Haha ok", "Låter bra", "Ses sen då!", "Jag ä på {bar}"],
    "arrive": ["På väg till {bar}!", "Ses på {bar} 🍻", "{bar} nu, kom"],
    "game_on": ["Spelet ä igång! 🎉", "Bra spelat", "Nästa runda!"],
}
KEYS = [  # (regex, line kind)
    (r"\b(hej|tja|tjena|hallå|hejsan|morsning|tjo)\b", "hello"),
    (r"\b(öl|bärs|pilsner|stor stark|bira|lager|ipa)\b", "beer"),
    (r"\b(var ä|var är|vart|var e|var ni|vilken krog|vilket ställe)\b", "where"),
    (r"\b(ikväll|ikvall|i kväll|ute)\b", "ikvall"),
    (r"\b(spel|spela|game|lek|frågesport)\b", "game"),
    (r"\b(skål|skal|cheers)\b", "skal"),
    (r"\b(kebab|pizza|mat|hungrig|grill)\b", "food"),
    (r"\b(natti|godnatt|hem|sova)\b", "home"),
]
REACTS = ["🍻", "😂", "👍", "🔥", "❤️"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def norm(s):
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    return s


class ApiError(Exception):
    def __init__(self, status, body):
        self.status, self.body = status, body
        msg = body.get("message") if isinstance(body, dict) else str(body)
        super().__init__("%s %s" % (status, (msg or "")[:160]))

    @property
    def code(self):
        return (self.body.get("message") if isinstance(self.body, dict) else str(self.body)) or ""


def http(path, body, token=None, tries=3):
    if LIVE_REF in URL or STAGING_REF not in URL:
        raise SystemExit("refusing: not the staging project")
    h = {"apikey": ANON, "Content-Type": "application/json", "Authorization": "Bearer " + (token or ANON)}
    data = json.dumps(body if body is not None else {}).encode()
    for i in range(tries):
        req = urllib.request.Request(URL + path, data=data, headers=h, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as f:
                t = f.read().decode()
                return json.loads(t) if t else None
        except urllib.error.HTTPError as e:
            t = e.read().decode(errors="replace")
            try:
                b = json.loads(t)
            except Exception:
                b = t
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(1.5 * (i + 1) + random.random())
                continue
            raise ApiError(e.code, b)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if i < tries - 1:
                time.sleep(2 * (i + 1))
                continue
            raise ApiError(0, str(e))


class Bot:
    def __init__(self, label, bar_i, avatar, role, rec):
        self.label, self.avatar, self.role = label, avatar, role
        self.bar = BARS[bar_i]
        self.lat = self.bar["lat"] + random.uniform(-0.0002, 0.0002)
        self.lng = self.bar["lng"] + random.uniform(-0.0003, 0.0003)
        self.rec = rec  # persisted: uid, refresh, access, exp
        self.code = None
        self.spel = None  # room id
        self.party = None
        self.ride = None  # {id, step, at, pk}
        self.next_beer = time.time() + random.uniform(60, 360)
        self.picked = set()
        self.done_moment = set()
        self.in_room_since = {}

    # ---- auth ----
    def ensure(self, store):
        r = self.rec
        if r.get("access") and r.get("exp", 0) > time.time() + 120:
            return
        if r.get("refresh"):
            try:
                a = http("/auth/v1/token?grant_type=refresh_token", {"refresh_token": r["refresh"]})
                self._take(a)
                store.save()
                return
            except ApiError as e:
                log(self.label, "refresh failed (%s): new account" % e)
        a = http("/auth/v1/signup", {"data": {"test": True, "bot": True, "name": self.label}})
        self._take(a)
        self.rec["new"] = True
        store.save()
        log(self.label, "new anonymous staging account", self.rec["uid"][:8])

    def _take(self, a):
        self.rec.update({"access": a["access_token"], "refresh": a["refresh_token"],
                         "exp": time.time() + int(a.get("expires_in") or 3600), "uid": a["user"]["id"]})

    def rpc(self, name, args=None):
        return http("/rest/v1/rpc/" + name, args or {}, self.rec["access"])

    def tryrpc(self, name, args=None, quiet=False):
        try:
            return self.rpc(name, args)
        except ApiError as e:
            if not quiet:
                log(self.label, name, "->", e)
            return None

    @property
    def uid(self):
        return self.rec.get("uid")


class Store:
    def __init__(self, path):
        self.path = path
        try:
            with open(path) as f:
                self.d = json.load(f)
        except Exception:
            self.d = {}
        self.d.setdefault("bots", {})

    def save(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.d, f, indent=1)
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except Exception:
            pass


def spel_counts():
    """Number of prompts per Spel game in docs/js/spel-cards.js (the server deals by index; never more than exist)."""
    c = {"vem": 140, "aldrig": 160, "hellre": 115}
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs", "js", "spel-cards.js")
    try:
        import subprocess
        out = subprocess.run(["node", "-e", "global.window={};require(process.argv[1]);const c=window.SPEL_CARDS;"
                              "console.log(JSON.stringify({vem:c.vem.length,aldrig:c.aldrig.length,hellre:c.hellre.length}))", os.path.abspath(p)],
                             capture_output=True, text=True, timeout=20)
        c.update(json.loads(out.stdout.strip()))
    except Exception:
        pass
    return c


class Runner:
    def __init__(self, a):
        self.a = a
        self.store = Store(a.state)
        self.gen = uuid.uuid4().hex[:8]
        self.bots = [Bot(l, b, av, role, self.store.d["bots"].setdefault(l, {})) for (l, b, av, role) in BOTS]
        self.by_label = {b.label: b for b in self.bots}
        self.leader = self.bots[0]
        self.gid = None
        self.code = None
        self.last_msg = 0
        self.quiet = bool(a.quiet)
        self.stop = False
        self.t_end = time.time() + 60 * a.minutes
        self.tasks = {}
        self.pending = []  # (at, fn)
        self.skald = set()
        self.dm_seen = {}
        self.np = spel_counts()
        self.stats = {"chat": 0, "beers": 0, "spel_moves": 0, "party_moves": 0, "moment_picks": 0, "rides": 0, "skal": 0}
        self.bot_uids = set()
        self.handed = set()

    # ---------- helpers ----------
    def later(self, sec, fn):
        self.pending.append((time.time() + sec, fn))

    def every(self, name, sec, fn, jitter=0.2):
        t = self.tasks.get(name, 0)
        if time.time() >= t:
            self.tasks[name] = time.time() + sec * (1 + random.uniform(-jitter, jitter))
            try:
                fn()
            except ApiError as e:
                log("task", name, "->", e)
            except Exception as e:  # keep the bots alive; print the bug
                log("task", name, "BUG", repr(e))

    def say(self, bot, text, gid=None, force=False):
        if self.quiet and not force:
            return
        gid = gid or self.gid
        r = bot.tryrpc("post_group_msg", {"p_group_id": gid, "p_body": text[:280]})
        if r is not None:
            self.stats["chat"] += 1
            log(bot.label, "says:", text)

    def line(self, kind, **kw):
        s = random.choice(LINES[kind])
        kw.setdefault("bar", random.choice(BARS)["name"].split(" (")[0])
        kw.setdefault("name", "du")
        try:
            return s.format(**kw)
        except Exception:
            return s

    def others(self, bot):
        return [b for b in self.bots if b is not bot]

    def is_bot_name(self, n):
        return str(n or "").startswith("Bot-")

    # ---------- setup ----------
    def setup(self):
        for b in self.bots:
            b.ensure(self.store)
            time.sleep(0.4)
        self.bot_uids = {b.uid for b in self.bots}
        for b in self.bots:
            b.tryrpc("zz_test_join", {"p_label": b.label, "p_bot": True, "p_gen": self.gen})
            b.tryrpc("set_display_name", {"p_display_name": b.label}, quiet=True)
            b.tryrpc("set_my_avatar", {"p_spec": b.avatar}, quiet=True)
        g = self.leader.tryrpc("zz_test_group_get", {"p_label": GROUP_LABEL}) or {}
        code = self.a.code or (g.get("code") if g.get("exists") else None)
        if code:
            for b in self.bots:
                r = b.tryrpc("join_group", {"p_code": code, "p_display_name": b.label})
                if r and r.get("id"):
                    self.gid, self.code = r["id"], r.get("code") or code
        if not self.gid:
            r = self.leader.rpc("create_group", {"p_name": GROUP_LABEL, "p_display_name": self.leader.label})
            self.gid, self.code = r["id"], r["code"]
            log("created group", GROUP_LABEL, "code", self.code)
            for b in self.bots[1:]:
                b.tryrpc("join_group", {"p_code": self.code, "p_display_name": b.label})
        self.leader.tryrpc("zz_test_group_set", {"p_label": GROUP_LABEL, "p_group_id": self.gid})
        for b in self.bots:   # an older bot set with the same names leaves (after the new set has joined)
            r = b.tryrpc("zz_test_retire", {"p_label": b.label}, quiet=True)
            if r and r.get("left"):
                log(b.label, "old copy left", r["left"], "group(s)")
        self.store.d["group"] = {"id": self.gid, "code": self.code}
        self.store.save()
        # start the chat cursor at the newest message: no replies to old lines
        msgs = self.leader.tryrpc("group_msgs", {"p_group_id": self.gid, "p_after_id": 0}) or []
        self.last_msg = max([m.get("id", 0) for m in msgs] or [0])
        for b in self.bots:
            fc = b.tryrpc("my_friend_code", {"p_name": b.label}, quiet=True) or {}
            b.code = fc.get("code")
        # the evening: Ikväll, check-ins, Erik drives
        for i, b in enumerate(self.bots):
            b.tryrpc("ikvall_set", {"p_st": "kanske" if b.label == "Bot-Mia" else "ute"}, quiet=True)
            if b.role == "driver":
                b.tryrpc("driver_set", {"p_on": True})
                b.tryrpc("ride_car_set", {"p_car": "Röd Volvo V70 · ABC 123 (test)"}, quiet=True)
            self.checkin(b, b.bar, announce=False)
            time.sleep(0.3)
        if self.a.friend:
            for b in self.bots:
                if b.role == "friend":
                    r = b.tryrpc("friend_request", {"p_code": self.a.friend, "p_name": b.label})
                    log(b.label, "friend request to", self.a.friend, "->", "ok" if r is not None else "failed")
        self.tasks["wander"] = time.time() + 600
        log("READY group=%s code=%s bots=%d minutes=%s" % (GROUP_LABEL, self.code, len(self.bots), self.a.minutes))
        print("::notice title=Testgänget::join code %s" % self.code if os.environ.get("GITHUB_ACTIONS") else "", flush=True)
        if not self.a.no_hello:
            self.say(self.leader, "Bots ä här 🤖 (testläge). Skriv \"bots: hjälp\" för kommandon.")

    # ---------- actions ----------
    def checkin(self, b, bar, announce=True):
        b.bar = bar
        b.lat = bar["lat"] + random.uniform(-0.00015, 0.00015)
        b.lng = bar["lng"] + random.uniform(-0.00025, 0.00025)
        r = b.tryrpc("check_in", {"p_bar_id": bar["id"], "p_bar_name": bar["name"], "p_lat": b.lat, "p_lng": b.lng}, quiet=True)
        if r is not None and announce:
            log(b.label, "checked in at", bar["name"])
        return r

    def beer(self, b):
        if b.label == "Bot-Erik":   # the driver never drinks (a driver with a drink is never asked for rides)
            return
        r = b.tryrpc("post_beer_v2", {"p_lat": b.lat, "p_lng": b.lng, "p_precise": True})
        if r and r.get("accepted", True):
            self.stats["beers"] += 1
            log(b.label, "logged a beer at", b.bar["name"])

    def pin_move(self, b):
        b.lat += random.uniform(-0.00012, 0.00012)
        b.lng += random.uniform(-0.0002, 0.0002)
        b.tryrpc("pin_follow", {"p_lat": b.lat, "p_lng": b.lng, "p_acc": 15}, quiet=True)

    # ---------- chat ----------
    def poll_chat(self):
        try:
            msgs = self.leader.rpc("group_msgs", {"p_group_id": self.gid, "p_after_id": self.last_msg}) or []
        except ApiError as e:
            if "member" in e.code or e.status in (401, 403):
                log("the leader is no longer in", GROUP_LABEL, "(a newer bot run took over?) -> stop")
                self.stop = True
                return
            raise
        for m in msgs:
            self.last_msg = max(self.last_msg, m.get("id", 0))
            name = m.get("name") or ""
            if self.is_bot_name(name):
                continue
            body = str(m.get("body") or "")
            if re.match(r"^\s*bots?\s*[:,]", body, re.I):
                self.command(body.split(":", 1)[1] if ":" in body else body.split(",", 1)[1], name)
                continue
            self.react_to(m, name, body)

    def react_to(self, m, name, body):
        if self.quiet:
            return
        t = norm(body)
        kind = None
        for rx, k in KEYS:
            if re.search(rx, t):
                kind = k
                break
        if not kind and "?" in t:
            kind = "question"
        if not kind and random.random() < 0.35:
            kind = "filler"
        first = name.split(" ")[0]
        if kind:
            b = random.choice(self.bots)
            txt = self.line(kind, name=first, bar=b.bar["name"].split(" (")[0])
            self.later(random.uniform(3, 10), lambda b=b, txt=txt: self.say(b, txt))
            if random.random() < 0.4:
                b2 = random.choice(self.others(b))
                txt2 = self.line(random.choice(["filler", kind]), name=first, bar=b2.bar["name"].split(" (")[0])
                self.later(random.uniform(9, 18), lambda b=b2, txt=txt2: self.say(b, txt))
        if random.random() < 0.5 and m.get("id"):
            b3 = random.choice(self.bots)
            self.later(random.uniform(2, 8), lambda b=b3, mid=m["id"]: b.tryrpc("react_msg", {"p_msg_id": mid, "p_emoji": random.choice(REACTS)}, quiet=True))

    def command(self, cmd, who):
        c = norm(cmd).strip()
        log("command from", who, ":", c)
        L = self.leader
        if c.startswith(("hjälp", "help")):
            self.say(L, "Kommandon: bots: kom till <krog> · spela · tyst · prata · hem · ute · skjuts · kör · kör inte · vänner · "
                        "moment vad|halvtid|bord|agent · status · stopp", force=True)
        elif c.startswith(("kom till", "kom")):
            want = c.replace("kom till", "").replace("kom", "").strip()
            bar = next((x for x in BARS if any(k in want for k in x["keys"])), BARS[0] if not want else None)
            if not bar:
                self.say(L, "Hittar int' den krogen. Testa Pitchers, Lobbybaren eller La Parma.", force=True)
                return
            for i, b in enumerate(self.bots):
                self.later(2 + i * 2, lambda b=b, bar=bar: self.checkin(b, bar))
            self.say(L, self.line("arrive", bar=bar["name"].split(" (")[0]), force=True)
        elif c.startswith(("spela", "spel")):
            game = "hellre"
            for g in ("vem", "aldrig", "hellre"):
                if g in c:
                    game = g
            self.open_spel(game)
        elif c.startswith(("tyst", "shh", "tysta")):
            self.say(L, "Okej, vi ä tysta 🤐 (skriv bots: prata)", force=True)
            self.quiet = True
        elif c.startswith(("prata", "snacka")):
            self.quiet = False
            self.say(L, "Vi ä tillbaka! 🗣️")
        elif c.startswith(("hem", "gå hem")):
            for i, b in enumerate(self.bots):
                self.later(1 + i, lambda b=b: (b.tryrpc("check_out", quiet=True), b.tryrpc("stop_beer", quiet=True),
                                               b.tryrpc("ikvall_set", {"p_st": "hemma"}, quiet=True)))
            self.say(L, self.line("home"), force=True)
        elif c.startswith("ute"):
            for i, b in enumerate(self.bots):
                self.later(1 + i, lambda b=b: (b.tryrpc("ikvall_set", {"p_st": "ute"}, quiet=True), self.checkin(b, b.bar)))
            self.say(L, "Alla ute! 🍻", force=True)
        elif c.startswith(("skjuts", "ride", "hämta")):
            rider = self.by_label["Bot-Sara"]
            r = rider.tryrpc("ride_request", {"p_lat": rider.lat, "p_lng": rider.lng, "p_place": rider.bar["name"][:40], "p_pax": 1,
                                              "p_note": "Testskjuts från Bot-Sara", "p_name": rider.label})
            self.say(rider, "Kan nån hämta mig vid %s? 🚗 (Hämta mig skickad)" % rider.bar["name"].split(" (")[0] if r else
                     "Hämta mig gick int' (ride_v2 av? Slå på den i testpanelen).", force=True)
        elif c.startswith(("kör inte", "ingen skjuts", "sluta köra")):
            e = self.by_label["Bot-Erik"]; e.role = "plain-driver-off"
            e.tryrpc("driver_set", {"p_on": False}, quiet=True)
            self.say(e, "Okej, jag kör int' mer ikväll. Nu får du köra! 🚗", force=True)
        elif c.startswith("kör"):
            e = self.by_label["Bot-Erik"]; e.role = "driver"
            e.tryrpc("driver_set", {"p_on": True}, quiet=True)
            self.say(e, "Jag kör ikväll igen 🚗", force=True)
        elif c.startswith(("vänner", "vän", "friends")):
            for b in self.bots:
                if b.role == "friend" and b.code:
                    self.say(b, "Min vänkod: %s" % b.code, force=True)
        elif c.startswith("moment"):
            kind = next((k for k in ("vad", "halvtid", "bord", "agent") if k in c), "vad")
            r = L.tryrpc("zz_test_moment", {"p_group_id": self.gid, "p_kind": kind})
            self.say(L, ("Moment %s öppnat 🎲" % kind) if r else "Momentet gick int' (moments av? Slå på i testpanelen).", force=True)
        elif c.startswith("status"):
            s = self.stats
            self.say(L, "Status: %d chatt · %d öl · %d spel-drag · %d party-drag · %d moment · %d skjuts · %d skål · %d min kvar" % (
                s["chat"], s["beers"], s["spel_moves"], s["party_moves"], s["moment_picks"], s["rides"], s["skal"],
                max(0, int((self.t_end - time.time()) / 60))), force=True)
        elif c.startswith(("stopp", "stop", "sluta")):
            self.say(L, "Bots går hem nu 👋", force=True)
            self.stop = True
        else:
            self.say(L, "Förstår int'. Skriv bots: hjälp", force=True)

    def poll_dms(self, b):
        r = b.rpc("my_dms") or {}
        for t in r.get("threads") or []:
            gid = t.get("group_id") or t.get("id")
            if not gid or t.get("last_me") or not t.get("unread"):
                continue
            after = self.dm_seen.get((b.label, gid), 0)
            msgs = b.tryrpc("group_msgs", {"p_group_id": gid, "p_after_id": after}, quiet=True) or []
            last = max([m.get("id", 0) for m in msgs] or [after])
            self.dm_seen[(b.label, gid)] = last
            theirs = [m for m in msgs if not m.get("is_me")]
            if not theirs:
                continue
            body = norm(theirs[-1].get("body"))
            kind = next((k for rx, k in KEYS if re.search(rx, body)), "dm")
            txt = self.line(kind, name=(theirs[-1].get("name") or "du").split(" ")[0], bar=b.bar["name"].split(" (")[0])
            self.later(random.uniform(3, 9), lambda b=b, gid=gid, txt=txt, last=last: (
                self.say(b, txt, gid=gid, force=True), b.tryrpc("dm_seen", {"p_group_id": gid, "p_last_id": last}, quiet=True)))

    # ---------- Spel (Skämskort, Vem, Aldrig, Hellre, Quiz) ----------
    def open_spel(self, game):
        r = self.leader.tryrpc("spel_open", {"p_group_id": self.gid, "p_game": game})
        if not r:
            return
        self.say(self.leader, "Jag öppnade %s i 🎉 Spel. Hoppa in! Vi startar om en halv minut." % game, force=True)
        for b in self.bots:
            b.spel = r["id"]
            b.in_room_since[r["id"]] = time.time()
        self.later(30, lambda rid=r["id"], game=game: self.start_spel(rid, game))

    def start_spel(self, rid, game):
        st = self.leader.tryrpc("spel_state", {"p_room": rid, "p_v": 0}) or {}
        if st.get("phase") != "lobby":
            return
        for b in self.bots:
            b.tryrpc("spel_open", {"p_group_id": self.gid}, quiet=True)
        data = {"game": game, "goal": 5, "pen": "utm", "np": max(5, int(self.np.get(game, 100)))}
        r = self.leader.tryrpc("spel_act", {"p_room": rid, "p_act": "start", "p_data": data})
        if r:
            log("spel started", game)

    def watch_spel(self):
        g = self.leader.rpc("spel_group", {"p_group_id": self.gid}) or {}
        room = g.get("room")
        if not room or room.get("phase") is None:
            for b in self.bots:
                b.spel = None
            return
        humans = [n for n in (room.get("names") or []) if not self.is_bot_name(n)]
        if not humans and not any(b.spel == room["id"] for b in self.bots):
            return   # a room with only bots that we did not open: leave it alone
        # GM2: only the host may switch games. When a person waits in the lobby (or after a game) and a BOT is the host,
        # all bots leave once (the host role passes on to the person), then join again as normal players.
        if humans and room.get("phase") in ("lobby", "end"):
            st = self.leader.tryrpc("spel_state", {"p_room": room["id"], "p_v": 0}, quiet=True) or {}
            ck = st.get("creator_k")
            host = next((p for p in st.get("players") or [] if p.get("k") == ck), None)
            key = ("handover", room["id"], st.get("game_no"))
            if host and self.is_bot_name(host.get("name")) and key not in self.handed:
                self.handed.add(key)
                for i, b in enumerate(self.bots):
                    b.tryrpc("spel_act", {"p_room": room["id"], "p_act": "leave"}, quiet=True)
                    b.spel = None
                log("Spel: bots left the lobby so the person becomes host; they join again in 5 s")
                self.tasks["spel_watch"] = time.time() + 5
                return
        for i, b in enumerate(self.bots):
            if b.spel != room["id"]:
                r = b.tryrpc("spel_open", {"p_group_id": self.gid}, quiet=True)
                if r and r.get("id"):
                    b.spel = r["id"]
                    log(b.label, "joined Spel room", room.get("game"))

    def play_spel(self, b):
        if not b.spel:
            return
        st = b.tryrpc("spel_state", {"p_room": b.spel, "p_v": 0}, quiet=True)
        if not st or st.get("closed"):
            b.spel = None
            return
        me, ph, game, pub = st.get("me") or {}, st.get("phase"), st.get("game"), st.get("pub") or {}
        if me.get("status") != "in":
            b.tryrpc("spel_open", {"p_group_id": self.gid}, quiet=True)
            return
        key = (st["id"], st.get("game_no"), st.get("round"), ph)
        if key in b.picked:
            return
        act = None
        if ph == "pick" and game == "kort" and not me.get("judge") and me.get("mine") is None:
            hand = me.get("hand") or []
            n = int(pub.get("pick") or 1)
            if len(hand) >= n:
                act = ("play", None, {"cards": random.sample(hand, n)})
        elif ph == "judge" and game == "kort" and me.get("judge"):
            n = len(pub.get("answers") or [])
            if n:
                act = ("best", str(random.randrange(n)), None)
        elif ph == "vote" and me.get("mine") is None:
            if game == "vem":
                ks = [p["k"] for p in st.get("players") or [] if p.get("k") != me.get("k")]
                act = ("vote", random.choice(ks), None) if ks else None
            elif game == "aldrig":
                act = ("vote", random.choice(["y", "n"]), None)
            elif game == "quiz":
                o = ((pub.get("q") or {}).get("o")) or ["a", "b"]
                act = ("vote", str(random.randrange(len(o))), None)
            else:
                act = ("vote", random.choice(["a", "b"]), None)
        elif ph == "result":
            # a human presses Nästa; if nobody does in 12 s, the bot that opened the room does
            if b is self.leader and time.time() - b.in_room_since.get(("res",) + key[:3], time.time()) > 12:
                act = ("next", None, None)
            b.in_room_since.setdefault(("res",) + key[:3], time.time())
        if act:
            if act[0] != "next":
                b.picked.add(key)
            delay = random.uniform(2, 7)
            self.later(delay, lambda b=b, rid=st["id"], act=act: self._spel_act(b, rid, act))

    def _spel_act(self, b, rid, act):
        r = b.tryrpc("spel_act", {"p_room": rid, "p_act": act[0], "p_val": act[1], "p_data": act[2]}, quiet=True)
        if r is not None:
            self.stats["spel_moves"] += 1
            log(b.label, "spel", act[0], act[1] or "")

    # ---------- Party (Imposter, Survivor, Hatten, Flocken, Vägen) ----------
    def watch_party(self):
        g = self.leader.rpc("party_group", {"p_group_id": self.gid}) or {}
        room = g.get("room") if isinstance(g, dict) else None
        if not room or not room.get("code") or room.get("closed"):
            for b in self.bots:
                b.party = None
            return
        for b in self.bots:
            if b.party != room.get("id"):
                r = b.tryrpc("party_join", {"p_code": room["code"], "p_name": b.label}, quiet=True)
                if r and r.get("id"):
                    b.party = r["id"]
                    log(b.label, "joined Party room", room.get("code"), r.get("game"))

    WORDS = ["Pilsner", "Kebab", "Dansgolvet", "Taxi", "Garderoben", "Bartendern", "Karaoke", "Pizza", "Jukeboxen", "Ölkranen"]

    def play_party(self, b):
        if not b.party:
            return
        st = b.tryrpc("party_state", {"p_room": b.party, "p_v": 0}, quiet=True)
        if not st or st.get("closed"):
            b.party = None
            return
        me, ph, game, pub, priv = st.get("me") or {}, st.get("phase"), st.get("game"), st.get("pub") or {}, st.get("priv") or {}
        mine = [p for p in st.get("players") or [] if p.get("is_me")]
        need = bool(mine and mine[0].get("need"))
        key = (st["id"], st.get("game_no"), pub.get("rk"), ph, pub.get("turn_k"))
        if key in b.picked:
            return
        others = [p["k"] for p in st.get("players") or [] if not p.get("is_me") and p.get("status") == "in"]
        act = None
        if game == "imposter" and ph == "clue" and pub.get("turn_k") == me.get("k"):
            act = ("done", None)
            clue = random.choice(["Kall", "Skum", "Gott", "Sent", "Högt", "Dyrt", "Kul"]) if not priv.get("imp") else random.choice(["Hmm", "Typ", "Ja"])
            self.later(1, lambda b=b, clue=clue: self.say(b, "Min ledtråd: %s" % clue, force=False))
        elif game == "vagen" and ph == "clue" and pub.get("psy_k") == me.get("k"):
            act = ("done", None)
        elif need and priv.get("mine") is None:
            if ph == "roles":
                act = ("ready", None)
            elif ph in ("vote", "final") and game in ("imposter", "survivor") and others:
                act = ("vote", random.choice(others))
            elif ph == "guess" and game == "imposter":
                act = ("guess", random.choice(self.WORDS))
            elif ph == "write":
                if game == "hatten" and pub.get("pk") == "w":
                    ks = [p["k"] for p in st.get("players") or [] if p.get("status") == "in"]
                    act = ("answer", random.choice(ks)) if ks else None
                elif game == "flocken":
                    act = ("answer", random.choice(["Öl", "Pizza", "Kebab", "Hund", "Volvo", "Röd", "Sverige"]))
                else:
                    act = ("answer", random.choice(["Bartendern som såg allt", "En stor stark", "Karaoke klockan 01",
                                                    "Kebaben på vägen hem", "Tappade jackan", "Dansade på bordet"]))
            elif ph == "vote" and game == "hatten":
                n = len(pub.get("slips") or [])
                opts = [i for i in range(n) if i != priv.get("my_slip")]
                act = ("best", str(random.choice(opts))) if opts else None
            elif ph == "guess" and game == "vagen":
                act = ("slide", str(random.randint(5, 95)))
        if act:
            b.picked.add(key)
            self.later(random.uniform(2, 8), lambda b=b, rid=st["id"], act=act: self._party_act(b, rid, act))

    def _party_act(self, b, rid, act):
        r = b.tryrpc("party_act", {"p_room": rid, "p_act": act[0], "p_val": act[1]}, quiet=True)
        if r is not None:
            self.stats["party_moves"] += 1
            log(b.label, "party", act[0], act[1] or "")

    # ---------- moments ----------
    def play_moments(self, b):
        r = b.rpc("moments_poll", {"p_group_id": self.gid}) or {}
        if not r.get("on"):
            return
        for m in r.get("rounds") or []:
            rid, kind, ph = m.get("id"), m.get("kind"), m.get("phase")
            if not m.get("asked") or (b.label, rid, ph) in b.done_moment:
                continue
            if kind in ("vad", "halvtid") and ph == "open" and m.get("mine") is None:
                opts = [o.get("v") for o in m.get("opts") or [] if o.get("v")]
                if opts:
                    b.done_moment.add((b.label, rid, ph))
                    self.later(random.uniform(5, 40), lambda b=b, rid=rid, p=random.choice(opts): self._mom(b, "moment_pick", rid, p))
            elif kind == "bord" and ph == "open" and b is random.choice(self.bots):
                b.done_moment.add((b.label, rid, ph))
                self.later(random.uniform(60, 150), lambda b=b, rid=rid: self._mom(b, "moment_done", rid))
            elif kind == "agent":
                if m.get("agent_me") and ph == "secret" and not m.get("done_at"):
                    b.done_moment.add((b.label, rid, ph))
                    self.later(random.uniform(90, 240), lambda b=b, rid=rid: self._mom(b, "moment_done", rid))
                elif ph == "vote" and not m.get("agent_me") and m.get("mine") is None:
                    ks = [k for k in (m.get("names") or {}) if k != m.get("me")]
                    if ks:
                        b.done_moment.add((b.label, rid, ph))
                        self.later(random.uniform(5, 30), lambda b=b, rid=rid, p=random.choice(ks): self._mom(b, "moment_pick", rid, p))

    def _mom(self, b, fn, rid, pick=None):
        args = {"p_round": rid}
        if pick is not None:
            args["p_pick"] = pick
        if b.tryrpc(fn, args, quiet=True) is not None:
            self.stats["moment_picks"] += 1
            log(b.label, fn, rid, pick or "")

    # ---------- ride (Bot-Erik drives) ----------
    def drive(self, b):
        r = b.rpc("ride_poll", {"p_lat": b.lat, "p_lng": b.lng}) or {}
        ride = r.get("ride") or {}
        if not ride.get("on"):
            return
        d = ride.get("drive")
        if d and d.get("live"):
            self.drive_step(b, d)
            return
        for o in ride.get("offers") or []:
            if o.get("status") == "open" and o.get("can_take", True) and not b.ride:
                b.ride = {"id": o["id"], "at": time.time(), "step": "asked"}
                log(b.label, "got a ride request", o["id"], "from", o.get("place"))
                self.later(random.uniform(5, 12), lambda b=b, rid=o["id"]: self._take(b, rid))

    def _take(self, b, rid):
        r = b.tryrpc("ride_take", {"p_id": rid})
        if r and r.get("ok"):
            self.stats["rides"] += 1
            b.ride = {"id": rid, "at": time.time(), "step": "taken"}
            b.tryrpc("ride_msg", {"p_id": rid, "p_text": "Jag tar den! Kommer om 2 min 🚗"}, quiet=True)
            log(b.label, "took ride", rid)
        else:
            b.ride = None

    def drive_step(self, b, d):
        rid = d.get("id")
        b.ride = b.ride or {"id": rid, "at": time.time(), "step": d.get("status")}
        plat, plng = d.get("pk_lat"), d.get("pk_lng")
        if plat and plng:   # drive ~12 % closer each tick (8 s): the rider sees the car come
            b.lat += (float(plat) - b.lat) * 0.12
            b.lng += (float(plng) - b.lng) * 0.12
        b.tryrpc("ride_pos", {"p_id": rid, "p_lat": b.lat, "p_lng": b.lng}, quiet=True)
        age = time.time() - b.ride["at"]
        st = d.get("status")
        if st != b.ride.get("seen"):   # the server can move the step itself (ride_pos near the pickup = Framme)
            b.ride["seen"] = st
            if st == "arrived":
                b.ride["at"] = time.time(); age = 0
                b.tryrpc("ride_msg", {"p_id": rid, "p_text": "Framme! Röd Volvo 🚗"}, quiet=True)
                log(b.label, "ride", rid, "is at the pickup")
        nxt = {"taken": ("enroute", 15), "enroute": ("arrived", 60), "arrived": ("done", 45)}.get(st)
        if nxt and age > nxt[1]:
            if b.tryrpc("ride_step", {"p_id": rid, "p_step": nxt[0]}) is not None:
                log(b.label, "ride", rid, "->", nxt[0])
                b.ride = {"id": rid, "at": time.time(), "step": nxt[0]}
                if nxt[0] == "done":
                    b.ride = None
                    b.lat, b.lng = b.bar["lat"], b.bar["lng"]

    # ---------- skål + friends ----------
    def skal_round(self):
        r = self.leader.rpc("poll_v2", {"p_min_lat": 55.0, "p_min_lng": 10.5, "p_max_lat": 69.5, "p_max_lng": 24.5}) or {}
        for p in r.get("pins") or []:
            if not p.get("is_friend") or self.is_bot_name(p.get("friend_name")) or p.get("id") in self.skald:
                continue
            self.skald.add(p["id"])
            b = random.choice([x for x in self.bots if x.label != "Bot-Erik"])
            def go(b=b, p=p):
                if b.tryrpc("skal", {"p_beer_id": p["id"]}, quiet=True) is not None:
                    self.stats["skal"] += 1
                    log(b.label, "skål on", p.get("friend_name"))
                    if random.random() < 0.4:
                        self.say(b, self.line("skal", name=(p.get("friend_name") or "du").split(" ")[0]))
            self.later(random.uniform(15, 60), go)

    def friends(self, b):
        inbox = b.rpc("my_inbox") or {}
        for it in (inbox.get("items") if isinstance(inbox, dict) else inbox) or []:
            if it.get("type") == "friend" and it.get("id"):
                r = b.tryrpc("friend_answer", {"p_id": it["id"], "p_accept": True, "p_name": b.label})
                if r is not None:
                    log(b.label, "accepted a friend request from", it.get("name"))

    # ---------- main loop ----------
    def run(self):
        self.setup()
        last_tick = 0
        try:
            while not self.stop and time.time() < self.t_end:
                now = time.time()
                due = [p for p in self.pending if p[0] <= now]
                self.pending = [p for p in self.pending if p[0] > now]
                for _, fn in due:
                    try:
                        fn()
                    except Exception as e:
                        log("later BUG", repr(e))
                for b in self.bots:
                    if b.rec.get("exp", 0) < now + 300:
                        b.ensure(self.store)
                self.every("chat", 4, self.poll_chat)
                self.every("spel_watch", 6, self.watch_spel)
                self.every("party_watch", 7, self.watch_party)
                for b in self.bots:
                    self.every("spel:" + b.label, 3, lambda b=b: self.play_spel(b))
                    self.every("party:" + b.label, 3.5, lambda b=b: self.play_party(b))
                    self.every("dm:" + b.label, 15, lambda b=b: self.poll_dms(b))
                    self.every("mom:" + b.label, 30, lambda b=b: self.play_moments(b))
                    self.every("pin:" + b.label, 240, lambda b=b: self.pin_move(b), jitter=0.5)
                    if b.role in ("friend", "leader"):
                        self.every("fr:" + b.label, 30, lambda b=b: self.friends(b))
                    if now >= b.next_beer:
                        b.next_beer = now + random.uniform(15 * 60, 35 * 60)
                        self.beer(b)
                if self.by_label["Bot-Erik"].role == "driver":
                    self.every("drive", 8, lambda: self.drive(self.by_label["Bot-Erik"]))
                self.every("skal", 45, self.skal_round)
                self.every("wander", 15 * 60, self.wander, jitter=0.4)
                if now - last_tick > 300:
                    last_tick = now
                    log("alive:", json.dumps(self.stats), "minutes left %.0f" % ((self.t_end - now) / 60))
                time.sleep(0.5)
        except KeyboardInterrupt:
            log("stopped by Ctrl+C")
        finally:
            self.finish()

    def wander(self):
        b = random.choice([x for x in self.bots if x.role not in ("driver",)])
        bar = random.choice([x for x in BARS if x is not b.bar])
        self.checkin(b, bar)
        if random.random() < 0.5:
            self.say(b, self.line("arrive", bar=bar["name"].split(" (")[0]))

    def finish(self):
        try:
            if not self.a.no_hello:
                self.say(self.leader, "Bots loggar ut för nu 👋 (starta igen: Actions → bots → Run workflow)", force=True)
            for b in self.bots:
                b.tryrpc("check_out", quiet=True)
                if b.role == "driver":
                    b.tryrpc("driver_set", {"p_on": False}, quiet=True)
        except Exception as e:
            log("finish:", e)
        self.store.save()
        log("DONE", json.dumps(self.stats))


def main():
    ap = argparse.ArgumentParser(description="PintsNow test bots (STAGING only)")
    ap.add_argument("--minutes", type=float, default=30)
    ap.add_argument("--friend", default=os.environ.get("BOTS_FRIEND_CODE", "").strip(), help="owner's friend code: Bot-Lisa + Bot-Johan send a request")
    ap.add_argument("--code", default="", help="join this group code instead of the shared Testgänget")
    ap.add_argument("--state", default=os.environ.get("BOTS_STATE") or os.path.join(os.path.expanduser("~"), ".pintsnow-bots", "state.json"))
    ap.add_argument("--quiet", action="store_true", help="start silent (no chat replies)")
    ap.add_argument("--no-hello", action="store_true", help="no hello / bye line in the chat")
    a = ap.parse_args()
    if not (0.5 <= a.minutes <= 180):
        raise SystemExit("--minutes must be 0.5–180")
    random.seed()
    import signal
    def _term(*_):   # Actions "Cancel run" / kill: stop cleanly (check out, save the sessions)
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, _term)
    Runner(a).run()


if __name__ == "__main__":
    main()
