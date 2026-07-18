import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:http';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildSelfHostedImages } from './build-self-hosted-images.mjs';
import { captureCommand, captureCommandResult, runCommand, runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

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
const bundledRegistryPort = 5000;
const bundledRegistryHost = `compartment-compartment-registry-auth.${platformNamespace}.svc:${bundledRegistryPort}`;
const platformBaseDomain = 'compartment.localhost';
const consoleHost = `console.${platformBaseDomain}`;
const serverNodeName = `k3d-${clusterName}-server-0`;
const builderName = `${clusterName}-builder`;
const platformImageTag = 'e2e';
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const kubernetesReadinessTimeoutSeconds = 240;
const kubernetesReadinessTimeout = `${kubernetesReadinessTimeoutSeconds}s`;
const platformServiceNames = Object.freeze(['api', 'worker', 'edge', 'caddy']);
const pebbleImageRef =
  'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const archiveLoadLockDirectory = join(tmpdir(), 'compartment-platform-k3d-image-load.lock');
const legacyCleanupLockDirectory = join(tmpdir(), 'compartment-platform-k3d-legacy-cleanup.lock');
const processLockRetryMilliseconds = 100;
const processLockTimeoutMilliseconds = 30 * 60 * 1_000;
const platformCleanupStageNames = Object.freeze([
  'cluster',
  'registry',
  'builder',
  'residual Docker resources',
  'run-owned images',
  'state files and directories',
]);
const builtImageRefsByServiceName = Object.freeze(
  Object.fromEntries(
    platformServiceNames.map((serviceName) => [
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

export function isRunOwnedDockerResourceName(name, environment = platformEnvironment) {
  const environmentBuilderName = `${environment.clusterName}-builder`;
  return [
    `k3d-${environment.clusterName}`,
    `k3d-${environment.clusterName}-images`,
    `k3d-${environment.clusterName}-server-0`,
    `k3d-${environment.clusterName}-serverlb`,
    `k3d-${environment.registryName}`,
    `buildx_buildkit_${environmentBuilderName}0_state`,
  ].includes(name);
}

export function isRunOwnedImageRef(imageRef, environment = platformEnvironment) {
  if (imageRef.startsWith(`localhost:${environment.registryHostPort}/compartment-`)) {
    return true;
  }
  return platformServiceNames.some(
    (serviceName) => imageRef === `ghcr.io/compartmentdev/compartment-${serviceName}:e2e-${environment.clusterName}`,
  );
}

export function isPlatformSourceCacheImageRef(imageRef) {
  return platformServiceNames.some((serviceName) =>
    imageRef.startsWith(`ghcr.io/compartmentdev/compartment-${serviceName}:sha-`),
  );
}

export function readPlatformK3dCleanupStageNames() {
  return platformCleanupStageNames;
}

export function runPlatformK3dCleanupSequence(steps, cleanupErrors = []) {
  for (const step of steps) {
    runCleanupStep(cleanupErrors, step.label, step.cleanup);
  }
  return cleanupErrors;
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

export function renderK3dRegistryConfig(registryHost, serviceClusterIp) {
  if (registryHost.trim() === '') {
    throw new Error('Bundled registry host is required.');
  }
  if (isIP(serviceClusterIp) !== 4) {
    throw new Error(`Bundled registry Service must have an IPv4 clusterIP, received: ${serviceClusterIp}`);
  }

  return `mirrors:\n  "${registryHost}":\n    endpoint:\n      - "http://${serviceClusterIp}:${bundledRegistryPort}"\n`;
}

export function renderPlatformK3dValues(imageDigestsByServiceName) {
  return `${renderPlatformImageValues(imageDigestsByServiceName)}${renderK3dServiceValues()}platform:\n  baseDomain: ${platformBaseDomain}\n  publicProtocol: http\n  tlsMode: custom-http\nbuildkit:\n  namespace: ${platformNamespace}-build\nedge:\n  snapshots:\n    enabled: true\n`;
}

export function renderManagedPlatformK3dValues(imageDigestsByServiceName, managedCaddyDigest) {
  return `${renderPlatformImageValues({ ...imageDigestsByServiceName, caddy: managedCaddyDigest })}${renderK3dServiceValues()}platform:\n  acmeCaUrl: https://pebble:14000/dir\n  publicIngressIpv4: 8.8.4.4\nbuildkit:\n  namespace: ${managedNamespace}-build\n`;
}

function renderPlatformImageValues(imageDigestsByServiceName) {
  const imageValues = platformServiceNames
    .map(
      (serviceName) =>
        `  ${serviceName}:\n    repository: ${registryClusterHost}/compartment-${serviceName}\n    tag: ${platformImageTag}\n    digest: ${readRequiredPlatformImageDigest(imageDigestsByServiceName, serviceName)}`,
    )
    .join('\n');
  return `images:\n${imageValues}\n`;
}

function renderK3dServiceValues() {
  return 'service:\n  caddy:\n    type: NodePort\n    httpPort: 80\n    httpsPort: 443\n    httpNodePort: 30080\n    httpsNodePort: 30443\n';
}

export function shouldCleanLegacyPlatformResources(environment = platformEnvironment) {
  return environment.clusterName !== 'compartment-e2e';
}

export async function settlePlatformK3dStartup(clusterPromise, imagePromise) {
  const [clusterResult, imageResult] = await Promise.allSettled([clusterPromise, imagePromise]);
  if (clusterResult.status === 'rejected') {
    throw clusterResult.reason;
  }
  if (imageResult.status === 'rejected') {
    throw imageResult.reason;
  }
  return imageResult.value;
}

async function cleanLegacyPlatformResources() {
  if (!shouldCleanLegacyPlatformResources()) {
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
        runCommand('docker', ['container', 'rm', '--force', containerName], repositoryRoot);
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
    const preparedImages = await settlePlatformK3dStartup(createCluster(), prepareAndPushPlatformImages(command));
    writeFileSync(platformValuesPath, renderPlatformK3dValues(preparedImages.imageDigestsByServiceName), {
      mode: 0o600,
    });
    writeFileSync(
      managedPlatformValuesPath,
      renderManagedPlatformK3dValues(preparedImages.imageDigestsByServiceName, preparedImages.managedCaddyDigest),
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

async function createCluster() {
  await runCommandAsync(
    'k3d',
    [
      'cluster',
      'create',
      clusterName,
      '--k3s-arg',
      '--disable=traefik@server:*',
      '--port',
      `127.0.0.1:${httpPort}:30080@server:0`,
      '--port',
      `127.0.0.1:${httpsPort}:30443@server:0`,
      '--port',
      `127.0.0.1:${managedBrokerPort}:30900@server:0`,
      '--port',
      `127.0.0.1:${managedAcmeManagementPort}:31500@server:0`,
      '--registry-use',
      registryClusterHost,
      '--wait',
    ],
    repositoryRoot,
  );
}

async function prepareAndPushPlatformImages(command) {
  const imageRefsByServiceName =
    command.imageSource === 'archive'
      ? await loadPlatformImageArchives(command.imageArchiveDir)
      : await buildPlatformImages();

  try {
    const imageDigestsByServiceName = {};
    for (const serviceName of platformServiceNames) {
      const sourceImageRef = imageRefsByServiceName[serviceName];
      const registryImageRef = `${registryPushHost}/compartment-${serviceName}:${platformImageTag}`;
      runCommand('docker', ['tag', sourceImageRef, registryImageRef], repositoryRoot);
      runCommand('docker', ['push', '--quiet', registryImageRef], repositoryRoot);
      imageDigestsByServiceName[serviceName] = readPushedImageDigest(registryImageRef);
    }
    return {
      imageDigestsByServiceName,
      managedCaddyDigest: buildManagedE2eCaddyImage(imageRefsByServiceName.caddy),
    };
  } finally {
    removeImageRefs(Object.values(imageRefsByServiceName));
  }
}

function buildManagedE2eCaddyImage(sourceImageRef) {
  if (typeof sourceImageRef !== 'string' || sourceImageRef.trim() === '') {
    throw new Error('Expected a source Caddy image for the managed install e2e.');
  }
  const buildDirectory = mkdtempSync(join(tmpdir(), 'compartment-managed-caddy-'));
  const extractedCaPath = join(buildDirectory, 'pebble.minica.pem');
  const dockerfilePath = join(buildDirectory, 'Dockerfile');
  const managedImageRef = `${registryPushHost}/compartment-caddy:managed-e2e`;
  let pebbleContainerId;
  let managedCaddyDigest;
  let buildError;
  try {
    pebbleContainerId = captureCommand('docker', ['create', pebbleImageRef], repositoryRoot).trim();
    runCommand('docker', ['cp', `${pebbleContainerId}:/test/certs/pebble.minica.pem`, extractedCaPath], repositoryRoot);
    copyFileSync(extractedCaPath, pebbleCaPath);
    writeFileSync(
      dockerfilePath,
      'ARG CADDY_IMAGE\nFROM ${CADDY_IMAGE}\nCOPY pebble.minica.pem /usr/local/share/ca-certificates/pebble.crt\nRUN update-ca-certificates\n',
    );
    runCommand(
      'docker',
      [
        'buildx',
        'build',
        '--builder',
        builderName,
        '--load',
        '--build-arg',
        `CADDY_IMAGE=${sourceImageRef}`,
        '--tag',
        managedImageRef,
        buildDirectory,
      ],
      repositoryRoot,
    );
    runCommand('docker', ['push', '--quiet', managedImageRef], repositoryRoot);
    managedCaddyDigest = readPushedImageDigest(managedImageRef);
  } catch (error) {
    buildError = error;
  }

  let cleanupError;
  if (pebbleContainerId !== undefined && pebbleContainerId !== '') {
    try {
      runCommand('docker', ['rm', '--force', pebbleContainerId], repositoryRoot);
    } catch (error) {
      cleanupError = error;
    }
  }
  try {
    rmSync(buildDirectory, { force: true, recursive: true });
  } catch (error) {
    cleanupError ??= error;
  }

  if (buildError !== undefined) {
    if (cleanupError !== undefined) {
      process.stderr.write(`Managed Caddy cleanup also failed: ${String(cleanupError)}\n`);
    }
    throw buildError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  return managedCaddyDigest;
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
    cleanHistoricalPlatformSourceImages();
    const imageRefsByServiceName = {};
    const loadedImageRefs = [];
    try {
      for (const serviceName of platformServiceNames) {
        const archivePath = `${imageArchiveDir}/${serviceName}.tar`;
        const loadOutput = captureCommand('docker', ['load', '--input', archivePath], repositoryRoot);
        const [imageRef, ...extraImageRefs] = parseLoadedImageRefs(loadOutput);

        if (imageRef === undefined || extraImageRefs.length > 0) {
          throw new Error(`Expected exactly one loaded image ref in ${archivePath}, received: ${loadOutput}`);
        }

        const isolatedImageRef = builtImageRefsByServiceName[serviceName];
        runCommand('docker', ['tag', imageRef, isolatedImageRef], repositoryRoot);
        imageRefsByServiceName[serviceName] = isolatedImageRef;
        loadedImageRefs.push(imageRef);
      }
    } catch (error) {
      removeImageRefs(Object.values(imageRefsByServiceName));
      throw error;
    } finally {
      removeImageRefs(loadedImageRefs);
    }

    return imageRefsByServiceName;
  });
}

export async function withPlatformK3dProcessLock(lockDirectory, operation) {
  const releaseLock = await acquirePlatformK3dProcessLock(lockDirectory);
  try {
    return await operation();
  } finally {
    releaseLock();
  }
}

async function acquirePlatformK3dProcessLock(lockDirectory) {
  const attempts = Math.ceil(processLockTimeoutMilliseconds / processLockRetryMilliseconds);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      mkdirSync(lockDirectory);
      writeFileSync(join(lockDirectory, 'pid'), process.pid.toString(), { mode: 0o600 });
      return () => rmSync(lockDirectory, { force: true, recursive: true });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (!processLockOwnerIsRunning(lockDirectory)) {
        rmSync(lockDirectory, { force: true, recursive: true });
        continue;
      }
      await delay(processLockRetryMilliseconds);
    }
  }
  throw new Error(`Timed out waiting for the platform k3d process lock at ${lockDirectory}.`);
}

function processLockOwnerIsRunning(lockDirectory) {
  let ownerPid;
  try {
    ownerPid = Number(readFileSync(join(lockDirectory, 'pid'), 'utf8'));
  } catch {
    try {
      return Date.now() - statSync(lockDirectory).mtimeMs < 5_000;
    } catch {
      return false;
    }
  }
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    return false;
  }
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function cleanHistoricalPlatformSourceImages() {
  const imageRefs = captureCommand('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], repositoryRoot)
    .split('\n')
    .map((imageRef) => imageRef.trim())
    .filter((imageRef) => imageRef !== '' && isPlatformSourceCacheImageRef(imageRef));
  removeImageRefs(imageRefs);
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
  try {
    cleanup();
  } catch (error) {
    cleanupErrors.push(error);
    process.stderr.write(`Failed to clean ${label} for ${clusterName}: ${String(error)}\n`);
  }
}

function cleanResidualDockerResources(cleanupErrors) {
  for (const containerName of [
    `k3d-${clusterName}-server-0`,
    `k3d-${clusterName}-serverlb`,
    `k3d-${registryName}`,
    `buildx_buildkit_${builderName}0`,
  ]) {
    if (dockerResourceExists('container', containerName)) {
      runCleanupStep(cleanupErrors, `container ${containerName}`, () => {
        runCommand('docker', ['container', 'rm', '--force', containerName], repositoryRoot);
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
      .filter((name) => name !== '' && isRunOwnedDockerResourceName(name));
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
      .filter((imageRef) => imageRef !== '' && isRunOwnedImageRef(imageRef));
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

  await configureK3dRegistryMirror();
  waitForPlatformDeployments();
  runCommand('kubectl', ['--context', contextName, '--request-timeout=5s', 'get', '--raw=/readyz'], repositoryRoot);
  await waitForConsole();
  process.stdout.write(`console: http://${consoleHost}:${httpPort}\nSTATUS=ok\n`);
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

async function configureK3dRegistryMirror() {
  const serviceClusterIp = captureCommand(
    'kubectl',
    [
      '--context',
      contextName,
      '--namespace',
      platformNamespace,
      'get',
      'service/compartment-compartment-registry-auth',
      '--output',
      'jsonpath={.spec.clusterIP}',
    ],
    repositoryRoot,
  ).trim();
  const configDirectory = mkdtempSync(join(tmpdir(), 'compartment-k3d-registry-'));
  const configPath = join(configDirectory, 'registries.yaml');

  try {
    writeFileSync(configPath, renderK3dRegistryConfig(bundledRegistryHost, serviceClusterIp), { mode: 0o600 });
    runCommand('docker', ['exec', serverNodeName, 'mkdir', '-p', '/etc/rancher/k3s'], repositoryRoot);
    runCommand('docker', ['cp', configPath, `${serverNodeName}:/etc/rancher/k3s/registries.yaml`], repositoryRoot);
    runCommand('docker', ['restart', serverNodeName], repositoryRoot);
  } finally {
    rmSync(configDirectory, { force: true, recursive: true });
  }

  await waitForK3dApiAfterRestart();
  runCommand(
    'kubectl',
    [
      '--context',
      contextName,
      'wait',
      `node/${serverNodeName}`,
      '--for=condition=Ready',
      `--timeout=${kubernetesReadinessTimeout}`,
    ],
    repositoryRoot,
  );
}

async function waitForK3dApiAfterRestart() {
  for (let attempt = 0; attempt < kubernetesReadinessTimeoutSeconds; attempt += 1) {
    try {
      captureCommand(
        'kubectl',
        ['--context', contextName, '--request-timeout=2s', 'get', `node/${serverNodeName}`, '--output', 'name'],
        repositoryRoot,
      );
      return;
    } catch {
      await delay(1_000);
    }
  }
  throw new Error(`Kubernetes API did not recover after restarting ${serverNodeName}.`);
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
  for (const tool of ['docker', 'k3d', 'kubectl', 'helm']) {
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
