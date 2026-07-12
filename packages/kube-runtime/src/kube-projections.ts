import type {
  ApplicationProjectionRow,
  KubeDeploymentManifest,
  KubeDeploymentManifestSpec,
  KubeManifest,
  KubeProjectedContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
} from './kube-runtime.types';
import { kubeApplicationName, kubeNamespaceName, kubeSecretName } from './kube-naming';
import { projectSecretManifest, secretChecksum, secretEnvironment } from './kube-secret-projection';

const managedByLabel: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

interface ApplicationProjectionContext {
  annotations: Record<string, string>;
  labels: Record<string, string>;
  deploymentId: string;
  name: string;
  namespace: string;
}

export function projectApplicationManifests(row: ApplicationProjectionRow): KubeManifest[] {
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
  const selectorLabels: Record<string, string> = {
    ...managedByLabel,
    'compartment.dev/deployment-id': row.deploymentId,
    'compartment.dev/environment-id': row.environmentId,
    'compartment.dev/organization-id': row.organizationId,
    'compartment.dev/project-id': row.projectId,
    'compartment.dev/service-id': row.serviceId,
  };
  const displayAnnotations: Record<string, string> = {
    'compartment.dev/environment-name': row.environmentName,
    'compartment.dev/organization-name': row.organizationName,
    'compartment.dev/project-name': row.projectName,
    'compartment.dev/service-name': row.serviceName,
  };
  return {
    annotations: displayAnnotations,
    labels: selectorLabels,
    deploymentId: row.deploymentId,
    name: kubeApplicationName(row.deploymentId),
    namespace: kubeNamespaceName(row.namespaceId),
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
    terminationGracePeriodSeconds: 45,
  };
  return {
    progressDeadlineSeconds: 45,
    replicas: row.replicas,
    selector: { matchLabels: context.labels },
    strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }, type: 'RollingUpdate' },
    template: {
      metadata: {
        annotations: { ...context.annotations, 'compartment.dev/secret-checksum': secretChecksum(row.env) },
        labels: context.labels,
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

function readinessProbe(): object {
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
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: manifestMetadata(context),
    spec: {
      ports: [{ name: 'http', port: 80, protocol: 'TCP', targetPort: row.containerPort }],
      selector: context.labels,
    },
  };
}

function manifestMetadata(context: ApplicationProjectionContext): object {
  return { annotations: context.annotations, labels: context.labels, name: context.name, namespace: context.namespace };
}
