import { mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { buildSelfHostedImages } from './build-self-hosted-images.mjs';
import { captureCommand, captureCommandResult, runCommand, runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import {
  buildDockerContainerRemovalArgs,
  isPlatformSourceCacheImageRef,
  isRunOwnedDockerResourceName,
  isRunOwnedImageRef,
  platformK3dServiceNames,
  readPlatformK3dCleanupStageNames,
  runPlatformK3dCleanupSequence,
  runPlatformK3dCleanupStep,
  settlePlatformK3dStartup,
  shouldCleanPlatformSourceCacheImage,
  withPlatformK3dProcessLock,
} from './platform-k3d-e2e-support.mjs';
import {
  releasePlatformImageCacheDockerLockIfOwned,
  withPlatformImageCacheDockerLock,
} from './platform-image-cache-lock.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const gvisorContainerdConfigPath = join(repositoryRoot, 'scripts/deploy/fixtures/containerd-gvisor-config.toml.tmpl');
const dockerResourceNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;
const kubernetesNamePattern = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;
const platformEnvironment = readPlatformK3dEnvironment(process.env);
const {
  clusterName,
  httpPort,
  httpsPort,
  managedNamespace,
  managedPlatformValuesPath,
  pebbleCaPath,
  pebbleRootPath,
  platformNamespace,
  platformOwnerEnvironmentPath,
  previousPlatformValuesPath,
  platformValuesPath,
  publicOperatorValuesPath,
  registryHostPort,
  registryName,
} = platformEnvironment;
const contextName = `k3d-${clusterName}`;
const registryClusterHost = `k3d-${registryName}:${registryHostPort}`;
const registryPushHost = `localhost:${registryHostPort}`;
const bundledRegistryClusterIp = '10.43.250.250';
const platformBaseDomain = 'compartment.localhost';
const consoleHost = `console.${platformBaseDomain}`;
const builderName = `${clusterName}-builder`;
const imageCacheLockOwnerToken = `e2e-${clusterName}`;
const pebbleCaContainerName = `${clusterName}-pebble-ca`;
const shouldExtractPebbleCa =
  process.env.COMPARTMENT_E2E_SHARD === undefined || process.env.COMPARTMENT_E2E_SHARD === 'managed-install';
const isIngressNginxShard = process.env.COMPARTMENT_E2E_SHARD === 'build-matrix-b';
const ingressClassName = isIngressNginxShard ? 'nginx' : 'traefik';
const registryTestCaPath = join(dirname(platformValuesPath), `${clusterName}-registry-test-ca.crt`);
const registryTestCaKeyPath = join(dirname(platformValuesPath), `${clusterName}-registry-test-ca.key`);
const platformImageTag = 'e2e';
const registryNodePullResourceName = 'registry-node-pull';
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const kubernetesReadinessTimeoutSeconds = 240;
const kubernetesReadinessTimeout = `${kubernetesReadinessTimeoutSeconds}s`;
const prerequisiteSetupBudgetMs = 120_000;
const transientKubernetesApiMaxAttempts = 6;
const transientKubernetesApiInitialDelayMs = 1_000;
const transientKubernetesApiMaxDelayMs = 16_000;
const certManagerManifestUrl =
  'https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml';
const ingressNginxManifestUrl =
  'https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.13.3/deploy/static/provider/baremetal/deploy.yaml';
const k3sImageRef = process.env.COMPARTMENT_E2E_K3S_IMAGE ?? 'rancher/k3s:v1.35.5-k3s1';
const ingressNginxHttpNodePort = 30_080;
const ingressNginxHttpsNodePort = 30_443;
const pebbleImageRef =
  'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const archiveLoadLockDirectory = join(tmpdir(), 'compartment-platform-k3d-image-load.lock');
const builtImageRefsByServiceName = Object.freeze(
  Object.fromEntries(
    platformK3dServiceNames.map((serviceName) => [
      serviceName,
      `ghcr.io/compartmentdev/compartment-${serviceName}:e2e-${clusterName}`,
    ]),
  ),
);
export function readPlatformK3dEnvironment(env) {
  const configuredClusterName = readNameEnv(env, 'COMPARTMENT_E2E_CLUSTER_NAME', 'compartment-e2e');
  const configuredRegistryName = readNameEnv(env, 'COMPARTMENT_E2E_REGISTRY_NAME', `${configuredClusterName}-registry`);
  return {
    clusterName: configuredClusterName,
    httpPort: readPortEnv(env, 'COMPARTMENT_E2E_HTTP_PORT', 18_080),
    httpsPort: readPortEnv(env, 'COMPARTMENT_E2E_HTTPS_PORT', 18_443),
    keepOnFailure: readBooleanEnv(env, 'COMPARTMENT_E2E_KEEP_ON_FAILURE'),
    gvisorEnabled: readBooleanEnv(env, 'COMPARTMENT_E2E_GVISOR_ENABLED'),
    managedNamespace: readNameEnv(env, 'COMPARTMENT_E2E_MANAGED_NAMESPACE', 'compartment-managed-e2e'),
    managedPlatformValuesPath: readStatePathEnv(
      env,
      'COMPARTMENT_E2E_MANAGED_VALUES_PATH',
      '.compartment/platform-k3d-managed-e2e-values.yaml',
    ),
    pebbleCaPath: readStatePathEnv(env, 'COMPARTMENT_E2E_PEBBLE_CA_PATH', '.compartment/pebble.minica.pem'),
    pebbleRootPath: readStatePathEnv(env, 'COMPARTMENT_E2E_PEBBLE_ROOT_PATH', '.compartment/pebble.root.pem'),
    platformNamespace: readNameEnv(env, 'COMPARTMENT_E2E_PLATFORM_NAMESPACE', 'compartment'),
    platformOwnerEnvironmentPath: readStatePathEnv(
      env,
      'COMPARTMENT_E2E_OWNER_ENV_PATH',
      '.compartment/platform-k3d-e2e-owner.env',
    ),
    previousPlatformValuesPath: readStatePathEnv(
      env,
      'COMPARTMENT_E2E_PREVIOUS_PLATFORM_VALUES_PATH',
      '.compartment/platform-k3d-previous-e2e-values.yaml',
    ),
    platformValuesPath: readStatePathEnv(
      env,
      'COMPARTMENT_E2E_PLATFORM_VALUES_PATH',
      '.compartment/platform-k3d-e2e-values.yaml',
    ),
    publicOperatorValuesPath: readStatePathEnv(
      env,
      'COMPARTMENT_E2E_PUBLIC_OPERATOR_VALUES_PATH',
      '.compartment/platform-k3d-public-operator-values.yaml',
    ),
    registryHostPort: readPortEnv(env, 'COMPARTMENT_E2E_REGISTRY_PORT', 15_500),
    registryName: configuredRegistryName,
  };
}

function readNameEnv(env, name, defaultValue) {
  const value = env[name] ?? defaultValue;
  if (!dockerResourceNamePattern.test(value) || !kubernetesNamePattern.test(value) || value.length > 63) {
    throw new Error(`${name} must be a valid lowercase DNS label.`);
  }
  return value;
}

function readPortEnv(env, name, defaultValue) {
  const rawValue = env[name];
  if (rawValue === undefined) {
    return defaultValue;
  }
  const value = Number(rawValue);
  if (!/^\d+$/u.test(rawValue) || !Number.isSafeInteger(value) || value < 1_024 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535.`);
  }
  return value;
}

function readBooleanEnv(env, name) {
  const value = env[name];
  if (value === undefined || value === '0') {
    return false;
  }
  if (value === '1') {
    return true;
  }
  throw new Error(`${name} must be 0 or 1.`);
}

function readStatePathEnv(env, name, defaultValue) {
  const path = resolve(repositoryRoot, env[name] ?? defaultValue);
  const stateRoot = resolve(repositoryRoot, '.compartment');
  if (path !== stateRoot && !path.startsWith(`${stateRoot}/`)) {
    throw new Error(`${name} must resolve inside ${stateRoot}.`);
  }
  return path;
}

export function readPlatformK3dCommand(args) {
  const [action, ...optionArgs] = args;

  if (action === 'configure' || action === 'down') {
    assertNoExtraArguments(optionArgs);
    return { action };
  }

  if (action === 'up') {
    return { action, ...readPlatformK3dUpOptions(optionArgs) };
  }

  throw new Error(usageText());
}

function readPlatformK3dUpOptions(optionArgs) {
  const options = { imageArchiveDir: undefined, imageSource: 'build' };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const optionName = optionArgs[index];
    const optionValue = optionArgs[index + 1];

    if ((optionName === '--image-source' || optionName === '--image-archive-dir') && optionValue !== undefined) {
      if (optionName === '--image-source') {
        options.imageSource = optionValue;
      } else {
        options.imageArchiveDir = optionValue;
      }
      index += 1;
      continue;
    }

    throw new Error(usageText());
  }

  if (options.imageSource !== 'build' && options.imageSource !== 'archive') {
    throw new Error(usageText());
  }

  if (options.imageSource === 'archive' && options.imageArchiveDir === undefined) {
    throw new Error(usageText());
  }

  if (options.imageSource === 'build' && options.imageArchiveDir !== undefined) {
    throw new Error(usageText());
  }

  return options;
}

function usageText() {
  return 'Usage: node ./scripts/deploy/platform-k3d-e2e.mjs <up [--image-source build|archive] [--image-archive-dir <dir>]|configure|down>';
}

function assertNoExtraArguments(optionArgs) {
  if (optionArgs.length > 0) {
    throw new Error(usageText());
  }
}

export function parseK3dClusterNames(output) {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/u)[0])
    .filter((name) => name !== undefined && name !== '');
}

export function parseLoadedImageRefs(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Loaded image: '))
    .map((line) => line.slice('Loaded image: '.length).trim())
    .filter((imageRef) => imageRef !== '');
}

export function isConsoleReadyStatus(status) {
  return status === 302;
}

export function renderPlatformK3dValues(imageDigestsByServiceName, gvisorEnabled = platformEnvironment.gvisorEnabled) {
  return `${renderPlatformImageValues(imageDigestsByServiceName)}${renderSandboxRuntimeValues(gvisorEnabled)}ingress:\n  className: ${ingressClassName}\n${renderRegistryTlsValues()}platform:\n  baseDomain: ${platformBaseDomain}\n  publicProtocol: http\nbuildkit:\n  namespace: ${platformNamespace}-build\n${renderBuildRuntimeValues(gvisorEnabled)}`;
}

export function renderPreviousPlatformK3dValues() {
  return `ingress:\n  className: ${ingressClassName}\n${renderRegistryTlsValues()}platform:\n  baseDomain: ${platformBaseDomain}\n  publicProtocol: http\nbuildkit:\n  namespace: ${platformNamespace}-build\n`;
}

export function renderManagedPlatformK3dValues(
  imageDigestsByServiceName,
  gvisorEnabled = platformEnvironment.gvisorEnabled,
) {
  return `${renderPlatformImageValues(imageDigestsByServiceName)}${renderSandboxRuntimeValues(gvisorEnabled)}ingress:\n  className: traefik\n  endpoint:\n    type: A\n    value: 8.8.4.4\n  targetsJson: '[{"type":"A","value":"8.8.4.4"}]'\n${renderRegistryTlsValues()}tls:\n  acme:\n    environment: staging\n    stagingUrl: https://pebble.${managedNamespace}.svc.cluster.local:14000/dir\n    skipTlsVerify: true\nbuildkit:\n  namespace: ${managedNamespace}-build\n${renderBuildRuntimeValues(gvisorEnabled)}`;
}

export function renderPublicOperatorPlatformK3dValues(
  imageDigestsByServiceName,
  gvisorEnabled = platformEnvironment.gvisorEnabled,
) {
  return `${renderPlatformImageValues(imageDigestsByServiceName)}${renderSandboxRuntimeValues(gvisorEnabled)}ingress:\n  className: ${ingressClassName}\nstorage:\n  storageClass: local-path\n${renderRegistryTlsValues()}platform:\n  publicProtocol: http\nbuildkit:\n  namespace: ${managedNamespace}-public-operator-build\n${renderBuildRuntimeValues(gvisorEnabled)}`;
}

function renderRegistryTlsValues() {
  return `registry:\n  clusterIP: ${bundledRegistryClusterIp}\n  issuerRef:\n    kind: ClusterIssuer\n    name: compartment-registry-test-issuer\n`;
}

function renderSandboxRuntimeValues(gvisorEnabled) {
  return gvisorEnabled
    ? 'tenantRuntime:\n  runtimeClassName: gvisor\n  createRuntimeClass: false\n  runtimeHandler: runsc\n'
    : '';
}

function renderBuildRuntimeValues(gvisorEnabled) {
  return gvisorEnabled ? '  runtimeClassName: gvisor\n' : '';
}
function renderPlatformImageValues(imageDigestsByServiceName) {
  const imageValues = platformK3dServiceNames
    .map(
      (serviceName) =>
        `  ${serviceName === 'dns01-solver' ? 'dns01Solver' : serviceName}:\n    repository: ${registryClusterHost}/compartment-${serviceName}\n    tag: ${platformImageTag}\n    digest: ${readRequiredPlatformImageDigest(imageDigestsByServiceName, serviceName)}`,
    )
    .join('\n');
  return `images:\n${imageValues}\n`;
}

async function upPlatform(command) {
  assertRequiredTools();
  try {
    await withPlatformK3dProcessLock(archiveLoadLockDirectory, async () => cleanHistoricalPlatformSourceImages());
    cleanPlatformResources();
    recreateRegistry();
    recreateBuilder();
    for (const statePath of [
      platformValuesPath,
      previousPlatformValuesPath,
      managedPlatformValuesPath,
      pebbleCaPath,
      pebbleRootPath,
      publicOperatorValuesPath,
    ]) {
      mkdirSync(dirname(statePath), { recursive: true });
    }
    createRegistryTestCertificateAuthority();
    if (shouldExtractPebbleCa) {
      extractPebbleManagementCertificateAuthority();
    }
    const preparedImages = await settlePlatformK3dStartup(createCluster(), prepareAndPushPlatformImages(command));
    writeFileSync(platformValuesPath, renderPlatformK3dValues(preparedImages.imageDigestsByServiceName), {
      mode: 0o600,
    });
    writeFileSync(previousPlatformValuesPath, renderPreviousPlatformK3dValues(), { mode: 0o600 });
    writeFileSync(managedPlatformValuesPath, renderManagedPlatformK3dValues(preparedImages.imageDigestsByServiceName), {
      mode: 0o600,
    });
    writeFileSync(
      publicOperatorValuesPath,
      renderPublicOperatorPlatformK3dValues(preparedImages.imageDigestsByServiceName),
      { mode: 0o600 },
    );
  } catch (error) {
    if (!platformEnvironment.keepOnFailure) {
      try {
        cleanPlatformResources();
      } catch (cleanupError) {
        process.stderr.write(`Cleanup also failed: ${String(cleanupError)}\n`);
      }
    }
    process.stderr.write('STATUS=failed\n');
    throw error;
  }

  process.stdout.write(`context: ${contextName}\nvalues: ${platformValuesPath}\nSTATUS=ok\n`);
}

function extractPebbleManagementCertificateAuthority() {
  let containerReference;
  try {
    containerReference = captureCommand(
      'docker',
      ['create', '--name', pebbleCaContainerName, pebbleImageRef],
      repositoryRoot,
    ).trim();
    runCommand('docker', ['cp', `${containerReference}:/test/certs/pebble.minica.pem`, pebbleCaPath], repositoryRoot);
  } finally {
    if (containerReference !== undefined && containerReference !== '') {
      runCommand('docker', ['rm', '--force', containerReference], repositoryRoot);
    }
  }
}

function createRegistryTestCertificateAuthority() {
  runCommand(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-keyout',
      registryTestCaKeyPath,
      '-out',
      registryTestCaPath,
      '-subj',
      '/CN=Compartment k3d registry test CA',
    ],
    repositoryRoot,
  );
}

async function createCluster() {
  const prerequisiteSetupStartedAt = performance.now();
  const prerequisiteSetupDeadline = prerequisiteSetupStartedAt + prerequisiteSetupBudgetMs;
  await runCommandAsync('k3d', buildPlatformK3dClusterCreateArgs(), repositoryRoot);
  await runKubectlWithTransientApiRetry(['--context', contextName, '--request-timeout=5s', 'get', '--raw=/readyz'], {
    deadline: prerequisiteSetupDeadline,
  });
  if (platformEnvironment.gvisorEnabled) {
    installGvisorRuntimeClass();
  }
  if (isIngressNginxShard) {
    await installIngressNginx(prerequisiteSetupStartedAt, prerequisiteSetupDeadline);
  } else {
    await waitForIngressController('kube-system', 'traefik', prerequisiteSetupStartedAt, prerequisiteSetupDeadline);
  }
  const certManagerApplyTimeoutSeconds = readPrerequisiteWaitTimeoutSeconds(prerequisiteSetupStartedAt);
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      `--request-timeout=${String(certManagerApplyTimeoutSeconds)}s`,
      'apply',
      '--server-side',
      '--filename',
      certManagerManifestUrl,
    ],
    repositoryRoot,
  );
  await waitForCertManager(prerequisiteSetupStartedAt, prerequisiteSetupDeadline);
  reportPrerequisiteSetupCost(performance.now() - prerequisiteSetupStartedAt);
  await installRegistryTestIssuer();
}

