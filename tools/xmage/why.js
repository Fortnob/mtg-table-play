/* Show how one card's XMage class lines up with its printed lines: node tools/xmage/why.js "Card Name" */
'use strict';
process.env.OFFLINE = '1';
const q = console.warn; console.warn = () => {};
const { load } = require('../engine');
const MTG = load();
console.warn = q;
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { loadCard } = require('./model');
const name = process.argv[2];
const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', 'oracle-cards.jsonl.gz'))).toString('utf8');
let card = null;
for (const line of raw.split('\n')) { if (line.includes(JSON.stringify(name).slice(1, -1))) { const c = JSON.parse(line); if (c.name === name) { card = c; break; } } }
if (!card) { console.log('no such card'); process.exit(1); }
MTG.cardlib = null;
const an = MTG.oracle.analyze(MTG.scry.slim(card));
const flat = (n) => String(n).split(' // ')[0].replace(/['’]/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const f = flat(card.name);
const file = path.join(__dirname, '..', '..', 'vendor', 'xmage', 'Mage.Sets', 'src', 'mage', 'cards', f[0], fs.readdirSync(path.join(__dirname, '..', '..', 'vendor', 'xmage', 'Mage.Sets', 'src', 'mage', 'cards', f[0])).find(x => x.toLowerCase() === f + '.java'));
console.log(file);
(an.lineInfo || []).forEach((li, i) => console.log(`line ${i} ${li.auto ? 'auto' : 'MANUAL'}: ${li.text}`));
const m = loadCard(file);
console.log('problems:', m.problems.join('; ') || '-');
for (const a of m.abilities) console.log(`ability ${a.obj.cls || a.obj.t} @${a.line} cmt: ${a.cmt}`);
if (m.spell) for (const c of m.spell.calls) console.log(`spell.${c.name} ${c.args.map(x => x.cls || x.path || x.t).join(',')} @${c.line} cmt: ${c.cmt}`);
