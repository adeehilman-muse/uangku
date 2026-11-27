#!/usr/bin/env python3
"""Export snapshot Supabase UangKu -> data.json untuk PWA local-first.

PWA tidak lagi memanggil API. Ia memuat data.json (statis, dibundel saat
deploy) sebagai seed/sync, lalu semua baca-tulis terjadi di localStorage HP.

Sumber data: Supabase project "uangku" (PostgREST, service_role key).
Versi sqlite lama tersimpan di export_snapshot.py.sqlite-bak.

Jalankan setiap kali ada transaksi/akun/investasi baru dari chat:
    python3 export_snapshot.py
lalu deploy ulang folder uang-tracker-web ke Vercel (saat akses tim pulih).

Merge di PWA (lihat app.js):
- transactions: append-only berdasarkan id (id server = int, id lokal = "l...").
- accounts/investments/prices: diganti snapshot bila snapshot.version lebih baru.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
_default_web = Path(__file__).resolve().parents[1] / "web"
if not _default_web.exists():
    _default_web = Path.home() / "workspace" / "uang-tracker-web"
OUT = Path(os.environ.get("UANGKU_WEB_DIR", _default_web)) / "data.json"
WIB = timezone(timedelta(hours=7))
SECRETS = Path(os.path.expanduser(os.environ.get("UANGKU_SECRETS", "~/.secrets/supabase-uangku")))
EGRESS_ENV = Path(os.path.expanduser(os.environ.get("UANGKU_EGRESS_ENV", "~/.secrets/egress-proxy-env")))


def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def get(table, query):
    cfg = load_env(SECRETS)
    for k, v in load_env(EGRESS_ENV).items():
        os.environ.setdefault(k, v)
    cmd = ["curl", "-s", "--max-time", "30", "-w", "\n%{http_code}",
           f"{cfg['SUPABASE_URL']}/rest/v1/{table}?{query}",
           "-H", f"apikey: {cfg['SUPABASE_SERVICE_ROLE_KEY']}",
           "-H", f"Authorization: Bearer {cfg['SUPABASE_SERVICE_ROLE_KEY']}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    body, _, code = out.stdout.rpartition("\n")
    if int(code) >= 400:
        print(f"Supabase error {code}: {body[:300]}", file=sys.stderr)
        sys.exit(1)
    return json.loads(body)


def main():
    owner = os.environ.get("UANGKU_OWNER", "ade")
    q = f"owner_id=eq.{owner}"
    snap = {
        "owner_id": owner,
        "version": int(time.time()),
        "exported_at": datetime.now(WIB).strftime("%Y-%m-%d %H:%M:%S"),
        "accounts": get("accounts", f"select=*&{q}&order=kind,name"),
        "transactions": get("transactions",
                            f"select=*&{q}&order=date.desc,id.desc&limit=2000"),
        "investments": get("investments", f"select=*&{q}&order=kind,symbol"),
        "prices": get("prices", "select=*&order=symbol"),
    }
    OUT.write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")))
    print(f"OK {OUT} v{snap['version']} "
          f"({len(snap['accounts'])} akun, {len(snap['transactions'])} tx, "
          f"{len(snap['investments'])} inv)")


if __name__ == "__main__":
    main()
