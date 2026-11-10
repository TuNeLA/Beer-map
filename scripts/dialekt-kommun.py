#!/usr/bin/env python3
"""PintsNow dialect layer (D2): build docs/zones/dialekt-kommun.json for docs/js/dialekt.js.

Inputs (all in the repo):
  scripts/dialekt-kommuner.csv   the D1 research list: 290 kommuner, SCB code, regionA, regionB (owner edits THIS file)
  docs/zones/kommuner.json       SCB kommun borders (CC0, the same file the map zones use)
  docs/js/cities.js, docs/js/hometown.js (XY), docs/js/taxi-data.js   town names + positions → town aliases
Output:
  docs/zones/dialekt-kommun.json (zones/*.json is cached offline by sw.js DATA_RE)
    k      [[kod, name, a, b, lat, lng], ...]  a / b = index into "codes"; lat/lng = the SCB label point
    alias  {normalised town name: kod}         towns that are not kommun names (Grängesberg → 2085 Ludvika)
    grid   {lat0, lng0, dlat, dlng, rows}      coarse lat/lng → kommun lookup, one RLE string per row
           row token: "<idx base36>[*<run base36>]", "-" = outside (no Swedish kommun within ~10 km)
Usage: python3 scripts/dialekt-kommun.py [repo-root]     (stdlib only; deterministic; prints a check report)
"""
import csv, json, os, re, sys, unicodedata, random

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = lambda *a: os.path.join(ROOT, *a)

# research codes → layer codes (brief: sv-neutral, sv-norr). B codes keep their names.
RENAME = {"sv": "sv-neutral", "sv-norrland": "sv-norr"}
A_CODES = ["sv-neutral", "sv-syd", "sv-vast", "sv-sthlm", "sv-dalarna", "sv-norr"]
B_CODES = ["sv-smaland", "sv-varmland", "sv-norr-ovre", "sv-norr-mitt", "sv-gotland"]
CODES = A_CODES + B_CODES
NAMES = {"sv-neutral": "Neutral", "sv-syd": "Syd", "sv-vast": "Väst", "sv-sthlm": "Stockholm", "sv-dalarna": "Dalarna",
         "sv-norr": "Norrland", "sv-smaland": "Småland", "sv-varmland": "Värmland", "sv-norr-ovre": "Övre Norrland",
         "sv-norr-mitt": "Mitt-Norrland", "sv-gotland": "Gotland"}
# cell ≈ 2.8 × 2.8 km at 60°N; sea / border cells take the nearest kommun within FILL cells (≈ 10 km)
DLAT, DLNG, FILL = float(os.environ.get("DK_DLAT", 0.025)), float(os.environ.get("DK_DLNG", 0.05)), int(os.environ.get("DK_FILL", 4))
# Hand fixes: the simplified SCB border puts these town points in the wrong kommun (checked by hand: Grängesberg is in
# Ludvika kommun). Key = norm(town), value = SCB kommunkod. The town's grid cell is forced too.
FIX = {"grängesberg": "2085"}


