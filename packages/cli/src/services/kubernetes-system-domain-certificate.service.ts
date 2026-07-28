import { createPrivateKey, createPublicKey, X509Certificate, type KeyObject } from 'node:crypto';
import {
  buildRequiredDomainCertificateDnsNames,
  domainCertificateMetadataCoversHostPlan,
  type DomainCertificateMetadata,
  type DomainHostPlan,
} from '@compartment/contracts';

const certificateBlockPattern: RegExp = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;
const subjectAltNameDnsPattern: RegExp = /DNS:([^,\n]+)/gu;

export function validateKubernetesSystemDomainCertificate(
  certificateText: string,
  privateKeyText: string,
  hostPlan: DomainHostPlan,
): DomainCertificateMetadata {
  const certificates: X509Certificate[] = readCertificateChain(certificateText);
  const leafCertificate: X509Certificate = certificates[0]!;
  assertPrivateKeyMatchesCertificate(privateKeyText, leafCertificate);
  assertCertificateIsCurrentlyValid(leafCertificate);
  const metadata: DomainCertificateMetadata = {
    dnsNames: readCertificateDnsNames(leafCertificate),
    expiresAt: readCertificateDate(leafCertificate.validTo, 'validTo'),
    fingerprintSha256: leafCertificate.fingerprint256,
    issuedAt: readCertificateDate(leafCertificate.validFrom, 'validFrom'),
    issuer: leafCertificate.issuer,
    serialNumber: leafCertificate.serialNumber,
    subject: leafCertificate.subject,
  };
  if (!domainCertificateMetadataCoversHostPlan(metadata, hostPlan)) {
    throw new Error(
      `The staged certificate must cover ${buildRequiredDomainCertificateDnsNames(hostPlan).join(' and ')}.`,
    );
  }
  return metadata;
}

function readCertificateChain(certificateText: string): X509Certificate[] {
  const certificateBlocks: string[] = certificateText.match(certificateBlockPattern) ?? [];
  if (certificateBlocks.length === 0) {
    throw new Error('The certificate file must contain at least one PEM certificate.');
  }
  try {
    return certificateBlocks.map((block: string): X509Certificate => new X509Certificate(block));
  } catch {
    throw new Error('The certificate file must contain valid PEM certificates.');
  }
}

function assertPrivateKeyMatchesCertificate(privateKeyText: string, certificate: X509Certificate): void {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(privateKeyText);
  } catch {
    throw new Error('The private-key file must contain a valid PEM private key.');
  }
  const privatePublicKey: Buffer = exportPublicKey(createPublicKey(privateKey));
  if (!privatePublicKey.equals(exportPublicKey(certificate.publicKey))) {
    throw new Error('The private key does not match the certificate public key.');
  }
}

function exportPublicKey(key: KeyObject): Buffer {
  return key.export({ format: 'der', type: 'spki' });
}

function assertCertificateIsCurrentlyValid(certificate: X509Certificate): void {
  const now: number = Date.now();
  if (readCertificateTime(certificate.validFrom, 'validFrom') > now) {
    throw new Error('The certificate is not valid yet.');
  }
  if (readCertificateTime(certificate.validTo, 'validTo') <= now) {
    throw new Error('The certificate has expired.');
  }
}

function readCertificateDnsNames(certificate: X509Certificate): string[] {
  const dnsNames: string[] = [...(certificate.subjectAltName?.matchAll(subjectAltNameDnsPattern) ?? [])]
    .map((match: RegExpMatchArray): string => match[1] ?? '')
    .map((value: string): string => value.trim().replace(/\.$/u, '').toLowerCase())
    .filter((value: string): boolean => value !== '');
  if (dnsNames.length === 0) {
    throw new Error('The certificate must include DNS subject alternative names.');
  }
  return dnsNames;
}

function readCertificateDate(value: string, fieldName: string): string {
  return new Date(readCertificateTime(value, fieldName)).toISOString();
}

function readCertificateTime(value: string, fieldName: string): number {
  const time: number = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new Error(`The certificate ${fieldName} date is invalid.`);
  }
  return time;
}
