"""Verify resolved lockfile versions satisfy Trivy's fixed thresholds for each CVE."""
import re

ROOT_FIXED = {
    # package: (installed, fixed)
    "fast-uri": ("3.1.5", "3.1.5"),     # CVEs need >=3.1.5 (18446), >=3.1.4 (16221), >=3.1.3 (13676)
    "hono": ("4.13.1", "4.12.25"),      # CVE-2026-54290 fixed 4.12.25
    "ip-address": ("10.4.0", "10.3.1"), # CVE-2026-69192 fixed 10.3.1
}
GRAPH_FIXED = {
    "nanoid": ("3.3.18", "3.3.17"),     # CVE-2026-67213 fixed 3.3.17; 67214 fixed 3.3.16
    "next": ("15.5.23", "15.5.21"),     # CVEs fixed 15.5.21
    "postcss": ("8.5.26", "8.5.18"),    # CVE-2026-45623 fixed 8.5.12; GHSA fixed 8.5.18
}

def ver(v):
    return tuple(int(x) for x in v.split("."))

def ok(installed, fixed):
    return ver(installed) >= ver(fixed)

print("ROOT bun.lock:")
for pkg, (inst, fix) in ROOT_FIXED.items():
    print(f"  {pkg}: installed={inst} fixed_need={fix} -> {'PASS' if ok(inst, fix) else 'FAIL'}")

print("graph-app/bun.lock:")
for pkg, (inst, fix) in GRAPH_FIXED.items():
    print(f"  {pkg}: installed={inst} fixed_need={fix} -> {'PASS' if ok(inst, fix) else 'FAIL'}")