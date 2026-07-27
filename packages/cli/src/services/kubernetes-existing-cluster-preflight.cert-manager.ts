import { runCommand, runCommandWithInput } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { assertApiResources } from './kubernetes-existing-cluster-preflight.cluster';
import { requiredCertManagerApis } from './kubernetes-existing-cluster-preflight.requirements';
import type { KubernetesInstallInput } from './kubernetes-install-input.service.types';
import type {
  KubernetesDeployment,
  KubernetesObjectList,
  KubernetesWebhook,
  KubernetesWebhookConfiguration,
  KubernetesWebhookServiceReference,
} from './kubernetes-existing-cluster-preflight.service.types';
import {
  buildPreflightKubectl,
  certManagerInstallInstruction,
  isPreflightNotFound,
  KubernetesExistingClusterPreflightError,
  readCommandFailure,
  readPreflightList,
} from './kubernetes-existing-cluster-preflight.support';

export async function assertCertManager(input: KubernetesInstallInput): Promise<void> {
  await assertApiResources(input, requiredCertManagerApis, 'cert-manager');
  const webhookService: KubernetesWebhookServiceReference = await readWebhookService(input);
  const deployments: KubernetesObjectList<KubernetesDeployment> = await readCertManagerDeployments(
    input,
    webhookService,
  );
  for (const component of ['controller', 'webhook', 'cainjector'] as const) {
    assertComponentReady(deployments.items, component, webhookService);
  }
  await assertCertificateDryRun(input);
}

async function readWebhookService(input: KubernetesInstallInput): Promise<KubernetesWebhookServiceReference> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'validatingwebhookconfigurations.admissionregistration.k8s.io', '-o=json']),
  );
  const list: KubernetesObjectList<KubernetesWebhookConfiguration> = readPreflightList(
    result,
    'cert-manager',
    'Cannot inspect admission webhooks.',
  );
  const services: KubernetesWebhookServiceReference[] = list.items.flatMap(readWebhookServices);
  if (services.length !== 1) {
    throw new KubernetesExistingClusterPreflightError(
      'cert-manager',
      `cert-manager webhook Service discovery found ${String(services.length)} matches; expected exactly one. ${certManagerInstallInstruction}`,
    );
  }
  return services[0]!;
}

async function readCertManagerDeployments(
  input: KubernetesInstallInput,
  webhookService: KubernetesWebhookServiceReference,
): Promise<KubernetesObjectList<KubernetesDeployment>> {
  const result: CommandResult = await runCommand(
    buildPreflightKubectl(input, ['get', 'deployments.apps', '--namespace', webhookService.namespace!, '-o=json']),
  );
  return readPreflightList(result, 'cert-manager', 'Cannot inspect cert-manager deployments.');
}

function assertComponentReady(
  deployments: readonly KubernetesDeployment[],
  component: 'cainjector' | 'controller' | 'webhook',
  webhookService: KubernetesWebhookServiceReference,
): void {
  const deployment: KubernetesDeployment | undefined = deployments.find((candidate: KubernetesDeployment): boolean =>
    isComponent(candidate, component, webhookService),
  );
  const desired: number = Math.max(1, deployment?.spec?.replicas ?? 1);
  const available: number = deployment?.status?.availableReplicas ?? 0;
  if (deployment === undefined || available < desired) {
    throw componentNotReady(component, webhookService);
  }
}

async function assertCertificateDryRun(input: KubernetesInstallInput): Promise<void> {
  const name: string = `compartment-preflight-${process.pid.toString()}`;
  const namespace: string = 'default';
  await assertObjectsAbsent(input, namespace, name);
  const result: CommandResult = await runCommandWithInput(
    buildPreflightKubectl(input, ['create', '--dry-run=server', '--filename=-', '--output=json']),
    buildCertificateManifest(name, namespace),
  );
  try {
    if (result.exitCode !== 0) {
      throw new KubernetesExistingClusterPreflightError(
        'cert-manager',
        `cert-manager webhook rejected the server-side Certificate dry-run: ${readCommandFailure(result)}. ${certManagerInstallInstruction}`,
      );
    }
  } finally {
    await assertObjectsAbsent(input, namespace, name);
  }
}

async function assertObjectsAbsent(input: KubernetesInstallInput, namespace: string, name: string): Promise<void> {
  for (const resource of ['certificates.cert-manager.io', 'secrets']) {
    const result: CommandResult = await runCommand(
      buildPreflightKubectl(input, ['get', resource, name, '--namespace', namespace, '-o=name']),
    );
    if (result.exitCode === 0) {
      throw persistentDryRunError(resource, name);
    }
    if (!isPreflightNotFound(result)) {
      throw new KubernetesExistingClusterPreflightError(
        'permissions',
        `Cannot verify that ${resource}/${name} is absent in namespace ${namespace}: ${readCommandFailure(result)}.`,
      );
    }
  }
}

function readWebhookServices(configuration: KubernetesWebhookConfiguration): KubernetesWebhookServiceReference[] {
  return (configuration.webhooks ?? [])
    .map((webhook: KubernetesWebhook): KubernetesWebhookServiceReference | undefined => webhook.clientConfig?.service)
    .filter(isCertManagerWebhookService);
}

function isCertManagerWebhookService(
  service: KubernetesWebhookServiceReference | undefined,
): service is KubernetesWebhookServiceReference {
  return (
    service?.name !== undefined && service.namespace !== undefined && service.name.includes('cert-manager-webhook')
  );
}

function isComponent(
  deployment: KubernetesDeployment,
  component: 'cainjector' | 'controller' | 'webhook',
  webhookService: KubernetesWebhookServiceReference,
): boolean {
  const labels: Record<string, string> = deployment.metadata?.labels ?? {};
  const name: string = deployment.metadata?.name ?? '';
  const standardComponent: string = labels['app.kubernetes.io/component'] ?? labels['app.kubernetes.io/name'] ?? '';
  const wrongWebhookNamespace: boolean =
    component === 'webhook' && deployment.metadata?.namespace !== webhookService.namespace;
  return (
    !wrongWebhookNamespace &&
    (standardComponent === component ||
      standardComponent === `cert-manager-${component}` ||
      (component === 'webhook' && name === webhookService.name))
  );
}

function buildCertificateManifest(name: string, namespace: string): string {
  return JSON.stringify({
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name, namespace },
    spec: {
      dnsNames: ['preflight.invalid'],
      issuerRef: { kind: 'Issuer', name: 'compartment-preflight' },
      secretName: name,
    },
  });
}

function componentNotReady(
  component: 'cainjector' | 'controller' | 'webhook',
  service: KubernetesWebhookServiceReference,
): KubernetesExistingClusterPreflightError {
  const serviceMessage: string =
    component === 'webhook' ? ` Expected Service ${service.namespace}/${service.name}.` : '';
  return new KubernetesExistingClusterPreflightError(
    'cert-manager',
    `cert-manager ${component} is missing or not ready.${serviceMessage} ${certManagerInstallInstruction}`,
  );
}

function persistentDryRunError(resource: string, name: string): KubernetesExistingClusterPreflightError {
  return new KubernetesExistingClusterPreflightError(
    'cert-manager',
    `Non-persistent preflight invariant failed: ${resource}/${name} exists after a server-side dry-run.`,
  );
}
