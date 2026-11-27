const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.end(JSON.stringify(body));
}

async function sb(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env belum diset di Vercel");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function auth(req, res) {
  const key = bearer(req);
  if (!key) { send(res, 401, { ok: false, error: "API key kosong" }); return null; }
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const rows = await sb(`api_keys?key_hash=eq.${hash}&select=id,owner_id,label&limit=1`);
  if (!rows || !rows.length) { send(res, 401, { ok: false, error: "API key tidak valid" }); return null; }
  sb(`api_keys?id=eq.${rows[0].id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});
  return rows[0].owner_id;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function nextId(table) {
  const rows = await sb(`${table}?select=id&order=id.desc&limit=1`);
  return (rows && rows.length ? rows[0].id : 0) + 1;
}

function wibNow() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

module.exports = { send, sb, auth, readBody, nextId, wibNow };
