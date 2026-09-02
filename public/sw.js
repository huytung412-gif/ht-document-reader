// Service worker cũ gây kẹt cache mã nguồn -> phiên bản này TỰ GỠ chính nó,
// xoá toàn bộ cache và nạp lại trang để trình duyệt lấy mã mới nhất.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        try { c.navigate(c.url); } catch {}
      }
    })()
  );
});

// Trong lúc còn sống: không can thiệp gì, để mọi request đi thẳng ra mạng.