function installGvisorRuntimeClass() {
  const runtimeClassPath = join(dirname(platformValuesPath), `${clusterName}-gvisor-runtime-class.yaml`);
  writeFileSync(
    runtimeClassPath,
    'apiVersion: node.k8s.io/v1\nkind: RuntimeClass\nmetadata:\n  name: gvisor\nhandler: runsc\n',
    { mode: 0o600 },
  );
  try {
    runCommand('kubectl', ['--context', contextName, 'apply', '--filename', runtimeClassPath], repositoryRoot);
  } finally {
    rmSync(runtimeClassPath, { force: true });
  }
}

async function waitForCertManager(prerequisiteSetupStartedAt, prerequisiteSetupDeadline) {
  for (const commandArgs of buildCertManagerReadinessWaitCommands(
    readPrerequisiteWaitTimeoutSeconds(prerequisiteSetupStartedAt),
  )) {
    const timeoutIndex = commandArgs.findIndex((arg) => arg.startsWith('--timeout='));
    commandArgs[timeoutIndex] = `--timeout=${String(readPrerequisiteWaitTimeoutSeconds(prerequisiteSetupStartedAt))}s`;
    await runKubectlWithTransientApiRetry(commandArgs, { deadline: prerequisiteSetupDeadline });
  }
}

