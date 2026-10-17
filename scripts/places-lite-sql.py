#!/usr/bin/env python3
"""Make SQL that copies docs/places.json (restaurants, cafés, fast food) into public.bars_lite.

The server snaps strangers' precise pins to these places (40 m; bars 75 m) and returns their bar_id,
so beers at a restaurant count there (CONTRACT "v14 CLIENT"). Ids are "pl_<lat*1e5>_<lng*1e5>", the
same rule as docs/js/bars.js. Run after a places.json refresh, paste each chunk into the SQL editor
(or the Supabase MCP), then run:  select public.olnu_resnap();

The data is packed (base36 deltas) so one chunk of 3200 places is ~20 KB. Each chunk checks its own
count and sums and inserts nothing when they do not match.

Usage: python3 -I scripts/places-lite-sql.py docs/places.json OUT_DIR [chunk_size]
"""
import json
import os
import sys

D = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def b36(n, w=0):
    s = ""
    while n:
        s = D[n % 36] + s
        n //= 36
    return (s or "0").rjust(w, "0")


SQL = """create or replace function pg_temp.b36(t text) returns bigint language sql immutable as $f$
  select coalesce(sum((strpos('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', substr(t, i, 1)) - 1)::bigint * (36::bigint ^ (length(t) - i))::bigint), 0)::bigint from generate_series(1, length(t)) i $f$;
with m as (select x.r[1] d, x.r[2] t, x.r[3] l, x.ord from regexp_matches('%(data)s', '([0-9A-Z]+)([rfc])([0-9A-Z]{4})', 'g') with ordinality as x(r, ord)),
v as (select 5500000 + sum(pg_temp.b36(m.d)) over (order by m.ord) la, 1090000 + pg_temp.b36(m.l) ln, m.t from m),
ok as (select (select count(*) from v) = %(n)d and (select sum(la) from v) = %(sla)d and (select sum(ln) from v) = %(sln)d as good),
ins as (insert into public.bars_lite (id, name, lat, lng, type, active)
  select 'pl_' || v.la || '_' || v.ln, null, (v.la::numeric / 100000)::float8, (v.ln::numeric / 100000)::float8,
         case v.t when 'r' then 'restaurant' when 'f' then 'fast_food' else 'cafe' end, true from v, ok where ok.good
  on conflict (id) do update set lat = excluded.lat, lng = excluded.lng, type = excluded.type, active = true, updated_at = now()
  returning 1)
select (select good from ok) good, (select count(*) from ins) inserted;
"""


def main():
    src, out = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 3200
    rows = {}
    for x in json.load(open(src)):
        try:
            la, ln, t = round(float(x[1]) * 1e5), round(float(x[2]) * 1e5), x[3]
        except Exception:
            continue
        if t in ("r", "f", "c") and 5500000 <= la <= 6910000 and 1090000 <= ln <= 2420000:
            rows.setdefault((la, ln), t)
    keys = sorted(rows)
    os.makedirs(out, exist_ok=True)
    for ci in range(0, len(keys), size):
        part, prev, data = keys[ci:ci + size], 5500000, []
        for la, ln in part:
            data.append(b36(la - prev) + rows[(la, ln)] + b36(ln - 1090000, 4))
            prev = la
        sql = SQL % {"data": "".join(data), "n": len(part), "sla": sum(k[0] for k in part), "sln": sum(k[1] for k in part)}
        with open(os.path.join(out, "places-%02d.sql" % (ci // size)), "w") as f:
            f.write(sql)
    # Places that left places.json stay in bars_lite but stop snapping:
    ids = ",".join("'pl_%d_%d'" % k for k in keys)
    with open(os.path.join(out, "places-zz-inactive.sql"), "w") as f:
        f.write("update public.bars_lite set active = false, updated_at = now() where active and id like 'pl\\_%%' and id not in (%s);\n" % ids)
        f.write("select public.olnu_resnap();\n")
    print(len(keys), "places,", (len(keys) + size - 1) // size, "chunks in", out, file=sys.stderr)


if __name__ == "__main__":
    main()
