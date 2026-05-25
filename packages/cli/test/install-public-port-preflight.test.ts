import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import type * as NodeNet from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findFreePort } from '@compartment/test-support';
import type { DockerExecutionContext } from '../src/docker-runtime.types';
import { findDistinctFreePorts, findFreePortExcluding, type DistinctFreePorts } from './public-port-test-support';

type AssertInstallPublicPortsAvailable = (input: {
  dockerContext: DockerExecutionContext;
  publicHttpPort: number;
  publicHttpsPort: number;
}) => Promise<void>;

interface InstallPublicPortPreflightModule {
  assertInstallPublicPortsAvailable: AssertInstallPublicPortsAvailable;
}

type ErrorServerClose = (callback?: ErrorServerCloseCallback) => Server;
type ErrorServerCloseCallback = (error?: Error) => void;
type ErrorConnectionDestroy = () => Socket;
interface ErrorConnectionOptions {
  host?: string | undefined;
  port?: number | undefined;
}
type ErrorConnectionSetTimeout = (timeout: number) => Socket;
type ErrorConnectionShouldSucceed = (options: ErrorConnectionOptions) => boolean;
type ErrorConnectionUnref = () => Socket;
type ErrorServerListen = (options: ErrorServerListenOptions, callback?: ErrorServerListenCallback) => Server;
type ErrorServerListenCallback = () => void;
type ErrorServerListenShouldFail = (options: ErrorServerListenOptions) => boolean;
interface ErrorServerListenOptions {
  host?: string | undefined;
  ipv6Only?: boolean | undefined;
  port?: number | undefined;
}
type ErrorServerUnref = () => Server;

describe.sequential('install public port preflight', (): void => {
  const occupiedServers: Server[] = [];

  beforeEach((): void => {
    vi.resetModules();
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('node:net');
    await Promise.all(occupiedServers.splice(0).map(closeServer));
  });

  it('passes silently for free public ports', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModule();
    const [publicHttpPort, publicHttpsPort]: DistinctFreePorts = await findDistinctFreePorts();

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort,
        publicHttpsPort,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails when the public ports are configured to the same value', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModule();
    const sharedPort: number = await findFreePort();

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort: sharedPort,
        publicHttpsPort: sharedPort,
      }),
    ).rejects.toThrow(
      `Public HTTP port ${sharedPort} conflicts with public HTTPS port ${sharedPort}. Choose different --public-http-port and --public-https-port values.`,
    );
  });

  it('fails with the HTTP-specific conflict message when the public HTTP port is already occupied', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModule();
    const busyHttpPort: number = await findFreePort();
    const publicHttpsPort: number = await findFreePortExcluding([busyHttpPort]);
    occupiedServers.push(await occupyPort(busyHttpPort));

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort: busyHttpPort,
        publicHttpsPort,
      }),
    ).rejects.toThrow(
      `Public HTTP port ${busyHttpPort} is already in use on this host. Choose a different --public-http-port.`,
    );
  });

  it('fails with the HTTPS-specific conflict message when the public HTTPS port is already occupied', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModule();
    const busyHttpsPort: number = await findFreePort();
    const publicHttpPort: number = await findFreePortExcluding([busyHttpsPort]);
    occupiedServers.push(await occupyPort(busyHttpsPort));

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort,
        publicHttpsPort: busyHttpsPort,
      }),
    ).rejects.toThrow(
      `Public HTTPS port ${busyHttpsPort} is already in use on this host. Choose a different --public-https-port.`,
    );
  });

  it('fails on rootless Docker when a privileged public port requires extra permissions', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModuleWithBindError('EACCES');

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(true),
        publicHttpPort: 80,
        publicHttpsPort: 443,
      }),
    ).rejects.toThrow(
      'Public HTTP port 80 cannot be used on this host. Choose a different --public-http-port. Cause: permission denied.',
    );
  });

  it('keeps privileged public ports valid for rootful Docker installs', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModuleWithBindError('EACCES');

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort: 80,
        publicHttpsPort: 443,
      }),
    ).resolves.toBeUndefined();
  });

  it('still reports an occupied privileged public port for rootful Docker installs', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModuleWithBindError(
      'EACCES',
      (): boolean => true,
      (options: ErrorConnectionOptions): boolean => options.port === 80 && options.host === '127.0.0.1',
    );

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort: 80,
        publicHttpsPort: 443,
      }),
    ).rejects.toThrow('Public HTTP port 80 is already in use on this host. Choose a different --public-http-port.');
  });

  it('still fails on permission errors for unprivileged public ports', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModuleWithBindError('EACCES');

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort: 8080,
        publicHttpsPort: 8443,
      }),
    ).rejects.toThrow(
      'Public HTTP port 8080 cannot be used on this host. Choose a different --public-http-port. Cause: permission denied.',
    );
  });

  it('fails when the public HTTP port is blocked on the IPv6 wildcard interface', async (): Promise<void> => {
    const { assertInstallPublicPortsAvailable } = await loadInstallPublicPortPreflightModuleWithBindError(
      'EADDRINUSE',
      (options: ErrorServerListenOptions): boolean => options.host === '::',
    );

    await expect(
      assertInstallPublicPortsAvailable({
        dockerContext: createDockerExecutionContext(false),
        publicHttpPort: 8080,
        publicHttpsPort: 8443,
      }),
    ).rejects.toThrow('Public HTTP port 8080 is already in use on this host. Choose a different --public-http-port.');
  });
});