export function buildCertManagerReadinessWaitCommands(timeoutSeconds) {
  const commonArgs = ['--context', contextName, '--namespace', 'cert-manager', 'wait'];
  const timeoutArg = `--timeout=${String(timeoutSeconds)}s`;
  return [
    [
      ...commonArgs,
      'deployment/cert-manager',
      'deployment/cert-manager-webhook',
      'deployment/cert-manager-cainjector',
      '--for=condition=Available',
      timeoutArg,
    ],
    [...commonArgs, 'endpoints/cert-manager-webhook', '--for=jsonpath={.subsets[0].addresses[0].ip}', timeoutArg],
  ];
}

async function installIngressNginx(prerequisiteSetupStartedAt, prerequisiteSetupDeadline) {
  const applyTimeoutSeconds = readPrerequisiteWaitTimeoutSeconds(prerequisiteSetupStartedAt);
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      `--request-timeout=${String(applyTimeoutSeconds)}s`,
      'apply',
      '--filename',
      ingressNginxManifestUrl,
    ],
    repositoryRoot,
  );
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      '--namespace',
      'ingress-nginx',
      'patch',
      'service',
      'ingress-nginx-controller',
      '--type=merge',
      '--patch',
      JSON.stringify({
        spec: {
          ports: [
            { name: 'http', nodePort: ingressNginxHttpNodePort, port: 80, protocol: 'TCP', targetPort: 'http' },
            { name: 'https', nodePort: ingressNginxHttpsNodePort, port: 443, protocol: 'TCP', targetPort: 'https' },
          ],
        },
      }),
    ],
    repositoryRoot,
  );
  await waitForIngressController(
    'ingress-nginx',
    'ingress-nginx-controller',
    prerequisiteSetupStartedAt,
    prerequisiteSetupDeadline,
  );
}

