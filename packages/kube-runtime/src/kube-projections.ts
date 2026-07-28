import type { V1ObjectMeta } from '@kubernetes/client-node';
import type {
  ApplicationProjectionRow,
  ApplicationReadinessConfig,
  KubeContainerPort,
  KubeReadinessProbe,
} from './kube-application-projection.types';
import type {
  KubeDeploymentManifest,
  KubeDeploymentManifestSpec,
  KubeManifest,
  KubeProjectedContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
  KubeServicePort,
} from './kube-runtime.types';
import { kubeApplicationIdentityName, kubeApplicationName, kubeNamespaceName, kubeSecretName } from './kube-naming';
import { projectSecretManifest, secretChecksum, secretEnvironment } from './kube-secret-projection';
import { projectPodSecurityContext, restrictedContainerSecurityContext } from './kube-security-context';

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
  assertContainerPorts(row.containerPorts);
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
    app: 'application',
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
  return {
    progressDeadlineSeconds: progressDeadlineSeconds(row.readiness),
    replicas: row.replicas,
    selector: { matchLabels: context.workloadLabels },
    strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }, type: 'RollingUpdate' },
    template: {
      metadata: {
        annotations: { ...context.annotations, 'compartment.dev/secret-checksum': secretChecksum(row.env) },
        labels: { ...context.workloadLabels, 'compartment.dev/deployment-id': row.deploymentId },
      },
      spec: applicationPodSpec(row),
    },
  };
}

function applicationPodSpec(row: ApplicationProjectionRow): KubeProjectedPodSpec {
  return {
    automountServiceAccountToken: false,
    containers: [applicationContainer(row)],
    imagePullSecrets: [{ name: kubeSecretName(row.imagePullSecretId) }],
    securityContext: projectPodSecurityContext(),
    serviceAccountName: kubeNamespaceName(row.namespaceId),
    terminationGracePeriodSeconds: row.terminationGracePeriodSeconds ?? minimumTerminationGracePeriodSeconds,
  };
}

function applicationContainer(row: ApplicationProjectionRow): KubeProjectedContainer {
  const env: KubeSecretEnvVariable[] = secretEnvironment(row.env, kubeSecretName(row.secretId));
  return {
    ...(row.runCommand === null ? {} : { args: [row.runCommand] }),
    env,
    image: row.image,
    lifecycle: { preStop: { exec: { command: ['sh', '-c', 'sleep 3'] } } },
    name: kubeApplicationName(row.deploymentId),
    securityContext: restrictedContainerSecurityContext(),
    ports: row.containerPorts.map(
      (containerPort: number, index: number): KubeContainerPort => ({
        containerPort,
        name: index === 0 ? 'http' : applicationPortName(containerPort),
        protocol: 'TCP',
      }),
    ),
    ...(row.readiness === null ? {} : { readinessProbe: readinessProbe(row.readiness) }),
  };
}

function readinessProbe(readiness: ApplicationReadinessConfig): KubeReadinessProbe {
  return {
    failureThreshold: 3,
    httpGet: { path: readiness.path, port: 'http' },
    initialDelaySeconds: 1,
    periodSeconds: 2,
    successThreshold: 1,
    timeoutSeconds: 1,
  };
}

function progressDeadlineSeconds(readiness: ApplicationReadinessConfig | null): number {
  return readiness === null ? 45 : Math.ceil(readiness.timeoutMs / 1_000);
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
      ports: applicationServicePorts(row.containerPorts),
      selector: context.workloadLabels,
    },
  };
}

function applicationServicePorts(containerPorts: number[]): KubeServicePort[] {
  const primaryPort: number | undefined = containerPorts[0];
  if (primaryPort === undefined) {
    throw new Error('Application projection requires at least one container port.');
  }
  const ports: KubeServicePort[] = [{ name: 'http', port: 80, protocol: 'TCP', targetPort: primaryPort }];
  for (const containerPort of containerPorts) {
    if (containerPort !== 80) {
      ports.push({
        name: applicationPortName(containerPort),
        port: containerPort,
        protocol: 'TCP',
        targetPort: containerPort,
      });
    }
  }
  return ports;
}

function applicationPortName(port: number): string {
  return `tcp-${port}`;
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

function assertContainerPorts(ports: number[]): void {
  if (
    ports.length === 0 ||
    new Set(ports).size !== ports.length ||
    ports.some((port: number): boolean => !Number.isInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new Error('Application container ports must be unique valid TCP ports.');
  }
}
