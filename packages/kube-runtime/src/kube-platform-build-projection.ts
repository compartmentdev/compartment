import { kubeNamespaceName, kubeSecretName } from './kube-naming';
import { platformBuildNetworkPolicies } from './kube-platform-build-network-policy';
import { platformBuildPruneCronJob } from './kube-platform-build-prune-projection';
import {
  buildkitContainerSecurityContext,
  buildkitPodSecurityContext,
  componentLabels,
  restrictedContainerSecurityContext,
  restrictedPodSecurityContext,
  workloadResources,
} from './kube-platform-build-projection-support';
import { projectSecretManifest, registryPullSecretManifest } from './kube-secret-projection';
import type {
  BundledPlatformRegistryProjection,
  PlatformBuildProjectionInput,
  PlatformRegistryPullCredentials,
} from './kube-platform-build-projection.types';
import type {
  KubeManifest,
  KubeProjectedContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
  KubePodVolume,
  KubeVolumeMount,
} from './kube-runtime.types';

const buildkitPort: number = 1234;
const registryPort: number = 5000;
const managedLabels: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

export function platformBuildManifests(input: PlatformBuildProjectionInput): KubeManifest[] {
  const namespace: string = kubeNamespaceName(input.platformId);
  return [
    namespaceManifest(namespace, input.platformId),
    registryPullSecret(input),
    buildkitClaim(namespace),
    ...bundledRegistryManifests(input, namespace),
    buildkitDeployment(input, namespace),
    service(namespace, 'buildkit', buildkitPort),
    platformBuildPruneCronJob(input, namespace),
    ...platformBuildNetworkPolicies(input, namespace),
  ];
}

function registryPullSecret(input: PlatformBuildProjectionInput): KubeManifest {
  const credentials: PlatformRegistryPullCredentials = input.registry.credentials;
  return registryPullSecretManifest({
    dockerConfigJson: credentials.dockerConfigJson,
    namespaceId: input.platformId,
    secretId: credentials.secretId,
  });
}

function bundledRegistryManifests(input: PlatformBuildProjectionInput, namespace: string): KubeManifest[] {
  if (input.registry.mode === 'external') {
    return [];
  }
  const registry: BundledPlatformRegistryProjection = input.registry;
  const secretName: string = kubeSecretName(registry.secretId);
  return [
    registryAuthSecret(input, registry),
    registryClaim(namespace),
    registryDeployment(registry, namespace, secretName),
    service(namespace, 'registry', registryPort),
  ];
}

function registryAuthSecret(
  input: PlatformBuildProjectionInput,
  registry: BundledPlatformRegistryProjection,
): KubeManifest {
  return projectSecretManifest({
    data: {
      REGISTRY_AUTH: 'htpasswd',
      REGISTRY_AUTH_HTPASSWD_PATH: '/auth/htpasswd',
      REGISTRY_AUTH_HTPASSWD_REALM: 'Compartment Registry',
      htpasswd: registry.credentials.htpasswd,
    },
    deploymentId: input.platformId,
    namespaceId: input.platformId,
    secretId: registry.secretId,
  });
}

function namespaceManifest(namespace: string, platformId: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      labels: {
        ...managedLabels,
        'compartment.dev/platform-id': platformId,
        'pod-security.kubernetes.io/audit': 'baseline',
        'pod-security.kubernetes.io/enforce': 'privileged',
        'pod-security.kubernetes.io/warn': 'baseline',
      },
      name: namespace,
    },
  };
}

function buildkitClaim(namespace: string): KubeManifest {
  return persistentVolumeClaim(namespace, 'buildkit-data', '8Gi');
}

function registryClaim(namespace: string): KubeManifest {
  return persistentVolumeClaim(namespace, 'registry-data', '8Gi');
}

function persistentVolumeClaim(namespace: string, name: string, storage: string): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { labels: managedLabels, name, namespace },
    spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage } } },
  };
}

function registryDeployment(
  registry: BundledPlatformRegistryProjection,
  namespace: string,
  secretName: string,
): KubeManifest {
  const labels: Record<string, string> = componentLabels('registry');
  return deployment(
    namespace,
    'registry',
    labels,
    {},
    {
      automountServiceAccountToken: false,
      containers: [registryContainer(registry, secretName)],
      securityContext: restrictedPodSecurityContext(),
      terminationGracePeriodSeconds: 45,
      volumes: [
        { name: 'auth', secret: { secretName } },
        { name: 'data', persistentVolumeClaim: { claimName: 'registry-data' } },
      ],
    },
  );
}

