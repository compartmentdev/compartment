import { createServer, type Server } from 'node:net';
import type { DockerExecutionContext } from './docker-runtime.types';
import { isInstallPublicPortOccupied } from './install-public-port-occupancy';

interface InstallPublicPortPreflightInput {
  dockerContext: DockerExecutionContext;
  publicHttpPort: number;
  publicHttpsPort: number;
}

export type InstallPublicPortLabel = 'Public HTTP port' | 'Public HTTPS port';
type InstallPublicPortOptionName = '--public-http-port' | '--public-https-port';

interface InstallPublicPortSpec {
  label: InstallPublicPortLabel;
  optionName: InstallPublicPortOptionName;
  port: number;
}

export class InstallPublicPortOccupiedError extends Error {
  readonly label: InstallPublicPortLabel;
  readonly optionName: InstallPublicPortOptionName;
  readonly port: number;

  constructor(portSpec: InstallPublicPortSpec) {
    super(
      `${portSpec.label} ${portSpec.port} is already in use on this host. Choose a different ${portSpec.optionName}.`,
    );
    this.name = 'InstallPublicPortOccupiedError';
    this.label = portSpec.label;
    this.optionName = portSpec.optionName;
    this.port = portSpec.port;
  }
}

interface InstallPublicPortBindTarget {
  host: '0.0.0.0' | '::';
  ipv6Only?: boolean | undefined;
}

interface PortBindError extends Error {
  code?: string | undefined;
}

const privilegedPortUpperBoundExclusive: number = 1024;
const installPublicPortFailureCauses: Readonly<Record<string, string>> = {
  EACCES: 'permission denied',
  EADDRNOTAVAIL: 'address is not available',
  EAFNOSUPPORT: 'address family is not supported',
  EAGAIN: 'resource temporarily unavailable',
  EPERM: 'operation not permitted',
  EPROTONOSUPPORT: 'protocol is not supported',
};

export async function assertInstallPublicPortsAvailable(input: InstallPublicPortPreflightInput): Promise<void> {
  assertDistinctPublicPorts(input.publicHttpPort, input.publicHttpsPort);

  for (const portSpec of readInstallPublicPortSpecs(input)) {
    await assertInstallPublicPortAvailable(portSpec, input.dockerContext);
  }
}

function assertDistinctPublicPorts(publicHttpPort: number, publicHttpsPort: number): void {
  if (publicHttpPort !== publicHttpsPort) {
    return;
  }

  throw new Error(formatInstallPublicPortConflictMessage(publicHttpPort, publicHttpsPort));
}

export function formatInstallPublicPortConflictMessage(publicHttpPort: number, publicHttpsPort: number): string {
  return `Public HTTP port ${publicHttpPort} conflicts with public HTTPS port ${publicHttpsPort}. Choose different --public-http-port and --public-https-port values.`;
}

function readInstallPublicPortSpecs(input: InstallPublicPortPreflightInput): InstallPublicPortSpec[] {
  return [
    {
      label: 'Public HTTP port',
      optionName: '--public-http-port',
      port: input.publicHttpPort,
    },
    {
      label: 'Public HTTPS port',
      optionName: '--public-https-port',
      port: input.publicHttpsPort,
    },
  ];
}

async function assertInstallPublicPortAvailable(
  portSpec: InstallPublicPortSpec,
  dockerContext: DockerExecutionContext,
): Promise<void> {
  for (const bindTarget of readInstallPublicPortBindTargets()) {
    const bindError: PortBindError | undefined = await readInstallPublicPortBindError(
      portSpec.port,
      bindTarget,
      dockerContext,
    );
    if (bindError !== undefined) {
      throw createInstallPublicPortBindError(portSpec, bindError);
    }
  }
}

function readInstallPublicPortBindTargets(): readonly InstallPublicPortBindTarget[] {
  return [
    {
      host: '0.0.0.0',
    },
    {
      host: '::',
      ipv6Only: true,
    },
  ];
}

async function readInstallPublicPortBindError(
  port: number,
  bindTarget: InstallPublicPortBindTarget,
  dockerContext: DockerExecutionContext,
): Promise<PortBindError | undefined> {
  try {
    await bindInstallPublicPort(port, bindTarget);
    return undefined;
  } catch (error) {
    const bindError: PortBindError = error instanceof Error ? error : new Error('Unexpected bind error.');
    if (shouldIgnoreUnsupportedIpv6Bind(bindError, bindTarget)) {
      return undefined;
    }

    return await resolveInstallPublicPortBindError(bindError, port, dockerContext);
  }
}

function shouldIgnoreUnsupportedIpv6Bind(bindError: PortBindError, bindTarget: InstallPublicPortBindTarget): boolean {
  return (
    bindTarget.host === '::' &&
    (bindError.code === 'EADDRNOTAVAIL' || bindError.code === 'EAFNOSUPPORT' || bindError.code === 'EPROTONOSUPPORT')
  );
}

async function bindInstallPublicPort(port: number, bindTarget: InstallPublicPortBindTarget): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    const server: Server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: bindTarget.host, ipv6Only: bindTarget.ipv6Only, port }, (): void => {
      server.close((error?: Error): void => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });
}

async function resolveInstallPublicPortBindError(
  bindError: PortBindError,
  port: number,
  dockerContext: DockerExecutionContext,
): Promise<PortBindError | undefined> {
  if (isIgnoredRootfulPrivilegedPortPermissionError(bindError, port, dockerContext)) {
    return (await isInstallPublicPortOccupied(port)) ? createPortBindError('EADDRINUSE', bindError.message) : undefined;
  }

  return bindError;
}

function isIgnoredRootfulPrivilegedPortPermissionError(
  bindError: PortBindError,
  port: number,
  dockerContext: DockerExecutionContext,
): boolean {
  return dockerContext.isRootlessDocker !== true && isPrivilegedPortPermissionError(bindError, port);
}

function isPrivilegedPortPermissionError(bindError: PortBindError, port: number): boolean {
  return port < privilegedPortUpperBoundExclusive && (bindError.code === 'EACCES' || bindError.code === 'EPERM');
}

function createPortBindError(code: string, message: string): PortBindError {
  const bindError: PortBindError = new Error(message);
  bindError.code = code;
  return bindError;
}

function createInstallPublicPortBindError(portSpec: InstallPublicPortSpec, bindError: PortBindError): Error {
  if (bindError.code === 'EADDRINUSE') {
    return new InstallPublicPortOccupiedError(portSpec);
  }

  return new Error(
    `${portSpec.label} ${portSpec.port} cannot be used on this host. Choose a different ${portSpec.optionName}. Cause: ${readInstallPublicPortFailureCause(bindError)}.`,
  );
}

function readInstallPublicPortFailureCause(bindError: PortBindError): string {
  const knownCause: string | undefined = readKnownInstallPublicPortFailureCause(bindError.code);
  if (knownCause !== undefined) {
    return knownCause;
  }

  return readUnknownInstallPublicPortFailureCause(bindError);
}

function readKnownInstallPublicPortFailureCause(code: string | undefined): string | undefined {
  return code === undefined ? undefined : installPublicPortFailureCauses[code];
}

function readUnknownInstallPublicPortFailureCause(bindError: PortBindError): string {
  const message: string = bindError.message
    .trim()
    .replace(/^listen\s+[A-Z0-9_]+:\s*/u, '')
    .replace(/\s+(0\.0\.0\.0|\[::\]):\d+\s*$/u, '');

  return message === '' ? 'unexpected bind error' : message;
}
