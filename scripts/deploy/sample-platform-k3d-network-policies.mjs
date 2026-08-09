import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { captureCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const sampleIntervalMs = 500;

export function readNetworkPolicyStates(output) {
  return new Map(
    JSON.parse(output).items.map((policy) => [
      `${policy.metadata.namespace}/${policy.metadata.name}`,
      `generation=${policy.metadata.generation} ingress=${JSON.stringify(policy.spec.ingress ?? null)}`,
    ]),
  );
}

export function diffNetworkPolicyStates(previous, current) {
  return [...current]
    .filter(([key, state]) => previous.get(key) !== state)
    .map(([key, state]) => `${key} ${state}`)
    .sort((left, right) => left.localeCompare(right));
}

function sampleOnce(previous, outputPath) {
  const current = readNetworkPolicyStates(
    captureCommand(
      'kubectl',
      ['--context', context, 'get', 'networkpolicies', '--all-namespaces', '-o', 'json'],
      repositoryRoot,
    ),
  );
  const changes = diffNetworkPolicyStates(previous, current);
  if (changes.length > 0) {
    appendFileSync(
      outputPath,
      `${changes.map((change) => `${new Date().toISOString()} ${change}`).join('\n')}\n`,
      'utf8',
    );
  }
  return current;
}

async function sampleNetworkPolicies(outputPath) {
  if (outputPath === undefined || outputPath.trim() === '') {
    throw new Error('Usage: node ./scripts/deploy/sample-platform-k3d-network-policies.mjs <output-file>');
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  let previous = new Map();
  let running = true;
  process.on('SIGTERM', () => {
    running = false;
  });
  while (running) {
    try {
      previous = sampleOnce(previous, outputPath);
    } catch {
      // The cluster is not always reachable across platform restarts; the next tick recovers.
    }
    await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
  }
}

runMain(import.meta.url, process.argv[1], async () => {
  await sampleNetworkPolicies(process.argv[2]);
});
