/* Print what analyze() makes of a made-up card: node tools/xmage/pa.js "Type Line" "oracle text" */
process.env.OFFLINE = '1'; const w = console.warn; console.warn = () => {};
const { load } = require('../engine'); const MTG = load(); console.warn = w;
const [tl, ...texts] = process.argv.slice(2);
for (const t of texts) {
  const a = MTG.oracle.analyze({ id: 'probe:' + t, name: 'Probe Card', type_line: tl, oracle_text: t.split(' || ').join('\n'), power: '2', toughness: '2', keywords: [], layout: 'normal', mana_cost: '{2}' });
  console.log(t, a.fullyAutomated ? '' : '[MANUAL]');
  for (const ab of a.abilities.concat(a.manaAbilities)) { const x = Object.assign({}, ab); delete x.text; console.log('  ', JSON.stringify(x)); }
  if (a.keywords.length) console.log('   kw', a.keywords.map(k => k.keyword + (k.arg ? ' ' + k.arg : '')).join(', '));
}
