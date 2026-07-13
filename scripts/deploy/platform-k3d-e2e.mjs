import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import { buildSelfHostedImages } from './build-self-hosted-images.mjs';
import { captureCommand, runCommand, runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const chartPath = 'deploy/chart/compartment';
const clusterName = 'compartment-e2e';
const contextName = `k3d-${clusterName}`;
const httpPort = 18_080;
const httpsPort = 18_443;
const registryName = 'compartment-e2e-registry';
const registryHostPort = 15_500;
const registryClusterHost = `k3d-${registryName}:${registryHostPort}`;
const registryPushHost = `localhost:${registryHostPort}`;
const platformImageTag = 'e2e';
const platformServiceNames = Object.freeze(['api', 'worker', 'edge', 'caddy']);
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

  if (action === 'down') {
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
  return 'Usage: node ./scripts/deploy/platform-k3d-e2e.mjs <up [--image-source build|archive] [--image-archive-dir <dir>]|down>';
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

async function upPlatform(command) {
  assertRequiredTools();
  if (clusterExists()) {
    throw new Error(`k3d cluster ${clusterName} already exists; run pnpm platform:e2e:down first.`);
  }

  recreateRegistry();

  try {
    await Promise.all([createCluster(), prepareAndPushPlatformImages(command)]);

    runCommand('kubectl', ['--context', contextName, 'create', 'namespace', 'compartment'], repositoryRoot);

    installHelmStage('foundation');
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        'compartment',
        'wait',
        'deployment/compartment-compartment-postgres',
        'deployment/compartment-compartment-registry',
        '--for=condition=Available',
        '--timeout=2m',
      ],
      repositoryRoot,
    );
    installHelmStage('full');
    runCommand(
      'kubectl',
      [
        '--context',
        contextName,
        '--namespace',
        'compartment',
        'wait',
        'deployment',
        '--all',
        '--for=condition=Available',
        '--timeout=2m',
      ],
      repositoryRoot,
    );
    runCommand('kubectl', ['--context', contextName, '--request-timeout=5s', 'get', '--raw=/readyz'], repositoryRoot);
    await waitForConsole();
  } catch (error) {
    deleteCluster();
    deleteRegistry();
    process.stderr.write('STATUS=failed\n');
    throw error;
  }

  process.stdout.write(`context: ${contextName}\nconsole: http://console.localhost:${httpPort}\nSTATUS=ok\n`);
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

  for (const serviceName of platformServiceNames) {
    const sourceImageRef = imageRefsByServiceName[serviceName];
    const registryImageRef = `${registryPushHost}/compartment-${serviceName}:${platformImageTag}`;
    runCommand('docker', ['tag', sourceImageRef, registryImageRef], repositoryRoot);
    runCommand('docker', ['push', '--quiet', registryImageRef], repositoryRoot);
  }
}

async function buildPlatformImages() {
  await buildSelfHostedImages({
    envFilePath: `${repositoryRoot}/.env.self-hosted.example`,
    env: process.env,
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
  process.stdout.write(`Removed ${clusterName}.\n`);
}

function installHelmStage(stage) {
  const args = [
    'upgrade',
    '--install',
    'compartment',
    chartPath,
    '--kube-context',
    contextName,
    '--namespace',
    'compartment',
    '--set',
    `ports.http=${httpPort}`,
    '--set',
    `ports.https=${httpsPort}`,
    '--set',
    `platform.startupStage=${stage}`,
    '--set',
    'edge.snapshots.enabled=true',
    '--atomic',
    '--wait',
    '--timeout',
    '8m',
  ];
  for (const serviceName of platformServiceNames) {
    args.push(
      '--set',
      `images.${serviceName}.repository=${registryClusterHost}/compartment-${serviceName}`,
      '--set',
      `images.${serviceName}.tag=${platformImageTag}`,
    );
  }
  if (stage === 'full') {
    args.push('--wait-for-jobs');
  }
  runCommand('helm', args, repositoryRoot);
}

async function waitForConsole() {
  const url = `http://console.localhost:${httpPort}/`;
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
        headers: { host: 'console.localhost' },
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
  downPlatform();
}

runMain(import.meta.url, process.argv[1], main);
