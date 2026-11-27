const { send, sb, auth, readBody, nextId } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST saja" });
  try {
    const owner = await auth(req, res);
    if (!owner) return;
    const b = await readBody(req);
    const amount = Math.round(Number(b.amount));
    const direction = b.direction === "in" ? "in" : "out";
    if (!amount || amount <= 0) return send(res, 400, { ok: false, error: "amount harus > 0" });
    const date = b.date || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const accountId = b.account_id == null || b.account_id === "" ? null : Number(b.account_id);

    let acc = null;
    if (accountId != null) {
      const rows = await sb(`accounts?id=eq.${accountId}&owner_id=eq.${encodeURIComponent(owner)}&select=id,name,balance&limit=1`);
      if (!rows || !rows.length) return send(res, 400, { ok: false, error: "account_id bukan milik user ini" });
      acc = rows[0];
    }

    const tx = {
      id: await nextId("transactions"),
      owner_id: owner,
      amount,
      note: String(b.note || ""),
      direction,
      category: String(b.category || "lain-lain"),
      date,
      ...(accountId != null ? { account_id: accountId } : {}),
    };
    const inserted = await sb("transactions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(tx),
    });

    let balance = null;
    if (acc) {
      balance = Number(acc.balance) + (direction === "in" ? amount : -amount);
      await sb(`accounts?id=eq.${acc.id}&owner_id=eq.${encodeURIComponent(owner)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ balance, updated_at: new Date().toISOString() }),
      });
    }
    send(res, 200, { ok: true, owner_id: owner, transaction: inserted[0] || tx, account_balance: balance });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e.message || e) });
  }
};
