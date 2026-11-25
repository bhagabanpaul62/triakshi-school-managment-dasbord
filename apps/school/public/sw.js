// Push only: shows what the server sends and opens the app on a tap. No caching, no offline pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Only a path inside this app on this origin. "//host", "/\host" and other origins resolve elsewhere and are refused.
function appUrl(href) {
  try {
    const u = new URL(String(href || ""), self.location.origin);
    if (u.origin === self.location.origin && /^\/app(\/|$)/.test(u.pathname)) return u.href;
  } catch (e) { /* fall through */ }
  return new URL("/app/notifications", self.location.origin).href;
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const tag = typeof d.tag === "string" && d.tag ? d.tag : undefined;
  event.waitUntil(self.registration.showNotification(typeof d.title === "string" && d.title ? d.title : "New notification", {
    body: typeof d.body === "string" ? d.body : "", tag, renotify: !!tag, data: { href: appUrl(d.href) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.href);
  event.waitUntil((async () => {
    const open = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).find((c) => new URL(c.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ("navigate" in open) await open.navigate(url).catch(() => {});
    } else await self.clients.openWindow(url);
  })());
});
