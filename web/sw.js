// TermPilot service worker. It exists only so Android Chrome can show the
// "run finished" notification (pages there may not call new Notification()).
// It caches nothing: the terminal is live, so a stale copy would be worse than none.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Tapping the notification brings the TermPilot tab back, or opens one
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const open = tabs.find((tab) => "focus" in tab);
      return open ? open.focus() : self.clients.openWindow("/");
    })
  );
});
