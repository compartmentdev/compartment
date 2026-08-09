import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const require = createRequire(import.meta.url);
await runCommandAsync('pnpm', ['--filter', '@compartment/kube-runtime', 'build'], repositoryRoot, process.env);
const { organizationGlobalCustomQuotaManifests } = require(join(repositoryRoot, 'packages/kube-runtime/dist/index.js'));
const context = process.env.COMPARTMENT_E2E_KUBE_CONTEXT;
const namespaces = ['quota-a-1', 'quota-a-2', 'quota-b'];
const platformNamespace = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment';
const buildNamespace = `${platformNamespace}-build`;
const kubectlTimeoutMs = 130_000;

async function kubectlResult(args) {
  const command = ['--context', context, ...args];
  const result = await new Promise((resolveCommand, rejectCommand) => {
    execFile(
      'kubectl',
      command,
      { cwd: repositoryRoot, env: process.env, killSignal: 'SIGKILL', timeout: kubectlTimeoutMs },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number' && error.killed !== true) {
          rejectCommand(error);
          return;
        }
        resolveCommand({
          status: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
          stderr,
          stdout,
          timedOut: error?.killed === true,
        });
      },
    );
  });
  return { command, ...result };
}

async function kubectl(args) {
  const result = await kubectlResult(args);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.timedOut) {
    throw new Error(`Command timed out: kubectl ${result.command.join(' ')}\n${result.stderr}`);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: kubectl ${result.command.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
}

async function captureKubectl(args) {
  const result = await kubectlResult(args);
  if (result.timedOut) {
    throw new Error(`Command timed out: kubectl ${result.command.join(' ')}\n${result.stderr}`);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: kubectl ${result.command.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

async function createNamespace(name, organizationId) {
  await kubectl(['delete', 'namespace', name, '--ignore-not-found', '--wait=true', '--timeout=120s']);
  const labels =
    organizationId === undefined
      ? undefined
      : {
          'app.kubernetes.io/managed-by': 'compartment',
          'compartment.dev/organization-id': organizationId,
          'compartment.dev/project-id': name,
        };
  await applyManifest(name, {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { ...(labels === undefined ? {} : { labels }), name },
  });
}

async function applyManifest(name, manifest) {
  const manifestDirectory = mkdtempSync(join(tmpdir(), 'compartment-quota-gate-'));
  const manifestPath = join(manifestDirectory, `${name}.json`);
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await kubectl(['apply', '-f', manifestPath]);
  } finally {
    rmSync(manifestDirectory, { force: true, recursive: true });
  }
}

async function createPod(namespace, name, cpu) {
  const resources = {
    limits: { cpu, memory: '64Mi' },
    requests: { cpu, memory: '64Mi' },
  };
  await kubectl([
    'run',
    name,
    '--namespace',
    namespace,
    '--image=registry.k8s.io/pause:3.10',
    '--restart=Never',
    '--overrides',
    JSON.stringify({
      spec: { containers: [{ image: 'registry.k8s.io/pause:3.10', name, resources }] },
    }),
  ]);
}

async function createPvc(namespace, name, storage) {
  await applyManifest(name, {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name, namespace },
    spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage } } },
  });
}

async function expectDenied(action, label) {
  try {
    await action();
  } catch (error) {
    const message = String(error);
    if (/custom quota|globalcustomquota|quota.*exceed|exceed.*quota/i.test(message)) {
      return;
    }
    throw new Error(`Expected a Capsule quota denial for ${label}, received: ${message}`, { cause: error });
  }
  throw new Error(`Expected Capsule to deny ${label}.`);
}

async function waitForReleasedCapacity(name) {
  await kubectl(['wait', '--for=jsonpath={.status.usage.used}=0', `globalcustomquota/${name}`, '--timeout=120s']);
  await waitForLedgerSettled(name);
}

async function waitForQuotaMaterialized(name, usage) {
  await kubectl([
    'wait',
    `--for=jsonpath={.status.usage.used}=${usage}`,
    `globalcustomquota/${name}`,
    '--timeout=120s',
  ]);
  await waitForLedgerSettled(name);
}

