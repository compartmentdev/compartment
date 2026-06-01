import { createHash } from 'node:crypto';
import {
  canSyncIptablesNetworkEgressDenyRules,
  syncIptablesNetworkEgressDenyRules,
} from './docker-network-egress-iptables';
import { runProcessCommand } from './process-command';
import { runProcessCommandWithTempFile } from './process-command-temp-file';
import type { DockerSyncNetworkEgressDenyRulesInput } from './docker-models';
import type { DockerNetworkEgressDenyRule } from './docker-network-egress.types';
import type { ProcessCommandInput } from './process-command.types';

const nftCommand: string = 'nft';
const nftTablePrefix: string = 'compartment_egress_';
const namespaceHashLength: number = 12;

type NftFamily = 'bridge' | 'inet';

interface NftTableExistence {
  readonly bridge: boolean;
  readonly inet: boolean;
}

export async function syncDockerNetworkEgressDenyRules(input: DockerSyncNetworkEgressDenyRulesInput): Promise<void> {
  const rules: DockerNetworkEgressDenyRule[] = buildDockerNetworkEgressDenyRules(input);
  const sourceAllowCidrs: string[] = dedupeValues(input.sourceAllowCidrs ?? []);
  const canSyncIptables: boolean = await canSyncIptablesNetworkEgressDenyRules();
  const canSyncNft: boolean = await canSyncNftNetworkEgressDenyRules();
  if (!canSyncIptables && !canSyncNft) {
    if (rules.length === 0 && sourceAllowCidrs.length === 0) {
      return;
    }

    throw new Error('Docker runtime egress deny rules require nftables or iptables on the Docker host.');
  }

  if (canSyncIptables) {
    await syncIptablesNetworkEgressDenyRules({
      namespace: input.namespace,
      rules,
      sourceAllowCidrs,
    });
  }

  if (canSyncNft) {
    await syncNftNetworkEgressDenyRules(input.namespace, rules, sourceAllowCidrs);
  }
}

async function canSyncNftNetworkEgressDenyRules(): Promise<boolean> {
  if (!(await canRunCommand({ args: ['--version'], file: nftCommand }))) {
    return false;
  }

  return await canRunCommand({ args: ['list', 'ruleset'], file: nftCommand });
}

async function syncNftNetworkEgressDenyRules(
  namespace: string,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
): Promise<void> {
  const tableName: string = buildNftTableName(namespace);
  const tableExists: NftTableExistence = await readNftTableExistence(tableName);

  if (rules.length === 0 && sourceAllowCidrs.length === 0) {
    await deleteEmptyNftTables(tableName, tableExists);
    return;
  }

  await runNftBatch(buildNftNetworkEgressDenyBatch(tableName, rules, sourceAllowCidrs, tableExists));
}

async function readNftTableExistence(tableName: string): Promise<NftTableExistence> {
  return {
    bridge: await nftTableExists('bridge', tableName),
    inet: await nftTableExists('inet', tableName),
  };
}

async function deleteEmptyNftTables(tableName: string, tableExists: NftTableExistence): Promise<void> {
  const deleteLines: string[] = [
    ...(tableExists.bridge ? [buildNftDeleteTableLine('bridge', tableName)] : []),
    ...(tableExists.inet ? [buildNftDeleteTableLine('inet', tableName)] : []),
  ];
  if (deleteLines.length > 0) {
    await runNftBatch(deleteLines);
  }
}

async function nftTableExists(family: NftFamily, tableName: string): Promise<boolean> {
  return await canRunCommand({ args: ['list', 'table', family, tableName], file: nftCommand });
}

function buildNftNetworkEgressDenyBatch(
  tableName: string,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
  tableExists: NftTableExistence,
): string[] {
  return [
    ...(tableExists.bridge ? [buildNftDeleteTableLine('bridge', tableName)] : []),
    ...(tableExists.inet ? [buildNftDeleteTableLine('inet', tableName)] : []),
    `add table bridge ${tableName}`,
    buildNftBridgeBaseChainLine(tableName),
    ...buildNftSourceAllowRuleLines('bridge', tableName, sourceAllowCidrs),
    ...buildNftDropRuleLines('bridge', tableName, rules),
    `add table inet ${tableName}`,
    buildNftInetBaseChainLine(tableName, 'forward'),
    buildNftInetBaseChainLine(tableName, 'input'),
    ...buildNftSourceAllowRuleLines('inet', tableName, sourceAllowCidrs),
    ...buildNftDropRuleLines('inet', tableName, rules),
  ];
}

function buildNftDeleteTableLine(family: NftFamily, tableName: string): string {
  return `delete table ${family} ${tableName}`;
}

function buildNftInetBaseChainLine(tableName: string, hook: 'forward' | 'input'): string {
  return `add chain inet ${tableName} ${hook} { type filter hook ${hook} priority -1; policy accept; }`;
}

function buildNftBridgeBaseChainLine(tableName: string): string {
  return `add chain bridge ${tableName} prerouting { type filter hook prerouting priority -300; policy accept; }`;
}

function buildNftSourceAllowRuleLines(
  family: NftFamily,
  tableName: string,
  sourceAllowCidrs: readonly string[],
): string[] {
  return sourceAllowCidrs.flatMap((sourceAllowCidr: string): string[] => {
    if (family === 'bridge') {
      return [buildNftSourceAllowRuleLine(family, tableName, 'prerouting', sourceAllowCidr)];
    }

    return [
      buildNftSourceAllowRuleLine(family, tableName, 'forward', sourceAllowCidr),
      buildNftSourceAllowRuleLine(family, tableName, 'input', sourceAllowCidr),
    ];
  });
}

type NftChainName = 'forward' | 'input' | 'prerouting';

function buildNftSourceAllowRuleLine(
  family: NftFamily,
  tableName: string,
  chainName: NftChainName,
  sourceAllowCidr: string,
): string {
  return `add rule ${family} ${tableName} ${chainName} ${buildNftIpMatchClausePrefix(family)}ip saddr ${sourceAllowCidr} accept`;
}

function buildNftDropRuleLines(
  family: NftFamily,
  tableName: string,
  rules: readonly DockerNetworkEgressDenyRule[],
): string[] {
  return rules.flatMap((rule: DockerNetworkEgressDenyRule): string[] => {
    if (family === 'bridge') {
      return [buildNftDropRuleLine(family, tableName, 'prerouting', rule)];
    }

    return [
      buildNftDropRuleLine(family, tableName, 'forward', rule),
      buildNftDropRuleLine(family, tableName, 'input', rule),
    ];
  });
}

function buildNftDropRuleLine(
  family: NftFamily,
  tableName: string,
  chainName: NftChainName,
  rule: DockerNetworkEgressDenyRule,
): string {
  return `add rule ${family} ${tableName} ${chainName} ${buildNftIpMatchClausePrefix(family)}ip saddr ${rule.sourceSubnet} ip daddr ${rule.destinationCidr} drop`;
}

function buildNftIpMatchClausePrefix(family: NftFamily): string {
  if (family === 'bridge') {
    return 'ether type ip ';
  }

  return '';
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
