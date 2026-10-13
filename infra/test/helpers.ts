import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { App } from 'aws-cdk-lib';
import { SiteStack, type SiteStackProps } from '../lib/site-stack.ts';

export const env = { account: '123456789012', region: 'ap-southeast-2' };

// Stand-ins for web/dist and the seed, so the tests do not depend on a prior build.
// They live in the OS temp dir, which the test run cleans up with the rest of its files.
const root = mkdtempSync(path.join(tmpdir(), 'songbook-infra-test-'));
export const siteDir = path.join(root, 'site');
mkdirSync(path.join(siteDir, 'assets'), { recursive: true });
writeFileSync(path.join(siteDir, 'index.html'), '<!doctype html>');
writeFileSync(path.join(siteDir, 'assets', 'index-abc123.js'), '');
export const seedFile = path.join(root, 'seed.json');
writeFileSync(seedFile, JSON.stringify({ source: 'test', book: { title: 'Test', songs: [] } }));
export const testRoot = root;

/** Skipping Lambda bundling keeps most tests fast; one test bundles for real. */
export const fastApp = () => new App({ context: { 'aws:cdk:bundling-stacks': [] } });

export function siteStack(props: Partial<SiteStackProps> = {}, app = fastApp(), id = 'Site'): SiteStack {
  return new SiteStack(app, id, { env, siteDir, seedFile, stage: 'beta', authDomain: { prefix: 'example-auth' }, ...props });
}

export const certificateArn = 'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000';
