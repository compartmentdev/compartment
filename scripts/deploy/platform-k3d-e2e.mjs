import { mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  shouldCleanLegacyPlatformResources,
  withPlatformK3dProcessLock,
} from './platform-k3d-e2e-support.mjs';
import {
  releasePlatformImageCacheDockerLockIfOwned,
  withPlatformImageCacheDockerLock,
} from './platform-image-cache-lock.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const dockerResourceNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;
const kubernetesNamePattern = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;
const platformEnvironment = readPlatformK3dEnvironment(process.env);
const {
  clusterName,
  httpPort,
  httpsPort,
  managedAcmeManagementPort,
  managedBrokerPort,
  managedNamespace,
  managedPlatformValuesPath,
  pebbleCaPath,
  pebbleRootPath,
  platformNamespace,
  platformOwnerEnvironmentPath,
  platformValuesPath,
  registryHostPort,
  registryName,
} = platformEnvironment;
const contextName = `k3d-${clusterName}`;
const registryClusterHost = `k3d-${registryName}:${registryHostPort}`;
const registryPushHost = `localhost:${registryHostPort}`;
const bundledRegistryClusterIp = '10.43.250.250';
const bundledRegistryHostname = '10-43-250-250.sslip.io';
const platformBaseDomain = 'compartment.localhost';
const consoleHost = `console.${platformBaseDomain}`;
const builderName = `${clusterName}-builder`;
const imageCacheLockOwnerToken = `e2e-${clusterName}`;
const pebbleCaContainerName = `${clusterName}-pebble-ca`;
const shouldExtractPebbleCa =
  process.env.COMPARTMENT_E2E_SHARD === undefined || process.env.COMPARTMENT_E2E_SHARD === 'managed-install';
const registryTestCaPath = join(dirname(platformValuesPath), `${clusterName}-registry-test-ca.crt`);
const registryTestCaKeyPath = join(dirname(platformValuesPath), `${clusterName}-registry-test-ca.key`);
const platformImageTag = 'e2e';
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const kubernetesReadinessTimeoutSeconds = 240;
const kubernetesReadinessTimeout = `${kubernetesReadinessTimeoutSeconds}s`;
const certManagerManifestUrl =
  'https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml';
const pebbleImageRef =
  'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const archiveLoadLockDirectory = join(tmpdir(), 'compartment-platform-k3d-image-load.lock');
const legacyCleanupLockDirectory = join(tmpdir(), 'compartment-platform-k3d-legacy-cleanup.lock');
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
    managedAcmeManagementPort: readPortEnv(env, 'COMPARTMENT_E2E_MANAGED_ACME_PORT', 19_500),
    managedBrokerPort: readPortEnv(env, 'COMPARTMENT_E2E_MANAGED_BROKER_PORT', 19_000),
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
    platformValuesPath: readStatePathEnv(
      env,
      'COMPARTMENT_E2E_PLATFORM_VALUES_PATH',
      '.compartment/platform-k3d-e2e-values.yaml',
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

export function renderPlatformK3dValues(imageDigestsByServiceName) {
  return `${renderPlatformImageValues(imageDigestsByServiceName)}ingress:\n  className: traefik\nregistry:\n  clusterIP: ${bundledRegistryClusterIp}\n  hostname: ${bundledRegistryHostname}\n  issuerRef:\n    kind: ClusterIssuer\n    name: compartment-registry-test-issuer\nplatform:\n  baseDomain: ${platformBaseDomain}\n  publicProtocol: http\n  tlsMode: custom-http\nbuildkit:\n  namespace: ${platformNamespace}-build\nedge:\n  snapshots:\n    enabled: true\n`;
}

export function renderManagedPlatformK3dValues(imageDigestsByServiceName) {
  return `${renderPlatformImageValues(imageDigestsByServiceName)}ingress:\n  className: traefik\n  endpoint:\n    type: A\n    value: 8.8.4.4\nregistry:\n  clusterIP: ${bundledRegistryClusterIp}\n  hostname: ${bundledRegistryHostname}\n  issuerRef:\n    kind: ClusterIssuer\n    name: compartment-registry-test-issuer\nplatform:\n  publicIngressIpv4: 8.8.4.4\nbuildkit:\n  namespace: ${managedNamespace}-build\n`;
}

function renderPlatformImageValues(imageDigestsByServiceName) {
  const imageValues = platformK3dServiceNames
    .map(
      (serviceName) =>
        `  ${serviceName}:\n    repository: ${registryClusterHost}/compartment-${serviceName}\n    tag: ${platformImageTag}\n    digest: ${readRequiredPlatformImageDigest(imageDigestsByServiceName, serviceName)}`,
    )
    .join('\n');
  return `images:\n${imageValues}\n`;
}

async function cleanLegacyPlatformResources() {
  if (!shouldCleanLegacyPlatformResources(platformEnvironment)) {
    return;
  }
  await withPlatformK3dProcessLock(legacyCleanupLockDirectory, cleanLegacyPlatformResourcesUnlocked);
}

function cleanLegacyPlatformResourcesUnlocked() {
  const cleanupErrors = [];
  const legacyClusterName = 'compartment-e2e';
  const legacyRegistryName = 'compartment-e2e-registry';
  runCleanupStep(cleanupErrors, 'legacy cluster', () => {
    const clusterNames = parseK3dClusterNames(
      captureCommand('k3d', ['cluster', 'list', '--no-headers'], repositoryRoot),
    );
    if (clusterNames.includes(legacyClusterName)) {
      runCommand('k3d', ['cluster', 'delete', legacyClusterName], repositoryRoot);
    }
  });
  runCleanupStep(cleanupErrors, 'legacy registry', () => {
    const registryNames = parseK3dClusterNames(
      captureCommand('k3d', ['registry', 'list', '--no-headers'], repositoryRoot),
    );
    if (registryNames.includes(`k3d-${legacyRegistryName}`)) {
      runCommand('k3d', ['registry', 'delete', `k3d-${legacyRegistryName}`], repositoryRoot);
    }
  });
  for (const containerName of [
    `k3d-${legacyClusterName}-server-0`,
    `k3d-${legacyClusterName}-serverlb`,
    `k3d-${legacyRegistryName}`,
  ]) {
    if (dockerResourceExists('container', containerName)) {
      runCleanupStep(cleanupErrors, `legacy container ${containerName}`, () => {
        runCommand('docker', buildDockerContainerRemovalArgs(containerName), repositoryRoot);
      });
    }
  }
  if (dockerResourceExists('network', `k3d-${legacyClusterName}`)) {
    runCleanupStep(cleanupErrors, 'legacy network', () => {
      runCommand('docker', ['network', 'rm', `k3d-${legacyClusterName}`], repositoryRoot);
    });
  }
  let legacyVolumeNames = [];
  runCleanupStep(cleanupErrors, 'legacy volume inventory', () => {
    legacyVolumeNames = captureCommand('docker', ['volume', 'ls', '--format', '{{.Name}}'], repositoryRoot)
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => [`k3d-${legacyClusterName}`, `k3d-${legacyClusterName}-images`].includes(name));
  });
  for (const volumeName of legacyVolumeNames) {
    runCleanupStep(cleanupErrors, `legacy volume ${volumeName}`, () => {
      runCommand('docker', ['volume', 'rm', '--force', volumeName], repositoryRoot);
    });
  }
  for (const legacyStatePath of [
    '.compartment/platform-k3d-e2e-values.yaml',
    '.compartment/platform-k3d-managed-e2e-values.yaml',
    '.compartment/platform-k3d-e2e-owner.env',
    '.compartment/pebble.minica.pem',
    '.compartment/pebble.root.pem',
  ]) {
    rmSync(resolve(repositoryRoot, legacyStatePath), { force: true });
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Unable to fully clean legacy platform k3d resources.');
  }
}

