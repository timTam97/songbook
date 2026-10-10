/** Shared plumbing for the scripts that drive a deployed stage from this machine. */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

export type Stage = 'prod' | 'beta';

export const STACK_NAMES: Record<Stage, string> = { prod: 'MelbourneSongsSite', beta: 'MelbourneSongsBeta' };

const region = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2';

export interface Args {
  stage: Stage;
  flags: Set<string>;
}

/** `--stage beta --reset --yes` -> { stage: 'beta', flags: {reset, yes} }. */
export function parseArgs(argv: string[], usage: string): Args {
  const flags = new Set<string>();
  let stage: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stage') stage = argv[++i];
    else if (arg.startsWith('--stage=')) stage = arg.slice('--stage='.length);
    else if (arg.startsWith('--')) flags.add(arg.slice(2));
    else fail(`unexpected argument ${arg}\n${usage}`);
  }
  if (stage !== 'beta' && stage !== 'prod') fail(`--stage beta|prod is required\n${usage}`);
  return { stage, flags };
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export async function stackOutputs(stage: Stage): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region });
  const out = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAMES[stage] }));
  const outputs = out.Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(outputs.map((o) => [o.OutputKey!, o.OutputValue!]));
}

export function output(outputs: Record<string, string>, key: string, stage: Stage): string {
  const value = outputs[key];
  if (!value) fail(`${STACK_NAMES[stage]} has no ${key} output. Deploy it first (npm run deploy:beta).`);
  return value;
}

/** Synchronous invoke; throws with the function's own error message if it failed. */
export async function invoke<T>(functionName: string, payload: unknown): Promise<T> {
  const lambda = new LambdaClient({ region });
  const out = await lambda.send(
    new InvokeCommand({ FunctionName: functionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(payload)) }),
  );
  const text = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '';
  if (out.FunctionError) {
    let message = text;
    try {
      message = (JSON.parse(text) as { errorMessage?: string }).errorMessage ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(`${functionName} failed: ${message}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
