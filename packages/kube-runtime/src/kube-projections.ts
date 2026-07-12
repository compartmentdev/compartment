import { createHash } from 'node:crypto';
import type {
  ApplicationProjectionOptions,
  ApplicationProjectionRow,
  KubeManifest,
  SecretProjectionRow,
} from './kube-runtime.types';
import { kubeApplicationName, kubeNamespaceName, kubeNetworkPolicyName, kubeSecretName } from './kube-naming';

const managedByLabel: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };
const metadataServiceCidr: string = ['169', '254', '0', '0/16'].join('.');

interface ApplicationProjectionContext {
  annotations: Record<string, string>;
  labels: Record<string, string>;
  deploymentId: string;
  name: string;
  namespace: string;
}

type NetworkPolicyKind = 'default-deny' | 'egress' | 'ingress';

export function projectApplicationManifests(
  row: ApplicationProjectionRow,
  options: ApplicationProjectionOptions,
): KubeManifest[] {
  const context: ApplicationProjectionContext = applicationProjectionContext(row);
  return [
    deploymentManifest(row, context),
    serviceManifest(row, context),
    defaultDenyManifest(context),
    applicationIngressManifest(row, options, context),
    applicationEgressManifest(options, context),
  ];
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

export function projectSecretManifest(row: SecretProjectionRow): KubeManifest {
  const orderedData: Record<string, string> = Object.fromEntries(
    Object.entries(row.data).sort(([left]: [string, string], [right]: [string, string]): number =>
      left.localeCompare(right),
    ),
  );
  const checksum: string = createHash('sha256').update(JSON.stringify(orderedData)).digest('hex');
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      annotations: { 'compartment.dev/checksum': checksum },
      labels: {
        ...managedByLabel,
        'compartment.dev/deployment-id': row.deploymentId,
        'compartment.dev/secret-id': row.secretId,
      },
      name: kubeSecretName(row.secretId),
      namespace: kubeNamespaceName(row.namespaceId),
    },
    stringData: orderedData,
    type: 'Opaque',
  };
}

function deploymentManifest(row: ApplicationProjectionRow, context: ApplicationProjectionContext): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: manifestMetadata(context),
    spec: deploymentSpec(row, context),
  };
}

function deploymentSpec(row: ApplicationProjectionRow, context: ApplicationProjectionContext): object {
  return {
    progressDeadlineSeconds: 45,
    replicas: row.replicas,
    selector: { matchLabels: context.labels },
    strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }, type: 'RollingUpdate' },
    template: {
      metadata: { annotations: context.annotations, labels: context.labels },
      spec: {
        automountServiceAccountToken: false,
        containers: [applicationContainer(row)],
        terminationGracePeriodSeconds: 45,
      },
    },
  };
}

function applicationContainer(row: ApplicationProjectionRow): object {
  const env: object[] = Object.entries(row.env)
    .sort(([left]: [string, string], [right]: [string, string]): number => left.localeCompare(right))
    .map(([name, value]: [string, string]): object => ({ name, value }));
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

function defaultDenyManifest(context: ApplicationProjectionContext): KubeManifest {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: policyMetadata(context, 'default-deny'),
    spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'] },
  };
}

function applicationIngressManifest(
  row: ApplicationProjectionRow,
  options: ApplicationProjectionOptions,
  context: ApplicationProjectionContext,
): KubeManifest {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: policyMetadata(context, 'ingress'),
    spec: applicationIngressSpec(row, options, context.labels),
  };
}

function applicationIngressSpec(
  row: ApplicationProjectionRow,
  options: ApplicationProjectionOptions,
  labels: Record<string, string>,
): object {
  const from: object = {
    namespaceSelector: { matchLabels: { 'compartment.dev/namespace-id': options.ingressNamespaceId } },
    podSelector: { matchLabels: options.ingressPodLabels },
  };
  return {
    ingress: [{ from: [from], ports: [{ port: row.containerPort, protocol: 'TCP' }] }],
    podSelector: { matchLabels: labels },
    policyTypes: ['Ingress'],
  };
}

function applicationEgressManifest(
  options: ApplicationProjectionOptions,
  context: ApplicationProjectionContext,
): KubeManifest {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: policyMetadata(context, 'egress'),
    spec: applicationEgressSpec(options, context.labels),
  };
}

function applicationEgressSpec(options: ApplicationProjectionOptions, labels: Record<string, string>): object {
  const dnsTarget: object = {
    namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
    podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
  };
  const internetTarget: object = {
    ipBlock: { cidr: '0.0.0.0/0', except: [metadataServiceCidr, options.podCidr, options.serviceCidr] },
  };
  return {
    egress: [
      {
        ports: [
          { port: 53, protocol: 'UDP' },
          { port: 53, protocol: 'TCP' },
        ],
        to: [dnsTarget],
      },
      { to: [internetTarget] },
    ],
    podSelector: { matchLabels: labels },
    policyTypes: ['Egress'],
  };
}

function manifestMetadata(context: ApplicationProjectionContext): object {
  return { annotations: context.annotations, labels: context.labels, name: context.name, namespace: context.namespace };
}

function policyMetadata(context: ApplicationProjectionContext, suffix: NetworkPolicyKind): object {
  return {
    labels: context.labels,
    name: kubeNetworkPolicyName(context.deploymentId, suffix),
    namespace: context.namespace,
  };
}
