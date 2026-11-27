/* UangKu service worker — app shell cached. TIDAK ADA API lagi (local-first).
   data.json selalu network agar snapshot terbaru selalu terambil.
   ATURAN: naikkan CACHE setiap mengubah index.html / app.js / styles.css,
   kalau tidak browser & PWA tetap menyajikan versi lama dari cache.
   (v10 = kembalinya kode v3 setelah rollback migrasi Firebase 2026-11-08.)
   (v11 = tambah donat pengeluaran + rincian Lainnya, 2026-11-12.)
   (v12 = perbaiki relTime NaN untuk updated_at ISO ber-zona, 2026-11-12.)
   (v13 = donat jadi konsumtif saja, tanpa investasi & tabungan, 2026-11-12.)
   (v14 = donat pindah ke menu/tab "Grafik" sendiri, 2026-11-12.)
   (v15 = grup "Top up e-wallet" jadi "Langganan Claude" + ikon logo Claude, 2026-11-12.)
   (v16 = merge snapshot transaksi jadi upsert server-menang, 2026-11-12.)
   (v17 = baris versi app+data di footer, untuk diagnosis cache, 2026-11-12.) */
const CACHE = "uangku-v24";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json",
               "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.endsWith("data.json")) return; // snapshot: selalu network, jangan cache
  if (url.pathname.startsWith("/api/")) return; // API multi-user: selalu network
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
