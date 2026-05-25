import { isIP } from 'node:net';
import { hasText } from './text';

interface HttpHostAuthority {
  authority: string;
  host: string;
}

const numericPortPattern: RegExp = /^[0-9]+$/u;
const hostnamePattern: RegExp = /^[A-Za-z0-9.-]+$/u;

export function parseHttpHostAuthority(value: string | undefined): HttpHostAuthority | null {
  if (!hasText(value) || value.trim() !== value) {
    return null;
  }

  const parsedAuthority: HttpHostAuthority | null = parseBracketedIpAuthority(value) ?? parseHostnameAuthority(value);
  if (parsedAuthority === null) {
    return null;
  }

  return parsedAuthority.authority === value.toLowerCase() ? parsedAuthority : null;
}

function parseBracketedIpAuthority(value: string): HttpHostAuthority | null {
  if (!value.startsWith('[')) {
    return null;
  }

  const bracketIndex: number = value.indexOf(']');
  if (bracketIndex === -1) {
    return null;
  }
  const host: string = value.slice(0, bracketIndex + 1).toLowerCase();
  const address: string = host.slice(1, -1);
  const port: string | null = readOptionalPort(value.slice(bracketIndex + 1));
  if (port === '' || isIP(address) !== 6) {
    return null;
  }

  return {
    authority: port === null ? host : `${host}:${port}`,
    host,
  };
}

function parseHostnameAuthority(value: string): HttpHostAuthority | null {
  const portSeparatorIndex: number = value.indexOf(':');
  const rawHost: string = portSeparatorIndex === -1 ? value : value.slice(0, portSeparatorIndex);
  const rawPort: string = portSeparatorIndex === -1 ? '' : value.slice(portSeparatorIndex);
  const port: string | null = readOptionalPort(rawPort);
  if (port === '' || !isValidHostname(rawHost)) {
    return null;
  }
  const host: string = rawHost.toLowerCase();

  return {
    authority: port === null ? host : `${host}:${port}`,
    host,
  };
}

function readOptionalPort(value: string): string | null {
  if (value === '') {
    return null;
  }
  if (!value.startsWith(':')) {
    return '';
  }

  const port: string = value.slice(1);
  const normalizedPort: string = numericPortPattern.test(port) ? String(Number(port)) : '';
  return normalizedPort === port && Number(port) <= 65535 ? port : '';
}

function isValidHostname(value: string): boolean {
  if (!hostnamePattern.test(value) || value.startsWith('.') || value.endsWith('.') || value.includes('..')) {
    return false;
  }
  if (/^[0-9.]+$/u.test(value) && isIP(value) !== 4) {
    return false;
  }

  return true;
}