async function waitForLedgerSettled(name) {
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    const reserved = await captureKubectl([
      'get',
      'quantityledger',
      '--all-namespaces',
      '--field-selector',
      `metadata.name=${name}`,
      '--output',
      'jsonpath={.items[0].status.reserved}',
    ]);
    if (reserved === '0') {
      return;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for quota ledger ${name} to settle.`);
}

async function expectEventuallyAdmitted(action, label) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      if (attempt === 120) {
        throw new Error(`Timed out waiting for Capsule to admit ${label}.`, { cause: error });
      }
      await delay(500);
    }
  }
}

async function admitExactlyOneConcurrentPod() {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const concurrent = await Promise.allSettled([
      createPod('quota-a-1', 'concurrent-a', '1200m'),
      createPod('quota-a-2', 'concurrent-b', '1200m'),
    ]);
    const admittedCount = concurrent.filter((result) => result.status === 'fulfilled').length;
    if (admittedCount === 1) {
      const denied = concurrent.find((result) => result.status === 'rejected');
      if (
        denied?.status === 'rejected' &&
        !/custom quota|globalcustomquota|quota.*exceed|exceed.*quota/i.test(String(denied.reason))
      ) {
        throw new Error(`Concurrent Pod failed for a reason other than quota admission: ${String(denied.reason)}`);
      }
      return concurrent[0].status === 'fulfilled'
        ? { name: 'concurrent-a', namespace: 'quota-a-1' }
        : { name: 'concurrent-b', namespace: 'quota-a-2' };
    }
    if (admittedCount > 1) {
      throw new Error('Expected exactly one concurrent organization quota admission.');
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for one concurrent organization quota admission.');
}

async function readInstalledOrganizationQuota() {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const payload = JSON.parse(
      await captureKubectl([
        'get',
        'globalcustomquota',
        '--selector',
        'app.kubernetes.io/managed-by=compartment',
        '--output',
        'json',
      ]),
    );
    const organizations = new Map();
    for (const item of payload.items ?? []) {
      const organizationId = item.metadata?.labels?.['compartment.dev/organization-id'];
      if (organizationId !== undefined) {
        organizations.set(organizationId, [...(organizations.get(organizationId) ?? []), item]);
      }
    }
    const installed = [...organizations.entries()].find(([, items]) => items.length === 5);
    if (
      installed !== undefined &&
      installed[1].every((item) =>
        item.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'),
      )
    ) {
      return installed[0];
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for the worker-reconciled organization quota pool.');
}

async function applyProjectedOrganizationQuota(manifests) {
  for (const manifest of manifests) {
    await applyManifest(manifest.metadata.name, manifest);
    await kubectl(['wait', '--for=condition=Ready', `globalcustomquota/${manifest.metadata.name}`, '--timeout=120s']);
  }
  return manifests;
}

async function runGate() {
  if (context === undefined || context === '') {
    throw new Error('COMPARTMENT_E2E_KUBE_CONTEXT is required.');
  }
  const secondaryManifests = organizationGlobalCustomQuotaManifests({ organizationId: 'quota-org-b' });
  const secondaryQuotaNames = secondaryManifests.map((manifest) => manifest.metadata.name);
  let gateError;
  let cleanupErrors = [];
  try {
    const organizationId = await readInstalledOrganizationQuota();
    const installedManifests = organizationGlobalCustomQuotaManifests({ organizationId });
    const requestsCpuQuota = installedManifests.find((manifest) =>
      manifest.spec.sources[0]?.path?.endsWith('requests.cpu'),
    );
    const storageQuota = installedManifests.find((manifest) =>
      manifest.spec.sources.some((source) => source.kind === 'PersistentVolumeClaim'),
    );
    if (requestsCpuQuota === undefined || storageQuota === undefined) {
      throw new Error('Worker-reconciled quota pool does not contain the fixed CPU and storage projections.');
    }
    await createNamespace('quota-a-1', organizationId);
    await createNamespace('quota-a-2', organizationId);
    await createNamespace('quota-b', 'quota-org-b');
    await applyProjectedOrganizationQuota(secondaryManifests);
    await createPod('quota-a-1', 'first', '1500m');
    await waitForQuotaMaterialized(requestsCpuQuota.metadata.name, '1500m');
    await expectDenied(async () => await createPod('quota-a-2', 'shared-denied', '1'), 'shared project CPU');
    await kubectl(['delete', 'pod', 'first', '--namespace', 'quota-a-1', '--wait=true']);
    await waitForReleasedCapacity(requestsCpuQuota.metadata.name);

    const admitted = await admitExactlyOneConcurrentPod();
    await waitForQuotaMaterialized(requestsCpuQuota.metadata.name, '1200m');
    await kubectl(['delete', 'pod', admitted.name, '--namespace', admitted.namespace, '--wait=true']);
    await waitForReleasedCapacity(requestsCpuQuota.metadata.name);
    await expectEventuallyAdmitted(
      async () => await createPod('quota-a-2', 'released-capacity', '1200m'),
      'released Pod capacity',
    );
    await createPod('quota-b', 'isolated-org', '2');
    await createPod(platformNamespace, 'platform-unaffected', '1');
    await createPod(buildNamespace, 'build-unaffected', '1');
    await createPvc('quota-a-1', 'storage-first', '15Gi');
    await waitForQuotaMaterialized(storageQuota.metadata.name, '15Gi');
    await expectDenied(async () => await createPvc('quota-a-2', 'storage-denied', '10Gi'), 'shared PVC storage');
    await kubectl(['delete', 'pvc', 'storage-first', '--namespace', 'quota-a-1', '--wait=true']);
    await waitForReleasedCapacity(storageQuota.metadata.name);
    await expectEventuallyAdmitted(
      async () => await createPvc('quota-a-2', 'storage-released', '10Gi'),
      'released PVC capacity',
    );
    await createPvc(platformNamespace, 'platform-storage-unaffected', '25Gi');
    await createPvc(buildNamespace, 'build-storage-unaffected', '25Gi');
  } catch (error) {
    gateError = error;
  } finally {
    const cleanupResults = await Promise.allSettled([
      kubectl([
        'delete',
        'pod',
        'platform-unaffected',
        '--namespace',
        platformNamespace,
        '--ignore-not-found',
        '--timeout=120s',
      ]),
      kubectl([
        'delete',
        'pod',
        'build-unaffected',
        '--namespace',
        buildNamespace,
        '--ignore-not-found',
        '--timeout=120s',
      ]),
      kubectl([
        'delete',
        'pvc',
        'platform-storage-unaffected',
        '--namespace',
        platformNamespace,
        '--ignore-not-found',
        '--timeout=120s',
      ]),
      kubectl([
        'delete',
        'pvc',
        'build-storage-unaffected',
        '--namespace',
        buildNamespace,
        '--ignore-not-found',
        '--timeout=120s',
      ]),
      kubectl(['delete', 'globalcustomquota', ...secondaryQuotaNames, '--ignore-not-found', '--timeout=120s']),
      kubectl(['delete', 'namespace', ...namespaces, '--ignore-not-found', '--timeout=120s']),
    ]);
    cleanupErrors = cleanupResults.filter((result) => result.status === 'rejected').map((result) => result.reason);
  }
  if (gateError !== undefined) {
    throw gateError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Organization quota gate cleanup failed.');
  }
}

runMain(import.meta.url, process.argv[1], runGate);
