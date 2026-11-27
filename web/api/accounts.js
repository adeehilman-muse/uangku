const { send, sb, auth, readBody, nextId } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  try {
    const owner = await auth(req, res);
    if (!owner) return;
    if (req.method === "GET") {
      const accounts = await sb(`accounts?select=*&owner_id=eq.${encodeURIComponent(owner)}&order=kind,name`);
      return send(res, 200, { ok: true, owner_id: owner, accounts });
    }
    if (req.method === "POST") {
      const b = await readBody(req);
      const name = String(b.name || "").trim();
      if (!name) return send(res, 400, { ok: false, error: "name kosong" });
      const acc = {
        id: await nextId("accounts"),
        owner_id: owner,
        name,
        kind: String(b.kind || "bank"),
        balance: Number(b.balance || 0),
        note: String(b.note || ""),
        account_no: String(b.account_no || ""),
      };
      const inserted = await sb("accounts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(acc),
      });
      return send(res, 200, { ok: true, owner_id: owner, account: inserted[0] || acc });
    }
    return send(res, 405, { ok: false, error: "GET/POST saja" });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e.message || e) });
  }
};
