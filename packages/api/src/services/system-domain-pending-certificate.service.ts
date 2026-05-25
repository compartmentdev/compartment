import { createPrivateKey, createPublicKey, X509Certificate, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  buildRequiredDomainCertificateDnsNames,
  domainCertificateMetadataCoversHostPlan,
  type DomainCertificateMetadata,
  type DomainHostPlan,
  type SystemDomainCertificate,
} from '@compartment/contracts';
import {
  buildPendingSystemDomainCertificatePaths as buildPendingSystemDomainCertificatePathsForDirectory,
  isMissingFileSystemEntryError,
  type PendingSystemDomainCertificatePaths,
} from '@compartment/utils';
import { getApiConfig } from '../runtime/runtime-access';

const certificateBlockPattern: RegExp = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;
const subjectAltNameDnsPattern: RegExp = /DNS:([^,\n]+)/gu;

export async function readPendingSystemDomainCertificate(
  operationId: string,
  hostPlan: DomainHostPlan,
): Promise<SystemDomainCertificate> {
  const paths: PendingSystemDomainCertificatePaths = buildPendingSystemDomainCertificatePathsForOperation(operationId);
  const certificateText: string = await readPendingCertificateFile(paths.certificatePath);
  const privateKeyText: string = await readPendingPrivateKeyFile(paths.privateKeyPath);
  const metadata: DomainCertificateMetadata = readCertificateMetadata(certificateText, privateKeyText);

  assertCertificateCoversHostPlan(metadata, hostPlan);
  return {
    certificatePath: paths.certificatePath,
    metadata,
    privateKeyPath: paths.privateKeyPath,
  };
}

function buildPendingSystemDomainCertificatePathsForOperation(
  operationId: string,
): PendingSystemDomainCertificatePaths {
  return buildPendingSystemDomainCertificatePathsForDirectory(getApiConfig().customTlsDirectory, operationId);
}

async function readPendingCertificateFile(certificatePath: string): Promise<string> {
  return await readPendingFile(
    certificatePath,
    'The staged certificate file is missing. Re-run attach-cert before retrying.',
    'The staged certificate file could not be read. Re-run attach-cert before retrying.',
  );
}

async function readPendingPrivateKeyFile(privateKeyPath: string): Promise<string> {
  return await readPendingFile(
    privateKeyPath,
    'The staged private key file is missing. Re-run attach-cert before retrying.',
    'The staged private key file could not be read. Re-run attach-cert before retrying.',
  );
}

async function readPendingFile(filePath: string, missingMessage: string, unreadableMessage: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      throw new Error(missingMessage);
    }

    throw new Error(unreadableMessage);
  }
}

function readCertificateMetadata(certificateText: string, privateKeyText: string): DomainCertificateMetadata {
  const certificates: X509Certificate[] = readCertificateChain(certificateText);
  const leafCertificate: X509Certificate = certificates[0]!;

  assertPrivateKeyMatchesCertificate(privateKeyText, leafCertificate);
  assertCertificateIsCurrentlyValid(leafCertificate);
  return {
    dnsNames: readCertificateDnsNames(leafCertificate),
    expiresAt: readCertificateDate(leafCertificate.validTo, 'validTo'),
    fingerprintSha256: leafCertificate.fingerprint256,
    issuedAt: readCertificateDate(leafCertificate.validFrom, 'validFrom'),
    issuer: leafCertificate.issuer,
    serialNumber: leafCertificate.serialNumber,
    subject: leafCertificate.subject,
  };
}

function readCertificateChain(certificateText: string): X509Certificate[] {
  const certificateBlocks: string[] = certificateText.match(certificateBlockPattern) ?? [];
  if (certificateBlocks.length === 0) {
    throw new Error('The staged certificate file must contain at least one PEM certificate.');
  }

  try {
    return certificateBlocks.map((certificateBlock: string): X509Certificate => new X509Certificate(certificateBlock));
  } catch {
    throw new Error('The staged certificate file must contain valid PEM certificates.');
  }
}

function assertPrivateKeyMatchesCertificate(privateKeyText: string, certificate: X509Certificate): void {
  const privateKey: KeyObject = readPrivateKey(privateKeyText);
  const publicKeyFromPrivateKey: Buffer = exportSpkiPublicKey(createPublicKey(privateKey));
  const publicKeyFromCertificate: Buffer = exportSpkiPublicKey(certificate.publicKey);

  if (!publicKeyFromPrivateKey.equals(publicKeyFromCertificate)) {
    throw new Error('The staged private key does not match the certificate public key.');
  }
}

function readPrivateKey(privateKeyText: string): KeyObject {
  try {
    return createPrivateKey(privateKeyText);
  } catch {
    throw new Error('The staged private key file must contain a valid PEM private key.');
  }
}

function assertCertificateIsCurrentlyValid(certificate: X509Certificate): void {
  const nowTime: number = Date.now();
  const validFromTime: number = readCertificateTime(certificate.validFrom, 'validFrom');
  const validToTime: number = readCertificateTime(certificate.validTo, 'validTo');

  if (validFromTime > nowTime) {
    throw new Error('The staged certificate is not valid yet.');
  }
  if (validToTime <= nowTime) {
    throw new Error('The staged certificate has expired.');
  }
}

function assertCertificateCoversHostPlan(metadata: DomainCertificateMetadata, hostPlan: DomainHostPlan): void {
  if (domainCertificateMetadataCoversHostPlan(metadata, hostPlan)) {
    return;
  }

  throw new Error(
    `The staged certificate must cover ${buildRequiredDomainCertificateDnsNames(hostPlan).join(' and ')}.`,
  );
}

function readCertificateDnsNames(certificate: X509Certificate): string[] {
  const subjectAltName: string | undefined = certificate.subjectAltName;
  const dnsNames: string[] = [...(subjectAltName?.matchAll(subjectAltNameDnsPattern) ?? [])]
    .map((match: RegExpMatchArray): string => readRequiredMatchValue(match))
    .map(normalizeCertificateDnsName);

  if (dnsNames.length === 0) {
    throw new Error('The staged certificate must include DNS subject alternative names.');
  }

  return dnsNames;
}

function readRequiredMatchValue(match: RegExpMatchArray): string {
  const value: string | undefined = match[1];
  if (value === undefined) {
    throw new Error('The staged certificate SAN entry is malformed.');
  }

  return value;
}

function normalizeCertificateDnsName(value: string): string {
  return value.trim().replace(/\.$/u, '').toLowerCase();
}

function readCertificateDate(value: string, fieldName: string): string {
  return new Date(readCertificateTime(value, fieldName)).toISOString();
}

function readCertificateTime(value: string, fieldName: string): number {
  const time: number = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new Error(`The staged certificate ${fieldName} date is invalid.`);
  }

  return time;
}

function exportSpkiPublicKey(key: KeyObject): Buffer {
  const value: string | Buffer = key.export({ format: 'pem', type: 'spki' });

  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
