/* ============================================================
   10d3-packvalue.js - what some sets' packs cost, against an ordinary one

   Written by tools/packvalue.js (rerun it when prices or sets change).
   MTG.packValue: a set whose packs are worth well above an ordinary set's
   (its cards' prices, dealt by the odds its packs are made with), and the
   times the usual price its packs cost. Any set not here costs the usual.
   MTG.coreCovered: core sets every card of which the packs of the other
   sets (not core sets) hold too; the Store does not sell them.
   ============================================================ */
'use strict';
(function (MTG) {
  MTG.packValue = {"acr":1.25,"cmm":1.5,"2x2":1.25,"clb":1.25,"plst":1.25,"2xm":1.5,"mh1":1.25,"uma":1.5,"a25":1.25,"ima":1.25,"mm3":1.25,"ema":1.75,"mma":1.5};
  MTG.coreCovered = new Set(["2ed","3ed","sum","4ed","5ed"]);
})(window.MTG);
