/* UangKu v3 — local-first. TANPA API: semua data di localStorage HP.
   data.json (statis, dibundel saat deploy) dipakai sebagai seed & sync satu arah:
   - transactions: digabung append-only berdasarkan id
   - accounts/investments/prices: diganti snapshot bila snapshot.version lebih baru
   Chat "kopi 20rb" tetap dicatat via backend, lalu snapshot di-export & deploy ulang. */
const LS_KEY = "uq_local_v1";
const $ = (id) => document.getElementById(id);
const fmtRp = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const MONTHS_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const CATS = {
  in: ["gaji", "bonus", "lain-lain"],
  out: ["makan", "bensin", "pacaran", "self-reward", "tagihan", "sedekah", "tabungan", "investasi", "ai", "lain-lain"],
};
const KIND_LABEL = { bank: "Bank", ewallet: "E-Wallet", invest: "Investasi", cash: "Tunai", other: "Lainnya" };
const KIND_ORDER = ["bank", "ewallet", "cash", "invest", "other"];

const CAT_COLOR = {
  "makan": "#FBBF24", "bensin": "#60A5FA", "pacaran": "#F472B6",
  "self-reward": "#A78BFA", "tagihan": "#94A3B8", "sedekah": "#34D399",
  "tabungan": "#22D3EE", "investasi": "#FB7185", "gaji": "#34D399",
  "bonus": "#22D3EE", "ai": "#FB923C", "lain-lain": "#64748B",
};
const CAT_LABEL = {
  "makan": "Makan", "bensin": "Bensin", "pacaran": "Pacaran",
  "self-reward": "Self reward", "tagihan": "Tagihan", "sedekah": "Sedekah",
  "tabungan": "Tabungan", "investasi": "Investasi", "gaji": "Gaji",
  "bonus": "Bonus", "ai": "AI", "lain-lain": "Lainnya",
};
const catName = (c) => CAT_LABEL[c] || c;
const catColor = (c) => CAT_COLOR[c] || "#64748B";

let DB = { version: 0, exported_at: "", accounts: [], transactions: [], investments: [], prices: [] };
let cur = new Date(); cur.setDate(1);
let direction = "out";
let selectedCat = null; /* kategori yang rincian transaksinya dibuka di tab Grafik */
const ym = () => cur.toISOString().slice(0, 7);
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

/* ---------- penyimpanan lokal ---------- */
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.accounts)) DB = Object.assign(DB, d);
    }
  } catch (e) { /* abaikan, pakai kosong */ }
}
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) { toast("Penyimpanan penuh!"); }
}

/* ---------- perubahan lokal: hapus & edit yang awet ---------- */
/* Model sync satu arah: snapshot server menang untuk data server. Supaya
   hapus/edit di HP tidak hidup lagi (atau hilang) saat snapshot baru datang,
   perubahan lokal disimpan terpisah (tombstone + override) dan diterapkan
   ulang setiap merge. Data server TIDAK diubah — hapus/ubah permanen tetap
   lewat chat. */
