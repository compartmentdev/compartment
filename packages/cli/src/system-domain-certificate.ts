import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPendingSystemDomainCertificatePaths } from '@compartment/utils';
import { copySelfHostedPrivateFile } from './self-hosted-file-permissions';
import type { SystemDomainRuntimeCertificateInput } from './system-domain.types';

export interface StageSystemDomainCertificateInput {
  certificateFile: string;
  customTlsDirectory: string;
  operationId: string;
  privateKeyFile: string;
  reportProgress?: (message: string) => void;
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
  await copySelfHostedPrivateFile(input.certificateFile, stagedCertificatePaths.certificatePath);
  await copySelfHostedPrivateFile(input.privateKeyFile, stagedCertificatePaths.privateKeyPath);

  return { requestFingerprint };
}

async function readSystemDomainCertificateFingerprint(
  certificateFile: string,
  privateKeyFile: string,
): Promise<string> {
  const certificateBytes: Buffer = await readFile(certificateFile);
  const privateKeyBytes: Buffer = await readFile(privateKeyFile);

  return createHash('sha256').update(certificateBytes).update('\0').update(privateKeyBytes).digest('hex').slice(0, 24);
}
