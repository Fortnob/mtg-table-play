/* Print what the text parser makes of sentences: node tools/xmage/pe.js "Draw a card." ... */
'use strict';
process.env.OFFLINE = '1'; const w = console.warn; console.warn = () => {};
const { load } = require('../engine'); const MTG = load(); console.warn = w;
for (const t of process.argv.slice(2)) { const r = MTG.oracle.parseEffects(t); console.log(t, '\n  ', r.auto, JSON.stringify(r.effects)); }
