import json, subprocess, sys

pkgs = {
    "fast-uri": ["3.1.5", "4.0.1"],
    "hono": ["4.12.25", "4.12.26", "4.12.27"],
    "ip-address": ["10.3.1"],
    "nanoid": ["3.3.17", "5.1.6"],
    "next": ["15.5.21", "15.5.22", "16.2.11"],
    "postcss": ["8.5.12", "8.5.18"],
}

for pkg, want in pkgs.items():
    try:
        out = subprocess.run(["npm", "view", pkg, "versions", "--json"],
                             capture_output=True, text=True, timeout=30)
        versions = json.loads(out.stdout)
        have = [v for v in want if v in versions]
        print(f"{pkg}: want={want} -> present={have} latest={versions[-3:]}")
    except Exception as e:
        print(f"{pkg}: ERROR {e}")