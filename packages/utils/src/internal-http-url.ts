import { isIPv6 } from 'node:net';

export function buildInternalHttpUrl(host: string, port: number): string {
  return `http://${formatInternalHttpHost(host)}:${port.toString()}`;
}

function formatInternalHttpHost(host: string): string {
  if (isIPv6(host)) {
    return `[${host}]`;
  }

  return host;
}