async function loadInstallPublicPortPreflightModule(): Promise<InstallPublicPortPreflightModule> {
  const module: InstallPublicPortPreflightModule = await import('../src/install-public-port-preflight');
  return module;
}

async function loadInstallPublicPortPreflightModuleWithBindError(
  code: string,
  shouldFail: ErrorServerListenShouldFail = (): boolean => true,
  shouldConnect: ErrorConnectionShouldSucceed = (): boolean => false,
): Promise<InstallPublicPortPreflightModule> {
  vi.doMock('node:net', async (importOriginal: () => Promise<typeof NodeNet>): Promise<typeof NodeNet> => {
    const actualModule: typeof NodeNet = await importOriginal();

    return {
      ...actualModule,
      createConnection: ((options: ErrorConnectionOptions): Socket =>
        createErrorConnection(options, shouldConnect)) as typeof NodeNet.createConnection,
      createServer: (): Server => createErrorServer(code, shouldFail),
    };
  });

  return await loadInstallPublicPortPreflightModule();
}

function createDockerExecutionContext(isRootlessDocker: boolean): DockerExecutionContext {
  return {
    dockerCommand: ['docker'],
    isRootlessDocker,
    mode: 'direct',
  };
}

function createErrorServer(code: string, shouldFail: ErrorServerListenShouldFail = (): boolean => true): Server {
  const server: Server = createServer();
  const bindError: Error & {
    code?: string | undefined;
  } = new Error(`listen ${code}: mocked bind failure`);
  bindError.code = code;

  const listen: ErrorServerListen = (
    options: ErrorServerListenOptions,
    callback?: ErrorServerListenCallback,
  ): Server => {
    queueMicrotask((): void => {
      if (shouldFail(options)) {
        server.emit('error', bindError);
        return;
      }

      callback?.();
    });
    return server;
  };
  const close: ErrorServerClose = (callback?: ErrorServerCloseCallback): Server => {
    callback?.();
    return server;
  };
  const unref: ErrorServerUnref = (): Server => server;

  Object.assign(server, { close, listen, unref });

  return server;
}

function createErrorConnection(
  options: ErrorConnectionOptions,
  shouldConnect: ErrorConnectionShouldSucceed = (): boolean => false,
): Socket {
  const socket: Socket = new EventEmitter() as Socket;
  const destroy: ErrorConnectionDestroy = (): Socket => socket;
  const setTimeout: ErrorConnectionSetTimeout = (): Socket => socket;
  const unref: ErrorConnectionUnref = (): Socket => socket;

  Object.assign(socket, { destroy, setTimeout, unref });

  queueMicrotask((): void => {
    if (shouldConnect(options)) {
      socket.emit('connect');
      return;
    }

    socket.emit('error', new Error('mocked connection failure'));
  });

  return socket;
}

async function occupyPort(port: number): Promise<Server> {
  return await new Promise<Server>((resolve: (server: Server) => void, reject: (error: Error) => void): void => {
    const server: Server = createServer();
    server.once('error', reject);
    server.listen(port, '0.0.0.0', (): void => {
      resolve(server);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