function registryContainer(registry: BundledPlatformRegistryProjection, secretName: string): KubeProjectedContainer {
  const names: string[] = ['REGISTRY_AUTH', 'REGISTRY_AUTH_HTPASSWD_REALM', 'REGISTRY_AUTH_HTPASSWD_PATH'];
  return {
    env: names.map((name: string): KubeSecretEnvVariable => secretEnvironmentVariable(name, secretName)),
    image: registry.image,
    name: 'registry',
    ports: [{ containerPort: registryPort, name: 'registry' }],
    resources: workloadResources('100m', '128Mi', '500m', '512Mi'),
    securityContext: restrictedContainerSecurityContext(),
    volumeMounts: [
      { mountPath: '/auth', name: 'auth', readOnly: true },
      { mountPath: '/var/lib/registry', name: 'data' },
    ],
  };
}

function buildkitDeployment(input: PlatformBuildProjectionInput, namespace: string): KubeManifest {
  const labels: Record<string, string> = componentLabels('buildkit');
  return deployment(
    namespace,
    'buildkit',
    labels,
    { 'compartment.dev/registry-endpoint': registryEndpoint(input) },
    {
      automountServiceAccountToken: false,
      containers: [buildkitContainer(input)],
      securityContext: buildkitPodSecurityContext(),
      terminationGracePeriodSeconds: 45,
      volumes: buildkitVolumes(input.registry.credentials.secretId),
    },
  );
}

function buildkitContainer(input: PlatformBuildProjectionInput): KubeProjectedContainer {
  return {
    args: [
      '--addr',
      `tcp://0.0.0.0:${buildkitPort}`,
      '--oci-worker-no-process-sandbox',
      '--oci-worker-gc-keepstorage',
      '2000',
    ],
    env: [],
    image: input.buildkitImage,
    name: 'buildkit',
    ports: [{ containerPort: buildkitPort, name: 'buildkit' }],
    resources: workloadResources('250m', '256Mi', '2', '2Gi'),
    securityContext: buildkitContainerSecurityContext(),
    volumeMounts: buildkitVolumeMounts(),
  };
}

function buildkitVolumeMounts(): KubeVolumeMount[] {
  return [
    { mountPath: '/home/user/.local/share/buildkit', name: 'data' },
    { mountPath: '/home/user/.local/tmp', name: 'rootless-tmp' },
    { mountPath: '/run/user/1000', name: 'run' },
    { mountPath: '/tmp', name: 'tmp' },
    {
      mountPath: '/home/user/.docker/config.json',
      name: 'registry-auth',
      readOnly: true,
      subPath: '.dockerconfigjson',
    },
  ];
}

function buildkitVolumes(secretId: string): KubePodVolume[] {
  return [
    { name: 'data', persistentVolumeClaim: { claimName: 'buildkit-data' } },
    { name: 'registry-auth', secret: { secretName: kubeSecretName(secretId) } },
    { emptyDir: {}, name: 'rootless-tmp' },
    { emptyDir: {}, name: 'run' },
    { emptyDir: {}, name: 'tmp' },
  ];
}

function deployment(
  namespace: string,
  name: string,
  labels: Record<string, string>,
  annotations: Record<string, string>,
  podSpec: KubeProjectedPodSpec,
): KubeManifest {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { annotations, labels, name, namespace },
    spec: {
      progressDeadlineSeconds: 45,
      replicas: 1,
      selector: { matchLabels: labels },
      strategy: { type: 'Recreate' },
      template: { metadata: { labels }, spec: podSpec },
    },
  };
}

function registryEndpoint(input: PlatformBuildProjectionInput): string {
  return input.registry.mode === 'bundled' ? `registry:${registryPort}` : input.registry.endpoint;
}

function service(namespace: string, name: string, port: number): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { labels: managedLabels, name, namespace },
    spec: {
      ports: [{ name, port, protocol: 'TCP', targetPort: port }],
      selector: componentLabels(name),
      type: 'ClusterIP',
    },
  };
}

function secretEnvironmentVariable(name: string, secretName: string): KubeSecretEnvVariable {
  return { name, valueFrom: { secretKeyRef: { key: name, name: secretName } } };
}
