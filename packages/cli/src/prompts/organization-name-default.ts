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
  const domain: string | undefined = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (!hasText(domain) || commonEmailDomains.has(domain)) {
    return undefined;
  }
  const parts: string[] = domain.split('.').filter(hasText);
  const suffixOffset: number = usesCompoundCountrySuffix(parts) ? 3 : 2;
  const label: string | undefined = parts.at(-Math.min(suffixOffset, parts.length));
  if (!hasText(label)) {
    return undefined;
  }
  const words: string[] = label
    .split(/[^a-z0-9]+/iu)
    .filter(hasText)
    .map(capitalizeWord);
  return words.length === 0 ? undefined : words.join(' ');
}

function usesCompoundCountrySuffix(parts: string[]): boolean {
  const topLevelDomain: string | undefined = parts.at(-1);
  const suffixPrefix: string | undefined = parts.at(-2);
  return (
    parts.length >= 3 &&
    topLevelDomain?.length === 2 &&
    suffixPrefix !== undefined &&
    compoundSuffixPrefixes.has(suffixPrefix)
  );
}

function capitalizeWord(word: string): string {
  return `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`;
}