async function waitForIngressController(
  namespace,
  deploymentName,
  prerequisiteSetupStartedAt,
  prerequisiteSetupDeadline,
) {
  const waitTimeoutSeconds = readPrerequisiteWaitTimeoutSeconds(prerequisiteSetupStartedAt);
  await runKubectlWithTransientApiRetry(
    [
      '--context',
      contextName,
      '--namespace',
      namespace,
      'wait',
      `deployment/${deploymentName}`,
      '--for=condition=Available',
      `--timeout=${String(waitTimeoutSeconds)}s`,
    ],
    { allowResourceNotFound: true, deadline: prerequisiteSetupDeadline },
  );
}

function readPrerequisiteWaitTimeoutSeconds(startedAt) {
  const remainingMs = prerequisiteSetupBudgetMs - (performance.now() - startedAt);
  if (remainingMs <= 0) {
    reportPrerequisiteSetupCost(performance.now() - startedAt);
  }
  return Math.max(1, Math.floor(remainingMs / 1_000));
}

function reportPrerequisiteSetupCost(elapsedMs) {
  const roundedElapsedMs = Math.ceil(elapsedMs);
  process.stdout.write(
    `prerequisite setup: ingress controller + cert-manager ${String(roundedElapsedMs)}ms (budget ${String(prerequisiteSetupBudgetMs)}ms)\n`,
  );
  if (roundedElapsedMs > prerequisiteSetupBudgetMs) {
    throw new Error(
      `Ingress controller and cert-manager setup exceeded the ${String(prerequisiteSetupBudgetMs)}ms shard budget.`,
    );
  }
}

