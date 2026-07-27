import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import type {
  KubernetesConfigCluster,
  KubernetesConfigContext,
  KubernetesContextChoice,
  KubernetesConfigView,
  KubernetesInstallInventory,
  KubernetesInstallInventoryInput,
  KubernetesInstallResourceInventory,
  KubernetesInventoryList,
  KubernetesInventoryResource,
  KubernetesStorageClassChoice,
} from './kubernetes-install-inventory.service.types';

const defaultStorageClassAnnotation: string = 'storageclass.kubernetes.io/is-default-class';

export async function readKubernetesInstallInventory(
  input: KubernetesInstallInventoryInput,
): Promise<KubernetesInstallInventory> {
  const config: KubernetesConfigView = await readJson<KubernetesConfigView>(
    ['kubectl', '--kubeconfig', input.resolvedKubeconfig.path, 'config', 'view', '--output=json'],
    'kube contexts',
  );
  return { contexts: readContexts(config) };
}

export async function readKubernetesInstallResourceInventory(
  input: KubernetesInstallInventoryInput,
  contextName: string,
): Promise<KubernetesInstallResourceInventory> {
  const [ingressClasses, storageClasses]: [KubernetesInventoryList, KubernetesInventoryList] = await Promise.all([
    readJson<KubernetesInventoryList>(
      clusterCommand(input, contextName, ['get', 'ingressclasses.networking.k8s.io', '--output=json']),
      'IngressClasses',
    ),
    readJson<KubernetesInventoryList>(
      clusterCommand(input, contextName, ['get', 'storageclasses.storage.k8s.io', '--output=json']),
      'StorageClasses',
    ),
  ]);
  return {
    ingressClasses: readResourceNames(ingressClasses),
    storageClasses: readStorageClasses(storageClasses),
  };
}

function readContexts(config: KubernetesConfigView): KubernetesContextChoice[] {
  const servers: Map<string, string> = new Map<string, string>(
    (config.clusters ?? []).flatMap((cluster: KubernetesConfigCluster): [string, string][] =>
      cluster.name === undefined || cluster.cluster?.server === undefined
        ? []
        : [[cluster.name, cluster.cluster.server]],
    ),
  );
  return (config.contexts ?? []).flatMap((context: KubernetesConfigContext): KubernetesContextChoice[] => {
    const name: string | undefined = context.name;
    const apiServer: string | undefined =
      context.context?.cluster === undefined ? undefined : servers.get(context.context.cluster);
    return name === undefined || apiServer === undefined ? [] : [{ apiServer, name }];
  });
}

function readResourceNames(list: KubernetesInventoryList): string[] {
  return (list.items ?? [])
    .map((item: KubernetesInventoryResource): string | undefined => item.metadata?.name)
    .filter((name: string | undefined): name is string => name !== undefined);
}

function readStorageClasses(list: KubernetesInventoryList): KubernetesStorageClassChoice[] {
  return (list.items ?? []).flatMap((item: KubernetesInventoryResource): KubernetesStorageClassChoice[] =>
    item.metadata?.name === undefined
      ? []
      : [
          {
            default: item.metadata.annotations?.[defaultStorageClassAnnotation] === 'true',
            name: item.metadata.name,
          },
        ],
  );
}

function clusterCommand(
  input: KubernetesInstallInventoryInput,
  contextName: string,
  args: readonly string[],
): string[] {
  return ['kubectl', '--kubeconfig', input.resolvedKubeconfig.path, '--context', contextName, ...args];
}

async function readJson<T>(command: readonly string[], subject: string): Promise<T> {
  const result: CommandResult = await runCommand(command);
  if (result.exitCode !== 0) {
    const output: string = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim();
    throw new Error(`Cannot inspect Kubernetes ${subject}: ${output}.`);
  }
  try {
    const value: JsonValue = JSON.parse(result.stdout) as JsonValue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as T;
    }
  } catch {
    // The stable error below is used for malformed kubectl output.
  }
  throw new Error(`Kubernetes returned invalid ${subject}.`);
}
