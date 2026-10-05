/* Read sentences the way a card's text would be read, one per argument:
   node tools/ps.js "Draw a card." "Target creature gets +1/+1 until end of turn."
   With --line, each argument is read as a whole line of a permanent's text
   (statics, triggers, activated abilities) instead of as one effect. */
'use strict';
process.env.OFFLINE = '1';
const w = console.warn; console.warn = () => {};
const MTG = require('./engine').load();
console.warn = w;
const asLine = process.argv.includes('--line');
let k = 0;
for (const s of process.argv.slice(2).filter(a => a !== '--line')) {
  console.log(s);
  if (asLine) {
    const a = MTG.oracle.analyze({ id: 'probe:' + (k++) + ':' + s.length, name: 'Probe Card', type_line: 'Enchantment',
      oracle_text: s, mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [], layout: 'normal' });
    for (const ab of a.abilities.concat(a.manaAbilities)) {
      console.log('  ' + (ab.auto ? ' ' : '!') + ab.kind + (ab.event ? '[' + ab.event + ']' : '') + ' ' + JSON.stringify(ab.effects));
    }
  } else {
    console.log('  ' + JSON.stringify(MTG.oracle.parseEffectSentence(s.replace(/\.$/, ''))));
  }
}
