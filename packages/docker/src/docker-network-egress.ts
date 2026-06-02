import { createHash } from 'node:crypto';
import {
  canSyncIptablesNetworkEgressDenyRules,
  syncIptablesNetworkEgressDenyRules,
} from './docker-network-egress-iptables';
import { readDockerFirewallBackend, type DockerFirewallBackend } from './docker-firewall-backend';
import { runProcessCommand } from './process-command';
import { runProcessCommandWithTempFile } from './process-command-temp-file';
import type { DockerSyncNetworkEgressDenyRulesInput } from './docker-models';
import type { DockerNetworkEgressDenyRule } from './docker-network-egress.types';
import type { ProcessCommandInput } from './process-command.types';

const nftCommand: string = 'nft';
const nftTablePrefix: string = 'compartment_egress_';
const namespaceHashLength: number = 12;

type FirewallBackend = 'iptables' | 'nft';

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

async function canSyncNftNetworkEgressDenyRules(): Promise<boolean> {
  if (!(await canRunCommand({ args: ['--version'], file: nftCommand }))) {
    return false;
  }

  return await canRunCommand({ args: ['list', 'ruleset'], file: nftCommand });
}

async function cleanupNftNetworkEgressDenyRulesBestEffort(namespace: string): Promise<void> {
  try {
    await syncNftNetworkEgressDenyRules(namespace, [], []);
  } catch {
    return;
  }
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

async function syncNftNetworkEgressDenyRules(
  namespace: string,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
): Promise<void> {
  const tableName: string = buildNftTableName(namespace);
  const tableExists: boolean = await nftTableExists(tableName);

  if (rules.length === 0 && sourceAllowCidrs.length === 0) {
    if (tableExists) {
      await runNftBatch([buildNftDeleteTableLine(tableName)]);
    }
    return;
  }

  await runNftBatch(buildNftNetworkEgressDenyBatch(tableName, rules, sourceAllowCidrs, tableExists));
}

async function nftTableExists(tableName: string): Promise<boolean> {
  return await canRunCommand({ args: ['list', 'table', 'inet', tableName], file: nftCommand });
}

function buildNftNetworkEgressDenyBatch(
  tableName: string,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
  tableExists: boolean,
): string[] {
  return [
    ...(tableExists ? [buildNftDeleteTableLine(tableName)] : []),
    `add table inet ${tableName}`,
    buildNftBaseChainLine(tableName, 'prerouting'),
    buildNftBaseChainLine(tableName, 'forward'),
    buildNftBaseChainLine(tableName, 'input'),
    ...buildNftSourceAllowRuleLines(tableName, sourceAllowCidrs),
    ...buildNftDropRuleLines(tableName, rules),
  ];
}

function buildNftDeleteTableLine(tableName: string): string {
  return `delete table inet ${tableName}`;
}

function buildNftBaseChainLine(tableName: string, hook: 'forward' | 'input' | 'prerouting'): string {
  if (hook === 'prerouting') {
    return `add chain inet ${tableName} ${hook} { type filter hook ${hook} priority -300; policy accept; }`;
  }

  return `add chain inet ${tableName} ${hook} { type filter hook ${hook} priority -1; policy accept; }`;
}

function buildNftSourceAllowRuleLines(tableName: string, sourceAllowCidrs: readonly string[]): string[] {
  return sourceAllowCidrs.flatMap((sourceAllowCidr: string): string[] => [
    buildNftSourceAllowRuleLine(tableName, 'prerouting', sourceAllowCidr),
    buildNftSourceAllowRuleLine(tableName, 'forward', sourceAllowCidr),
    buildNftSourceAllowRuleLine(tableName, 'input', sourceAllowCidr),
  ]);
}

function buildNftSourceAllowRuleLine(
  tableName: string,
  chainName: 'forward' | 'input' | 'prerouting',
  sourceAllowCidr: string,
): string {
  return `add rule inet ${tableName} ${chainName} ip saddr ${sourceAllowCidr} accept`;
}

function buildNftDropRuleLines(tableName: string, rules: readonly DockerNetworkEgressDenyRule[]): string[] {
  return rules.flatMap((rule: DockerNetworkEgressDenyRule): string[] => [
    buildNftDropRuleLine(tableName, 'prerouting', rule),
    buildNftDropRuleLine(tableName, 'forward', rule),
    buildNftDropRuleLine(tableName, 'input', rule),
  ]);
}

function buildNftDropRuleLine(
  tableName: string,
  chainName: 'forward' | 'input' | 'prerouting',
  rule: DockerNetworkEgressDenyRule,
): string {
  return `add rule inet ${tableName} ${chainName} ip saddr ${rule.sourceSubnet} ip daddr ${rule.destinationCidr} drop`;
}

async function runNftBatch(lines: readonly string[]): Promise<void> {
  await runProcessCommandWithTempFile({
    args: ['-f'],
    content: `${lines.join('\n')}\n`,
    file: nftCommand,
    fileName: 'nft',
  });
}

async function canRunCommand(input: ProcessCommandInput): Promise<boolean> {
  try {
    await runProcessCommand(input);
    return true;
  } catch {
    return false;
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

function buildNftTableName(namespace: string): string {
  return `${nftTablePrefix}${createNamespaceHash(namespace)}`;
}

function createNamespaceHash(namespace: string): string {
  return createHash('sha256').update(namespace).digest('hex').slice(0, namespaceHashLength);
}
