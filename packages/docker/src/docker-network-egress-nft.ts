import { createHash } from 'node:crypto';
import { runProcessCommand } from './process-command';
import { runProcessCommandWithTempFile } from './process-command-temp-file';
import type { DockerNetworkEgressDenyRule } from './docker-network-egress.types';
import type { ProcessCommandInput } from './process-command.types';

const nftCommand: string = 'nft';
const nftTablePrefix: string = 'compartment_egress_';
const namespaceHashLength: number = 12;

type NftFamily = 'bridge' | 'inet';
type NftChainName = 'forward' | 'input' | 'prerouting';

interface NftTableExistence {
  readonly bridge: boolean;
  readonly inet: boolean;
}

export async function canSyncNftNetworkEgressDenyRules(): Promise<boolean> {
  if (!(await canRunCommand({ args: ['--version'], file: nftCommand }))) {
    return false;
  }

  return await canRunCommand({ args: ['list', 'ruleset'], file: nftCommand });
}

export async function cleanupNftNetworkEgressDenyRulesBestEffort(namespace: string): Promise<void> {
  try {
    await syncNftNetworkEgressDenyRules(namespace, [], []);
  } catch {
    return;
  }
}

export async function syncNftNetworkEgressDenyRules(
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
    ...buildNftBaseChainLines('inet', tableName),
    ...buildNftSourceAllowRuleLines('inet', tableName, sourceAllowCidrs),
    ...buildNftDropRuleLines('inet', tableName, rules),
  ];
}

function buildNftDeleteTableLine(family: NftFamily, tableName: string): string {
  return `delete table ${family} ${tableName}`;
}

function buildNftBaseChainLines(family: NftFamily, tableName: string): string[] {
  return readNftFamilyChainNames(family).map((hook: NftChainName): string =>
    buildNftBaseChainLine(family, tableName, hook),
  );
}

function buildNftBridgeBaseChainLine(tableName: string): string {
  return buildNftBaseChainLine('bridge', tableName, 'prerouting');
}

function buildNftBaseChainLine(family: NftFamily, tableName: string, hook: NftChainName): string {
  const priority: '-300' | '-1' = hook === 'prerouting' ? '-300' : '-1';
  return `add chain ${family} ${tableName} ${hook} { type filter hook ${hook} priority ${priority}; policy accept; }`;
}

function buildNftSourceAllowRuleLines(
  family: NftFamily,
  tableName: string,
  sourceAllowCidrs: readonly string[],
): string[] {
  return sourceAllowCidrs.flatMap((sourceAllowCidr: string): string[] => {
    return readNftFamilyChainNames(family).map((chainName: NftChainName): string =>
      buildNftSourceAllowRuleLine(family, tableName, chainName, sourceAllowCidr),
    );
  });
}

function buildNftSourceAllowRuleLine(
  family: NftFamily,
  tableName: string,
  chainName: NftChainName,
  sourceAllowCidr: string,
): string {
  const ipMatchPrefix: string = buildNftIpMatchClausePrefix(family);
  return `add rule ${family} ${tableName} ${chainName} ${ipMatchPrefix}ip saddr ${sourceAllowCidr} accept`;
}

function buildNftDropRuleLines(
  family: NftFamily,
  tableName: string,
  rules: readonly DockerNetworkEgressDenyRule[],
): string[] {
  return rules.flatMap((rule: DockerNetworkEgressDenyRule): string[] => {
    return readNftFamilyChainNames(family).map((chainName: NftChainName): string =>
      buildNftDropRuleLine(family, tableName, chainName, rule),
    );
  });
}

function buildNftDropRuleLine(
  family: NftFamily,
  tableName: string,
  chainName: NftChainName,
  rule: DockerNetworkEgressDenyRule,
): string {
  const ipMatchPrefix: string = buildNftIpMatchClausePrefix(family);
  return [
    `add rule ${family} ${tableName} ${chainName}`,
    `${ipMatchPrefix}ip saddr ${rule.sourceSubnet}`,
    `ip daddr ${rule.destinationCidr} drop`,
  ].join(' ');
}

function readNftFamilyChainNames(family: NftFamily): readonly NftChainName[] {
  return family === 'bridge' ? ['prerouting'] : ['prerouting', 'forward', 'input'];
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

function buildNftTableName(namespace: string): string {
  return `${nftTablePrefix}${createNamespaceHash(namespace)}`;
}

function createNamespaceHash(namespace: string): string {
  return createHash('sha256').update(namespace).digest('hex').slice(0, namespaceHashLength);
}
