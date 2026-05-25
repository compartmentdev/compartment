import { isAbsolute, resolve } from 'node:path';

export interface PendingSystemDomainCertificatePaths {
  certificatePath: string;
  privateKeyPath: string;
}

export function buildPendingSystemDomainCertificatePaths(
  customTlsDirectory: string,
  operationId: string,
): PendingSystemDomainCertificatePaths {
  const tlsDirectory: string = readRequiredAbsoluteCustomTlsDirectory(customTlsDirectory);
  const pendingOperationId: string = readRequiredPendingOperationId(operationId);

  return {
    certificatePath: resolve(tlsDirectory, pendingOperationId, 'fullchain.pem'),
    privateKeyPath: resolve(tlsDirectory, pendingOperationId, 'privkey.pem'),
  };
}

function readRequiredAbsoluteCustomTlsDirectory(customTlsDirectory: string): string {
  if (isAbsolute(customTlsDirectory)) {
    return customTlsDirectory;
  }

  throw new Error('COMPARTMENT_CUSTOM_TLS_DIR must be an absolute path.');
}

function readRequiredPendingOperationId(operationId: string): string {
  if (
    operationId !== '' &&
    operationId !== '.' &&
    operationId !== '..' &&
    !isAbsolute(operationId) &&
    !operationId.includes('/') &&
    !operationId.includes('\\')
  ) {
    return operationId;
  }

  throw new Error('The pending system-domain operation id must be a single safe path segment.');
}
