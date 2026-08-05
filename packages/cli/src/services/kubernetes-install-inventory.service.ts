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
  KubernetesInstallIssuerChoice,
  KubernetesInstallIssuerKind,
  KubernetesInstallResourceInventory,
  KubernetesInstallResourceLists,
  KubernetesInventoryList,
  KubernetesInventoryResource,
  KubernetesStorageClassChoice,
} from './kubernetes-install-inventory.service.types';

const defaultStorageClassAnnotation: string = 'storageclass.kubernetes.io/is-default-class';
const certManagerVersion: string = 'v1.21.0';

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
  namespace: string,
): Promise<KubernetesInstallResourceInventory> {
  const lists: KubernetesInstallResourceLists = await readResourceLists(input, contextName, namespace);
  return {
    ingressClasses: readResourceNames(lists.ingressClasses),
    issuers: [
      ...readIssuerChoices(lists.issuers, 'Issuer'),
      ...readIssuerChoices(lists.clusterIssuers, 'ClusterIssuer'),
    ],
    storageClasses: readStorageClasses(lists.storageClasses),
  };
}

async function readResourceLists(
  input: KubernetesInstallInventoryInput,
  contextName: string,
  namespace: string,
): Promise<KubernetesInstallResourceLists> {
  const [ingressClasses, storageClasses, issuers, clusterIssuers]: KubernetesInventoryList[] = await Promise.all([
    readClusterList(input, contextName, 'ingressclasses.networking.k8s.io', 'IngressClasses'),
    readClusterList(input, contextName, 'storageclasses.storage.k8s.io', 'StorageClasses'),
    readNamespacedIssuerList(input, contextName, namespace),
    readClusterIssuerList(input, contextName),
  ]);
  return {
    clusterIssuers: clusterIssuers!,
    ingressClasses: ingressClasses!,
    issuers: issuers!,
    storageClasses: storageClasses!,
  };
}

async function readClusterList(
  input: KubernetesInstallInventoryInput,
  contextName: string,
  resource: string,
  subject: string,
): Promise<KubernetesInventoryList> {
  return await readJson<KubernetesInventoryList>(
    clusterCommand(input, contextName, ['get', resource, '--output=json']),
    subject,
  );
}

async function readNamespacedIssuerList(
  input: KubernetesInstallInventoryInput,
  contextName: string,
  namespace: string,
): Promise<KubernetesInventoryList> {
  const args: string[] = ['--namespace', namespace, 'get', 'issuers.cert-manager.io', '--output=json'];
  return await readCertManagerResources<KubernetesInventoryList>(clusterCommand(input, contextName, args), 'Issuers');
}

async function readClusterIssuerList(
  input: KubernetesInstallInventoryInput,
  contextName: string,
): Promise<KubernetesInventoryList> {
  const command: string[] = clusterCommand(input, contextName, [
    'get',
    'clusterissuers.cert-manager.io',
    '--output=json',
  ]);
  return await readCertManagerResources<KubernetesInventoryList>(command, 'ClusterIssuers');
}

function readIssuerChoices(
  list: KubernetesInventoryList,
  kind: KubernetesInstallIssuerKind,
): KubernetesInstallIssuerChoice[] {
  return readResourceNames(list).map((name: string): KubernetesInstallIssuerChoice => ({ kind, name }));
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

async function readCertManagerResources<T>(command: readonly string[], subject: string): Promise<T> {
  try {
    return await readJson<T>(command, subject);
  } catch (error) {
    const detail: string = error instanceof Error ? error.message : String(error);
    if (/doesn['’]t have a resource type|the server could not find the requested resource/iu.test(detail)) {
      throw missingCertManagerPrerequisiteError();
    }
    throw error;
  }
}

function missingCertManagerPrerequisiteError(): Error {
  return new Error(`Missing prerequisite: cert-manager CRDs are not installed.
Run:
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/${certManagerVersion}/cert-manager.yaml
  kubectl --namespace cert-manager wait deployment --all --for=condition=Available --timeout=5m
Then apply your CA Issuer or ClusterIssuer manifest, distribute its CA to every node and this machine, and rerun compartment install.`);
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
