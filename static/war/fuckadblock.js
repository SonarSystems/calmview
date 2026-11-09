// Calmview stand-in for (Fuck|Block)AdBlock detectors: always reports "no ad blocker".
(function () {
  "use strict";
  function Detector() {}
  Detector.prototype.onDetected = function () { return this; };
  Detector.prototype.onNotDetected = function (fn) { if (typeof fn === "function") setTimeout(fn, 1); return this; };
  Detector.prototype.on = function (detected, fn) { return detected ? this : this.onNotDetected(fn); };
  Detector.prototype.check = function () { return false; };
  Detector.prototype.emitEvent = function () { return this; };
  Detector.prototype.clearEvent = function () {};
  Detector.prototype.setOption = function () { return this; };
  window.FuckAdBlock = window.BlockAdBlock = window.SniffAdBlock = Detector;
  window.fuckAdBlock = window.blockAdBlock = window.sniffAdBlock = new Detector();
})();
