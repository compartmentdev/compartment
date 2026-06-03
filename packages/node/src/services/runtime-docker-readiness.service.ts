import { randomUUID } from 'node:crypto';
import {
  buildDockerNamespaceLabels,
  isDockerNetworkIpamCapacityError,
  requireDockerImageAvailable,
  runDockerContainerToCompletion,
  readDockerEngineErrorMessage,
  type DockerEngineError,
  type DockerRunContainerInput,
} from '@compartment/docker';
import type { ResolvedServiceReadinessConfig } from '@compartment/contracts';
import { createRuntimeNetworkIpCapacityExhaustedError } from '../errors/node-runtime-error';

interface DockerNetworkRuntimeReadinessInput {
  dockerNamespace: string;
  host: string;
  hostHeader?: string | undefined;
  networkName: string;
  port: number;
  probeImageRef: string;
  readiness: ResolvedServiceReadinessConfig;
}

const dockerNetworkReadinessPollIntervalMs: number = 500;
const maxDockerNetworkReadinessProbeTimeoutSeconds: number = 5;
const dockerNetworkReadinessProbeScript: string = [
  "const http = require('node:http');",
  'const url = new URL(process.env.COMPARTMENT_READINESS_URL);',
  'const timeout = Number(process.env.COMPARTMENT_READINESS_TIMEOUT_MS);',
  'const host = process.env.COMPARTMENT_READINESS_HOST_HEADER;',
  "const headers = host === undefined || host === '' ? undefined : { Host: host };",
  'const options = {',
  'hostname: url.hostname,',
  'port: url.port,',
  'path: `${url.pathname}${url.search}`,',
  "method: 'GET',",
  'headers,',
  'timeout,',
  '};',
  'const request = http.request(options, (response) => {',
  'response.resume();',
  'response.on("end", () => {',
  'process.exit(response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1);',
  '});',
  '});',
  'request.on("timeout", () => { request.destroy(new Error("readiness timeout")); });',
  'request.on("error", () => { process.exit(1); });',
  'request.end();',
].join(' ');

export async function waitForHealthyRuntimeFromDockerNetwork(input: DockerNetworkRuntimeReadinessInput): Promise<void> {
  const deadline: number = Date.now() + input.readiness.timeoutMs;
  await requireDockerImageAvailable({ imageRef: input.probeImageRef });

  while (Date.now() <= deadline) {
    if (await canReachRuntimeFromDockerNetwork(input, deadline)) {
      return;
    }

    await waitForDockerNetworkReadinessPoll();
  }

  throw new Error(
    `Container on port ${input.port.toString()} did not become healthy before ${input.readiness.timeoutMs}ms.`,
  );
}

async function canReachRuntimeFromDockerNetwork(
  input: DockerNetworkRuntimeReadinessInput,
  deadline: number,
): Promise<boolean> {
  try {
    await runDockerContainerToCompletion(buildDockerNetworkReadinessProbeContainerInput(input, deadline));
    return true;
  } catch (error) {
    if (isDockerNetworkIpamCapacityError(error as DockerEngineError)) {
      const detail: string = readDockerEngineErrorMessage(error as DockerEngineError);
      throw createRuntimeNetworkIpCapacityExhaustedError(
        detail === '' ? 'Docker Engine could not allocate a runtime network IP address.' : detail,
      );
    }
    return false;
  }
}

function buildDockerNetworkReadinessProbeContainerInput(
  input: DockerNetworkRuntimeReadinessInput,
  deadline: number,
): DockerRunContainerInput {
  return {
    command: buildDockerNetworkReadinessProbeCommand(),
    containerName: buildDockerNetworkReadinessProbeContainerName(input.dockerNamespace),
    env: buildDockerNetworkReadinessProbeEnv(input, deadline),
    imageRef: input.probeImageRef,
    labels: {
      ...buildDockerNamespaceLabels(input.dockerNamespace),
      'compartment.operation': 'runtime-readiness-probe',
    },
    network: {
      name: input.networkName,
    },
    securityProfile: {
      name: 'restricted-readonly',
      tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=16m'],
      user: 'node',
    },
  };
}

function buildDockerNetworkReadinessProbeCommand(): string[] {
  return ['node', '-e', dockerNetworkReadinessProbeScript];
}

function buildDockerNetworkReadinessProbeEnv(
  input: DockerNetworkRuntimeReadinessInput,
  deadline: number,
): Record<string, string> {
  return {
    COMPARTMENT_READINESS_HOST_HEADER: readDockerNetworkReadinessProbeHostHeader(input),
    COMPARTMENT_READINESS_TIMEOUT_MS: readDockerNetworkReadinessProbeTimeoutMs(deadline).toString(),
    COMPARTMENT_READINESS_URL: readDockerNetworkReadinessProbeUrl(input),
  };
}

function readDockerNetworkReadinessProbeHostHeader(input: DockerNetworkRuntimeReadinessInput): string {
  return input.hostHeader === undefined ? '' : `${input.hostHeader}:${input.port.toString()}`;
}

function readDockerNetworkReadinessProbeUrl(input: DockerNetworkRuntimeReadinessInput): string {
  return `http://${input.host}:${input.port.toString()}${toHttpReadinessPath(input.readiness.path)}`;
}

function readDockerNetworkReadinessProbeTimeoutMs(deadline: number): number {
  const remainingSeconds: number = Math.ceil(Math.max(1, deadline - Date.now()) / 1000);
  return Math.min(maxDockerNetworkReadinessProbeTimeoutSeconds, remainingSeconds) * 1000;
}

function buildDockerNetworkReadinessProbeContainerName(dockerNamespace: string): string {
  return `compartment-${dockerNamespace}-readiness-${randomUUID()}`;
}

function toHttpReadinessPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

async function waitForDockerNetworkReadinessPoll(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, dockerNetworkReadinessPollIntervalMs);
  });
}