const OV_KEY = "uq_overrides_v1";
const AUDIT_KEY = "uq_audit_v1";
const isLocalId = (id) => String(id).startsWith("l");
function loadOverrides() {
  try {
    const d = JSON.parse(localStorage.getItem(OV_KEY) || "{}");
    return { deletedTx: [], deletedAcc: [], deletedInv: [], editedTx: {}, editedAcc: {}, ...(d || {}) };
  } catch (e) { return { deletedTx: [], deletedAcc: [], deletedInv: [], editedTx: {}, editedAcc: {} }; }
}
function saveOverrides(ov) {
  try { localStorage.setItem(OV_KEY, JSON.stringify(ov)); } catch (e) { /* abaikan */ }
}
function loadAudit() {
  try { const a = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function logAudit(text) {
  try {
    const a = loadAudit();
    a.unshift({ ts: new Date().toISOString(), text });
    localStorage.setItem(AUDIT_KEY, JSON.stringify(a.slice(0, 50)));
  } catch (e) { /* abaikan */ }
}
function mergeSnapshot(snap) {
  if (!snap || !Array.isArray(snap.accounts)) return "error";
  if (!DB.accounts.length && !DB.transactions.length) {
    DB = JSON.parse(JSON.stringify(snap));
    applyOverrides();
    saveLocal();
    return "updated";
  }
  if ((snap.version || 0) <= (DB.version || 0)) return "uptodate";
  // Akun & investasi lokal (id "l...") dipertahankan — dulu hilang saat sync.
  const localAcc = DB.accounts.filter((a) => isLocalId(a.id));
  const localInv = DB.investments.filter((iv) => isLocalId(iv.id));
  const localTx = DB.transactions.filter((t) => isLocalId(t.id));
  // Deep-copy: override (Object.assign) tidak boleh mengubah objek snapshot.
  DB.transactions = JSON.parse(JSON.stringify(snap.transactions || []));
  DB.accounts = JSON.parse(JSON.stringify(snap.accounts));
  DB.investments = JSON.parse(JSON.stringify(snap.investments || []));
  DB.prices = JSON.parse(JSON.stringify(snap.prices || []));
  applyOverrides();
  // Transaksi/akun/investasi lokal tidak ada di snapshot, jadi tetap dipertahankan.
  DB.transactions = DB.transactions.concat(localTx);
  DB.accounts = DB.accounts.concat(localAcc);
  DB.investments = DB.investments.concat(localInv);
  // Saldo snapshot sudah mencakup semua transaksi server. Transaksi lokal
  // belum dikenal server -> terapkan efeknya ke saldo SERVER saja (akun lokal
  // menyimpan saldonya sendiri, jangan dihitung dua kali).
  for (const t of DB.transactions) {
    if (!isLocalId(t.id) || t.account_id == null) continue;
    const a = DB.accounts.find((x) => String(x.id) === String(t.account_id));
    if (a && !isLocalId(a.id)) a.balance = (+a.balance || 0) + (t.direction === "in" ? +t.amount : -t.amount);
  }
  DB.version = snap.version;
  DB.exported_at = snap.exported_at || "";
  saveLocal();
  return "updated";
}
function applyOverrides() {
  const ov = loadOverrides();
  const delTx = new Set((ov.deletedTx || []).map(String));
  const delAcc = new Set((ov.deletedAcc || []).map(String));
  const delInv = new Set((ov.deletedInv || []).map(String));
  // Hapus (tombstone): keluarkan dari daftar; efek saldonya juga dicabut dari
  // saldo snapshot — tapi hanya bila transaksi itu masih ada di snapshot
  // (kalau server sudah menghapusnya, tidak ada yang perlu dicabut).
  for (const id of delTx) {
    const t = DB.transactions.find((x) => String(x.id) === String(id));
    if (t && t.account_id != null) {
      const a = DB.accounts.find((x) => String(x.id) === String(t.account_id));
      if (a) a.balance = (+a.balance || 0) - (t.direction === "in" ? +t.amount : -t.amount);
    }
  }
  if (delTx.size) DB.transactions = DB.transactions.filter((t) => !delTx.has(String(t.id)));
  if (delAcc.size) DB.accounts = DB.accounts.filter((a) => !delAcc.has(String(a.id)));
  if (delInv.size) DB.investments = DB.investments.filter((iv) => !delInv.has(String(iv.id)));
  // Edit transaksi server: terapkan field yang diubah + koreksi saldo snapshot
  // sebesar selisih efeknya (baru − lama).
  for (const [id, patch] of Object.entries(ov.editedTx || {})) {
    const t = DB.transactions.find((x) => String(x.id) === String(id));
    if (!t) continue;
    const oldAcc = t.account_id, oldDir = t.direction, oldAmt = +t.amount || 0;
    Object.assign(t, patch);
    const eff = (dir, amt) => (dir === "in" ? amt : -amt);
    const newAcc = t.account_id, newDir = t.direction, newAmt = +t.amount || 0;
    if (String(oldAcc) !== String(newAcc)) {
      const oa = DB.accounts.find((x) => String(x.id) === String(oldAcc));
      if (oa) oa.balance = (+oa.balance || 0) - eff(oldDir, oldAmt);
      const na = DB.accounts.find((x) => String(x.id) === String(newAcc));
      if (na) na.balance = (+na.balance || 0) + eff(newDir, newAmt);
    } else if (oldDir !== newDir || oldAmt !== newAmt) {
      const a = DB.accounts.find((x) => String(x.id) === String(newAcc));
      if (a) a.balance = (+a.balance || 0) - eff(oldDir, oldAmt) + eff(newDir, newAmt);
    }
  }
  // Edit akun server: nilai absolut, langsung timpa.
  for (const [id, patch] of Object.entries(ov.editedAcc || {})) {
    const a = DB.accounts.find((x) => String(x.id) === String(id));
    if (a) Object.assign(a, patch);
  }
}
const acctMap = () => Object.fromEntries(DB.accounts.map((a) => [String(a.id), a]));
function adjBalance(accId, direction, amount) {
  if (accId == null) return;
  const a = DB.accounts.find((x) => String(x.id) === String(accId));
  if (a) a.balance = (+a.balance || 0) + (direction === "in" ? +amount : -amount);
}
const priceMap = () => Object.fromEntries((DB.prices || []).map((p) => [p.symbol, p]));
function sortedTx(list) {
  return list.slice().sort((a, b) =>
    b.date < a.date ? -1 : b.date > a.date ? 1 :
    String(b.id) < String(a.id) ? -1 : 1);
}

/* ---------- util UI ---------- */
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.add("hidden"), 2200);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function dayLabel(iso) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" });
}
function relTime(ts) {
  if (!ts) return "belum ada harga";
  // updated_at bisa "2026-11-01 19:49:23" (tanpa zona) atau ISO "...T19:49:23+00:00" (sudah ada zona).
  // Dulu: "+07:00" selalu ditempel -> ISO ber-zona jadi invalid -> "NaN hari lalu".
  let iso = String(ts).replace(" ", "T");
  if (!/[+-]\d{2}:?\d{2}$/.test(iso) && !iso.endsWith("Z")) iso += "+07:00";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "diperbarui " + esc(ts);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return "diperbarui " + mins + " mnt lalu";
  const h = Math.round(mins / 60);
  if (h < 48) return "diperbarui " + h + " jam lalu";
  return "diperbarui " + Math.round(h / 24) + " hari lalu";
}
function updateAssetHero(acctNet, acctCount, invTotal) {
  $("netAssets").textContent = fmtRp(acctNet + invTotal);
  const stale = window._priceStale ? ` · <span class="stale-txt">harga investasi ${esc(window._priceStale)}</span>` : "";
  $("accMeta").innerHTML = `${acctCount} kantong · investasi ${fmtRp(invTotal)}${stale}`;
}

/* ---------- format ribuan saat mengetik nominal ---------- */
/* Input type="text" + inputmode numeric: tampil "599.000" saat mengetik,
   nilai mentah disimpan di dataset.raw supaya 59900 vs 599000 tidak tertukar. */
function fmtNumInput(el) {
  const digits = (el.value || "").replace(/\D/g, "");
  el.dataset.raw = digits;
  el.value = digits ? Number(digits).toLocaleString("id-ID") : "";
}
function amtRaw(el) { return parseInt(el.dataset.raw || (el.value || "").replace(/\D/g, ""), 10) || 0; }

