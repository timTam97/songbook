/**
 * Write a stage's public songbook.json to a directory, checked and
 * pretty-printed. The weekly export commits this file to the `content` branch;
 * it is also a seed for SEED_FILE (to promote beta's songs at the cutover, or
 * to re-seed an empty table from a backup).
 *
 *   npm run export -- --stage beta --out .tmp/export          # site URL from the stack outputs
 *   npm run export -- --url https://songs.example.com --out x  # any site; needs no AWS access
 *
 * A relative --out is relative to the directory npm was run from.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXPORT_FILE, exportSongbook, type Exported } from '../src/export.ts';
import { fail, output, stackOutputs, type Stage } from './stage.ts';

const USAGE = 'usage: npm run export -- (--stage beta|prod | --url https://<site>) --out <dir>';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const match = /^--(stage|url|out)(?:=(.*))?$/.exec(argv[i]);
  if (!match) fail(`unexpected argument ${argv[i]}\n${USAGE}`);
  const value = match[2] ?? argv[++i];
  if (!value) fail(`--${match[1]} needs a value\n${USAGE}`);
  args.set(match[1], value);
}
const stage = args.get('stage');
const url = args.get('url');
const out = args.get('out');
if (!out || (stage === undefined) === (url === undefined)) fail(USAGE);
if (stage !== undefined && stage !== 'beta' && stage !== 'prod') fail(USAGE);

const site = url ?? output(await stackOutputs(stage as Stage), 'SiteUrl', stage as Stage);
const endpoint = `${site.replace(/\/+$/, '')}/${EXPORT_FILE}`;
const res = await fetch(endpoint, { cache: 'no-store' });
if (!res.ok) fail(`${endpoint}: HTTP ${res.status}`);
let exported: Exported;
try {
  exported = exportSongbook(await res.text(), res.headers.get('content-type'));
} catch (err) {
  fail(`${endpoint}: ${(err as Error).message}`);
}

const file = path.join(path.resolve(process.env.INIT_CWD ?? process.cwd(), out), EXPORT_FILE);
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, exported.text);
console.log(`Wrote ${exported.songs} songs (last edited ${exported.updatedAt}) to ${file}.`);
