import {
  assertValidUnixSocketPath,
  prepareUnixSocketPath,
  restrictUnixSocketPathPermissions,
  type UnixSocketPathPolicy,
} from '@compartment/utils';
import { resolve } from 'node:path';

const systemApiTemporaryExamplePath: string = resolve('/', 'tmp', 'compartment', 'dev', 'api', 'system-api.sock');
const systemApiRuntimeExamplePath: string = resolve('/', 'var', 'run', 'compartment', 'api', 'system-api.sock');

const systemApiSocketPolicy: UnixSocketPathPolicy = {
  directoryLabel: 'System API socket directory',
  directoryMode: 0o700,
  privatePathExample: `${systemApiTemporaryExamplePath} or ${systemApiRuntimeExamplePath}`,
  socketMode: 0o600,
  variableName: 'COMPARTMENT_SYSTEM_API_SOCKET',
};

export function prepareSystemApiSocketPath(socketPath: string): void {
  prepareUnixSocketPath(socketPath, systemApiSocketPolicy);
}

export function restrictSystemApiSocketPathPermissions(socketPath: string): void {
  restrictUnixSocketPathPermissions(socketPath, systemApiSocketPolicy);
}

export function assertValidSystemApiSocketPath(
  socketPath: string,
  variableName: string = 'COMPARTMENT_SYSTEM_API_SOCKET',
): void {
  assertValidUnixSocketPath(socketPath, {
    ...systemApiSocketPolicy,
    variableName,
  });
}
