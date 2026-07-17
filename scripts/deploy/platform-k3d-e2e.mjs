import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildSelfHostedImages } from './build-self-hosted-images.mjs';
import { captureCommand, runCommand, runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const clusterName = 'compartment-e2e';
const contextName = `k3d-${clusterName}`;
const httpPort = 18_080;
const httpsPort = 18_443;
const registryName = 'compartment-e2e-registry';
const registryHostPort = 15_500;
const managedBrokerPort = 19_000;
const managedAcmeManagementPort = 19_500;
const registryClusterHost = `k3d-${registryName}:${registryHostPort}`;
const registryPushHost = `localhost:${registryHostPort}`;
const bundledRegistryPort = 5000;
const bundledRegistryHost = `compartment-compartment-registry-auth.compartment.svc:${bundledRegistryPort}`;
const platformBaseDomain = 'compartment.localhost';
const consoleHost = `console.${platformBaseDomain}`;
const serverNodeName = `k3d-${clusterName}-server-0`;
const platformImageTag = 'e2e';
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const platformValuesPath = join(repositoryRoot, '.compartment', 'platform-k3d-e2e-values.yaml');
const managedPlatformValuesPath = join(repositoryRoot, '.compartment', 'platform-k3d-managed-e2e-values.yaml');
const pebbleCaPath = join(repositoryRoot, '.compartment', 'pebble.minica.pem');
const pebbleRootPath = join(repositoryRoot, '.compartment', 'pebble.root.pem');
const platformOwnerEnvironmentPath = join(repositoryRoot, '.compartment', 'platform-k3d-e2e-owner.env');
const kubernetesReadinessTimeoutSeconds = 240;
const kubernetesReadinessTimeout = `${kubernetesReadinessTimeoutSeconds}s`;
const platformServiceNames = Object.freeze(['api', 'worker', 'edge', 'caddy']);
const pebbleImageRef =
  'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const builtImageRefsByServiceName = Object.freeze(
  Object.fromEntries(
    platformServiceNames.map((serviceName) => [
      serviceName,
      `ghcr.io/compartmentdev/compartment-${serviceName}:latest`,
    ]),
  ),
);

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
  return `${renderPlatformImageValues(imageDigestsByServiceName)}${renderK3dServiceValues()}platform:\n  baseDomain: ${platformBaseDomain}\n  publicProtocol: http\n  tlsMode: custom-http\nedge:\n  snapshots:\n    enabled: true\n`;
}

export function renderManagedPlatformK3dValues(imageDigestsByServiceName, managedCaddyDigest) {
  return `${renderPlatformImageValues({ ...imageDigestsByServiceName, caddy: managedCaddyDigest })}${renderK3dServiceValues()}platform:\n  acmeCaUrl: https://pebble:14000/dir\n  publicIngressIpv4: 8.8.4.4\nbuildkit:\n  namespace: compartment-managed-e2e-build\n`;
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

async function upPlatform(command) {
  assertRequiredTools();
  if (clusterExists()) {
    throw new Error(`k3d cluster ${clusterName} already exists; run pnpm platform:e2e:down first.`);
  }

  recreateRegistry();
  mkdirSync(resolve(repositoryRoot, '.compartment'), { recursive: true });

  try {
    const [, preparedImages] = await Promise.all([createCluster(), prepareAndPushPlatformImages(command)]);
    writeFileSync(platformValuesPath, renderPlatformK3dValues(preparedImages.imageDigestsByServiceName), {
      mode: 0o600,
    });
    writeFileSync(
      managedPlatformValuesPath,
      renderManagedPlatformK3dValues(preparedImages.imageDigestsByServiceName, preparedImages.managedCaddyDigest),
      { mode: 0o600 },
    );
  } catch (error) {
    deleteCluster();
    deleteRegistry();
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
      ? loadPlatformImageArchives(command.imageArchiveDir)
      : await buildPlatformImages();

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
      ['build', '--build-arg', `CADDY_IMAGE=${sourceImageRef}`, '--tag', managedImageRef, buildDirectory],
      repositoryRoot,
    );
    runCommand('docker', ['push', '--quiet', managedImageRef], repositoryRoot);
    return readPushedImageDigest(managedImageRef);
  } finally {
    if (pebbleContainerId !== undefined && pebbleContainerId !== '') {
      runCommand('docker', ['rm', '--force', pebbleContainerId], repositoryRoot);
    }
    rmSync(buildDirectory, { force: true, recursive: true });
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
  await buildSelfHostedImages({
    env: process.env,
    imageRefsByServiceName: builtImageRefsByServiceName,
    repositoryRoot,
  });

  return builtImageRefsByServiceName;
}

function loadPlatformImageArchives(imageArchiveDir) {
  const imageRefsByServiceName = {};

  for (const serviceName of platformServiceNames) {
    const archivePath = `${imageArchiveDir}/${serviceName}.tar`;
    const loadOutput = captureCommand('docker', ['load', '--input', archivePath], repositoryRoot);
    const [imageRef, ...extraImageRefs] = parseLoadedImageRefs(loadOutput);

    if (imageRef === undefined || extraImageRefs.length > 0) {
      throw new Error(`Expected exactly one loaded image ref in ${archivePath}, received: ${loadOutput}`);
    }

    imageRefsByServiceName[serviceName] = imageRef;
  }

  return imageRefsByServiceName;
}

function downPlatform() {
  assertTool('k3d');
  if (clusterExists()) {
    deleteCluster();
  }
  deleteRegistry();
  rmSync(platformValuesPath, { force: true });
  rmSync(managedPlatformValuesPath, { force: true });
  rmSync(pebbleCaPath, { force: true });
  rmSync(pebbleRootPath, { force: true });
  rmSync(platformOwnerEnvironmentPath, { force: true });
  process.stdout.write(`Removed ${clusterName}.\n`);
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
  for (const namespace of ['compartment', 'compartment-build']) {
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
      'compartment',
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