async function installRegistryTestIssuer() {
  await runKubectlWithTransientApiRetry([
    '--context',
    contextName,
    '--namespace',
    'cert-manager',
    'create',
    'secret',
    'tls',
    'compartment-registry-test-ca',
    `--cert=${registryTestCaPath}`,
    `--key=${registryTestCaKeyPath}`,
  ]);
  const issuerPath = join(dirname(platformValuesPath), `${clusterName}-registry-test-issuer.yaml`);
  writeFileSync(
    issuerPath,
    'apiVersion: cert-manager.io/v1\nkind: ClusterIssuer\nmetadata:\n  name: compartment-registry-test-issuer\nspec:\n  ca:\n    secretName: compartment-registry-test-ca\n',
    { mode: 0o600 },
  );
  runCommand('kubectl', ['--context', contextName, 'apply', '--filename', issuerPath], repositoryRoot);
  rmSync(issuerPath, { force: true });
}

export async function runKubectlWithTransientApiRetry(args, options = {}) {
  const commandRunner =
    options.commandRunner ?? ((commandArgs) => captureCommandResult('kubectl', commandArgs, repositoryRoot));
  const wait = options.wait ?? delay;
  let lastResult;

  for (let attempt = 1; attempt <= transientKubernetesApiMaxAttempts; attempt += 1) {
    lastResult = commandRunner(args);
    if (lastResult.status === 0) {
      return;
    }
    const allowNotReady = args.includes('--raw=/readyz');
    if (
      !isTransientKubernetesApiFailure(lastResult, allowNotReady, options.allowResourceNotFound === true) ||
      attempt === transientKubernetesApiMaxAttempts
    ) {
      if (lastResult.stderr !== '') {
        process.stderr.write(lastResult.stderr);
      }
      throw lastResult.error ?? new Error(`Command failed: kubectl ${args.join(' ')}`);
    }

    const retryDelayMs = Math.min(
      transientKubernetesApiInitialDelayMs * 2 ** (attempt - 1),
      transientKubernetesApiMaxDelayMs,
    );
    const remainingDelayMs =
      typeof options.deadline === 'number' ? Math.max(0, options.deadline - performance.now()) : retryDelayMs;
    if (remainingDelayMs === 0) {
      throw new Error('Kubernetes API did not become ready within the prerequisite setup budget.');
    }
    const boundedRetryDelayMs = Math.min(retryDelayMs, remainingDelayMs);
    process.stderr.write(
      `Kubernetes API is not ready (attempt ${String(attempt)}/${String(transientKubernetesApiMaxAttempts)}); retrying in ${String(Math.ceil(boundedRetryDelayMs))}ms.\n`,
    );
    await wait(boundedRetryDelayMs);
  }

  throw lastResult?.error ?? new Error(`Command failed after Kubernetes API retry: kubectl ${args.join(' ')}`);
}

export function isTransientKubernetesApiFailure(result, allowNotReady = false, allowResourceNotFound = false) {
  const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.toLowerCase();
  if (output.includes('failed calling webhook') || output.includes('admission webhook')) {
    return false;
  }
  return (
    output.includes('serviceunavailable') ||
    output.includes('service unavailable') ||
    output.includes('unable to connect to the server') ||
    /the connection to the server .* was refused/u.test(output) ||
    /get "?https?:\/\/[^"]+"?: dial tcp [^\s]+: connect: connection refused/u.test(output) ||
    output.includes('the server is currently unable to handle the request') ||
    (allowNotReady && output.includes('not ready')) ||
    (allowResourceNotFound && output.includes('error from server (notfound)'))
  );
}

export function buildPlatformK3dClusterCreateArgs() {
  const publicPortArgs = isIngressNginxShard
    ? [
        '--agents',
        '1',
        '--port',
        `127.0.0.1:${httpPort}:${String(ingressNginxHttpNodePort)}@agent:0`,
        '--port',
        `127.0.0.1:${httpsPort}:${String(ingressNginxHttpsNodePort)}@agent:0`,
      ]
    : ['--port', `127.0.0.1:${httpPort}:80@loadbalancer`, '--port', `127.0.0.1:${httpsPort}:443@loadbalancer`];
  return [
    'cluster',
    'create',
    clusterName,
    '--image',
    k3sImageRef,
    ...publicPortArgs,
    '--registry-use',
    registryClusterHost,
    '--volume',
    `${registryTestCaPath}:/etc/ssl/certs/compartment-registry-test-ca.crt@server:*;agent:*`,
    ...(platformEnvironment.gvisorEnabled
      ? [
          '--volume',
          '/usr/bin/runsc:/usr/local/bin/runsc@server:*;agent:*',
          '--volume',
          '/usr/bin/containerd-shim-runsc-v1:/usr/local/bin/containerd-shim-runsc-v1@server:*;agent:*',
          '--volume',
          '/usr/bin/gvisor-bin:/usr/local/bin/gvisor-bin@server:*;agent:*',
          '--volume',
          `${gvisorContainerdConfigPath}:/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl@server:*;agent:*`,
          '--volume',
          '/etc/containerd/runsc.toml:/etc/containerd/runsc.toml@server:*;agent:*',
        ]
      : []),
    '--timeout',
    `${String(Math.floor(prerequisiteSetupBudgetMs / 1_000))}s`,
    '--wait',
  ];
}

