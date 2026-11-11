#!/usr/bin/env python3
"""Fail if any JWT in the tracked files has a role other than 'anon' (e.g. a Supabase service_role key).
Prints only file, line and role, never the token. Usage: python3 scripts/check-jwt-roles.py [repo root]"""
import base64, json, re, subprocess, sys
root = sys.argv[1] if len(sys.argv) > 1 else "."
files = subprocess.check_output(["git", "-C", root, "ls-files"]).decode().split("\n")
pat = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}")
bad = 0; seen = 0
for f in files:
    if not f: continue
    try: txt = open(f"{root}/{f}", encoding="utf-8", errors="ignore").read()
    except Exception: continue
    for i, line in enumerate(txt.split("\n"), 1):
        for m in pat.finditer(line):
            p = m.group(1); p += "=" * (-len(p) % 4)
            try: role = json.loads(base64.urlsafe_b64decode(p)).get("role")
            except Exception: role = "?"
            seen += 1
            if role != "anon":
                bad += 1; print(f"FAIL {f}:{i} JWT role={role!r} (only anon keys may be in the repo)")
print(f"check-jwt-roles: {seen} JWT(s), {bad} not anon")
sys.exit(1 if bad else 0)
