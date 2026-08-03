import { isValidEmailAddress } from '@compartment/utils';

const reservedAcmeDomains: readonly string[] = ['example.com', 'example.net', 'example.org', 'invalid', 'localhost'];
const emailLocalPartPattern: RegExp = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/u;
const emailDomainLabelPattern: RegExp = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;

export function assertKubernetesInstallAcmeEmail(email: string): void {
  if (!isValidEmailAddress(email) || !hasValidEmailStructure(email)) {
    throw new Error('Admin email must be a valid email address.');
  }
  const domain: string = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (reservedAcmeDomains.some((reserved: string): boolean => domain === reserved || domain.endsWith(`.${reserved}`))) {
    throw new Error(`Admin email domain "${domain}" is reserved and is rejected by public ACME providers.`);
  }
}

function hasValidEmailStructure(email: string): boolean {
  const [localPart = '', domain = ''] = email.split('@');
  return (
    email.length <= 254 &&
    localPart.length <= 64 &&
    emailLocalPartPattern.test(localPart) &&
    domain.split('.').every((label: string): boolean => emailDomainLabelPattern.test(label))
  );
}
