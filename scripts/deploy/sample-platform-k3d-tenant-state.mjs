import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { captureCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const sampleIntervalMs = 500;

export function describeNetworkPolicy(policy) {
  return `generation=${policy.metadata.generation} ingress=${JSON.stringify(policy.spec.ingress ?? null)}`;
}

/**
 * A `Recreate` Deployment tears its Pod down on any spec change, so an oscillating template reads as repeated Pod
 * replacement rather than a crash. Recording the template digest alongside the generation separates the two.
 */
export function describeDeployment(deployment) {
  return [
    `generation=${deployment.metadata.generation}`,
    `replicas=${deployment.spec.replicas}`,
    `strategy=${deployment.spec.strategy?.type ?? 'RollingUpdate'}`,
    `template=${digest(deployment.spec.template)}`,
  ].join(' ');
}

const trackedResources = [
  { describe: describeNetworkPolicy, resource: 'networkpolicies' },
  { describe: describeDeployment, resource: 'deployments' },
];

export function readObjectStates(output, describe) {
  return new Map(
    JSON.parse(output).items.map((object) => [
      `${object.metadata.namespace}/${object.metadata.name}`,
      describe(object),
    ]),
  );
}

export function diffObjectStates(previous, current) {
  return [
    ...[...current].filter(([key, state]) => previous.get(key) !== state).map(([key, state]) => `${key} ${state}`),
    ...[...previous].filter(([key]) => !current.has(key)).map(([key]) => `${key} deleted`),
  ].sort((left, right) => left.localeCompare(right));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function sampleResource(tracked, previous, outputPath) {
  const current = readObjectStates(
    captureCommand(
      'kubectl',
      // A stalled API request would block both sampling and SIGTERM shutdown, since the capture is synchronous.
      ['--context', context, 'get', tracked.resource, '--all-namespaces', '-o', 'json', '--request-timeout=5s'],
      repositoryRoot,
    ),
    tracked.describe,
  );
  const changes = diffObjectStates(previous, current);
  if (changes.length > 0) {
    const timestamp = new Date().toISOString();
    appendFileSync(outputPath, `${changes.map((change) => `${timestamp} ${change}`).join('\n')}\n`, 'utf8');
  }
  return current;
}

async function sampleTenantState(outputPath) {
  if (outputPath === undefined || outputPath.trim() === '') {
    throw new Error('Usage: node ./scripts/deploy/sample-platform-k3d-tenant-state.mjs <output-file>');
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  const previous = new Map(trackedResources.map((tracked) => [tracked.resource, new Map()]));
  let running = true;
  process.on('SIGTERM', () => {
    running = false;
  });
  while (running) {
    for (const tracked of trackedResources) {
      try {
        previous.set(tracked.resource, sampleResource(tracked, previous.get(tracked.resource), outputPath));
      } catch {
        // The cluster is not always reachable across platform restarts; the next tick recovers.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
  }
}

runMain(import.meta.url, process.argv[1], async () => {
  await sampleTenantState(process.argv[2]);
});
