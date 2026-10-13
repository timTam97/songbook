/**
 * Seed a stage's table from the frozen seed (data/seed-songbook.json), then republish.
 *
 *   npm run seed -- --stage beta                  # seeds only if the table is empty
 *   npm run seed -- --stage beta --reset --yes    # discard everything on beta and re-import the seed
 *
 * Refuses to run against prod: prod is seeded once, by its first deploy.
 */
import type { PublishResult } from '../src/publish.ts';
import type { SeedResult } from '../src/seed.ts';
import { fail, frozenSeed, invoke, output, parseArgs, stackOutputs } from './stage.ts';

const USAGE = 'usage: npm run seed -- --stage beta [--reset --yes]';
const { stage, flags } = parseArgs(process.argv.slice(2), USAGE);
if (stage === 'prod') fail('Refusing to seed prod. Its table is seeded once, by its first deploy.');
const reset = flags.has('reset');
if (reset && !flags.has('yes')) {
  fail('--reset deletes every song, edit and history entry on beta, then re-imports the frozen seed. Add --yes to confirm.');
}
for (const flag of flags) if (flag !== 'reset' && flag !== 'yes') fail(`unknown flag --${flag}\n${USAGE}`);

const outputs = await stackOutputs(stage);
const seed = frozenSeed();
console.log(`Seeding ${stage} from ${seed.source} (${seed.book.songs.length} songs)${reset ? ', after emptying the table' : ''}…`);
const seeded = await invoke<SeedResult>(output(outputs, 'SeedFunctionName', stage), { ...seed, reset });
console.log(JSON.stringify(seeded));
const published = await invoke<PublishResult>(output(outputs, 'PublishFunctionName', stage), {});
console.log(JSON.stringify(published));
