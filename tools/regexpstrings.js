'use strict';
/*
 * Patterns built from strings: new RegExp('\\b' + word + '\\b'). In a string
 * the backslash has to be doubled; written once, '\b' is a backspace and
 * '\d', '\s', '\w' lose theirs, so the pattern quietly matches something
 * else and nothing throws. This looks at every string on a line from
 * RegExp( onwards and fails on a lone backslash before b, d, s or w.
 *
 *   node tools/regexpstrings.js [dir]     (default: src)
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..', 'src');
const LIT = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const LONE = /(?<!\\)(?:\\\\)*\\[bdswBDSW]/;

const found = new Set();
let calls = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
  fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
    for (let at = line.indexOf('RegExp('); at >= 0; at = line.indexOf('RegExp(', at + 1)) {
      calls++;
      for (const m of line.slice(at).matchAll(LIT)) {
        if (LONE.test(m[0])) found.add(`${f}:${i + 1} ${m[0].slice(0, 60)}`);
      }
    }
  });
}
if (found.size) {
  console.log([...found].join('\n'));
  console.log(found.size + ' strings given to RegExp with a backslash written once; double it (\\\\b, \\\\d, \\\\s, \\\\w)');
  process.exit(1);
}
console.log(calls + ' RegExp( calls, every backslash in their strings doubled');
