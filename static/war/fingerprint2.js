// Calmview stand-in for fingerprintjs2: gives the page a random value instead of a fingerprint.
(function () {
  "use strict";
  var id = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  function Fingerprint2() {}
  Fingerprint2.get = function (_o, cb) { if (typeof _o === "function") cb = _o; setTimeout(function () { cb([]); }, 1); };
  Fingerprint2.getPromise = function () { return Promise.resolve([]); };
  Fingerprint2.getV18 = function (_o, cb) { if (typeof _o === "function") cb = _o; setTimeout(function () { cb(id, []); }, 1); };
  Fingerprint2.x64hash128 = function () { return id; };
  Fingerprint2.VERSION = "2.1.0";
  Fingerprint2.prototype.get = function (cb) { setTimeout(function () { cb(id, []); }, 1); };
  window.Fingerprint2 = Fingerprint2;
})();
