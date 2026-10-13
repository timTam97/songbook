/**
 * Check that a stage's public songbook.json is the frozen seed
 * (data/seed-songbook.json), ignoring the fields only the published book has
 * (schemaVersion, updatedAt). Run it after the first deploy of a stage, or
 * after `npm run seed -- --reset`; once editors save changes it will differ.
 *
 *   npm run check:published -- --stage beta
 */
import { sameData, type Songbook } from '@songbook/core';
import { fail, frozenSeed, output, parseArgs, stackOutputs } from './stage.ts';

const { stage } = parseArgs(process.argv.slice(2), 'usage: npm run check:published -- --stage beta|prod');
const url = `${output(await stackOutputs(stage), 'SiteUrl', stage)}/songbook.json`;
const res = await fetch(url, { cache: 'no-store' });
if (!res.ok) fail(`${url}: HTTP ${res.status}`);
const type = res.headers.get('content-type');
if (type !== 'application/json') fail(`${url}: Content-Type is ${type}, expected application/json`);

const { schemaVersion, updatedAt, ...published } = (await res.json()) as Songbook;
const { book: expected, source } = frozenSeed();
if (schemaVersion !== 1) fail(`schemaVersion is ${schemaVersion}, expected 1`);
if (!updatedAt) fail('updatedAt is missing');

if (!sameData(published, expected)) {
  const differing = expected.songs.filter((song, k) => !sameData(published.songs?.[k], song)).map((s) => `${s.number} ${s.title}`);
  fail(
    `${url} differs from ${source}: ${published.songs?.length} songs published vs ${expected.songs.length}; ` +
      `differing: ${differing.slice(0, 10).join(', ') || 'book metadata'}`,
  );
}
console.log(`OK: ${url} matches ${source} (${expected.songs.length} songs, updated ${updatedAt}).`);
