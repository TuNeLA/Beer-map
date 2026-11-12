#!/usr/bin/env python3
"""Overture Maps places for Sweden: food / drink places and Systembolaget stores, as one small JSON file.

Used by the weekly Actions (bars.yml, hours.yml) as an OPTIONAL gap filler next to OpenStreetMap:
  - scripts/build-placeinfo.mjs: cuisine / website / phone for an OSM place that has none (source kept per field).
  - scripts/fetch-hours.mjs: Systembolaget stores that OSM does not have yet.
Licence: Overture places = CDLA-Permissive-2.0 (Meta, Microsoft, PinMeTo, ...), Apache-2.0 (Foursquare), CC0 (AllThePlaces).
No OSM data inside Overture places. See docs.overturemaps.org/attribution. Overture has NO price and NO opening hours.

Usage: pip install duckdb==2.0.0 && python3 scripts/overture-se.py <out.json> [release]
Out: {"v":1,"release":"2026-10-21.0","food":[[name, lat, lng, category, website, phone], ...],
      "sb":[[name, lat, lng, address, dataset], ...]}
The release defaults to the newest one in the Overture STAC catalog. Any error = exit 1 (the caller goes on without it).
"""
import json
import os
import sys
import urllib.request

import duckdb

BBOX = "bbox.xmin between 10.5 and 24.5 and bbox.ymin between 55.0 and 69.5"
FOOD = ("list_contains(taxonomy.hierarchy, 'food_and_drink') or taxonomy.primary ilike '%restaurant%' "
        "or taxonomy.primary in ('bar', 'pub', 'cafe', 'coffee_shop', 'bakery', 'brewery', 'lounge')")
SB = "names.primary ilike '%systembolaget%' or brand.names.primary ilike '%systembolaget%'"


def latest_release():
    with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=60) as r:
        cat = json.load(r)
    return cat["latest"]


def main():
    out = sys.argv[1]
    rel = sys.argv[2] if len(sys.argv) > 2 else latest_release()
    c = duckdb.connect()
    c.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    proxy = (os.environ.get("HTTPS_PROXY") or "").replace("http://", "")
    if proxy:
        c.execute(f"SET http_proxy='{proxy}'")
    # public bucket: anonymous access (an AWS key in the env would be sent and refused)
    c.execute("SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';")
    src = f"read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=places/type=place/*', hive_partitioning=1)"
    base = (f"from {src} where {BBOX} and addresses[1].country = 'SE' "
            "and coalesce(operating_status, 'open') = 'open' and coalesce(confidence, 0) >= 0.5")
    food = c.execute(
        "select names.primary, round(st_y(geometry), 5), round(st_x(geometry), 5), taxonomy.primary, websites[1], phones[1] "
        f"{base} and ({FOOD}) and names.primary is not null").fetchall()
    sb = c.execute(
        "select names.primary, round(st_y(geometry), 5), round(st_x(geometry), 5), addresses[1].freeform || coalesce(', ' || addresses[1].locality, ''), "
        "list_distinct(list_transform(sources, lambda x: x.dataset)) "
        f"{base} and ({SB})").fetchall()
    rows = [[n[:60], la, lo, cat or "", (w or "")[:150], (p or "")[:25]] for n, la, lo, cat, w, p in food]
    sbs = [[n or "Systembolaget", la, lo, (a or "")[:80], ",".join(d for d in (ds or []) if d != "Overture")] for n, la, lo, a, ds in sb]
    if len(rows) < 5000:
        print(f"Only {len(rows)} Overture food places: not writing {out}", file=sys.stderr)
        sys.exit(1)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "release": rel, "food": rows, "sb": sbs}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Overture {rel}: {len(rows)} food places, {len(sbs)} Systembolaget rows -> {out}")


if __name__ == "__main__":
    main()
