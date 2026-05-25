import { compartmentReservedCookieNamePrefixes } from '@compartment/contracts';

const platformOwnedCookieNamePattern: string = `(?:${compartmentReservedCookieNamePrefixes
  .map(escapeRegexPattern)
  .join('|')})[^=;]+`;

export function readCaddyPlatformAppCookieStripDirectives(): readonly string[] {
  return [
    `header_up Cookie "(^|; *)${platformOwnedCookieNamePattern}=[^;]*" "$1"`,
    'header_up Cookie "(; *)(; *)+" "$1"',
    'header_up Cookie "^; *(.*)$" "$1"',
    'header_up Cookie "^(.*?); *$" "$1"',
    `header_down Set-Cookie "^ *${platformOwnedCookieNamePattern}=.*$" ""`,
  ];
}

function escapeRegexPattern(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}
