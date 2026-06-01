import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { buildPendingSystemDomainCertificatePaths } from '@compartment/utils';
import { copySelfHostedPrivateFile } from './self-hosted-file-permissions';
import { readOptionalSelfHostedPathStats } from './self-hosted-path-stats';
import type { SelfHostedRuntimeIdentity } from './self-hosted-runtime-identity';
import type { SystemDomainRuntimeCertificateInput } from './system-domain.types';

const customTlsDirectoryMode: number = 0o750;
const customTlsFileMode: number = 0o640;

export interface StageSystemDomainCertificateInput {
  certificateFile: string;
  customTlsDirectory: string;
  operationId: string;
  privateKeyFile: string;
  reportProgress?: (message: string) => void;
  runtimeIdentity: SelfHostedRuntimeIdentity;
}

export interface StageSystemDomainCertificateResult {
  requestFingerprint: string;
}

export async function stageSystemDomainCertificate(
  input: StageSystemDomainCertificateInput,
): Promise<StageSystemDomainCertificateResult> {
  const stagedCertificatePaths: SystemDomainRuntimeCertificateInput = buildPendingSystemDomainCertificatePaths(
    input.customTlsDirectory,
    input.operationId,
  );
  const requestFingerprint: string = await readSystemDomainCertificateFingerprint(
    input.certificateFile,
    input.privateKeyFile,
  );

  input.reportProgress?.('Staging custom domain certificate...');
  await assertCustomTlsDirectoryNotRuntimeWritable(input.customTlsDirectory, input.runtimeIdentity);
  await copySelfHostedPrivateFile(input.certificateFile, stagedCertificatePaths.certificatePath, {
    directoryMode: customTlsDirectoryMode,
    fileMode: customTlsFileMode,
    owner: { uid: 0, gid: input.runtimeIdentity.gid },
  });
  await copySelfHostedPrivateFile(input.privateKeyFile, stagedCertificatePaths.privateKeyPath, {
    directoryMode: customTlsDirectoryMode,
    fileMode: customTlsFileMode,
    owner: { uid: 0, gid: input.runtimeIdentity.gid },
  });

  return { requestFingerprint };
}

async function assertCustomTlsDirectoryNotRuntimeWritable(
  customTlsDirectory: string,
  runtimeIdentity: SelfHostedRuntimeIdentity,
): Promise<void> {
  const stats: Stats | null = await readOptionalSelfHostedPathStats(customTlsDirectory);
  if (stats === null) {
    return;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Compartment custom TLS directory ${customTlsDirectory} must be a real directory.`);
  }
  if (stats.uid === runtimeIdentity.uid && (stats.mode & 0o200) !== 0) {
    throwRuntimeWritableTlsDirectoryError(customTlsDirectory);
  }
  if (stats.gid === runtimeIdentity.gid && (stats.mode & 0o020) !== 0) {
    throwRuntimeWritableTlsDirectoryError(customTlsDirectory);
  }
  if ((stats.mode & 0o002) !== 0) {
    throwRuntimeWritableTlsDirectoryError(customTlsDirectory);
  }
}

function throwRuntimeWritableTlsDirectoryError(customTlsDirectory: string): never {
  throw new Error(
    `Compartment custom TLS directory ${customTlsDirectory} is writable by the runtime identity. Run \`sudo compartment system restart\` before attaching a custom certificate.`,
  );
}

async function readSystemDomainCertificateFingerprint(
  certificateFile: string,
  privateKeyFile: string,
): Promise<string> {
  const certificateBytes: Buffer = await readFile(certificateFile);
  const privateKeyBytes: Buffer = await readFile(privateKeyFile);

  return createHash('sha256').update(certificateBytes).update('\0').update(privateKeyBytes).digest('hex').slice(0, 24);
}
