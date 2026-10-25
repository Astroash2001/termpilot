// TermPilot · alerts
// Shows the relay's push messages (an agent needs an answer, or finished) while TermPilot is
// closed or the phone is locked, and opens the chat an alert is about when it is tapped.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch {}
  // Browsers drop the subscription of a site that receives a push and shows nothing, so always show one
  event.waitUntil(self.registration.showNotification(msg.title || "TermPilot", {
    body: msg.body || "",
    tag: msg.tag,
    renotify: Boolean(msg.tag),
    data: { url: msg.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const [win] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (!win) return self.clients.openWindow(url);
    // The open page switches chats itself; navigating would reload it and drop the connection
    win.postMessage({ type: "OPEN", url });
    return win.focus();
  })());
});
