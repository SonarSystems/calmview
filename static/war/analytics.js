// Calmview stand-in for Google Analytics / Tag Manager: nothing is recorded, but pages that wait for a
// "hit sent" callback (often before following a link) still get it.
(function () {
  "use strict";
  var w = window;
  var callback = function (o) {
    if (!o || typeof o !== "object") return;
    var fn = o.hitCallback || o.eventCallback || o.event_callback;
    if (typeof fn === "function") setTimeout(fn, 1);
  };
  var tracker = { get: function () {}, set: function () {}, send: function () { for (var i = 0; i < arguments.length; i++) callback(arguments[i]); } };
  var ga = function () {
    var a = arguments;
    for (var i = 0; i < a.length; i++) { if (typeof a[i] === "function") { try { a[i](tracker); } catch (e) {} } callback(a[i]); }
  };
  ga.create = function () { return tracker; };
  ga.getByName = function () { return tracker; };
  ga.getAll = function () { return [tracker]; };
  ga.remove = function () {};
  ga.loaded = true;
  var name = w.GoogleAnalyticsObject || "ga";
  var q = w[name] && w[name].q;
  w[name] = ga;
  if (Array.isArray(q)) q.forEach(function (args) { ga.apply(null, args); });
  w.gtag = w.gtag || function () { for (var i = 0; i < arguments.length; i++) callback(arguments[i]); };
  var dl = w.dataLayer = w.dataLayer || [];
  var push = dl.push;
  dl.push = function () { for (var i = 0; i < arguments.length; i++) callback(arguments[i]); return push.apply(dl, arguments); };
  w.google_tag_manager = w.google_tag_manager || {};
  w._gaq = w._gaq || { push: function () {} };
})();
