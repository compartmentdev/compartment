import type { V1ObjectMeta } from '@kubernetes/client-node';
import type { ApplicationProjectionRow, KubeReadinessProbe } from './kube-application-projection.types';
import type {
  KubeDeploymentManifest,
  KubeDeploymentManifestSpec,
  KubeManifest,
  KubeProjectedContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
} from './kube-runtime.types';
import { kubeApplicationIdentityName, kubeNamespaceName, kubeSecretName } from './kube-naming';
import { projectSecretManifest, secretChecksum, secretEnvironment } from './kube-secret-projection';

const managedByLabel: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

interface ApplicationProjectionContext {
  annotations: Record<string, string>;
  labels: Record<string, string>;
  deploymentId: string;
  name: string;
  namespace: string;
  workloadLabels: Record<string, string>;
}

const minimumTerminationGracePeriodSeconds: number = 45;

export function projectApplicationManifests(row: ApplicationProjectionRow): KubeManifest[] {
  assertTerminationGracePeriod(row.terminationGracePeriodSeconds ?? minimumTerminationGracePeriodSeconds);
  const context: ApplicationProjectionContext = applicationProjectionContext(row);
  const secret: KubeManifest = projectSecretManifest({
    data: row.env,
    deploymentId: row.deploymentId,
    namespaceId: row.namespaceId,
    secretId: row.secretId,
  });
  return [secret, deploymentManifest(row, context), serviceManifest(row, context)];
}

function applicationProjectionContext(row: ApplicationProjectionRow): ApplicationProjectionContext {
  const workloadLabels: Record<string, string> = {
    ...managedByLabel,
    'compartment.dev/environment-id': row.environmentId,
    'compartment.dev/organization-id': row.organizationId,
    'compartment.dev/project-id': row.projectId,
    'compartment.dev/service-id': row.serviceId,
  };
  const deploymentLabels: Record<string, string> = {
    ...workloadLabels,
    'compartment.dev/deployment-id': row.deploymentId,
  };
  return {
    annotations: displayAnnotations(row),
    labels: deploymentLabels,
    deploymentId: row.deploymentId,
    name: kubeApplicationIdentityName(row.environmentId, row.serviceId),
    namespace: kubeNamespaceName(row.namespaceId),
    workloadLabels,
  };
}

function displayAnnotations(row: ApplicationProjectionRow): Record<string, string> {
  return {
    'compartment.dev/environment-name': row.environmentName,
    'compartment.dev/organization-name': row.organizationName,
    'compartment.dev/project-name': row.projectName,
    'compartment.dev/service-name': row.serviceName,
  };
}

function deploymentManifest(
  row: ApplicationProjectionRow,
  context: ApplicationProjectionContext,
): KubeDeploymentManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: manifestMetadata(context),
    spec: deploymentSpec(row, context),
  };
}

function deploymentSpec(
  row: ApplicationProjectionRow,
  context: ApplicationProjectionContext,
): KubeDeploymentManifestSpec {
  const podSpec: KubeProjectedPodSpec = {
    automountServiceAccountToken: false,
    containers: [applicationContainer(row)],
    imagePullSecrets: [{ name: kubeSecretName(row.imagePullSecretId) }],
    terminationGracePeriodSeconds: row.terminationGracePeriodSeconds ?? minimumTerminationGracePeriodSeconds,
  };
  return {
    progressDeadlineSeconds: 45,
    replicas: row.replicas,
    selector: { matchLabels: context.workloadLabels },
    strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }, type: 'RollingUpdate' },
    template: {
      metadata: {
        annotations: { ...context.annotations, 'compartment.dev/secret-checksum': secretChecksum(row.env) },
        labels: context.workloadLabels,
      },
      spec: podSpec,
    },
  };
}

function applicationContainer(row: ApplicationProjectionRow): KubeProjectedContainer {
  const env: KubeSecretEnvVariable[] = secretEnvironment(row.env, kubeSecretName(row.secretId));
  return {
    env,
    image: row.image,
    lifecycle: { preStop: { exec: { command: ['sh', '-c', 'sleep 3'] } } },
    name: 'app',
    ports: [{ containerPort: row.containerPort, name: 'http', protocol: 'TCP' }],
    readinessProbe: readinessProbe(),
  };
}

function readinessProbe(): KubeReadinessProbe {
  return {
    failureThreshold: 3,
    httpGet: { path: '/', port: 'http' },
    initialDelaySeconds: 1,
    periodSeconds: 2,
    successThreshold: 1,
    timeoutSeconds: 1,
  };
}

function serviceManifest(row: ApplicationProjectionRow, context: ApplicationProjectionContext): KubeManifest {
  const metadata: V1ObjectMeta = {
    annotations: context.annotations,
    labels: context.workloadLabels,
    name: context.name,
    namespace: context.namespace,
  };
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata,
    spec: {
      ports: [{ name: 'http', port: 80, protocol: 'TCP', targetPort: row.containerPort }],
      selector: context.workloadLabels,
    },
  };
}

function manifestMetadata(context: ApplicationProjectionContext): V1ObjectMeta {
  return { annotations: context.annotations, labels: context.labels, name: context.name, namespace: context.namespace };
}

function assertTerminationGracePeriod(value: number): void {
  if (!Number.isInteger(value) || value < minimumTerminationGracePeriodSeconds) {
    throw new Error(
      `Application termination grace period must be an integer of at least ${minimumTerminationGracePeriodSeconds} seconds.`,
    );
  }
}
