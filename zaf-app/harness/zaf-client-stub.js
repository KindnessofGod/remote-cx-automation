// A stand-in for Zendesk's ZAFClient, exactly as thin as the sidebar needs.
// Implements only what zaf-app/assets/main.js actually calls: metadata(), get(),
// invoke(), request(). Not a mock of Zendesk — a harness that lets the REAL
// sidebar bundle boot outside an iframe so its rendering and wiring can be
// driven. `request()` deliberately does NOT do the `jwt` substitution, so the
// bundle takes its documented no-ZAF fallback path.
window.ZAFClient = {
  init: function () {
    return {
      metadata: function () {
        return Promise.resolve({ settings: { apiBaseUrl: "http://localhost:4020" } });
      },
      get: function () {
        return Promise.resolve({
          "ticket.id": Number(new URLSearchParams(location.search).get("ticket") || 2001),
          "currentUser.email": "specialist@example.com",
          "currentUser.name": "Sam Specialist",
          "currentUser.id": 42,
        });
      },
      invoke: function () { return Promise.resolve(); },
      request: function (req) {
        return fetch(req.url, {
          method: req.type || "GET",
          headers: Object.assign({ "content-type": "application/json" },
            Object.fromEntries(Object.entries(req.headers || {})
              .filter(([, v]) => typeof v === "string" && v.indexOf("{{jwt") === -1))),
          body: req.data,
        }).then(function (r) { return r.text().then(function (t) {
          try { return JSON.parse(t); } catch (e) { return t; }
        }); });
      },
    };
  },
};
