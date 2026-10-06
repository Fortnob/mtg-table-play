/* The card database in Node: reads a Scryfall bulk file from tools/ into
   MTG.cardDb, the same packed form the browser keeps in IndexedDB, so the
   tools can search locally just as the app does.

     const { loadLocalDb } = require('./localdb');
     await loadLocalDb(MTG);                  // default-cards if present, else oracle-cards
     await loadLocalDb(MTG, { kind: 'oracle_cards' });

   python tools/fetch-bulk.py fetches oracle-cards; --type default fetches
   every printing (default-cards.jsonl.gz), which drafts need. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const FILES = {
  default_cards: path.join(__dirname, 'default-cards.jsonl.gz'),
  oracle_cards: path.join(__dirname, 'oracle-cards.jsonl.gz'),
};

function pickFile(kind) {
  if (kind) return fs.existsSync(FILES[kind]) ? [kind, FILES[kind]] : null;
  for (const k of ['default_cards', 'oracle_cards']) if (fs.existsSync(FILES[k])) return [k, FILES[k]];
  return null;
}

/** Packs a bulk file; resolves to { data, ms }. */
async function packFile(MTG, file, kind) {
  const t0 = Date.now();
  const packer = new MTG.cardDb.Packer(kind);
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) packer.addLine(line);
  return { data: packer.finish(), ms: Date.now() - t0 };
}

async function loadLocalDb(MTG, opts) {
  opts = opts || {};
  const got = pickFile(opts.kind);
  if (!got) throw new Error('No bulk file in tools/ (python tools/fetch-bulk.py)');
  const [kind, file] = got;
  const { data, ms } = await packFile(MTG, file, kind);
  const t1 = Date.now();
  MTG.cardDb.use(data, { kind, file: path.basename(file), oracles: data.oracles.length, prints: data.prints.length,
    updated_at: fs.statSync(file).mtime.toISOString() });
  return { kind, file, packMs: ms, indexMs: Date.now() - t1, oracles: data.oracles.length, prints: data.prints.length, data };
}

module.exports = { loadLocalDb, packFile, FILES };
