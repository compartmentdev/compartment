import { isIP } from 'node:net';

export function parseOptionalTrustedOutboundHostList(value: string | undefined, variableName: string): string[] {
  const normalizedValue: string = value?.trim() ?? '';
  if (normalizedValue === '') {
    return [];
  }

  return [
    ...new Set(
      normalizedValue
        .split(',')
        .map((entry: string): string => entry.trim())
        .filter((entry: string): boolean => entry !== '')
        .map((entry: string): string => parseTrustedOutboundHostListEntry(entry, variableName)),
    ),
  ];
}

function parseTrustedOutboundHostListEntry(value: string, variableName: string): string {
  try {
    if (value.includes('://')) {
      throw new Error('Expected host only.');
    }
    const normalizedValue: string = value.toLowerCase();
    const parsedUrl: URL = new URL(`https://${normalizedValue}`);
    if (!matchesParsedTrustedOutboundHostEntry(parsedUrl, normalizedValue)) {
      throw new Error('Expected host only.');
    }
    assertTrustedOutboundHostIsNotIpLiteral(parsedUrl.hostname);

    return parsedUrl.host;
  } catch {
    throw new Error(
      `${variableName} must be empty or a comma-separated list of public hostnames or host:port entries.`,
    );
  }
}

function matchesParsedTrustedOutboundHostEntry(parsedUrl: URL, normalizedValue: string): boolean {
  return (
    (parsedUrl.host === normalizedValue || normalizedValue === `${parsedUrl.host}:443`) &&
    parsedUrl.pathname === '/' &&
    parsedUrl.search === '' &&
    parsedUrl.hash === ''
  );
}

function assertTrustedOutboundHostIsNotIpLiteral(hostname: string): void {
  const normalizedHostname: string =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIP(normalizedHostname) !== 0) {
    throw new Error('Expected hostname.');
  }
}
