import { hasText } from '@compartment/utils';

const commonEmailDomains: Set<string> = new Set<string>([
  'aol.com',
  'example.com',
  'fastmail.com',
  'gmail.com',
  'gmx.com',
  'gmx.de',
  'googlemail.com',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'mail.ru',
  'me.com',
  'msn.com',
  'outlook.com',
  'pm.me',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'yahoo.com',
  'yandex.ru',
]);

const compoundSuffixPrefixes: Set<string> = new Set<string>(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

export function deriveRegisterOrganizationName(email: string): string | undefined {
  const domain: string | undefined = readEmailDomain(email);
  if (domain === undefined || commonEmailDomains.has(domain)) {
    return undefined;
  }

  const domainLabel: string | undefined = pickOrganizationDomainLabel(domain);
  if (!hasText(domainLabel)) {
    return undefined;
  }

  return formatOrganizationName(domainLabel);
}

function readEmailDomain(email: string): string | undefined {
  const atIndex: number = email.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return undefined;
  }

  return email.slice(atIndex + 1).toLowerCase();
}

function pickOrganizationDomainLabel(domain: string): string | undefined {
  const domainParts: string[] = domain.split('.').filter(hasText);
  if (domainParts.length === 0) {
    return undefined;
  }

  const labelIndex: number = resolveOrganizationLabelIndex(domainParts);
  return domainParts[labelIndex];
}

function resolveOrganizationLabelIndex(domainParts: string[]): number {
  if (usesCompoundCountrySuffix(domainParts)) {
    return domainParts.length - 3;
  }

  if (domainParts.length >= 2) {
    return domainParts.length - 2;
  }

  return 0;
}

function usesCompoundCountrySuffix(domainParts: string[]): boolean {
  if (domainParts.length < 3) {
    return false;
  }

  const topLevelDomain: string = domainParts[domainParts.length - 1]!;
  const suffixPrefix: string = domainParts[domainParts.length - 2]!;
  return topLevelDomain.length === 2 && compoundSuffixPrefixes.has(suffixPrefix);
}

function formatOrganizationName(domainLabel: string): string | undefined {
  const words: string[] = domainLabel
    .split(/[^a-z0-9]+/iu)
    .filter(hasText)
    .map(capitalizeWord);
  if (words.length === 0) {
    return undefined;
  }

  return words.join(' ');
}

function capitalizeWord(word: string): string {
  const normalizedWord: string = word.toLowerCase();
  return `${normalizedWord[0]?.toUpperCase() ?? ''}${normalizedWord.slice(1)}`;
}
