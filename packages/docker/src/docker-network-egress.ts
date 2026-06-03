import {
  canSyncIptablesNetworkEgressDenyRules,
  syncIptablesNetworkEgressDenyRules,
} from './docker-network-egress-iptables';
import {
  canSyncNftNetworkEgressDenyRules,
  cleanupNftNetworkEgressDenyRulesBestEffort,
  syncNftNetworkEgressDenyRules,
} from './docker-network-egress-nft';
import { readDockerFirewallBackend, type DockerFirewallBackend } from './docker-firewall-backend';
import type { DockerSyncNetworkEgressDenyRulesInput } from './docker-models';
import type { DockerNetworkEgressDenyRule } from './docker-network-egress.types';

type FirewallBackend = Exclude<DockerFirewallBackend, 'unknown'>;

export async function syncDockerNetworkEgressDenyRules(input: DockerSyncNetworkEgressDenyRulesInput): Promise<void> {
  const rules: DockerNetworkEgressDenyRule[] = buildDockerNetworkEgressDenyRules(input);
  const sourceAllowCidrs: string[] = dedupeValues(input.sourceAllowCidrs ?? []);
  const backend: FirewallBackend | null = await resolveFirewallBackend();
  if (backend !== null) {
    await syncResolvedFirewallBackend(input.namespace, backend, rules, sourceAllowCidrs);
    return;
  }

  if (rules.length === 0 && sourceAllowCidrs.length === 0) {
    return;
  }
  throw new Error('Docker runtime egress deny rules require nftables or iptables on the Docker host.');
}

async function syncResolvedFirewallBackend(
  namespace: string,
  backend: FirewallBackend,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
): Promise<void> {
  if (backend === 'nft') {
    await syncNftNetworkEgressDenyRules(namespace, rules, sourceAllowCidrs);
    await cleanupIptablesNetworkEgressDenyRulesBestEffort(namespace);
    return;
  }

  await syncIptablesNetworkEgressDenyRules({
    namespace,
    rules,
    sourceAllowCidrs,
  });
  await cleanupNftNetworkEgressDenyRulesBestEffort(namespace);
}

async function resolveFirewallBackend(): Promise<FirewallBackend | null> {
  const canSyncIptables: boolean = await canSyncIptablesNetworkEgressDenyRules();
  const dockerBackend: DockerFirewallBackend = await readDockerFirewallBackend();
  if (dockerBackend !== 'unknown') {
    return await readAvailableDockerFirewallBackend(dockerBackend, canSyncIptables);
  }

  if (canSyncIptables) {
    return 'iptables';
  }
  if (await canSyncNftNetworkEgressDenyRules()) {
    return 'nft';
  }

  return null;
}

async function readAvailableDockerFirewallBackend(
  dockerBackend: FirewallBackend,
  canSyncIptables: boolean,
): Promise<FirewallBackend | null> {
  if (dockerBackend === 'iptables') {
    return canSyncIptables ? 'iptables' : null;
  }

  return (await canSyncNftNetworkEgressDenyRules()) ? 'nft' : null;
}

async function cleanupIptablesNetworkEgressDenyRulesBestEffort(namespace: string): Promise<void> {
  try {
    await syncIptablesNetworkEgressDenyRules({
      namespace,
      rules: [],
      sourceAllowCidrs: [],
    });
  } catch {
    return;
  }
}

function buildDockerNetworkEgressDenyRules(
  input: DockerSyncNetworkEgressDenyRulesInput,
): DockerNetworkEgressDenyRule[] {
  return dedupeValues(input.sourceSubnets).flatMap((sourceSubnet: string): DockerNetworkEgressDenyRule[] =>
    dedupeValues(input.destinationCidrs).map(
      (destinationCidr: string): DockerNetworkEgressDenyRule => ({
        destinationCidr,
        sourceSubnet,
      }),
    ),
  );
}

function dedupeValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left: string, right: string): number => left.localeCompare(right));
}
