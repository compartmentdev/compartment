import { runProcessCommand } from './process-command';

const dockerCommand: string = 'docker';

export type DockerFirewallBackend = 'iptables' | 'nft' | 'unknown';

type DockerFirewallBackendPayload =
  | boolean
  | DockerFirewallBackendInfo
  | DockerFirewallBackendPayload[]
  | null
  | number
  | string;

interface DockerFirewallBackendInfo {
  readonly [key: string]: DockerFirewallBackendPayload | undefined;
  readonly Driver?: DockerFirewallBackendPayload | undefined;
  readonly driver?: DockerFirewallBackendPayload | undefined;
}

export async function readDockerFirewallBackend(): Promise<DockerFirewallBackend> {
  try {
    const { stdout } = await runProcessCommand({
      args: ['info', '--format', '{{ json .FirewallBackend }}'],
      file: dockerCommand,
    });
    return parseDockerFirewallBackendDriver(stdout);
  } catch {
    return 'unknown';
  }
}

function parseDockerFirewallBackendDriver(value: string): DockerFirewallBackend {
  const rawValue: string = value.trim();
  if (rawValue === '' || rawValue === '<nil>' || rawValue === 'null') {
    return 'unknown';
  }

  try {
    const parsedValue: DockerFirewallBackendPayload = JSON.parse(rawValue) as DockerFirewallBackendPayload;
    return normalizeDockerFirewallBackend(readDockerFirewallBackendDriverValue(parsedValue));
  } catch {
    return 'unknown';
  }
}

function readDockerFirewallBackendDriverValue(value: DockerFirewallBackendPayload): string | null {
  if (typeof value === 'string') {
    return readText(value);
  }
  if (!isDockerFirewallBackendInfo(value)) {
    return null;
  }

  return readPayloadText(value.Driver) ?? readPayloadText(value.driver);
}

function isDockerFirewallBackendInfo(value: DockerFirewallBackendPayload): value is DockerFirewallBackendInfo {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPayloadText(value: DockerFirewallBackendPayload | undefined): string | null {
  return typeof value === 'string' ? readText(value) : null;
}

function readText(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function normalizeDockerFirewallBackend(value: string | null): DockerFirewallBackend {
  const normalizedValue: string | null = value?.toLowerCase() ?? null;
  if (normalizedValue === 'iptables') {
    return 'iptables';
  }
  if (normalizedValue === 'nft' || normalizedValue === 'nftables') {
    return 'nft';
  }

  return 'unknown';
}