/* ---------- ASET ---------- */
function renderAccounts() {
  const accounts = DB.accounts.slice().sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.name < b.name ? -1 : 1));
  const acctNet = accounts.filter((a) => a.kind !== "invest").reduce((s, a) => s + (+a.balance || 0), 0);
  updateAssetHero(acctNet, accounts.length, window._invTotal || 0);
  const wrap = $("accGroups");
  wrap.innerHTML = "";
  for (const k of KIND_ORDER) {
    const list = accounts.filter((a) => a.kind === k);
    if (!list.length) continue;
    const g = document.createElement("div");
    g.innerHTML = `<h2>${esc(KIND_LABEL[k] || k)}</h2>`;
    const box = document.createElement("div");
    box.className = "acc-group card";
    box.style.padding = "4px 14px";
    for (const a of list) {
      const row = document.createElement("div");
      row.className = "acc-row";
      row.innerHTML =
        `<button class="acc-main" data-id="${esc(a.id)}">` +
        `<span class="acc-name">${esc(a.name)}</span>` +
        `<span class="acc-bal num">${fmtRp(a.balance)}</span></button>` +
        `<div class="acc-edit hidden">` +
        `<input type="text" value="${esc(a.name)}" data-f="name" aria-label="Nama">` +
        `<input type="number" value="${a.balance}" data-f="balance" aria-label="Saldo">` +
        `<select data-f="kind">${KIND_ORDER.map((o) =>
          `<option value="${o}"${o === a.kind ? " selected" : ""}>${esc(KIND_LABEL[o] || o)}</option>`).join("")}</select>` +
        `<input type="text" value="${esc(a.note || "")}" data-f="note" placeholder="Catatan" aria-label="Catatan">` +
        `<div class="row-btns"><button class="btn primary" data-act="save">Simpan</button>` +
        `<button class="btn danger" data-act="del">Hapus</button></div></div>`;
      box.appendChild(row);
    }
    g.appendChild(box);
    wrap.appendChild(g);
  }
  if (!accounts.length) wrap.innerHTML = `<p class="empty">Belum ada akun.</p>`;
  wrap.querySelectorAll(".acc-main").forEach((b) =>
    b.addEventListener("click", () =>
      b.nextElementSibling.classList.toggle("hidden")));
  wrap.querySelectorAll(".acc-edit").forEach((ed) => {
    const id = ed.previousElementSibling.dataset.id;
    ed.querySelector('[data-act="save"]').addEventListener("click", () => {
      const a = DB.accounts.find((x) => String(x.id) === String(id));
      if (!a) return;
      const oldBal = +a.balance || 0, oldName = a.name;
      ed.querySelectorAll("[data-f]").forEach((i) => (a[i.dataset.f] = i.value));
      a.balance = parseFloat(a.balance) || 0;
      if (!isLocalId(id)) {
        const o = loadOverrides();
        o.editedAcc[String(id)] = { name: a.name, balance: a.balance, kind: a.kind, note: a.note || "" };
        saveOverrides(o);
      }
      if (oldBal !== a.balance) logAudit(`Saldo ${oldName}: ${fmtRp(oldBal)} → ${fmtRp(a.balance)}`);
      saveLocal(); toast("Akun diperbarui"); renderAll();
    });
    ed.querySelector('[data-act="del"]').addEventListener("click", () => {
      const a = DB.accounts.find((x) => String(x.id) === String(id));
      if (!a) return;
      const server = !isLocalId(id);
      if (!confirm(server
        ? "Hapus akun ini di HP? Transaksinya tetap ada tanpa akun, dan akun kembali saat snapshot baru — hapus permanen lewat chat."
        : "Hapus akun ini? Transaksinya tetap ada tanpa akun.")) return;
      DB.accounts = DB.accounts.filter((x) => String(x.id) !== String(id));
      if (server) {
        const o = loadOverrides();
        if (!o.deletedAcc.includes(String(id))) o.deletedAcc.push(String(id));
        saveOverrides(o);
        logAudit(`Hapus akun: ${a.name} (lokal; server tetap ada)`);
      }
      saveLocal(); toast("Akun dihapus"); renderAll();
    });
  });
  $("fAcc").innerHTML = `<option value="">Tanpa akun</option>` +
    accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
}

/* ---------- donat pengeluaran ---------- */
/* Rincian "Lainnya" dari keterangan transaksi (bukan kategori baru). */
function lainGroup(note) {
  const n = (note || "").toLowerCase();
  if (/claude/i.test(n)) return "Langganan Claude";
  if (/outflow/.test(n)) return "Shopee (Outflow)";
  if (/shopeepay|top up|topup/.test(n)) return "Top up e-wallet";
  if (/laundry/.test(n)) return "Laundry";
  if (/transfer/.test(n)) return "Transfer ke orang";
  if (/esim|trip\.com/.test(n)) return "eSIM / travel";
  if (/pangkas|rambut|barber/.test(n)) return "Pangkas rambut";
  if (/aethera|ainkey|api key/.test(n)) return "Tes API (Aethera)";
  if (/kaos kaki|indomaret/.test(n)) return "Belanja (Indomaret)";
  if (/reimburse|zidan/.test(n)) return "Reimburse Zidan";
  if (/fitness|idachi|gym/.test(n)) return "Gym / fitness";
  if (/parkir|parkee/.test(n)) return "Parkir";
  return (note || "Lainnya").trim().slice(0, 28) || "Lainnya";
}
const LAIN_COLORS = ["#F97316","#EAB308","#84CC16","#34D399","#14B8A6","#06B6D4","#38BDF8","#818CF8","#A78BFA","#EC4899","#F43F5E","#94A3B8"];
const CLAUDE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>';
function donutSVG(segments, total, centerLabel) {
  const R = 80, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = segments.map((s) => {
    const frac = total ? s.total / total : 0;
    const len = frac * C;
    const gap = segments.length > 1 ? 1.5 : 0;
    const el = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}" stroke-width="34" stroke-dasharray="${Math.max(len - gap, 0)} ${C - Math.max(len - gap, 0)}" stroke-dashoffset="${-off}" />`;
    off += len;
    return el;
  }).join("");
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Donat pengeluaran">` +
    `<circle cx="100" cy="100" r="${R}" fill="none" stroke="#1A2330" stroke-width="34" />` +
    `<g transform="rotate(-90 100 100)">${arcs}</g>` +
    `<text x="100" y="97" text-anchor="middle" class="donut-center-total" fill="#EDEFF2">${fmtRp(total)}</text>` +
    `<text x="100" y="117" text-anchor="middle" class="donut-center-label">${esc(centerLabel)}</text></svg>`;
}
function legendRow(s, total) {
  const pct = total ? (s.total / total) * 100 : 0;
  const mark = s.icon
    ? `<span class="claude-ico" style="color:${s.color}">${s.icon}</span>`
    : `<span class="dot" style="background:${s.color}"></span>`;
  return `<div class="map-row"${s.key ? ` data-cat="${esc(s.key)}"` : ""}><div class="map-top"><span class="map-name">${mark}${esc(s.label)}</span><span class="map-amt num">${fmtRp(s.total)}</span></div><div class="map-pct num">${pct.toFixed(1)}% · ${s.count}×</div></div>`;
}
/* Irisan <2% digabung jadi satu "Lainnya" di donat (tetap dirinci di legenda),
   supaya slice kecil tidak jadi garis tipis yang tak terbaca. */
