// Calmview stand-in for AdSense (adsbygoogle.js): accepts the page's push() calls and shows nothing.
(function () {
  "use strict";
  var old = window.adsbygoogle;
  window.adsbygoogle = { loaded: true, push: function () {} };
  if (Array.isArray(old)) old.length = 0;
})();
