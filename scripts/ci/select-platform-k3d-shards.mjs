import { appendFileSync } from 'node:fs';

import { captureCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import { platformK3dFullShardNames, platformK3dPullRequestShardNames } from '../deploy/platform-k3d-e2e-shards.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

/**
 * Changes to the subsystems the reduced pull-request lane does not fully exercise escalate that
 * pull request to the full matrix. Everything else is proven by the two pull-request shards, and
 * regressions outside them surface on the next main and nightly run.
 */
export const platformK3dFullMatrixPathPrefixes = Object.freeze([
  '.github/workflows/',
  'deploy/',
  'packages/cli/src/commands/install/',
  'packages/cli/src/services/kubernetes-',
  'packages/docker/',
  'packages/edge/',
  'packages/kube-runtime/',
  'packages/worker/',
  'scripts/deploy/',
]);

export function selectPlatformK3dShards(changedPaths) {
  const escalated = changedPaths.some((changedPath) =>
    platformK3dFullMatrixPathPrefixes.some((prefix) => changedPath.startsWith(prefix)),
  );

  return {
    escalated,
    shards: escalated ? [...platformK3dFullShardNames] : [...platformK3dPullRequestShardNames],
  };
}

export function readChangedPaths(baseRef, headRef) {
  const mergeBase = captureCommand('git', ['merge-base', baseRef, headRef], repositoryRoot).trim();

  return captureCommand('git', ['diff', '--name-only', `${mergeBase}..${headRef}`], repositoryRoot)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

runMain(import.meta.url, process.argv[1], async () => {
  const [baseRef, headRef] = process.argv.slice(2);
  const selection =
    baseRef === undefined || headRef === undefined
      ? { escalated: true, shards: [...platformK3dFullShardNames] }
      : selectPlatformK3dShards(readChangedPaths(baseRef, headRef));
  const outputPath = process.env.GITHUB_OUTPUT;

  process.stdout.write(
    `platform k3d lane: ${selection.escalated ? 'full matrix' : 'pull request'} (${selection.shards.join(', ')})\n`,
  );
  if (outputPath !== undefined && outputPath !== '') {
    appendFileSync(outputPath, `shards_json=${JSON.stringify(selection.shards)}\n`);
  }
});
