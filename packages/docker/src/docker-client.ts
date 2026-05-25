import Docker from 'dockerode';
import { runDockerCommand } from './docker-command';
import type { DockerCommandResult } from './docker-command.types';

interface DockerClientEnvOverrides {
  dockerHost: string;
}

interface DockerContextInspectResult {
  Endpoints: {
    docker: DockerContextInspectDockerEndpoint;
  };
}

interface DockerContextInspectDockerEndpoint {
  Host?: string | null | undefined;
}

export async function createDockerClient(): Promise<Docker> {
  const configuredHost: string | undefined = readDockerHostFromEnv();
  if (configuredHost !== undefined) {
    return createDockerClientForHost(configuredHost);
  }

  const context: DockerContextInspectResult = await readDockerContextInspectResult();
  return createDockerClientFromContext(context);
}

async function readDockerContextInspectResult(): Promise<DockerContextInspectResult> {
  const output: DockerCommandResult = await runDockerCommand(['context', 'inspect', '--format', '{{ json . }}']);
  const rawContext: string = output.stdout.trim();
  if (!hasText(rawContext)) {
    throw new Error('Docker context inspect returned an empty payload.');
  }

  return JSON.parse(rawContext) as DockerContextInspectResult;
}

function createDockerClientFromContext(context: DockerContextInspectResult): Docker {
  const dockerHost: string = readDockerContextHost(context);
  return createDockerClientForHost(dockerHost);
}

function readDockerContextHost(context: DockerContextInspectResult): string {
  const host: string | null | undefined = context.Endpoints.docker.Host;
  if (!hasText(host)) {
    throw new Error('Docker context did not expose a daemon host.');
  }

  return requireLocalDockerHost(host, 'docker context');
}

function readDockerHostFromEnv(): string | undefined {
  if (!hasText(process.env.DOCKER_HOST)) {
    return undefined;
  }

  return requireLocalDockerHost(process.env.DOCKER_HOST, 'DOCKER_HOST');
}

export function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

function createDockerClientForHost(dockerHost: string): Docker {
  return withDockerClientEnv({ dockerHost }, (): Docker => new Docker());
}

function requireLocalDockerHost(host: string, source: string): string {
  if (host.startsWith('unix://') || host.startsWith('npipe://')) {
    return host;
  }

  throw new Error(
    `Unsupported Docker host "${host}" from ${source}. Compartment requires a local Docker socket on the same machine.`,
  );
}

function withDockerClientEnv<T>(overrides: DockerClientEnvOverrides, createClient: () => T): T {
  const previousDockerHost: string | undefined = process.env.DOCKER_HOST;
  const previousDockerCertPath: string | undefined = process.env.DOCKER_CERT_PATH;
  const previousDockerTlsVerify: string | undefined = process.env.DOCKER_TLS_VERIFY;

  process.env.DOCKER_HOST = overrides.dockerHost;
  delete process.env.DOCKER_CERT_PATH;
  delete process.env.DOCKER_TLS_VERIFY;

  try {
    return createClient();
  } finally {
    restoreDockerClientEnv(previousDockerHost, previousDockerCertPath, previousDockerTlsVerify);
  }
}

function restoreDockerClientEnv(
  previousDockerHost: string | undefined,
  previousDockerCertPath: string | undefined,
  previousDockerTlsVerify: string | undefined,
): void {
  if (previousDockerHost === undefined) {
    delete process.env.DOCKER_HOST;
  } else {
    process.env.DOCKER_HOST = previousDockerHost;
  }

  if (previousDockerCertPath === undefined) {
    delete process.env.DOCKER_CERT_PATH;
  } else {
    process.env.DOCKER_CERT_PATH = previousDockerCertPath;
  }

  if (previousDockerTlsVerify === undefined) {
    delete process.env.DOCKER_TLS_VERIFY;
  } else {
    process.env.DOCKER_TLS_VERIFY = previousDockerTlsVerify;
  }
}
