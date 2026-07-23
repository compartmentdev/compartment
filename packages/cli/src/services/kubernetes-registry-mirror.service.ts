import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { access, lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { isMissingFileSystemEntryError, type JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { readCliVersion } from '../cli-build-info';
import { buildKubectlCommand, buildKubernetesReleaseSelector, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';
import {
  createKubernetesRegistryMirror,
  isLocalK3sKubeconfigChain,
  mergeKubernetesRegistryMirrorConfig,
} from './kubernetes-registry-mirror-config.service';
import type {
  KubernetesRegistryMirror,
  KubernetesRegistryMirrorApplyResult,
  KubernetesRegistryServiceItem,
  KubernetesRegistryServiceList,
} from './kubernetes-registry-mirror.service.types';

const k3sConfigDirectory: string = '/etc/rancher/k3s';
const k3sRegistryConfigPath: string = `${k3sConfigDirectory}/registries.yaml`;

export async function readInstalledKubernetesRegistryMirror(
  target: KubernetesOperatorTarget,
): Promise<KubernetesRegistryMirror> {
  const result: CommandResult = await runCommand(buildRegistryServiceCommand(target));
  if (result.exitCode !== 0) {
    throw new Error(`Failed to inspect the installed registry-auth Service: ${readCommandOutput(result)}`);
  }
  const registryService: KubernetesRegistryServiceItem = readRegistryService(result.stdout);
  return createKubernetesRegistryMirror(
    registryService.metadata?.name ?? '',
    target.namespace,
    registryService.spec?.clusterIP ?? '',
  );
}

export async function canAutoApplyKubernetesRegistryMirror(target: KubernetesOperatorTarget): Promise<boolean> {
  if (!isLocalK3sKubeconfigChain(process.env, target.kubeContext) || process.getuid?.() !== 0) {
    return false;
  }
  try {
    await access(k3sConfigDirectory, constants.W_OK);
  } catch {
    return false;
  }
  const systemctlResult: CommandResult = await runCommand(['systemctl', '--version']);
  return systemctlResult.exitCode === 0;
}

export async function hasMultipleKubernetesNodes(target: KubernetesOperatorTarget): Promise<boolean> {
  const result: CommandResult = await runCommand(buildKubectlCommand(target, ['get', 'nodes', '--output', 'json']));
  if (result.exitCode !== 0) {
    return true;
  }
  try {
    const nodeList: JsonValue = JSON.parse(result.stdout) as JsonValue;
    if (
      typeof nodeList !== 'object' ||
      nodeList === null ||
      Array.isArray(nodeList) ||
      !Array.isArray(nodeList.items)
    ) {
      return true;
    }
    return nodeList.items.length > 1;
  } catch {
    return true;
  }
}

export async function applyKubernetesRegistryMirror(
  mirror: KubernetesRegistryMirror,
): Promise<KubernetesRegistryMirrorApplyResult> {
  const existingConfig: string = await readExistingRegistryConfig();
  const mergedConfig: string = mergeKubernetesRegistryMirrorConfig(existingConfig, mirror);
  const configChanged: boolean = mergedConfig !== existingConfig;
  if (configChanged) {
    await writeRegistryConfigAtomically(mergedConfig);
  }
  const restartResult: CommandResult | undefined = configChanged
    ? await runCommand(['systemctl', 'restart', 'k3s'])
    : undefined;
  return {
    configChanged,
    current: await hasCurrentRegistryEndpoint(mirror),
    ...(restartResult === undefined || restartResult.exitCode === 0
      ? {}
      : { restartError: readCommandOutput(restartResult) }),
  };
}

export function renderKubernetesRegistryMirrorInstructions(mirror: KubernetesRegistryMirror): string {
  const cliVersion: string = readCliVersion();
  return `
Configure the registry mirror on every k3s node:
1. Install Compartment CLI ${cliVersion} on the node.
2. Run:
sudo compartment system registry-mirror apply \\
  --registry-host '${mirror.host}' \\
  --cluster-ip '${mirror.clusterIp}'

This writes /etc/rancher/k3s/registries.yaml and restarts k3s when the config changes.
`;
}

function buildRegistryServiceCommand(target: KubernetesOperatorTarget): string[] {
  return buildKubectlCommand(target, [
    'get',
    'service',
    '--selector',
    buildKubernetesReleaseSelector(target.releaseName),
    '--output',
    'json',
  ]);
}

function readRegistryService(output: string): KubernetesRegistryServiceItem {
  const services: KubernetesRegistryServiceList = parseRegistryServiceList(output);
  const registryServices: KubernetesRegistryServiceItem[] = (services.items ?? []).filter(
    (service: KubernetesRegistryServiceItem): boolean => service.metadata?.name?.endsWith('-registry-auth') === true,
  );
  if (registryServices.length !== 1) {
    throw new Error(
      `Expected exactly one installed registry-auth Service, found ${registryServices.length.toString()}.`,
    );
  }
  return registryServices[0]!;
}

async function hasCurrentRegistryEndpoint(mirror: KubernetesRegistryMirror): Promise<boolean> {
  const currentConfig: string = await readExistingRegistryConfig();
  if (currentConfig.trim() === '') {
    return false;
  }
  return mergeKubernetesRegistryMirrorConfig(currentConfig, mirror) === currentConfig;
}

async function readExistingRegistryConfig(): Promise<string> {
  try {
    return await readFile(k3sRegistryConfigPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return '';
    }
    throw error;
  }
}

async function writeRegistryConfigAtomically(config: string): Promise<void> {
  const destinationPath: string = await resolveRegistryConfigDestinationPath();
  const temporaryPath: string = `${destinationPath}.tmp-${process.pid.toString()}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, config, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, destinationPath);
  } finally {
    await removeTemporaryRegistryConfig(temporaryPath);
  }
}

async function resolveRegistryConfigDestinationPath(): Promise<string> {
  let registryConfigStat: Stats;
  try {
    registryConfigStat = await lstat(k3sRegistryConfigPath);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return k3sRegistryConfigPath;
    }
    throw error;
  }
  return registryConfigStat.isSymbolicLink() ? await realpath(k3sRegistryConfigPath) : k3sRegistryConfigPath;
}

async function removeTemporaryRegistryConfig(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error) || !isMissingFileSystemEntryError(error)) {
      throw error;
    }
  }
}

function parseRegistryServiceList(output: string): KubernetesRegistryServiceList {
  try {
    const parsed: JsonValue = JSON.parse(output) as JsonValue;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Array.isArray(parsed.items) ||
      parsed.items.some((item: JsonValue): boolean => typeof item !== 'object' || item === null || Array.isArray(item))
    ) {
      throw new Error('unexpected root');
    }
    return { items: parsed.items as KubernetesRegistryServiceItem[] };
  } catch {
    throw new Error('Kubectl returned invalid registry-auth Service JSON.');
  }
}
