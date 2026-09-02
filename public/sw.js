// Service worker "network-first": LUÔN thử mạng trước, chỉ dùng bản lưu khi offline.
// -> mã nguồn không bao giờ bị kẹt bản cũ, nhưng vẫn cài được thành app + chạy offline phần vỏ.
const V = "dt-net-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // để trình duyệt tự lo bên ngoài
  if (url.pathname.startsWith("/api/")) return; // API: luôn ra mạng, không đụng

  e.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type === "basic") {
          const c = await caches.open(V);
          c.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell =
            (await caches.match("/index.html")) || (await caches.match("/"));
          if (shell) return shell;
        }
        return new Response("Ngoại tuyến", { status: 503, statusText: "offline" });
      }
    })()
  );
});