async function upPlatform(command) {
  assertRequiredTools();
  try {
    await cleanLegacyPlatformResources();
    await withPlatformK3dProcessLock(archiveLoadLockDirectory, async () => cleanHistoricalPlatformSourceImages());
    cleanPlatformResources();
    recreateRegistry();
    recreateBuilder();
    for (const statePath of [platformValuesPath, managedPlatformValuesPath, pebbleCaPath, pebbleRootPath]) {
      mkdirSync(dirname(statePath), { recursive: true });
    }
    if (shouldExtractPebbleCa) {
      extractPebbleManagementCertificateAuthority();
    }
    const preparedImages = await settlePlatformK3dStartup(createCluster(), prepareAndPushPlatformImages(command));
    writeFileSync(platformValuesPath, renderPlatformK3dValues(preparedImages.imageDigestsByServiceName), {
      mode: 0o600,
    });
    writeFileSync(managedPlatformValuesPath, renderManagedPlatformK3dValues(preparedImages.imageDigestsByServiceName), {
      mode: 0o600,
    });
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

async function createCluster() {
  await runCommandAsync('k3d', buildPlatformK3dClusterCreateArgs(), repositoryRoot);
  runCommand(
    'kubectl',
    ['--context', contextName, 'apply', '--server-side', '--filename', certManagerManifestUrl],
    repositoryRoot,
  );
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      '--namespace',
      'cert-manager',
      'wait',
      'deployment',
      '--all',
      '--for=condition=Available',
      `--timeout=${kubernetesReadinessTimeout}`,
    ],
    repositoryRoot,
  );
  installRegistryTestIssuerAndNodeTrust();
}

