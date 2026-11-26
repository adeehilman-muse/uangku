#!/usr/bin/env python3
"""Redeploy UangKu PWA (uang-tracker-web) to Vercel production, project 'uangku' (team ahmu1).

Uses the Vercel CLI, NOT the MCP connection: the MCP connection lost team scope
2026-11-09 (list_teams empty, all team calls 403) and re-auth 2026-11-12 did NOT
restore it — authorize_team_access is not exposed as an MCP tool. The CLI
(~/.npm-global/bin/vercel, logged in as miminnekopoi-6239) HAS team ahmu1 access.
Project is linked: ~/workspace/uang-tracker-web/.vercel/project.json.

Usage: python3 deploy_uangku.py — deploys, then verifies live data.json version.
"""
import json, os, subprocess

WEB = os.environ.get("UANGKU_WEB_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web"))
VERCEL = os.environ.get("VERCEL_BIN", "/home/hatch/.npm-global/bin/vercel")
VERCEL_SCOPE = os.environ.get("VERCEL_SCOPE", "ahmu1")
LIVE_URL = os.environ.get("UANGKU_LIVE_URL", "https://uangku-ahmu1.vercel.app")

# Egress proxy env (needed for api.vercel.com from this VM)
for line in open(os.path.expanduser(os.environ.get("UANGKU_EGRESS_ENV", "~/.secrets/egress-proxy-env"))):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

out = subprocess.run(
    [VERCEL, "deploy", "--prod", "--scope", VERCEL_SCOPE, "--yes"],
    cwd=WEB, capture_output=True, text=True, timeout=300)
print(out.stdout[-1500:])
print(out.stderr[-500:])

# Verify live data.json matches local snapshot version
local = json.load(open(os.path.join(WEB, "data.json")))
live = subprocess.run(
    ["curl", "-s", "-m", "20", f"{LIVE_URL}/data.json"],
    capture_output=True, text=True, timeout=60)
try:
    live_ver = json.loads(live.stdout).get("version")
except Exception:
    live_ver = None
print(f"local version: {local.get('version')} | live version: {live_ver} | "
      f"{'OK live sama' if live_ver == local.get('version') else 'BELUM SAMA — cek deploy'}")
