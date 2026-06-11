(function () {
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "http://localhost:8000";

  function getAuthToken() {
    return localStorage.getItem("userToken");
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var rawData = window.atob(base64);
    var output = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) {
      output[i] = rawData.charCodeAt(i);
    }
    return output;
  }

  async function subscribeToPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    var token = getAuthToken();
    if (!token) return;

    try {
      var reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      var keyRes = await fetch(API + "/api/push/vapid-public-key");
      var keyData = await keyRes.json();
      if (!keyData.public_key) return;

      var applicationServerKey = urlBase64ToUint8Array(keyData.public_key);

      var subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey,
      });

      await fetch(API + "/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(subscription),
      });
    } catch (e) {
      console.error("Push subscription failed:", e);
    }
  }

  async function unsubscribeFromPush() {
    if (!("serviceWorker" in navigator)) return;

    var token = getAuthToken();
    if (!token) return;

    try {
      var reg = await navigator.serviceWorker.ready;
      var subscription = await reg.pushManager.getSubscription();
      if (!subscription) return;

      await fetch(API + "/api/push/subscribe", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      await subscription.unsubscribe();
    } catch (e) {
      console.error("Push unsubscription failed:", e);
    }
  }

  var token = getAuthToken();
  if (token) {
    subscribeToPush();
  }

  window.addEventListener("storage", function (e) {
    if (e.key === "userToken" && e.newValue) {
      subscribeToPush();
    }
  });
})();
