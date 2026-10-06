/* For the most-played cards blocked by a class their own file writes, show
   the printed line and that class's code, for writing a translator by hand.
   node tools/xmage/customs.js [--from 0] [--to 15] [--std] */
'use strict';
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const from = +arg('from', 0), to = +arg('to', 15);
const lines = fs.readFileSync(path.join(__dirname, '..', 'out', 'xmage-popular.txt'), 'utf8').split('\n')
  .filter(l => /custom/.test(l) && (!process.argv.includes('--std') || l[0] === 'S'));
const CARDS = path.join(__dirname, '..', '..', 'vendor', 'xmage', 'Mage.Sets', 'src', 'mage', 'cards');
const flat = (n) => String(n).split(' // ')[0].replace(/['’]/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
for (const l of lines.slice(from, to)) {
  const name = l.replace(/^. #\d+ /, '').replace(/: .*$/, '');
  const f = flat(name);
  const dir = path.join(CARDS, f[0]);
  const file = fs.readdirSync(dir).find(x => x.toLowerCase() === f + '.java');
  console.log('\n######## ' + l.slice(0, 160));
  if (!file) continue;
  const src = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^import .*\n/gm, '').replace(/\n\s*\n/g, '\n')
    .replace(/\s*@Override\s*\n\s*public \w+ copy\(\) \{[^}]*\}/g, '').replace(/\s*private \w+\(final \w+ \w+\) \{[^}]*\}/g, '');
  console.log(src.replace(/^package.*\n/, '').replace(/\/\*\*[\s\S]*?\*\/\n/, '').slice(0, 4000));
}
