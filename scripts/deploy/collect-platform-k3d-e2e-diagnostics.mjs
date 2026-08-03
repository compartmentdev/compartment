import { mkdirSync, writeFileSync } from 'node:fs';

import { captureCommand, captureCommandResult } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const platformNamespace = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

export function parseDeploymentReferences(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const separatorIndex = line.indexOf('/');
      if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
        throw new Error(`Invalid Kubernetes deployment reference: ${line}`);
      }
      return { name: line.slice(separatorIndex + 1), namespace: line.slice(0, separatorIndex) };
    });
}

export function parseUnreadyDeploymentReferences(output) {
  return JSON.parse(output)
    .items.filter((deployment) => {
      const desiredReplicas = deployment.spec?.replicas ?? 1;
      return desiredReplicas > 0 && (deployment.status?.availableReplicas ?? 0) < desiredReplicas;
    })
    .map((deployment) => ({
      name: deployment.metadata.name,
      namespace: deployment.metadata.namespace,
    }));
}

export function parseUnreadyPodReferences(output) {
  return JSON.parse(output)
    .items.filter(
      (pod) =>
        pod.status?.phase !== 'Succeeded' &&
        !pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'),
    )
    .map((pod) => ({ name: pod.metadata.name, namespace: pod.metadata.namespace }));
}

export function parseRestartedContainerReferences(output) {
  return JSON.parse(output).items.flatMap((pod) =>
    (pod.status?.containerStatuses ?? [])
      .filter((container) => container.restartCount > 0)
      .map((container) => ({
        containerName: container.name,
        podName: pod.metadata.name,
        namespace: pod.metadata.namespace,
      })),
  );
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

  const unreadyDeployments = readUnreadyDeploymentReferences();
  const unreadyPods = readUnreadyPodReferences();
  const restartedContainers = readRestartedContainerReferences();
  for (const deployment of unreadyDeployments) {
    capture(outputDirectory, `describe-${deployment.namespace}-${deployment.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      deployment.namespace,
      'describe',
      'deployment',
      deployment.name,
    ]);
  }
  for (const pod of unreadyPods) {
    capture(outputDirectory, `describe-pod-${pod.namespace}-${pod.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      pod.namespace,
      'describe',
      'pod',
      pod.name,
    ]);
    capture(outputDirectory, `logs-pod-${pod.namespace}-${pod.name}`, 'kubectl', [
      '--context',
      context,
      '--namespace',
      pod.namespace,
      'logs',
      `pod/${pod.name}`,
      '--all-containers=true',
      '--prefix=true',
      '--tail=100',
    ]);
  }
  for (const container of restartedContainers) {
    capture(
      outputDirectory,
      `logs-previous-${container.namespace}-${container.podName}-${container.containerName}`,
      'kubectl',
      [
        '--context',
        context,
        '--namespace',
        container.namespace,
        'logs',
        `pod/${container.podName}`,
        '--container',
        container.containerName,
        '--previous',
        '--prefix=true',
        '--tail=100',
      ],
    );
  }
}

function readUnreadyDeploymentReferences() {
  try {
    return parseUnreadyDeploymentReferences(
      captureCommand(
        'kubectl',
        ['--context', context, 'get', 'deployments', '--all-namespaces', '-o', 'json'],
        repositoryRoot,
      ),
    );
  } catch {
    return [];
  }
}

function readUnreadyPodReferences() {
  try {
    return parseUnreadyPodReferences(
      captureCommand(
        'kubectl',
        ['--context', context, 'get', 'pods', '--all-namespaces', '-o', 'json'],
        repositoryRoot,
      ),
    );
  } catch {
    return [];
  }
}

function readRestartedContainerReferences() {
  try {
    return parseRestartedContainerReferences(
      captureCommand(
        'kubectl',
        ['--context', context, 'get', 'pods', '--all-namespaces', '-o', 'json'],
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
  const diagnostic = `${command}${output}`;
  writeFileSync(`${outputDirectory}/${name}.log`, diagnostic, 'utf8');
  process.stderr.write(`\n===== k3d e2e diagnostic: ${name} =====\n${diagnostic}`);
}

runMain(import.meta.url, process.argv[1], async () => {
  collectPlatformK3dDiagnostics(process.argv[2]);
});
