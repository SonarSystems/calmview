// Calmview stand-in for Google Publisher Tags (gpt.js): pages that queue ad calls keep working, and
// no ads are requested.
(function () {
  "use strict";
  var w = window;
  var chain = function () {
    var target = function () {};
    var p = new Proxy(target, {
      get: function (_t, k) {
        if (k === "then") return undefined;
        if (k === Symbol.toPrimitive) return function () { return ""; };
        return function () { return p; };
      },
      apply: function () { return p; },
    });
    return p;
  };
  var listeners = [];
  var slot = function (path, id) {
    var s = chain();
    return new Proxy(s, {
      get: function (_t, k) {
        if (k === "getSlotElementId") return function () { return id; };
        if (k === "getAdUnitPath") return function () { return path; };
        if (k === "getTargeting" || k === "getTargetingKeys" || k === "getCategoryExclusions") return function () { return []; };
        if (k === "getResponseInformation") return function () { return null; };
        return function () { return s; };
      },
    });
  };
  var slots = [];
  var pubads = {
    addEventListener: function (t, fn) { listeners.push([t, fn]); return pubads; },
    removeEventListener: function () { return pubads; },
    getSlots: function () { return slots; },
    getTargeting: function () { return []; },
    getTargetingKeys: function () { return []; },
    isInitialLoadDisabled: function () { return false; },
    refresh: function (list) {
      (list || slots).forEach(function (s) {
        listeners.forEach(function (l) { if (l[0] === "slotRenderEnded") try { l[1]({ slot: s, isEmpty: true, size: null }); } catch (e) {} });
      });
    },
  };
  pubads = new Proxy(pubads, { get: function (t, k) { return k in t ? t[k] : function () { return pubads; }; } });
  var gt = w.googletag || {};
  var queue = Array.isArray(gt.cmd) ? gt.cmd : [];
  gt.apiReady = true;
  gt.pubadsReady = true;
  gt.pubads = function () { return pubads; };
  gt.companionAds = function () { return chain(); };
  gt.content = function () { return chain(); };
  gt.defineSlot = function (path, _size, id) { var s = slot(path, id); slots.push(s); return s; };
  gt.defineOutOfPageSlot = function (path, id) { var s = slot(path, id); slots.push(s); return s; };
  gt.destroySlots = function () { slots.length = 0; return true; };
  gt.display = function () {};
  gt.enableServices = function () {};
  gt.disablePublisherConsole = function () {};
  gt.openConsole = function () {};
  gt.setAdIframeTitle = function () {};
  gt.sizeMapping = function () { return chain(); };
  gt.getVersion = function () { return "hush"; };
  gt.cmd = { push: function () { for (var i = 0; i < arguments.length; i++) try { arguments[i](); } catch (e) {} return 0; } };
  w.googletag = gt;
  queue.forEach(function (fn) { try { fn(); } catch (e) {} });
})();
