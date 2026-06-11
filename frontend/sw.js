self.addEventListener("push", function (event) {
  let data = { title: "Smart Park & Ride", body: "", data: {} };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: data.data,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then(function (windowClients) {
      if (windowClients.length > 0) {
        return windowClients[0].focus();
      }
      return clients.openWindow(url);
    }),
  );
});