export function readPlatformK3dCertManagerManifestUrl() {
  return certManagerManifestUrl;
}

export function readPlatformK3dIngressNginxManifestUrl() {
  return ingressNginxManifestUrl;
}

async function prepareAndPushPlatformImages(command) {
  const imageRefsByServiceName =
    command.imageSource === 'archive'
      ? await loadPlatformImageArchives(command.imageArchiveDir)
      : await buildPlatformImages();

  try {
    const imageDigestsByServiceName = {};
    for (const serviceName of platformK3dServiceNames) {
      const sourceImageRef = imageRefsByServiceName[serviceName];
      const registryImageRef = `${registryPushHost}/compartment-${serviceName}:${platformImageTag}`;
      runCommand('docker', ['tag', sourceImageRef, registryImageRef], repositoryRoot);
      runCommand('docker', ['push', '--quiet', registryImageRef], repositoryRoot);
      imageDigestsByServiceName[serviceName] = readPushedImageDigest(registryImageRef);
    }
    return {
      imageDigestsByServiceName,
    };
  } finally {
    removeImageRefs(Object.values(imageRefsByServiceName));
  }
}

function removeImageRefs(imageRefs) {
  const existingImageRefs = imageRefs.filter(
    (imageRef) =>
      typeof imageRef === 'string' &&
      imageRef !== '' &&
      captureCommandResult('docker', ['image', 'inspect', imageRef], repositoryRoot).status === 0,
  );
  if (existingImageRefs.length > 0) {
    runCommand('docker', ['image', 'rm', '--force', ...existingImageRefs], repositoryRoot);
  }
}

function readPushedImageDigest(imageRef) {
  const digest = captureCommand(
    'docker',
    ['buildx', 'imagetools', 'inspect', '--format', '{{ printf "%s" .Manifest.Digest }}', imageRef],
    repositoryRoot,
  ).trim();
  if (!imageDigestPattern.test(digest)) {
    throw new Error(`Expected a pushed platform image digest for ${imageRef}, received: ${digest}`);
  }
  return digest;
}

function readRequiredPlatformImageDigest(imageDigestsByServiceName, serviceName) {
  const digest = imageDigestsByServiceName?.[serviceName];
  if (typeof digest !== 'string' || !imageDigestPattern.test(digest)) {
    throw new Error(`Expected a platform image digest for ${serviceName}.`);
  }
  return digest;
}

async function buildPlatformImages() {
  try {
    await buildSelfHostedImages({
      builderName,
      env: process.env,
      imageRefsByServiceName: builtImageRefsByServiceName,
      repositoryRoot,
    });
  } catch (error) {
    removeImageRefs(Object.values(builtImageRefsByServiceName));
    throw error;
  }

  return builtImageRefsByServiceName;
}

async function loadPlatformImageArchives(imageArchiveDir) {
  return await withPlatformK3dProcessLock(archiveLoadLockDirectory, async () => {
    await cleanHistoricalPlatformSourceImages();
    const imageRefsByServiceName = {};
    try {
      for (const serviceName of platformK3dServiceNames) {
        const archivePath = `${imageArchiveDir}/${serviceName}.tar`;
        const loadOutput = captureCommand('docker', ['load', '--input', archivePath], repositoryRoot);
        const [imageRef, ...extraImageRefs] = parseLoadedImageRefs(loadOutput);

        if (imageRef === undefined || extraImageRefs.length > 0) {
          throw new Error(`Expected exactly one loaded image ref in ${archivePath}, received: ${loadOutput}`);
        }

        const isolatedImageRef = builtImageRefsByServiceName[serviceName];
        runCommand('docker', ['tag', imageRef, isolatedImageRef], repositoryRoot);
        imageRefsByServiceName[serviceName] = isolatedImageRef;
      }
    } catch (error) {
      removeImageRefs(Object.values(imageRefsByServiceName));
      throw error;
    }

    return imageRefsByServiceName;
  });
}

