import { request as createHttpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { isSea } from 'node:sea';
import { copyFile, chmod, chown, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SystemServiceHealth, SystemServiceStatus } from '@compartment/contracts';
import { readCommandOutput, runCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import type { SelfHostedRuntimeServiceInspection } from './docker-runtime.types';
import { ensureSelfHostedRuntimeDirectories } from './self-hosted-runtime-directories';
import { readSelfHostedEnvironmentValues } from './self-hosted-env-file';
import { readCanonicalNodeAgentSocketPath } from './self-hosted-host-socket-paths';

const nodeAgentBinaryPath: string = '/usr/local/bin/compartment-node-agent';
const nodeAgentServiceName: string = 'compartment-node-agent.service';
const nodeAgentSystemdUnitPath: string = `/etc/systemd/system/${nodeAgentServiceName}`;
const nodeAgentBinaryMode: number = 0o755;
const nodeAgentHealthRequestTimeoutMs: number = 1_000;
const nodeAgentRestartPollIntervalMs: number = 250;
const nodeAgentRestartTimeoutMs: number = 30_000;
const systemdUnitMode: number = 0o644;
const nodeRuntimeDirectory: string = 'compartment/node';
const selfHostedStateDirectory: string = 'compartment/self-hosted';
const legacySelfHostedStateDirectory: string = ['compartment/on', 'prem'].join('');
const resourceBackupsStateDirectory: string = 'compartment/resource-backups';

interface StageNodeAgentHostServiceInput {
  envPath: string;
}

interface RestartNodeAgentHostServiceInput {
  envPath: string;
  waitForHealth?: boolean | undefined;
}

interface WaitForNodeAgentHostServiceHealthInput {
  envPath: string;
}

interface InspectNodeAgentHostServiceInput {
  nodeSocketPath: string;
}

export async function stageNodeAgentHostService(input: StageNodeAgentHostServiceInput): Promise<void> {
  await ensureSelfHostedRuntimeDirectories();
  await installNodeAgentBinary();
  await writeNodeAgentSystemdUnit(input.envPath);
  await runRequiredSystemCommand(['systemctl', 'daemon-reload'], 'Failed to reload systemd after node agent install.');
  await runRequiredSystemCommand(
    ['systemctl', 'enable', nodeAgentServiceName],
    'Failed to enable compartment-node-agent service.',
  );
}

export function assertNodeAgentHostServiceInstallable(): void {
  readNodeAgentSourceBinaryPath();
}

export async function restartNodeAgentHostService(input: RestartNodeAgentHostServiceInput): Promise<void> {
  await runRequiredSystemCommand(
    ['systemctl', 'restart', nodeAgentServiceName],
    'Failed to restart compartment-node-agent service.',
  );
  if (input.waitForHealth === false) {
    return;
  }
  await waitForNodeAgentHostServiceHealth(input);
}

export async function waitForNodeAgentHostServiceHealth(input: WaitForNodeAgentHostServiceHealthInput): Promise<void> {
  await waitForNodeAgentHealth(await readNodeAgentSocketPath(input.envPath));
}

export async function inspectNodeAgentHostService(
  input: InspectNodeAgentHostServiceInput,
): Promise<SelfHostedRuntimeServiceInspection> {
  const result: CommandResult = await runCommand(['systemctl', 'is-active', nodeAgentServiceName]);
  const status: SystemServiceStatus = readNodeAgentServiceStatus(result);
  return {
    containerId: null,
    health: await readNodeAgentInspectionHealth(status, input.nodeSocketPath),
    imageRef: null,
    name: 'node',
    publishedPorts: [],
    startedAt: null,
    status,
  };
}

async function installNodeAgentBinary(): Promise<void> {
  const temporaryBinaryPath: string = `${nodeAgentBinaryPath}.tmp-${process.pid}`;

  await mkdir(dirname(nodeAgentBinaryPath), { recursive: true });
  try {
    await copyFile(readNodeAgentSourceBinaryPath(), temporaryBinaryPath);
    await applyRootOwnershipIfRoot(temporaryBinaryPath);
    await chmod(temporaryBinaryPath, nodeAgentBinaryMode);
    await rename(temporaryBinaryPath, nodeAgentBinaryPath);
  } catch (error) {
    await rm(temporaryBinaryPath, { force: true });
    throw error;
  }
}

function readNodeAgentSourceBinaryPath(): string {
  if (isSea()) {
    return process.execPath;
  }

  throw new Error(
    'compartment-node-agent can only be installed from the self-contained compartment binary. Install the packaged CLI before running `sudo compartment install`.',
  );
}

async function writeNodeAgentSystemdUnit(envPath: string): Promise<void> {
  await writeFile(nodeAgentSystemdUnitPath, renderNodeAgentSystemdUnit(envPath), {
    encoding: 'utf8',
    mode: systemdUnitMode,
  });
  await applyRootOwnershipIfRoot(nodeAgentSystemdUnitPath);
  await chmod(nodeAgentSystemdUnitPath, systemdUnitMode);
}

async function applyRootOwnershipIfRoot(path: string): Promise<void> {
  if (process.getuid?.() !== 0) {
    return;
  }

  await chown(path, 0, 0);
}

function renderNodeAgentSystemdUnit(envPath: string): string {
  return `[Unit]
Description=Compartment Node Agent
After=docker.service docker.socket network-online.target
Wants=network-online.target
[Service]
${renderNodeAgentSystemdService(envPath)}
[Install]
WantedBy=multi-user.target
`;
}

function renderNodeAgentSystemdService(envPath: string): string {
  return `Type=simple
User=root
Group=root
EnvironmentFile=${envPath}
ExecStart=${nodeAgentBinaryPath}
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
RuntimeDirectory=compartment/node
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
StateDirectory=${selfHostedStateDirectory} ${legacySelfHostedStateDirectory} ${resourceBackupsStateDirectory}
StateDirectoryMode=0700
ReadWritePaths=/var/run/${nodeRuntimeDirectory} /var/lib/${selfHostedStateDirectory} /var/lib/${legacySelfHostedStateDirectory} /var/lib/${resourceBackupsStateDirectory} /var/run/docker.sock
UMask=0077`;
}

async function runRequiredSystemCommand(command: readonly string[], failureMessage: string): Promise<void> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode === 0) {
    return;
  }

  const output: string = readCommandOutput(result);
  throw new Error(output === '' ? failureMessage : `${failureMessage}\n${output}`);
}

