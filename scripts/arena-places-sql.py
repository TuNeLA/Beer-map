#!/usr/bin/env python3
"""Öl Nu — 🏟️ docs/arenas.json → SQL that upserts the arenas into bars_lite (type 'arena'; CONTRACT "ARENOR").
Usage: python3 scripts/arena-places-sql.py docs/arenas.json > arenas.sql   (run it in the SQL editor, then: select public.olnu_resnap();)
Migration 0106 was made with this script. Upsert only: an arena that leaves the list stays (the owner can switch it off in
stats.html like any bar: owner_bar_action close)."""
import json, sys
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "docs/arenas.json", encoding="utf-8"))
q = lambda s: "'" + str(s).replace("'", "''") + "'"
rows = [f"({q(a['id'])}, {q(a['name'][:200])}, {a['lat']}, {a['lng']})" for a in d.get("a", [])
        if isinstance(a.get("lat"), (int, float)) and 55 <= a["lat"] <= 69.1 and 10.9 <= a["lng"] <= 24.2]
print("insert into public.bars_lite (id, name, lat, lng, type, active, updated_at)")
print("select v.id, v.name, v.lat, v.lng, 'arena', true, now() from (values")
print(",\n".join(rows))
print(") as v(id, name, lat, lng)")
print("on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, type = 'arena', active = true, updated_at = now();")
print("\nselect public.olnu_resnap();")