async function cleanHistoricalPlatformSourceImages() {
  await withPlatformImageCacheDockerLock(imageCacheLockOwnerToken, async () => {
    const currentCommitSha = captureCommand('git', ['rev-parse', 'HEAD'], repositoryRoot).trim();
    const imageRefs = captureCommand('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], repositoryRoot)
      .split('\n')
      .map((imageRef) => imageRef.trim())
      .filter((imageRef) => imageRef !== '' && isPlatformSourceCacheImageRef(imageRef))
      .filter((imageRef) => !imageRef.endsWith(`:sha-${currentCommitSha}`))
      .filter((imageRef) => {
        const createdAt = captureCommand(
          'docker',
          ['image', 'inspect', '--format', '{{.Created}}', imageRef],
          repositoryRoot,
        );
        return shouldCleanPlatformSourceCacheImage(imageRef, createdAt);
      });
    removeImageRefs(imageRefs);
  });
}

function downPlatform() {
  assertTool('docker');
  assertTool('k3d');
  cleanPlatformResources();
  process.stdout.write(`Removed ${clusterName}.\n`);
}

function cleanPlatformResources() {
  const cleanupErrors = [];
  const cleanupByStageName = {
    builder: deleteBuilder,
    cluster: () => {
      if (clusterExists()) {
        deleteCluster();
      }
    },
    registry: deleteRegistry,
    'residual Docker resources': () => cleanResidualDockerResources(cleanupErrors),
    'run-owned images': () => cleanRunOwnedImages(cleanupErrors),
    'state files and directories': () => cleanPlatformState(cleanupErrors),
  };
  runPlatformK3dCleanupSequence(
    readPlatformK3dCleanupStageNames().map((label) => ({ cleanup: cleanupByStageName[label], label })),
    clusterName,
    cleanupErrors,
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Unable to fully clean k3d resources for ${clusterName}.`);
  }
}

function cleanPlatformState(cleanupErrors) {
  const statePaths = [
    platformValuesPath,
    managedPlatformValuesPath,
    pebbleCaPath,
    pebbleRootPath,
    platformOwnerEnvironmentPath,
    previousPlatformValuesPath,
    publicOperatorValuesPath,
    registryTestCaKeyPath,
    registryTestCaPath,
  ];
  for (const statePath of statePaths) {
    runCleanupStep(cleanupErrors, `state file ${statePath}`, () => rmSync(statePath, { force: true }));
  }
  const stateDirectories = [...new Set(statePaths.map((statePath) => dirname(statePath)))];
  for (const stateDirectory of stateDirectories) {
    if (stateDirectory === resolve(repositoryRoot, '.compartment')) {
      continue;
    }
    runCleanupStep(cleanupErrors, `state directory ${stateDirectory}`, () => {
      try {
        rmdirSync(stateDirectory);
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') {
          throw error;
        }
      }
    });
  }
}

function runCleanupStep(cleanupErrors, label, cleanup) {
  runPlatformK3dCleanupStep(cleanupErrors, label, cleanup, clusterName);
}

function cleanResidualDockerResources(cleanupErrors) {
  runCleanupStep(cleanupErrors, 'shared image cache lock', () => {
    releasePlatformImageCacheDockerLockIfOwned(imageCacheLockOwnerToken);
  });
  for (const containerName of [
    `k3d-${clusterName}-server-0`,
    `k3d-${clusterName}-serverlb`,
    `k3d-${registryName}`,
    `buildx_buildkit_${builderName}0`,
    pebbleCaContainerName,
  ]) {
    if (dockerResourceExists('container', containerName)) {
      runCleanupStep(cleanupErrors, `container ${containerName}`, () => {
        runCommand('docker', buildDockerContainerRemovalArgs(containerName), repositoryRoot);
      });
    }
  }
  const networkName = `k3d-${clusterName}`;
  if (dockerResourceExists('network', networkName)) {
    runCleanupStep(cleanupErrors, `network ${networkName}`, () => {
      runCommand('docker', ['network', 'rm', networkName], repositoryRoot);
    });
  }
  let volumeNames = [];
  runCleanupStep(cleanupErrors, 'volume inventory', () => {
    volumeNames = captureCommand('docker', ['volume', 'ls', '--format', '{{.Name}}'], repositoryRoot)
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name !== '' && isRunOwnedDockerResourceName(name, platformEnvironment));
  });
  for (const volumeName of volumeNames) {
    runCleanupStep(cleanupErrors, `volume ${volumeName}`, () => {
      runCommand('docker', ['volume', 'rm', '--force', volumeName], repositoryRoot);
    });
  }
}

function cleanRunOwnedImages(cleanupErrors) {
  let imageRefs = [];
  runCleanupStep(cleanupErrors, 'image inventory', () => {
    imageRefs = captureCommand('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], repositoryRoot)
      .split('\n')
      .map((imageRef) => imageRef.trim())
      .filter((imageRef) => imageRef !== '' && isRunOwnedImageRef(imageRef, platformEnvironment));
  });
  if (imageRefs.length > 0) {
    runCleanupStep(cleanupErrors, 'images', () => {
      runCommand('docker', ['image', 'rm', '--force', ...imageRefs], repositoryRoot);
    });
  }
}

function dockerResourceExists(resourceType, name) {
  return captureCommandResult('docker', [resourceType, 'inspect', name], repositoryRoot).status === 0;
}

function recreateBuilder() {
  deleteBuilder();
  runCommand('docker', ['buildx', 'create', '--name', builderName, '--driver', 'docker-container'], repositoryRoot);
}

function deleteBuilder() {
  if (captureCommandResult('docker', ['buildx', 'inspect', builderName], repositoryRoot).status === 0) {
    runCommand('docker', ['buildx', 'rm', '--force', builderName], repositoryRoot);
  }
}

async function configureInstalledPlatform() {
  assertRequiredTools();
  if (!clusterExists()) {
    throw new Error(`k3d cluster ${clusterName} does not exist; run pnpm platform:e2e:up first.`);
  }

  waitForPlatformDeployments();
  await assertPrivateRegistryNodePull();
  runCommand('kubectl', ['--context', contextName, '--request-timeout=5s', 'get', '--raw=/readyz'], repositoryRoot);
  await waitForConsole();
  process.stdout.write(`console: http://${consoleHost}:${httpPort}\nSTATUS=ok\n`);
}

async function assertPrivateRegistryNodePull() {
  const output = JSON.parse(
    captureCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        platformNamespace,
        'exec',
        'deployment/compartment-worker',
        '--',
        'node',
        'dist/registry-install-verifier.js',
      ],
      repositoryRoot,
    ).trim(),
  );
  if (typeof output.imageRef !== 'string' || typeof output.dockerConfigJson !== 'string') {
    throw new Error('Registry node-pull check received invalid verifier output.');
  }
  const manifestPath = join(dirname(platformValuesPath), `${clusterName}-registry-node-pull.yaml`);
  writeFileSync(
    manifestPath,
    `apiVersion: v1
kind: Secret
metadata:
  name: ${registryNodePullResourceName}
  namespace: ${platformNamespace}
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: ${JSON.stringify(output.dockerConfigJson)}
---
apiVersion: v1
kind: Pod
metadata:
  name: ${registryNodePullResourceName}
  namespace: ${platformNamespace}
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  containers:
    - name: node-pull
      image: ${output.imageRef}
      imagePullPolicy: Always
  imagePullSecrets:
    - name: ${registryNodePullResourceName}
`,
    { mode: 0o600 },
  );
  try {
    runCommand('kubectl', ['--context', contextName, 'apply', '--filename', manifestPath], repositoryRoot);
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        platformNamespace,
        'wait',
        `pod/${registryNodePullResourceName}`,
        '--for=condition=Ready',
        `--timeout=${kubernetesReadinessTimeout}`,
      ],
      repositoryRoot,
    );
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        platformNamespace,
        'delete',
        `pod/${registryNodePullResourceName}`,
        '--wait=true',
      ],
      repositoryRoot,
    );
  } finally {
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        platformNamespace,
        'delete',
        `pod/${registryNodePullResourceName}`,
        `secret/${registryNodePullResourceName}`,
        '--ignore-not-found',
        '--wait=false',
      ],
      repositoryRoot,
    );
    rmSync(manifestPath, { force: true });
  }
}

