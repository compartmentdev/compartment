import { createHash } from 'node:crypto';
import { runProcessCommand } from './process-command';
import type { DockerNetworkEgressDenyRule } from './docker-network-egress.types';
import type { ProcessCommandInput } from './process-command.types';

const iptablesCommand: string = 'iptables';
const iptablesChainPrefix: string = 'CMP-EG';
const dockerUserChainName: string = 'DOCKER-USER';
const inputChainName: string = 'INPUT';
const namespaceHashLength: number = 12;
const maxIptablesDeleteAttempts: number = 16;
const iptablesWaitSeconds: string = '10';

interface IptablesManagedChain {
  primaryChainName: string;
  parentChainName: string;
  secondaryChainName: string;
}

interface IptablesNetworkEgressDenyInput {
  namespace: string;
  rules: readonly DockerNetworkEgressDenyRule[];
  sourceAllowCidrs: readonly string[];
}

type IptablesEgressErrorInput = Error | string | number | boolean | symbol | bigint | null | undefined;

export async function canSyncIptablesNetworkEgressDenyRules(): Promise<boolean> {
  if (!(await canRunCommand({ args: ['--version'], file: iptablesCommand }))) {
    return false;
  }

  return await canRunIptablesCommand(['-L', '-n']);
}

export async function syncIptablesNetworkEgressDenyRules(input: IptablesNetworkEgressDenyInput): Promise<void> {
  const chains: IptablesManagedChain[] = buildIptablesManagedChains(input.namespace);

  if (input.rules.length === 0 && input.sourceAllowCidrs.length === 0) {
    for (const chain of chains) {
      await removeIptablesManagedChain(chain.parentChainName, chain.primaryChainName);
      await removeIptablesManagedChain(chain.parentChainName, chain.secondaryChainName);
    }
    return;
  }

  for (const chain of chains) {
    await syncIptablesManagedChain(chain, input.rules, input.sourceAllowCidrs);
  }
}

function buildIptablesManagedChains(namespace: string): IptablesManagedChain[] {
  return [
    {
      parentChainName: dockerUserChainName,
      primaryChainName: buildIptablesChainName(namespace, 'F'),
      secondaryChainName: buildIptablesChainName(namespace, 'FN'),
    },
    {
      parentChainName: inputChainName,
      primaryChainName: buildIptablesChainName(namespace, 'I'),
      secondaryChainName: buildIptablesChainName(namespace, 'IN'),
    },
  ];
}

async function syncIptablesManagedChain(
  chain: IptablesManagedChain,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
): Promise<void> {
  const activeChainName: string | null = await readActiveIptablesManagedChain(chain);
  const stagingChainName: string =
    activeChainName === chain.primaryChainName ? chain.secondaryChainName : chain.primaryChainName;

  await replaceIptablesChainRules(stagingChainName, rules, sourceAllowCidrs);
  await ensureIptablesJump(chain.parentChainName, stagingChainName);
  if (activeChainName !== null && activeChainName !== stagingChainName) {
    await removeIptablesManagedChainBestEffort(chain.parentChainName, activeChainName);
  }
}

async function readActiveIptablesManagedChain(chain: IptablesManagedChain): Promise<string | null> {
  for (const chainName of [chain.primaryChainName, chain.secondaryChainName]) {
    if (await canRunIptablesCommand(['-C', chain.parentChainName, '-j', chainName])) {
      return chainName;
    }
  }

  return null;
}

async function replaceIptablesChainRules(
  chainName: string,
  rules: readonly DockerNetworkEgressDenyRule[],
  sourceAllowCidrs: readonly string[],
): Promise<void> {
  await ensureIptablesChain(chainName);
  await runIptablesCommand(['-F', chainName]);
  for (const sourceAllowCidr of sourceAllowCidrs) {
    await runIptablesCommand(['-A', chainName, '-s', sourceAllowCidr, '-j', 'RETURN']);
  }
  for (const rule of rules) {
    await runIptablesCommand(['-A', chainName, '-s', rule.sourceSubnet, '-d', rule.destinationCidr, '-j', 'DROP']);
  }
}

async function ensureIptablesChain(chainName: string): Promise<void> {
  try {
    await runIptablesCommand(['-N', chainName]);
  } catch (error) {
    if (!isIptablesAlreadyExistsError(error as IptablesEgressErrorInput)) {
      throw error;
    }
  }
}

async function ensureIptablesJump(parentChainName: string, chainName: string): Promise<void> {
  if (await canRunIptablesCommand(['-C', parentChainName, '-j', chainName])) {
    return;
  }

  await runIptablesCommand(['-I', parentChainName, '1', '-j', chainName]);
}

async function removeIptablesManagedChainBestEffort(parentChainName: string, chainName: string): Promise<void> {
  try {
    await removeIptablesManagedChain(parentChainName, chainName);
  } catch {
    return;
  }
}

async function removeIptablesManagedChain(parentChainName: string, chainName: string): Promise<void> {
  await deleteIptablesJumps(parentChainName, chainName);

  try {
    await runIptablesCommand(['-F', chainName]);
    await runIptablesCommand(['-X', chainName]);
  } catch (error) {
    if (!isIptablesMissingError(error as IptablesEgressErrorInput)) {
      throw error;
    }
  }
}

async function deleteIptablesJumps(parentChainName: string, chainName: string): Promise<void> {
  for (let attempt: number = 0; attempt < maxIptablesDeleteAttempts; attempt += 1) {
    if (!(await canRunIptablesCommand(['-C', parentChainName, '-j', chainName]))) {
      return;
    }

    await runIptablesCommand(['-D', parentChainName, '-j', chainName]);
  }
}

async function runIptablesCommand(args: string[]): Promise<void> {
  await runProcessCommand({
    args: ['-w', iptablesWaitSeconds, ...args],
    file: iptablesCommand,
  });
}

async function canRunIptablesCommand(args: string[]): Promise<boolean> {
  return await canRunCommand({
    args: ['-w', iptablesWaitSeconds, ...args],
    file: iptablesCommand,
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

function buildIptablesChainName(namespace: string, suffix: 'F' | 'FN' | 'I' | 'IN'): string {
  return `${iptablesChainPrefix}-${createNamespaceHash(namespace)}-${suffix}`;
}

function createNamespaceHash(namespace: string): string {
  return createHash('sha256').update(namespace).digest('hex').slice(0, namespaceHashLength);
}

function isIptablesAlreadyExistsError(error: IptablesEgressErrorInput): boolean {
  return readProcessErrorOutput(error).includes('chain already exists');
}

function isIptablesMissingError(error: IptablesEgressErrorInput): boolean {
  const output: string = readProcessErrorOutput(error);
  return output.includes('no chain/target/match by that name') || output.includes('no chain by that name');
}

function readProcessErrorOutput(error: IptablesEgressErrorInput): string {
  if (!(error instanceof Error)) {
    return '';
  }

  const processError: NodeJS.ErrnoException & { stderr?: string | undefined; stdout?: string | undefined } = error;
  return `${processError.message}\n${processError.stdout ?? ''}\n${processError.stderr ?? ''}`.toLowerCase();
}
