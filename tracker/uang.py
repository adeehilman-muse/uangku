#!/usr/bin/env python3
"""CLI asisten untuk UangKu v3 — backend Supabase (PostgREST, service_role key).
Sumber data: Supabase project "uangku" (rgeugpcglkztiojwwkzg). sqlite VPS + Flask
127.0.0.1:8091 kini hanya cadangan (uang.py.sqlite-bak = CLI lama).

  uang.py out 20000 "kopi" --cat makan [--date 2026-11-01] [--acc 3]
  uang.py in 7100000 "gaji" --cat gaji [--date 2026-11-01] [--acc 3]
  uang.py acc-add "Bank Jago" --kind bank --balance 13185200
  uang.py acc-balance 3 13000000
  uang.py acc-list
  uang.py invest saham JGLE 1054 47.23 --note "..."
  uang.py price JGLE 30 --source "..."
  uang.py flow [--month 2026-11]
  uang.py del-tx 12
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))
SECRETS = os.path.expanduser(os.environ.get("UANGKU_SECRETS", "~/.secrets/supabase-uangku"))
EGRESS_ENV = os.path.expanduser(os.environ.get("UANGKU_EGRESS_ENV", "~/.secrets/egress-proxy-env"))


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


def _cfg():
    cfg = load_env(SECRETS)
    for k, v in load_env(EGRESS_ENV).items():
        os.environ.setdefault(k, v)
    return cfg["SUPABASE_URL"], cfg["SUPABASE_SERVICE_ROLE_KEY"]


URL, KEY = _cfg()


def call(method, path, data=None, prefer=None):
    headers = [
        "-H", f"apikey: {KEY}",
        "-H", f"Authorization: Bearer {KEY}",
        "-H", "Content-Type: application/json",
    ]
    if prefer:
        headers += ["-H", f"Prefer: {prefer}"]
    cmd = ["curl", "-s", "--max-time", "30", "-w", "\n%{http_code}",
           URL + path] + headers
    if method in ("POST", "PATCH"):
        cmd += ["-X", method, "--data", json.dumps(data, ensure_ascii=False)]
    elif method == "DELETE":
        cmd += ["-X", "DELETE"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    body, _, code = out.stdout.rpartition("\n")
    code = int(code) if code.strip().isdigit() else 0
    parsed = None
    if body.strip():
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
    if code >= 400:
        print(f"Supabase error {code}: {body[:500]}", file=sys.stderr)
        sys.exit(1)
    return parsed


def rp(n):
    return f"Rp {n:,.0f}".replace(",", ".")


def today():
    return datetime.now(WIB).strftime("%Y-%m-%d")


def next_id(table, idcol="id"):
    rows = call("GET", f"/rest/v1/{table}?select={idcol}&order={idcol}.desc&limit=1")
    return (rows[0][idcol] if rows else 0) + 1


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("out", "in"):
        a = sub.add_parser(name); a.add_argument("amount", type=int); a.add_argument("note")
        a.add_argument("--cat", default="lain-lain"); a.add_argument("--date"); a.add_argument("--acc", type=int); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    a = sub.add_parser("acc-add"); a.add_argument("name"); a.add_argument("--kind", default="bank")
    a.add_argument("--balance", type=float, default=0); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    a = sub.add_parser("acc-balance"); a.add_argument("id", type=int); a.add_argument("balance", type=float); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    a = sub.add_parser("acc-list"); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    a = sub.add_parser("invest"); a.add_argument("kind"); a.add_argument("symbol")
    a.add_argument("qty", type=float); a.add_argument("avg_price", type=float)
    a.add_argument("--date"); a.add_argument("--note", default=""); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    a = sub.add_parser("price"); a.add_argument("symbol"); a.add_argument("price", type=float)
    a.add_argument("--source", default="")
    a = sub.add_parser("flow"); a.add_argument("--month"); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    a = sub.add_parser("del-tx"); a.add_argument("id", type=int); a.add_argument("--owner", default=os.environ.get("UANGKU_OWNER", "ade"))
    args = ap.parse_args()

    if args.cmd in ("out", "in"):
        direction = "out" if args.cmd == "out" else "in"
        tid = next_id("transactions")
        r = call("POST", "/rest/v1/transactions",
                 {"id": tid, "owner_id": args.owner, "amount": args.amount, "note": args.note,
                  "direction": direction, "category": args.cat,
                  "date": args.date or today(),
                  **({"account_id": args.acc} if args.acc else {})},
                 prefer="return=representation")
        print({"id": tid, "ok": True})
        if args.acc:
            acc = call("GET", f"/rest/v1/accounts?id=eq.{args.acc}&owner_id=eq.{args.owner}&select=id,name,balance")[0]
            new_bal = acc["balance"] + (args.amount if direction == "in" else -args.amount)
            call("PATCH", f"/rest/v1/accounts?id=eq.{args.acc}&owner_id=eq.{args.owner}",
                 {"balance": new_bal, "updated_at": datetime.now(WIB).isoformat()})
            print(f"saldo {acc['name']}: {rp(acc['balance'])} -> {rp(new_bal)}")
    elif args.cmd == "acc-add":
        aid = next_id("accounts")
        print(call("POST", "/rest/v1/accounts",
                   {"id": aid, "owner_id": args.owner, "name": args.name, "kind": args.kind,
                    "balance": args.balance},
                   prefer="return=representation"))
    elif args.cmd == "acc-balance":
        print(call("PATCH", f"/rest/v1/accounts?id=eq.{args.id}&owner_id=eq.{args.owner}",
                   {"balance": args.balance, "updated_at": datetime.now(WIB).isoformat()},
                   prefer="return=representation"))
    elif args.cmd == "acc-list":
        accs = call("GET", f"/rest/v1/accounts?select=*&owner_id=eq.{args.owner}&order=kind,name")
        for a in accs:
            print(f"[{a['id']}] {a['kind']:7} {a['name']:20} {rp(a['balance'])}")
        net = sum(a["balance"] for a in accs if a["kind"] != "invest")
        inv = sum(a["balance"] for a in accs if a["kind"] == "invest")
        print(f"Aset bersih: {rp(net)} | akun investasi: {rp(inv)}")
    elif args.cmd == "invest":
        iid = next_id("investments")
        print(call("POST", "/rest/v1/investments",
                   {"id": iid, "owner_id": args.owner, "kind": args.kind, "symbol": args.symbol,
                    "qty": args.qty, "avg_price": args.avg_price,
                    "date": args.date or today(), "note": args.note},
                   prefer="return=representation"))
    elif args.cmd == "price":
        print(call("POST", "/rest/v1/prices",
                   {"symbol": args.symbol, "price": args.price,
                    "source": args.source, "updated_at": datetime.now(WIB).isoformat()},
                   prefer="return=representation,resolution=merge-duplicates"))
    elif args.cmd == "flow":
        month = args.month or datetime.now(WIB).strftime("%Y-%m")
        y, m = map(int, month.split("-"))
        end = (datetime(y + (m == 12), m % 12 + 1, 1)).strftime("%Y-%m-%d")
        txs = call("GET", "/rest/v1/transactions?select=*"
                          f"&owner_id=eq.{args.owner}&date=gte.{month}-01&date=lt.{end}&order=date")
        income = sum(t["amount"] for t in txs if t["direction"] == "in")
        expense = sum(t["amount"] for t in txs if t["direction"] == "out")
        print(f"[{month}] masuk: {rp(income)} | keluar: {rp(expense)} | surplus: {rp(income - expense)}")
        for d, label in (("out", "out"), ("in", "in")):
            agg = {}
            for t in txs:
                if t["direction"] == d:
                    agg.setdefault(t["category"], [0, 0])
                    agg[t["category"]][0] += t["amount"]
                    agg[t["category"]][1] += 1
            for c, (v, n) in sorted(agg.items(), key=lambda x: -x[1][0]):
                print(f"  {label} {c}: {rp(v)} ({n}x)")
    elif args.cmd == "del-tx":
        call("DELETE", f"/rest/v1/transactions?id=eq.{args.id}&owner_id=eq.{args.owner}")
        print({"id": args.id, "ok": True, "deleted": True})


main()
