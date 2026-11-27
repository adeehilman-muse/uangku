const { send, sb, auth, wibNow } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "GET saja" });
  try {
    const owner = await auth(req, res);
    if (!owner) return;
    const q = `owner_id=eq.${encodeURIComponent(owner)}`;
    const [accounts, transactions, investments, prices] = await Promise.all([
      sb(`accounts?select=*&${q}&order=kind,name`),
      sb(`transactions?select=*&${q}&order=date.desc,id.desc&limit=2000`),
      sb(`investments?select=*&${q}&order=kind,symbol`),
      sb(`prices?select=*&order=symbol`),
    ]);
    send(res, 200, {
      ok: true,
      owner_id: owner,
      version: Math.floor(Date.now() / 1000),
      exported_at: wibNow(),
      accounts,
      transactions,
      investments,
      prices,
    });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e.message || e) });
  }
};