function foldSmall(segs, total, label) {
  const big = [], small = [];
  for (const s of segs) (total && s.total / total < 0.02 ? small : big).push(s);
  if (!small.length) return segs;
  const st = small.reduce((a, s) => a + s.total, 0);
  const sc = small.reduce((a, s) => a + s.count, 0);
  return [...big, { label, total: st, count: sc, color: "#64748B" }].sort((a, b) => b.total - a.total);
}
function renderDonut(outCat, expense, outRows) {
  // Donat = pengeluaran KONSUMTIF saja: investasi & tabungan dikeluarkan,
  // itu uang yang dipindah jadi aset, bukan dihabiskan.
  const NON_KONSUMTIF = ["investasi", "tabungan"];
  const konsCat = Object.fromEntries(
    Object.entries(outCat).filter(([c]) => !NON_KONSUMTIF.includes(c)));
  const konsTotal = Object.values(konsCat).reduce((s, v) => s + v.total, 0);
  const entries = Object.entries(konsCat).sort((a, b) => b[1].total - a[1].total);
  const wrap = $("donutWrap"), leg = $("donutLegend");
  if (!entries.length || !konsTotal) {
    wrap.innerHTML = `<p class="empty">Belum ada pengeluaran konsumtif bulan ini.</p>`;
    leg.innerHTML = "";
    $("lainCard").classList.add("hidden");
    return;
  }
  const segs = entries.map(([c, v]) => ({ key: c, label: catName(c), total: v.total, count: v.count, color: catColor(c) }));
  wrap.innerHTML = donutSVG(foldSmall(segs, konsTotal, "Lainnya (<2%)"), konsTotal, "total konsumtif");
  leg.innerHTML = segs.map((s) => legendRow(s, konsTotal)).join("");
  const lainRows = outRows.filter((t) => t.category === "lain-lain");
  const lainCard = $("lainCard");
  if (!lainRows.length) { lainCard.classList.add("hidden"); return; }
  lainCard.classList.remove("hidden");
  const groups = {};
  for (const t of lainRows) {
    const g = lainGroup(t.note);
    groups[g] = groups[g] || { total: 0, count: 0 };
    groups[g].total += +t.amount || 0;
    groups[g].count += 1;
  }
  const lsegs = Object.entries(groups)
    .map(([label, v], i) => ({ label, total: v.total, count: v.count, color: LAIN_COLORS[i % LAIN_COLORS.length], icon: label === "Langganan Claude" ? CLAUDE_ICON : null }))
    .sort((a, b) => b.total - a.total);
  const ltot = lsegs.reduce((s, x) => s + x.total, 0);
  $("lainWrap").innerHTML = donutSVG(foldSmall(lsegs, ltot, "Lainnya kecil"), ltot, "total Lainnya");
  $("lainLegend").innerHTML = lsegs.map((s) => legendRow(s, ltot)).join("");
}

/* ---------- ARUS KAS ---------- */
function fillCats() {
  $("fCat").innerHTML = CATS[direction]
    .map((c) => `<option value="${c}">${catName(c)}</option>`).join("");
}
function renderCashflow() {
  const m = ym();
  const rows = DB.transactions.filter((t) => (t.date || "").slice(0, 7) === m);
  let income = 0, expense = 0;
  const in_cat = {}, out_cat = {};
  for (const t of rows) {
    const amt = +t.amount || 0;
    const bucket = t.direction === "in" ? in_cat : out_cat;
    if (t.direction === "in") income += amt; else expense += amt;
    bucket[t.category] = bucket[t.category] || { total: 0, count: 0 };
    bucket[t.category].total += amt;
    bucket[t.category].count += 1;
  }
  const surplus = income - expense;
  $("monthLabel").textContent = MONTHS_ID[cur.getMonth()] + " " + cur.getFullYear();
  $("flowIn").textContent = "+" + fmtRp(income);
  $("flowOut").textContent = "−" + fmtRp(expense);
  const sur = $("flowSur");
  sur.textContent = (surplus >= 0 ? "+" : "−") + fmtRp(Math.abs(surplus));
  sur.className = "num " + (surplus >= 0 ? "flow-in" : "flow-out");
  renderDonut(out_cat, expense, rows.filter((t) => t.direction !== "in"));
  const wrap = $("mapList");
  wrap.innerHTML = "";
  const entries = Object.entries(out_cat).sort((a, b) => b[1].total - a[1].total);
  if (!entries.length) { wrap.innerHTML = `<p class="empty">Belum ada pengeluaran bulan ini.</p>`; renderTopTx([]); return; }
  for (const [c, v] of entries) {
    const pct = expense ? (v.total / expense) * 100 : 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "map-row";
    row.setAttribute("aria-label", `Lihat rincian ${catName(c)} di Grafik`);
    row.addEventListener("click", () => {
      selectedCat = c;
      renderDetail();
      showTab("detail");
      window.scrollTo(0, 0);
    });
    row.innerHTML =
      `<div class="map-top"><span class="map-name"><span class="dot" style="background:${catColor(c)}"></span>${esc(catName(c))}</span>` +
      `<span class="map-right"><span class="map-amt num">${fmtRp(v.total)}</span><span class="map-chev" aria-hidden="true">›</span></span></div>` +
      `<div class="map-bar"><div style="width:${pct}%;background:${catColor(c)}"></div></div>` +
      `<div class="map-pct num">${pct.toFixed(1)}% · ${v.count}×</div>`;
    wrap.appendChild(row);
  }
  renderTopTx(rows.filter((t) => t.direction === "out"));
  renderDetail();
}
/* "Di mana" uangnya pergi: bagian setelah pemisah terakhir di keterangan
   ("Makan siang - Sambal Bakaran" -> "Sambal Bakaran"; tanpa pemisah -> keterangan utuh).
   Kalau segmen terakhir cuma kata tujuan generik ("piknik"), pakai segmen pertama
   ("Gogo Supermarket Bengkong - piknik" -> "Gogo Supermarket Bengkong"). */
