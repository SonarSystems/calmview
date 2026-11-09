// Calmview stand-in for Amazon's apstag: bid requests return no bids at once.
(function () {
  "use strict";
  var w = window;
  var q = w.apstag && w.apstag._Q;
  w.apstag = {
    init: function () {},
    fetchBids: function (_c, cb) { if (typeof cb === "function") setTimeout(function () { cb([]); }, 1); },
    setDisplayBids: function () {},
    targetingKeys: function () { return []; },
    renderImp: function () {},
    rpa: function () {}, upa: function () {}, dpa: function () {},
    _Q: [],
  };
  if (Array.isArray(q)) q.length = 0;
})();
