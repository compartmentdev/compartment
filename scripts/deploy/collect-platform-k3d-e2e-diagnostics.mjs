import { mkdirSync, writeFileSync } from 'node:fs';

import { captureCommand, captureCommandResult } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const platformNamespace = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

export function parseNamespacedReferences(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const separatorIndex = line.indexOf('/');
      if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
        throw new Error(`Invalid namespaced Kubernetes reference: ${line}`);
      }
      return { name: line.slice(separatorIndex + 1), namespace: line.slice(0, separatorIndex) };
    });
}

function collectPlatformK3dDiagnostics(outputDirectory) {
  if (outputDirectory === undefined || outputDirectory.trim() === '') {
    throw new Error('Usage: node ./scripts/deploy/collect-platform-k3d-e2e-diagnostics.mjs <output-dir>');
  }
  mkdirSync(outputDirectory, { recursive: true });
  capture(outputDirectory, 'pods', 'kubectl', ['--context', context, 'get', 'pods', '--all-namespaces', '-o', 'wide']);
  capture(outputDirectory, 'deployments', 'kubectl', [
    '--context',
    context,
    'get',
    'deployments',
    '--all-namespaces',
    '-o',
    'wide',
  ]);
  capture(outputDirectory, 'jobs', 'kubectl', ['--context', context, 'get', 'jobs', '--all-namespaces', '-o', 'wide']);
  capture(outputDirectory, 'services', 'kubectl', [
    '--context',
    context,
    'get',
    'services',
    '--all-namespaces',
    '-o',
    'wide',
  ]);
  capture(outputDirectory, 'endpoint-slices', 'kubectl', [
    '--context',
    context,
    'get',
    'endpointslices',
    '--all-namespaces',
    '-o',
    'wide',
  ]);
  capture(outputDirectory, 'helm-status', 'helm', [
    'status',
    'compartment',
    '--kube-context',
    context,
    '--namespace',
    platformNamespace,
  ]);
  capture(outputDirectory, 'events', 'kubectl', [
    '--context',
    context,
    'get',
    'events',
    '--all-namespaces',
    '--sort-by=.lastTimestamp',
  ]);

  for (const deployment of readNamespacedReferences('deployments')) {
    capture(outputDirectory, `describe-${deployment.namespace}-${deployment.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      deployment.namespace,
      'describe',
      'deployment',
      deployment.name,
    ]);
    capture(outputDirectory, `logs-${deployment.namespace}-${deployment.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      deployment.namespace,
      'logs',
      `deployment/${deployment.name}`,
      '--all-containers',
      '--tail=500',
    ]);
  }

  for (const job of readNamespacedReferences('jobs')) {
    capture(outputDirectory, `describe-job-${job.namespace}-${job.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      job.namespace,
      'describe',
      'job',
      job.name,
    ]);
    capture(outputDirectory, `logs-job-${job.namespace}-${job.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      job.namespace,
      'logs',
      `job/${job.name}`,
      '--all-containers',
      '--prefix',
      '--tail=500',
    ]);
  }
}

function readNamespacedReferences(resource) {
  try {
    return parseNamespacedReferences(
      captureCommand(
        'kubectl',
        [
          '--context',
          context,
          'get',
          resource,
          '--all-namespaces',
          '-o',
          'jsonpath={range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\\n"}{end}',
        ],
        repositoryRoot,
      ),
    );
  } catch {
    return [];
  }
}

function capture(outputDirectory, name, file, args) {
  const result = captureCommandResult(file, args, repositoryRoot);
  const command = `+ ${[file, ...args].join(' ')}\n`;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(`${outputDirectory}/${name}.log`, `${command}${output}`, 'utf8');
}

runMain(import.meta.url, process.argv[1], async () => {
  collectPlatformK3dDiagnostics(process.argv[2]);
});