function installRegistryTestIssuerAndNodeTrust() {
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
  runCommand(
    'kubectl',
    [
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
    ],
    repositoryRoot,
  );
  const issuerPath = join(dirname(platformValuesPath), `${clusterName}-registry-test-issuer.yaml`);
  writeFileSync(
    issuerPath,
    'apiVersion: cert-manager.io/v1\nkind: ClusterIssuer\nmetadata:\n  name: compartment-registry-test-issuer\nspec:\n  ca:\n    secretName: compartment-registry-test-ca\n',
    { mode: 0o600 },
  );
  runCommand('kubectl', ['--context', contextName, 'apply', '--filename', issuerPath], repositoryRoot);
  rmSync(issuerPath, { force: true });

  const nodeNames = captureCommand(
    'docker',
    ['ps', '--filter', 'label=app=k3d', '--filter', `label=k3d.cluster=${clusterName}`, '--format', '{{.Names}}'],
    repositoryRoot,
  )
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => /-(?:server|agent)-[0-9]+$/u.test(name));
  for (const nodeName of nodeNames) {
    runCommand(
      'docker',
      ['cp', registryTestCaPath, `${nodeName}:/tmp/compartment-registry-test-ca.crt`],
      repositoryRoot,
    );
    runCommand(
      'docker',
      ['exec', nodeName, 'sh', '-c', 'cat /tmp/compartment-registry-test-ca.crt >>/etc/ssl/certs/ca-certificates.crt'],
      repositoryRoot,
    );
    runCommand('docker', ['restart', nodeName], repositoryRoot);
  }
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      'wait',
      'nodes',
      '--all',
      '--for=condition=Ready',
      `--timeout=${kubernetesReadinessTimeout}`,
    ],
    repositoryRoot,
  );
}

export function buildPlatformK3dClusterCreateArgs() {
  return [
    'cluster',
    'create',
    clusterName,
    '--port',
    `127.0.0.1:${httpPort}:80@loadbalancer`,
    '--port',
    `127.0.0.1:${httpsPort}:443@loadbalancer`,
    '--port',
    `127.0.0.1:${managedBrokerPort}:30900@server:0`,
    '--port',
    `127.0.0.1:${managedAcmeManagementPort}:31500@server:0`,
    '--registry-use',
    registryClusterHost,
    '--wait',
  ];
}

export function readPlatformK3dCertManagerManifestUrl() {
  return certManagerManifestUrl;
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
  await assertPrivateRegistryEndpointIsRequired();
  runCommand('kubectl', ['--context', contextName, '--request-timeout=5s', 'get', '--raw=/readyz'], repositoryRoot);
  await waitForConsole();
  process.stdout.write(`console: http://${consoleHost}:${httpPort}\nSTATUS=ok\n`);
}

async function assertPrivateRegistryEndpointIsRequired() {
  const output = JSON.parse(
    captureCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        platformNamespace,
        'exec',
        'deployment/compartment-compartment-worker',
        '--',
        'node',
        'dist/registry-install-verifier.js',
      ],
      repositoryRoot,
    ).trim(),
  );
  if (typeof output.imageRef !== 'string' || typeof output.dockerConfigJson !== 'string') {
    throw new Error('Registry endpoint negative check received invalid verifier output.');
  }
  const manifestPath = join(dirname(platformValuesPath), `${clusterName}-registry-negative.yaml`);
  writeFileSync(
    manifestPath,
    `apiVersion: v1
kind: Secret
metadata:
  name: registry-negative-pull
  namespace: ${platformNamespace}
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: ${JSON.stringify(output.dockerConfigJson)}
---
apiVersion: v1
kind: Pod
metadata:
  name: registry-endpoint-disabled
  namespace: ${platformNamespace}
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  containers:
    - name: negative
      image: ${output.imageRef}
      imagePullPolicy: Always
  imagePullSecrets:
    - name: registry-negative-pull
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
        'pod/registry-endpoint-disabled',
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
        'pod/registry-endpoint-disabled',
        '--wait=true',
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
        'scale',
        'deployment/compartment-compartment-registry-auth',
        '--replicas=0',
      ],
      repositoryRoot,
    );
    runCommand('kubectl', ['--context', contextName, 'apply', '--filename', manifestPath], repositoryRoot);
    let failedThroughDisabledEndpoint = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const reason = captureCommand(
        'kubectl',
        [
          '--context',
          contextName,
          '--namespace',
          platformNamespace,
          'get',
          'pod/registry-endpoint-disabled',
          '--output',
          'jsonpath={.status.containerStatuses[0].state.waiting.reason}',
        ],
        repositoryRoot,
      ).trim();
      if (reason === 'ErrImagePull' || reason === 'ImagePullBackOff') {
        failedThroughDisabledEndpoint = true;
        break;
      }
      await delay(2_000);
    }
    if (!failedThroughDisabledEndpoint) {
      throw new Error('Private registry pull unexpectedly succeeded while the endpoint was disabled.');
    }
  } finally {
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        platformNamespace,
        'delete',
        'pod/registry-endpoint-disabled',
        'secret/registry-negative-pull',
        '--ignore-not-found',
        '--wait=false',
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
        'scale',
        'deployment/compartment-compartment-registry-auth',
        '--replicas=1',
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
        'rollout',
        'status',
        'deployment/compartment-compartment-registry-auth',
        `--timeout=${kubernetesReadinessTimeout}`,
      ],
      repositoryRoot,
    );
    rmSync(manifestPath, { force: true });
  }
}

function waitForPlatformDeployments() {
  for (const namespace of [platformNamespace, `${platformNamespace}-build`]) {
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        namespace,
        'wait',
        'deployment',
        '--all',
        '--for=condition=Available',
        `--timeout=${kubernetesReadinessTimeout}`,
      ],
      repositoryRoot,
    );
  }
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