function waitForPlatformDeployments() {
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      '--namespace',
      platformNamespace,
      'wait',
      'deployment',
      '--all',
      '--for=condition=Available',
      `--timeout=${kubernetesReadinessTimeout}`,
    ],
    repositoryRoot,
  );
}

async function waitForConsole() {
  const url = `http://${consoleHost}:${httpPort}/`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (isConsoleReadyStatus(await readConsoleStatus())) {
        return;
      }
    } catch {
      // The public endpoint is expected to refuse connections while the pods converge.
    }
    await delay(2_000);
  }
  throw new Error(`Console readiness failed: expected HTTP 302 from ${url}.`);
}

async function readConsoleStatus() {
  return await new Promise((resolveStatus, rejectStatus) => {
    const request = get(
      {
        headers: { host: consoleHost },
        hostname: '127.0.0.1',
        path: '/',
        port: httpPort,
        timeout: 5_000,
      },
      (response) => {
        response.resume();
        resolveStatus(response.statusCode);
      },
    );
    request.once('error', rejectStatus);
    request.once('timeout', () => request.destroy(new Error('Console request timed out.')));
  });
}

function assertRequiredTools() {
  for (const tool of ['docker', 'k3d', 'kubectl', 'helm', 'openssl']) {
    assertTool(tool);
  }
  if (platformEnvironment.gvisorEnabled) {
    assertTool('runsc');
    assertTool('containerd-shim-runsc-v1');
    captureCommand('test', ['-d', '/usr/bin/gvisor-bin'], repositoryRoot);
    captureCommand('test', ['-f', '/etc/containerd/runsc.toml'], repositoryRoot);
  }
}

function assertTool(tool) {
  try {
    captureCommand('which', [tool], repositoryRoot);
  } catch {
    throw new Error(`Required e2e tool is unavailable: ${tool}.`);
  }
}

function clusterExists() {
  const output = captureCommand('k3d', ['cluster', 'list', '--no-headers'], repositoryRoot);
  return parseK3dClusterNames(output).includes(clusterName);
}

function registryExists() {
  const output = captureCommand('k3d', ['registry', 'list', '--no-headers'], repositoryRoot);
  return parseK3dClusterNames(output).includes(`k3d-${registryName}`);
}

function recreateRegistry() {
  deleteRegistry();
  runCommand('k3d', ['registry', 'create', registryName, '--port', `127.0.0.1:${registryHostPort}`], repositoryRoot);
}

function deleteRegistry() {
  if (registryExists()) {
    runCommand('k3d', ['registry', 'delete', `k3d-${registryName}`], repositoryRoot);
  }
}

function deleteCluster() {
  runCommand('k3d', ['cluster', 'delete', clusterName], repositoryRoot);
}

async function main() {
  const command = readPlatformK3dCommand(process.argv.slice(2));
  if (command.action === 'up') {
    await upPlatform(command);
    return;
  }
  if (command.action === 'configure') {
    await configureInstalledPlatform();
    return;
  }
  downPlatform();
}

runMain(import.meta.url, process.argv[1], main);