def norm(s):
    """Same as dialekt.js norm(): no (…) part, no ' kommun', only a–z 0–9 å ä ö (other accents dropped: é → e).
    å ä ö stay: Habo ≠ Håbo."""
    s = re.sub(r"\([^)]*\)", " ", str(s or "")).lower().strip()
    s = re.sub(r"\s+kommun$", "", s)
    s = unicodedata.normalize("NFC", s)
    out = []
    for ch in s:
        if re.match(r"[a-z0-9åäö]", ch): out.append(ch); continue
        out.append(re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", ch)))
    return "".join(out)


def b36(n):
    d = "0123456789abcdefghijklmnopqrstuvwxyz"; o = ""
    while True:
        o = d[n % 36] + o; n //= 36
        if not n: return o


def rings(g):
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []


def in_poly(poly, x, y):
    inside = False
    for k, r in enumerate(poly):
        c = False; j = len(r) - 1
        for i in range(len(r)):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
            j = i
        if k == 0: inside = c
        elif c: inside = False
    return inside


def main():
    rows = list(csv.DictReader(open(P("scripts", "dialekt-kommuner.csv"), encoding="utf-8")))
    assert len(rows) == 290, "expected 290 kommuner, got %d" % len(rows)
    geo = json.load(open(P("docs", "zones", "kommuner.json"), encoding="utf-8"))
    feats = {f["properties"]["k"]: f for f in geo["features"]}
    assert len(feats) == 290, "kommuner.json: %d features" % len(feats)

    K = []; by_kod = {}; seen_norm = {}
    for r in sorted(rows, key=lambda r: r["kommunkod"]):
        kod = r["kommunkod"].strip().zfill(4)
        a = RENAME.get(r["regionA"].strip(), r["regionA"].strip()); b = RENAME.get(r["regionB"].strip(), r["regionB"].strip())
        assert a in A_CODES, "%s: bad regionA %s" % (kod, a)
        assert b in CODES, "%s: bad regionB %s" % (kod, b)
        assert kod in feats, "%s not in kommuner.json" % kod
        n = norm(r["kommun"]); assert n not in seen_norm, "name clash %s / %s" % (r["kommun"], seen_norm.get(n)); seen_norm[n] = r["kommun"]
        p = feats[kod]["properties"]
        by_kod[kod] = len(K)
        K.append([kod, r["kommun"].strip(), CODES.index(a), CODES.index(b), round(p["y"], 3), round(p["x"], 3)])

    # ---- point → kommun (exact, SCB polygons) ----
    polys = []
    for kod, f in feats.items():
        for poly in rings(f["geometry"]):
            xs = [c[0] for c in poly[0]]; ys = [c[1] for c in poly[0]]
            polys.append((min(xs), min(ys), max(xs), max(ys), poly, by_kod[kod]))

    def kommun_at(lat, lng):
        for x0, y0, x1, y1, poly, i in polys:
            if x0 <= lng <= x1 and y0 <= lat <= y1 and in_poly(poly, lng, lat): return i
        return -1

    def kommun_near(lat, lng):   # like zones.js zoneAt(): a few points ~1–3 km around (simplified coast)
        i = kommun_at(lat, lng)
        if i >= 0: return i
        import math
        for d in (0.01, 0.02, 0.03):
            for a in range(8):
                i = kommun_at(lat + d * math.sin(a * 0.785), lng + 2 * d * math.cos(a * 0.785))
                if i >= 0: return i
        return -1

    # ---- grid ----
    lats = [p[1] for p in polys] + [p[3] for p in polys]; lngs = [p[0] for p in polys] + [p[2] for p in polys]
    lat0 = round((int(min(lats) / DLAT) - 1) * DLAT, 4); lng0 = round((int(min(lngs) / DLNG) - 1) * DLNG, 4)
    NR = int((max(lats) - lat0) / DLAT) + 2; NC = int((max(lngs) - lng0) / DLNG) + 2
    G = [[kommun_at(lat0 + (r + 0.5) * DLAT, lng0 + (c + 0.5) * DLNG) for c in range(NC)] for r in range(NR)]
    land = sum(1 for r in G for v in r if v >= 0)
    for _ in range(FILL):   # grow the land 1 cell per pass (majority of the 8 neighbours) → coast, islands, borders
        N = [row[:] for row in G]
        for r in range(NR):
            for c in range(NC):
                if G[r][c] >= 0: continue
                cnt = {}
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        rr, cc = r + dr, c + dc
                        if 0 <= rr < NR and 0 <= cc < NC and G[rr][cc] >= 0: cnt[G[rr][cc]] = cnt.get(G[rr][cc], 0) + 1
                if cnt: N[r][c] = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        G = N
    # make sure every kommun has its label cell (tiny kommuner can fall between cell centres)
    for i, k in enumerate(K):
        r = int((k[4] - lat0) / DLAT); c = int((k[5] - lng0) / DLNG)
        if G[r][c] != i and kommun_at(k[4], k[5]) == i: G[r][c] = i

    # ---- town aliases + town cells (people are in towns: the cell of every known town is its own kommun) ----
    towns = {}
    src = open(P("docs", "js", "cities.js"), encoding="utf-8").read()
    for m in re.finditer(r'\["([^"]+)",\s*([\d.]+),\s*([\d.]+)\]', src): towns.setdefault(m.group(1), (float(m.group(2)), float(m.group(3))))
    src = open(P("docs", "js", "hometown.js"), encoding="utf-8").read()
    m = re.search(r"var XY = \{(.*?)\};", src, re.S)
    if m:
        for t in re.finditer(r'"([^"]+)":\s*\[([\d.]+),\s*([\d.]+)\]', m.group(1)): towns.setdefault(t.group(1), (float(t.group(2)), float(t.group(3))))
    src = open(P("docs", "js", "taxi-data.js"), encoding="utf-8").read()
    for t in re.finditer(r'"town":"([^"]+)","lat":([\d.]+),"lng":([\d.]+)', src): towns.setdefault(t.group(1), (float(t.group(2)), float(t.group(3))))
    alias = {}; miss = []; forced = []
    for name, (la, ln) in sorted(towns.items()):
        n = norm(name)
        if not n: continue
        if n in seen_norm: i = by_kod[[k for k in K if norm(k[1]) == n][0][0]]
        elif n in FIX: i = by_kod[FIX[n]]
        else: i = kommun_near(la, ln)
        if i < 0: miss.append(name); continue
        if n not in seen_norm: alias[n] = K[i][0]
        r = int((la - lat0) // DLAT); c = int((ln - lng0) // DLNG)
        if G[r][c] != i: forced.append("%s %s→%s" % (name, K[G[r][c]][1] if G[r][c] >= 0 else "-", K[i][1])); G[r][c] = i

    def enc(row):
        out = []; i = 0
        while i < len(row):
            j = i
            while j < len(row) and row[j] == row[i]: j += 1
            v = "-" if row[i] < 0 else b36(row[i]); n = j - i
            out.append(v if n == 1 else v + "*" + b36(n)); i = j
        return ",".join(out)
    rows_enc = [enc(r) for r in G]
    # trim fully-outside rows at the ends is not needed: they encode as "-*xx" (4 chars)

    def grid_at(lat, lng):
        r = int((lat - lat0) // DLAT); c = int((lng - lng0) // DLNG)
        return G[r][c] if 0 <= r < NR and 0 <= c < NC else -1

    # ---- checks ----
    bad_label = [k[1] for i, k in enumerate(K) if grid_at(k[4], k[5]) != i]
    bad_label_reg = [k[1] for i, k in enumerate(K) if grid_at(k[4], k[5]) < 0 or K[grid_at(k[4], k[5])][2] != k[2]]
    rnd = random.Random(7); tot = wrongk = wronga = 0
    while tot < 20000:
        la = rnd.uniform(55.3, 69.1); ln = rnd.uniform(11.0, 24.2); i = kommun_at(la, ln)
        if i < 0: continue
        tot += 1; g = grid_at(la, ln)
        if g != i: wrongk += 1
        if g < 0 or K[g][2] != K[i][2]: wronga += 1

    data = {
        "v": 1, "cc": "SE", "lang": "sv", "scheme": "A",
        "src": "D1 research 2026-11-10 (scripts/dialekt-kommuner.csv) + SCB Digitala gränser (CC0). Built by scripts/dialekt-kommun.py.",
        "codes": CODES, "names": [NAMES[c] for c in CODES], "nA": len(A_CODES),
        "k": K, "alias": alias,
        "grid": {"lat0": lat0, "lng0": lng0, "dlat": DLAT, "dlng": DLNG, "rows": rows_enc},
    }
    out = P("docs", "zones", "dialekt-kommun.json")
    s = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    open(out, "w", encoding="utf-8").write(s + "\n")
    cnt = {}
    for k in K: cnt[CODES[k[2]]] = cnt.get(CODES[k[2]], 0) + 1
    print("dialekt-kommun.json: %d bytes, %d kommuner, %d aliases, grid %d×%d (land cells %d)" % (len(s.encode()), len(K), len(alias), NR, NC, land))
    print("A regions:", ", ".join("%s %d" % (c, cnt.get(c, 0)) for c in A_CODES))
    print("grid check, 20000 random points in Sweden: wrong kommun %.2f %%, wrong A region %.2f %%" % (100.0 * wrongk / tot, 100.0 * wronga / tot))
    print("label points: wrong kommun %d %s, wrong region %d %s" % (len(bad_label), bad_label[:8], len(bad_label_reg), bad_label_reg))
    print("town cells forced to their own kommun (%d of %d towns): %s" % (len(forced), len(towns), "; ".join(forced)))
    if miss: print("towns with no kommun (outside Sweden?):", miss)
    if bad_label_reg: sys.exit("FAIL: a kommun label point maps to another region")


if __name__ == "__main__":
    main()
