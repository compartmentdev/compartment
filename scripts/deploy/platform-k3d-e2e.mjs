import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import { buildSelfHostedImages } from './build-self-hosted-images.mjs';
import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const chartPath = 'deploy/chart/compartment';
const clusterName = 'compartment-e2e';
const contextName = `k3d-${clusterName}`;
const httpPort = 18_080;
const httpsPort = 18_443;
const imageRefs = Object.freeze(
  ['api', 'worker', 'edge', 'caddy'].map((serviceName) => `ghcr.io/compartmentdev/compartment-${serviceName}:latest`),
);

export function readPlatformK3dAction(args) {
  if (args.length === 1 && (args[0] === 'up' || args[0] === 'down')) {
    return args[0];
  }

  throw new Error('Usage: node ./scripts/deploy/platform-k3d-e2e.mjs <up|down>');
}

export function parseK3dClusterNames(output) {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/u)[0])
    .filter((name) => name !== undefined && name !== '');
}

export function isConsoleReadyStatus(status) {
  return status === 302;
}

async function upPlatform() {
  assertRequiredTools();
  if (clusterExists()) {
    throw new Error(`k3d cluster ${clusterName} already exists; run pnpm platform:e2e:down first.`);
  }

  await buildSelfHostedImages({
    envFilePath: `${repositoryRoot}/.env.self-hosted.example`,
    env: process.env,
    repositoryRoot,
  });

  try {
    runCommand(
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
        '--wait',
      ],
      repositoryRoot,
    );
    runCommand('k3d', ['image', 'import', '--cluster', clusterName, ...imageRefs], repositoryRoot);
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
    process.stderr.write('STATUS=failed\n');
    throw error;
  }

  process.stdout.write(`context: ${contextName}\nconsole: http://console.localhost:${httpPort}\nSTATUS=ok\n`);
}

function downPlatform() {
  assertTool('k3d');
  if (clusterExists()) {
    deleteCluster();
  }
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
    '--rollback-on-failure',
    '--wait',
    '--timeout',
    '8m',
  ];
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

function deleteCluster() {
  runCommand('k3d', ['cluster', 'delete', clusterName], repositoryRoot);
}

async function main() {
  const action = readPlatformK3dAction(process.argv.slice(2));
  if (action === 'up') {
    await upPlatform();
    return;
  }
  downPlatform();
}

runMain(import.meta.url, process.argv[1], main);