const GENERIC_PLACE = new Set(["piknik", "jajan", "makan", "makan siang", "makan malam", "sarapan", "belanja", "top up", "transfer", "bayar"]);
function notePlace(note) {
  const parts = String(note || "").split(/\s[-–—]\s/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return (String(note || "").trim() || "(tanpa keterangan)");
  const last = parts[parts.length - 1];
  if (parts.length > 1 && GENERIC_PLACE.has(last.toLowerCase())) return parts[0];
  return last;
}
/* Layar detail satu kategori: donat breakdown per tempat/merchant,
   lalu di bawahnya rincian transaksi (tanggal, keterangan, nominal). */
function renderDetail() {
  if (!selectedCat) return;
  const m = ym();
  const rows = sortedTx(DB.transactions.filter((t) =>
    t.direction === "out" && t.category === selectedCat && (t.date || "").slice(0, 7) === m));
  const expense = DB.transactions
    .filter((t) => t.direction === "out" && (t.date || "").slice(0, 7) === m)
    .reduce((s, t) => s + (+t.amount || 0), 0);
  const total = rows.reduce((s, t) => s + (+t.amount || 0), 0);
  const pct = expense ? (total / expense) * 100 : 0;
  $("detailTitle").textContent = catName(selectedCat);
  $("detailSub").textContent = `${fmtRp(total)} · ${rows.length}× · ${pct.toFixed(1)}% dari pengeluaran bulan ini`;
  const bar = $("detailBar");
  bar.style.width = pct + "%";
  bar.style.background = catColor(selectedCat);
  const groups = {};
  for (const t of rows) {
    const g = selectedCat === "lain-lain" ? lainGroup(t.note) : notePlace(t.note);
    groups[g] = groups[g] || { total: 0, count: 0 };
    groups[g].total += +t.amount || 0;
    groups[g].count += 1;
  }
  const segs = Object.entries(groups)
    .map(([label, v], i) => ({ label, total: v.total, count: v.count, color: LAIN_COLORS[i % LAIN_COLORS.length] }))
    .sort((a, b) => b.total - a.total);
  $("detailWrap").innerHTML = segs.length
    ? donutSVG(foldSmall(segs, total, "Lainnya kecil"), total, "bulan ini")
    : `<p class="empty">Belum ada pengeluaran bulan ini.</p>`;
  $("detailLegend").innerHTML = segs.map((s) => legendRow(s, total)).join("");
  $("detailList").innerHTML = rows.length ? rows.map((t) =>
    `<div class="tx-item"><div><div class="note">${esc(t.note || "(tanpa keterangan)")}</div>` +
    `<div class="meta">${dayLabel(t.date)}</div></div>` +
    `<span class="amt num">−${fmtRp(t.amount)}</span></div>`).join("")
    : `<p class="empty">Belum ada transaksi bulan ini.</p>`;
}
/* 5 pengeluaran terbesar bulan ini (tab Grafik) — data sudah ada, tinggal tampilkan. */
function renderTopTx(outRows) {
  const el = $("topTx");
  if (!el) return;
  const top = outRows.slice().sort((a, b) => (+b.amount || 0) - (+a.amount || 0)).slice(0, 5);
  el.innerHTML = top.length ? top.map((t) =>
    `<div class="tx-item"><div><div class="note">${esc(t.note || "(tanpa keterangan)")}</div>` +
    `<div class="meta">${dayLabel(t.date)} · ${esc(catName(t.category))}</div></div>` +
    `<span class="amt num">−${fmtRp(t.amount)}</span></div>`).join("")
    : `<p class="empty">Belum ada pengeluaran bulan ini.</p>`;
}
function renderTx() {
  const dir = $("filterDir").value;
  const q = ($("txSearch").value || "").trim().toLowerCase();
  const fc = $("filterCat").value;
  const m = ym();
  const amap = acctMap();
  const ov = loadOverrides();
  let rows = DB.transactions.filter((t) => (t.date || "").slice(0, 7) === m);
  if (dir) rows = rows.filter((t) => t.direction === dir);
  if (fc) rows = rows.filter((t) => t.category === fc);
  if (q) rows = rows.filter((t) => (t.note || "").toLowerCase().includes(q));
  rows = sortedTx(rows).slice(0, 300);
  const wrap = $("txList");
  wrap.innerHTML = "";
  if (!rows.length) { wrap.innerHTML = `<p class="empty">Belum ada transaksi.</p>`; return; }
  let lastDay = "", dayEl = null, dayNet = 0;
  const closeDay = () => {
    if (dayEl) {
      const t = dayEl.querySelector(".t");
      t.textContent = (dayNet >= 0 ? "+" : "−") + fmtRp(Math.abs(dayNet));
      t.className = "t num " + (dayNet >= 0 ? "flow-in" : "flow-out");
    }
  };
  for (const t of rows) {
    if (t.date !== lastDay) {
      closeDay();
      lastDay = t.date; dayNet = 0;
      dayEl = document.createElement("div");
      dayEl.innerHTML = `<div class="day-head"><span class="d">${dayLabel(t.date)}</span><span class="t num"></span></div>`;
      wrap.appendChild(dayEl);
    }
    dayNet += t.direction === "in" ? +t.amount : -t.amount;
    const accName = t.account_id != null && amap[String(t.account_id)] ? amap[String(t.account_id)].name : "";
    const editedMark = ov.editedTx && ov.editedTx[String(t.id)] ? " · edit lokal" : "";
    const el = document.createElement("div");
    el.className = "tx-item";
    const signed = t.direction === "in" ? "+" + fmtRp(t.amount) : "−" + fmtRp(t.amount);
    el.innerHTML =
      `<div><div class="note">${esc(t.note || "(tanpa keterangan)")}</div>` +
      `<div class="meta">${esc(catName(t.category))}${accName ? " · " + esc(accName) : ""}${editedMark}</div></div>` +
      `<div style="display:flex;align-items:center">` +
      `<span class="amt num${t.direction === "in" ? " in" : ""}">${signed}</span>` +
      `<button class="edit" data-id="${esc(t.id)}" aria-label="Ubah">✎</button>` +
      `<button class="del" data-id="${esc(t.id)}" aria-label="Hapus">✕</button></div>`;
    wrap.appendChild(el);
  }
  closeDay();
  wrap.querySelectorAll(".edit").forEach((b) =>
    b.addEventListener("click", () => startEdit(b.dataset.id)));
  wrap.querySelectorAll(".del").forEach((b) =>
    b.addEventListener("click", () => {
      const tx = DB.transactions.find((x) => String(x.id) === String(b.dataset.id));
      if (!tx) return;
      const server = !isLocalId(tx.id);
      if (!confirm(server
        ? "Hapus transaksi ini di HP? Data server tetap ada — hapus permanen lewat chat."
        : "Hapus transaksi ini?")) return;
      adjBalance(tx.account_id, tx.direction === "in" ? "out" : "in", +tx.amount || 0);
      DB.transactions = DB.transactions.filter((x) => String(x.id) !== String(b.dataset.id));
      if (server) {
        const o = loadOverrides();
        if (!o.deletedTx.includes(String(tx.id))) o.deletedTx.push(String(tx.id));
        saveOverrides(o);
        logAudit(`Hapus transaksi: ${tx.note || "(tanpa keterangan)"} ${fmtRp(tx.amount)} (lokal; server tetap ada)`);
      }
      saveLocal(); toast("Dihapus"); renderAll();
    }));
}

/* ---------- INVESTASI ---------- */
function enrichInvestments() {
  const pr = priceMap();
  return DB.investments.slice()
    .sort((a, b) => (a.kind < b.kind ? -1 : 1) || (a.symbol < b.symbol ? -1 : 1))
    .map((iv) => {
      const p = pr[iv.symbol] || {};
      const price = p.price != null ? +p.price : null;
      const mult = iv.kind === "saham" ? 100 : 1;
      const cost = (+iv.qty) * (+iv.avg_price) * mult;
      const mval = price != null ? (+iv.qty) * price * mult : null;
      const pnl = mval != null ? mval - cost : null;
      return Object.assign({}, iv, {
        latest_price: price, price_at: p.updated_at || null, price_source: p.source || null,
        market_value: mval, pnl,
        pnl_pct: pnl != null && cost ? (pnl / cost * 100) : null,
      });
    });
}
function renderInvestments() {
  const list = enrichInvestments();
  const wrap = $("invList");
  wrap.innerHTML = "";
  let totalVal = 0, totalPnl = 0, hasPrice = false;
  if (!list.length) wrap.innerHTML = `<p class="empty">Belum ada posisi.</p>`;
  for (const iv of list) {
    const pnlCls = iv.pnl == null ? "" : iv.pnl >= 0 ? "pnl-up" : "pnl-down";
    const pnlTxt = iv.pnl == null ? "—" :
      (iv.pnl >= 0 ? "+" : "") + fmtRp(iv.pnl) +
      (iv.pnl_pct != null ? ` (${iv.pnl_pct.toFixed(1)}%)` : "");
    if (iv.market_value != null) { totalVal += iv.market_value; totalPnl += iv.pnl; hasPrice = true; }
    const unit = iv.kind === "saham" ? "lot" : iv.kind === "rdpu" ? "unit" : "";
    const el = document.createElement("div");
    el.className = "inv-card";
    el.innerHTML =
      `<div class="inv-head"><div><div class="inv-kind">${esc(iv.kind).toUpperCase()}</div>` +
      `<div class="inv-sym">${esc(iv.symbol)}</div></div>` +
      `<div class="${pnlCls} num">${pnlTxt}</div></div>` +
      `<div class="inv-grid">` +
      `<span class="k">Jumlah</span><span class="v num">${esc(iv.qty)}${unit ? " " + unit : ""}</span>` +
      `<span class="k">Harga beli</span><span class="v num">${fmtRp(iv.avg_price)}</span>` +
      `<span class="k">Harga kini</span><span class="v num">${iv.latest_price != null ? fmtRp(iv.latest_price) : "—"}</span>` +
      `<span class="k">Nilai pasar</span><span class="v num">${iv.market_value != null ? fmtRp(iv.market_value) : "—"}</span>` +
      `</div>` +
      `<div class="price-meta${iv.price_at ? "" : " stale"}">${relTime(iv.price_at)}${iv.price_source ? " · " + esc(iv.price_source) : ""}</div>` +
      `<button class="del" data-id="${esc(iv.id)}">Hapus posisi</button>`;
    wrap.appendChild(el);
  }
  let newest = 0;
  for (const iv of list) {
    if (!iv.price_at) continue;
    const d = new Date(String(iv.price_at).replace(" ", "T"));
    if (!isNaN(d.getTime())) newest = Math.max(newest, d.getTime());
  }
  const ageDays = newest ? Math.floor((Date.now() - newest) / 86400000) : null;
  window._priceStale = ageDays != null && ageDays > 2 ? `${ageDays} hari lalu` : "";
  $("invTotal").textContent = hasPrice ? fmtRp(totalVal) : "Rp 0";
  window._invTotal = hasPrice ? totalVal : 0;
  const p = $("invPnl");
  p.textContent = hasPrice
    ? `P/L ${(totalPnl >= 0 ? "+" : "")}${fmtRp(totalPnl)}${window._priceStale ? ` · harga ${window._priceStale}` : ""}`
    : "belum ada harga terkini";
  p.className = "hero-sub num " + (hasPrice ? (totalPnl >= 0 ? "pnl-up" : "pnl-down") : "");
  wrap.querySelectorAll(".del").forEach((b) =>
    b.addEventListener("click", () => {
      const iv = DB.investments.find((x) => String(x.id) === String(b.dataset.id));
      if (!iv) return;
      const server = !isLocalId(iv.id);
      if (!confirm(server
        ? "Hapus posisi ini di HP? Posisi kembali saat snapshot baru — hapus permanen lewat chat."
        : "Hapus posisi ini?")) return;
      DB.investments = DB.investments.filter((x) => String(x.id) !== String(b.dataset.id));
      if (server) {
        const o = loadOverrides();
        if (!o.deletedInv.includes(String(iv.id))) o.deletedInv.push(String(iv.id));
        saveOverrides(o);
        logAudit(`Hapus posisi: ${iv.symbol} (lokal; server tetap ada)`);
      }
      saveLocal(); toast("Dihapus"); renderAll();
    }));
}

function renderAll() {
  renderInvestments();
  renderAccounts();
  renderCashflow();
  renderTx();
  renderDataInfo();
  const vl = $("verLine");
  if (vl) vl.textContent = "UangKu v23 · data v" + (DB.version || 0) + (window._syncError ? " · tidak dapat memuat update" : "");
}

/* ---------- pengaturan: data lokal ---------- */
function renderDataInfo() {
  const el = $("dataInfo");
  if (!el) return;
  el.innerHTML =
    `Data tersimpan di HP ini dan disinkronkan satu arah dari server.<br>` +
    `Transaksi: <b class="num">${DB.transactions.length}</b> · ` +
    `Akun: <b class="num">${DB.accounts.length}</b> · ` +
    `Investasi: <b class="num">${DB.investments.length}</b><br>` +
    (DB.exported_at ? `Snapshot server: ${esc(DB.exported_at)}` : `Belum ada snapshot server.`) +
    `<br><span class="hint">Hapus/ubah di HP hanya berlaku lokal — data server tetap ada. Hapus/ubah permanen lewat chat.</span>`;
  const li = $("localInfo");
  if (li) {
    const ov = loadOverrides();
    const nDel = (ov.deletedTx || []).length + (ov.deletedAcc || []).length + (ov.deletedInv || []).length;
    const nEd = Object.keys(ov.editedTx || {}).length + Object.keys(ov.editedAcc || {}).length;
    li.textContent = (nDel || nEd)
      ? `Perubahan lokal: ${nDel} dihapus · ${nEd} diubah (tetap berlaku walau snapshot baru datang).`
      : "Belum ada perubahan lokal.";
  }
  const al = $("auditLog");
  if (al) {
    const a = loadAudit().slice(0, 8);
    al.innerHTML = a.length
      ? a.map((e) => `<div>${esc(e.text)} <span>· ${new Date(e.ts).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span></div>`).join("")
      : `<div>Belum ada aktivitas.</div>`;
  }
}
function downloadBackup() {
  const blob = new Blob([JSON.stringify(DB)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "uangku-backup-" + todayStr() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Cadangan diunduh");
}

/* ---------- events ---------- */
/* Stepper bulan hanya muncul di tab yang dipengaruhinya (Arus Kas & Grafik). */
function updateMonthStep(tab) {
  const ms = $("monthStep");
  if (ms) ms.classList.toggle("hidden", tab !== "arus" && tab !== "grafik" && tab !== "detail");
}
function showTab(name) {
  document.querySelectorAll(".bottomnav button").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.id === "tab-" + name));
  updateMonthStep(name);
}
/* Sub-tab Arus Kas: Ringkasan (flow + bar kategori) / Riwayat (daftar transaksi). */
let arusSub = "summary";
function setArusSub(name) {
  arusSub = name;
  $("arusSummary").classList.toggle("hidden", name !== "summary");
  $("arusHistory").classList.toggle("hidden", name !== "history");
  $("arusSubSummary").classList.toggle("active", name === "summary");
  $("arusSubHistory").classList.toggle("active", name === "history");
  $("arusSubSummary").setAttribute("aria-pressed", name === "summary");
  $("arusSubHistory").setAttribute("aria-pressed", name === "history");
}
$("arusSubSummary").addEventListener("click", () => setArusSub("summary"));
$("arusSubHistory").addEventListener("click", () => setArusSub("history"));
/* Buka lipatan form transaksi (dipakai saat mulai edit dari Riwayat). */
function openTxForm() {
  const body = $("fFormWrap");
  if (!body.classList.contains("hidden")) return;
  body.classList.remove("hidden");
  const btn = $("fFormToggle");
  btn.setAttribute("aria-expanded", "true");
  btn.textContent = "− " + btn.dataset.label;
}
document.querySelectorAll(".bottomnav button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));

/* Klik legenda donat (kategori asli saja) = buka layar detail kategori itu. */
$("donutLegend").addEventListener("click", (e) => {
  const row = e.target.closest("[data-cat]");
  if (!row) return;
  selectedCat = row.dataset.cat;
  renderDetail();
  showTab("detail");
  window.scrollTo(0, 0);
});
$("detailBack").addEventListener("click", () => { showTab("arus"); window.scrollTo(0, 0); });

$("mPrev").addEventListener("click", () => { cur.setMonth(cur.getMonth() - 1); renderAll(); });
$("mNext").addEventListener("click", () => { cur.setMonth(cur.getMonth() + 1); renderAll(); });

function setDirection(d) {
  direction = d;
  $("dirOut").classList.toggle("active", d === "out");
  $("dirIn").classList.toggle("active", d === "in");
  $("dirOut").setAttribute("aria-pressed", d === "out");
  $("dirIn").setAttribute("aria-pressed", d === "in");
  fillCats();
}
function fillFilterCats() {
  const sel = $("filterCat");
  if (!sel) return;
  const cur = sel.value;
  const all = [...CATS.out, ...CATS.in].filter((c, i, a) => a.indexOf(c) === i);
  sel.innerHTML = `<option value="">Semua kategori</option>` +
    all.map((c) => `<option value="${c}">${catName(c)}</option>`).join("");
  if (all.includes(cur)) sel.value = cur;
}
$("dirOut").addEventListener("click", () => setDirection("out"));
$("dirIn").addEventListener("click", () => setDirection("in"));

let editingId = null;
function startEdit(id) {
  const t = DB.transactions.find((x) => String(x.id) === String(id));
  if (!t) return;
  setArusSub("summary");
  openTxForm();
  editingId = t.id;
  setDirection(t.direction);
  $("fAmount").value = String(t.amount || "");
  fmtNumInput($("fAmount"));
  $("fNote").value = t.note || "";
  $("fCat").value = t.category;
  $("fAcc").value = t.account_id != null ? String(t.account_id) : "";
  $("fDate").value = t.date || todayStr();
  $("fAdd").textContent = "Simpan perubahan";
  $("fCancel").classList.remove("hidden");
  const hint = $("editHint");
  hint.textContent = !isLocalId(t.id)
    ? "Transaksi dari server — perubahan tersimpan di HP ini. Ubah permanen lewat chat."
    : "Transaksi lokal.";
  hint.classList.remove("hidden");
  $("fAmount").focus();
  document.querySelector("#tab-arus .card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function cancelEdit() {
  editingId = null;
  $("fAmount").value = ""; $("fAmount").dataset.raw = "";
  $("fNote").value = "";
  $("fAdd").textContent = "Catat";
  $("fCancel").classList.add("hidden");
  $("editHint").classList.add("hidden");
}
$("fAmount").addEventListener("input", () => fmtNumInput($("fAmount")));
$("fAdd").addEventListener("click", () => {
  const amount = amtRaw($("fAmount"));
  if (!amount || amount <= 0) { toast("Isi nominal dulu"); return; }
  const accId = $("fAcc").value ? $("fAcc").value : null;
  const fields = {
    amount,
    note: $("fNote").value.trim(),
    direction,
    category: $("fCat").value,
    account_id: accId,
    date: $("fDate").value || todayStr(),
  };
  if (editingId) {
    const t = DB.transactions.find((x) => String(x.id) === String(editingId));
    if (!t) { cancelEdit(); return; }
    const server = !isLocalId(t.id);
    adjBalance(t.account_id, t.direction === "in" ? "out" : "in", +t.amount || 0);
    Object.assign(t, fields);
    adjBalance(accId, direction, amount);
    if (server) {
      const o = loadOverrides();
      o.editedTx[String(t.id)] = { ...fields };
      saveOverrides(o);
      logAudit(`Ubah transaksi: ${t.note || "(tanpa keterangan)"} ${fmtRp(amount)} (lokal)`);
    }
    saveLocal();
    cancelEdit();
    toast(server ? "Perubahan tersimpan di HP ini" : "Perubahan tersimpan");
    renderAll();
    setArusSub("history");
    return;
  }
  DB.transactions.push({ id: "l" + Date.now(), ...fields });
  adjBalance(accId, direction, amount);
  saveLocal();
  $("fAmount").value = ""; $("fAmount").dataset.raw = ""; $("fNote").value = "";
  toast("Tercatat"); renderAll();
});
$("fCancel").addEventListener("click", cancelEdit);
$("filterDir").addEventListener("change", renderTx);
$("filterCat").addEventListener("change", renderTx);
$("txSearch").addEventListener("input", renderTx);

$("aBal").addEventListener("input", () => fmtNumInput($("aBal")));
$("aAdd").addEventListener("click", () => {
  const name = $("aName").value.trim();
  if (!name) { toast("Isi nama akun dulu"); return; }
  DB.accounts.push({
    id: "l" + Date.now(), name, kind: $("aKind").value,
    balance: amtRaw($("aBal")), note: "",
  });
  saveLocal();
  $("aName").value = ""; $("aBal").value = ""; $("aBal").dataset.raw = "";
  toast("Akun ditambah"); renderAll();
});

$("iAdd").addEventListener("click", () => {
  const symbol = $("iSymbol").value.trim().toUpperCase();
  const qty = parseFloat($("iQty").value), avg = parseFloat($("iAvg").value);
  if (!symbol || !qty || !avg) { toast("Lengkapi simbol, qty, harga"); return; }
  DB.investments.push({
    id: "l" + Date.now(), kind: $("iKind").value, symbol,
    qty, avg_price: avg, date: todayStr(), note: "",
  });
  saveLocal();
  $("iSymbol").value = ""; $("iQty").value = ""; $("iAvg").value = "";
  toast("Posisi ditambah"); renderAll();
});

let lastFocus = null;
function openSettings() {
  lastFocus = document.activeElement;
  renderDataInfo();
  $("settingsModal").classList.remove("hidden");
  $("sCloseX").focus();
}
function closeSettings() {
  $("settingsModal").classList.add("hidden");
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
$("settingsBtn").addEventListener("click", openSettings);
$("sClose").addEventListener("click", closeSettings);
$("sCloseX").addEventListener("click", closeSettings);
$("settingsModal").addEventListener("click", (e) => { if (e.target === $("settingsModal")) closeSettings(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("settingsModal").classList.contains("hidden")) closeSettings();
  if (e.key === "Tab" && !$("settingsModal").classList.contains("hidden")) {
    const f = [...$("settingsModal").querySelectorAll("button, input, select")].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
$("dResetLocal").addEventListener("click", async () => {
  if (!confirm("Hapus semua perubahan lokal (hapus & edit di HP) dan muat ulang data server?")) return;
  saveOverrides({ deletedTx: [], deletedAcc: [], deletedInv: [], editedTx: {}, editedAcc: {} });
  toast("Memuat snapshot…");
  await syncSnapshot();
  renderAll();
  toast("Perubahan lokal direset");
});
$("dExport").addEventListener("click", downloadBackup);
$("dImport").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.accounts) || !Array.isArray(d.transactions)) throw 0;
      DB = Object.assign({ version: 0, exported_at: "", prices: [] }, d);
      saveLocal(); toast("Cadangan dipulihkan"); renderAll();
      $("settingsModal").classList.add("hidden");
    } catch (err) { toast("File tidak valid"); }
  };
  r.readAsText(f);
  e.target.value = "";
});
$("dResync").addEventListener("click", async () => {
  toast("Memuat snapshot…");
  const st = await syncSnapshot();
  toast(st === "updated" ? "Data server dimuat" : st === "error" ? "Gagal memuat — periksa koneksi" : "Sudah yang terbaru");
  renderAll();
});

/* ---------- pull to refresh: tarik ke bawah saat di posisi paling atas ---------- */
/* Memakai syncSnapshot() yang sama dengan tombol "Muat ulang" di Pengaturan. */
(function pullToRefresh() {
  const el = $("pullRef"), label = $("pullRefText");
  const THRESHOLD = 56, MAX_PULL = 88;
  let startY = 0, pulling = false, refreshing = false, dist = 0;
  const setH = (h) => { el.style.height = h + "px"; };
  const reset = () => {
    pulling = false; dist = 0; setH(0);
    el.classList.remove("ready", "loading");
    label.textContent = "Tarik untuk refresh";
  };
  document.addEventListener("touchstart", (e) => {
    if (refreshing || window.scrollY > 0) return;
    if (!$("settingsModal").classList.contains("hidden")) return;
    if (e.target.closest("input, textarea, select, button, a, .modal")) return;
    pulling = true; startY = e.touches[0].clientY; dist = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0) { setH(0); return; }
    e.preventDefault(); /* cegah scroll + PTR bawaan browser saat menarik */
    const h = Math.min(dist * 0.5, MAX_PULL);
    setH(h);
    el.classList.toggle("ready", h >= THRESHOLD);
    label.textContent = h >= THRESHOLD ? "Lepas untuk refresh" : "Tarik untuk refresh";
  }, { passive: false });
  document.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    if (dist * 0.5 < THRESHOLD || refreshing) { reset(); return; }
    refreshing = true;
    el.classList.add("loading"); el.classList.remove("ready");
    setH(THRESHOLD); label.textContent = "Memuat…";
    const st = await syncSnapshot();
    toast(st === "updated" ? "Data server dimuat" : st === "error" ? "Gagal memuat — periksa koneksi" : "Sudah yang terbaru");
    renderAll();
    refreshing = false; reset();
  }, { passive: true });
})();
/* Form tambah akun/posisi dilipat supaya tidak mendorong konten ke bawah. */
document.querySelectorAll(".collapse-toggle").forEach((btn) =>
  btn.addEventListener("click", () => {
    const body = $(btn.dataset.target);
    const open = body.classList.toggle("hidden") === false;
    btn.setAttribute("aria-expanded", open);
    btn.textContent = (open ? "− " : "+ ") + btn.dataset.label;
  }));

/* ---------- boot ---------- */
async function syncSnapshot() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) return "error";
    return mergeSnapshot(await res.json());
  } catch (e) { return "error"; }
}

(function init() {
  loadLocal();
  $("fDate").value = todayStr();
  fillCats();
  fillFilterCats();
  renderAll();
  updateMonthStep("aset");
  syncSnapshot().then((st) => {
    window._syncError = st === "error";
    renderAll();
  });
})();
