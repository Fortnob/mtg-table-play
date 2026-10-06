/* Summarise tools/out/xmage-compare.json (from build.js --compare): node tools/xmage/diffs.js [pattern] [n] */
'use strict';
const d = require('../out/xmage-compare.json');
const pat = process.argv[2] ? new RegExp(process.argv[2]) : null;
const per = +(process.argv[3] || 4);
const by = {};
for (const x of d) {
  const k = x.diff.replace(/: parser.*/, '').replace(/\.\d+/g, '.N');
  (by[k] = by[k] || []).push(x);
}
for (const [k, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  if (pat && !pat.test(k)) continue;
  console.log(`=== ${list.length} ${k}`);
  for (const x of list.slice(0, per)) console.log(`  ${x.name} :: ${x.line.slice(0, 90)}\n     ${x.diff.slice(0, 260)}`);
}
