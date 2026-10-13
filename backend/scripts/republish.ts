/**
 * Force a publish of songbook.json for a stage (the admin portal's Republish button).
 *
 *   npm run republish -- --stage beta
 */
import type { PublishResult } from '../src/publish.ts';
import { invoke, output, parseArgs, stackOutputs } from './stage.ts';

const { stage } = parseArgs(process.argv.slice(2), 'usage: npm run republish -- --stage beta|prod');
const outputs = await stackOutputs(stage);
console.log(JSON.stringify(await invoke<PublishResult>(output(outputs, 'PublishFunctionName', stage), {})));