function readNodeAgentServiceStatus(result: CommandResult): SystemServiceStatus {
  const activeState: string = result.stdout.trim().toLowerCase();
  switch (activeState) {
    case 'active':
      return 'running';
    case 'activating':
    case 'reloading':
      return 'restarting';
    case 'inactive':
      return 'exited';
    case 'failed':
      return 'dead';
    default:
      return result.exitCode === 0 ? 'unknown' : 'missing';
  }
}

async function readNodeAgentInspectionHealth(
  status: SystemServiceStatus,
  nodeSocketPath: string,
): Promise<SystemServiceHealth | null> {
  if (status !== 'running' && status !== 'restarting') {
    return null;
  }

  return (await readNodeAgentHealth(nodeSocketPath)) ? 'healthy' : 'unhealthy';
}

async function readNodeAgentSocketPath(envPath: string): Promise<string> {
  const environmentText: string = await readFile(envPath, 'utf8');
  return readCanonicalNodeAgentSocketPath(readSelfHostedEnvironmentValues(environmentText));
}

async function waitForNodeAgentHealth(socketPath: string): Promise<void> {
  const deadline: number = Date.now() + nodeAgentRestartTimeoutMs;
  while (Date.now() <= deadline) {
    if (await readNodeAgentHealth(socketPath)) {
      return;
    }

    await waitForNodeAgentHealthPoll();
  }

  throw new Error(`compartment-node-agent did not become healthy on ${socketPath}.`);
}

async function readNodeAgentHealth(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((complete: (value: boolean) => void): void => {
    const request: ClientRequest = createHttpRequest(
      {
        method: 'GET',
        path: '/healthz',
        socketPath,
      },
      (response: IncomingMessage): void => {
        response.resume();
        response.on('end', (): void => {
          complete((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300);
        });
      },
    );

    request.setTimeout(nodeAgentHealthRequestTimeoutMs, (): void => {
      complete(false);
      request.destroy();
    });
    request.on('error', (): void => {
      complete(false);
    });
    request.end();
  });
}

async function waitForNodeAgentHealthPoll(): Promise<void> {
  await new Promise<void>((complete: () => void): void => {
    setTimeout(complete, nodeAgentRestartPollIntervalMs);
  });
}
