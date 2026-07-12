import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  kubeSecretName,
  platformBuildManifests,
  projectApplicationManifests,
  type KubeManifest,
  type PlatformBuildProjectionInput,
} from '../src';

const linkLocalCidr: string = ['169', '254', '0', '0/16'].join('.');
const metadataServiceCidr: string = ['169', '254', '169', '254/32'].join('.');
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');
const privateNetworkCidrs: string[] = [
  `${[10, 0, 0, 0].join('.')}/8`,
  `${[172, 16, 0, 0].join('.')}/12`,
  `${[192, 168, 0, 0].join('.')}/16`,
];

interface DeploymentPodSpec {
  containers: {
    args?: string[] | undefined;
    command?: string[] | undefined;
    resources?: object | undefined;
    securityContext?: object | undefined;
    volumeMounts?: object[] | undefined;
  }[];
  imagePullSecrets?: { name: string }[] | undefined;
  securityContext?: object | undefined;
}

describe('platform build projection', (): void => {
  it('projects the P9 rootless build platform as a private deterministic bundle', (): void => {
    const manifests: KubeManifest[] = platformBuildManifests(platformInput());
    const namespace: KubeManifest = manifest(manifests, 'Namespace', undefined);
    const buildkit: KubeManifest = manifest(manifests, 'Deployment', 'buildkit');
    const podSpec: DeploymentPodSpec = deploymentPodSpec(buildkit);
    const serialized: string = JSON.stringify(manifests);
    const registry: KubeManifest = manifest(manifests, 'Deployment', 'registry');
    const registryPodSpec: DeploymentPodSpec = deploymentPodSpec(registry);
    const prune: KubeManifest = manifest(manifests, 'CronJob', 'buildkit-prune');
    const buildkitPolicy: KubeManifest = manifest(manifests, 'NetworkPolicy', 'buildkit');

    expect(toYaml(manifests)).toMatchSnapshot();
    expect(namespace.metadata?.labels).toMatchObject({
      'pod-security.kubernetes.io/audit': 'baseline',
      'pod-security.kubernetes.io/enforce': 'privileged',
      'pod-security.kubernetes.io/warn': 'baseline',
    });
    expect(podSpec.securityContext).toEqual({
      fsGroup: 1000,
      fsGroupChangePolicy: 'OnRootMismatch',
      seccompProfile: { type: 'Unconfined' },
    });
    expect(podSpec.containers[0]?.securityContext).toEqual({
      allowPrivilegeEscalation: true,
      appArmorProfile: { type: 'Unconfined' },
      readOnlyRootFilesystem: true,
      runAsGroup: 1000,
      runAsNonRoot: true,
      runAsUser: 1000,
    });
    expect(podSpec.containers[0]?.args).toEqual([
      '--addr',
      'tcp://0.0.0.0:1234',
      '--oci-worker-no-process-sandbox',
      '--oci-worker-gc-keepstorage',
      '2000',
    ]);
    expect(manifest(manifests, 'PersistentVolumeClaim', 'registry-data').spec).toMatchObject({
      resources: { requests: { storage: '8Gi' } },
    });
    expect(registryPodSpec.containers[0]?.volumeMounts).toContainEqual({
      mountPath: '/var/lib/registry',
      name: 'data',
    });
    expect(registryPodSpec.containers[0]?.resources).toEqual({
      limits: { cpu: '500m', memory: '512Mi' },
      requests: { cpu: '100m', memory: '128Mi' },
    });
    expect(cronJobContainer(prune).command).toEqual(['buildctl']);
    expect(buildkitPolicy.spec).toMatchObject({
      egress: [
        {
          ports: [
            { port: 53, protocol: 'UDP' },
            { port: 53, protocol: 'TCP' },
          ],
        },
        {
          ports: [
            { port: 80, protocol: 'TCP' },
            { port: 443, protocol: 'TCP' },
          ],
          to: [
            {
              ipBlock: {
                cidr: '0.0.0.0/0',
                except: [metadataServiceCidr, linkLocalCidr, ...privateNetworkCidrs, podCidr, serviceCidr],
              },
            },
          ],
        },
        { ports: [{ port: 5000, protocol: 'TCP' }] },
      ],
      ingress: [
        {
          from: [
            {
              namespaceSelector: { matchLabels: { 'compartment.dev/namespace-id': 'worker-01jz' } },
              podSelector: { matchLabels: { 'app.kubernetes.io/name': 'worker' } },
            },
          ],
        },
      ],
    });
    expect(serialized).not.toContain('procMount');
    expect(serialized).not.toContain('LoadBalancer');
    expect(serialized).not.toContain('NodePort');
    expect(serialized).not.toContain('pod-security.kubernetes.io/enforce":"baseline');
  });

  it('projects external registry credentials and egress without bundled registry resources', (): void => {
    const input: PlatformBuildProjectionInput = platformInput();
    const manifests: KubeManifest[] = platformBuildManifests({
      ...input,
      registry: {
        credentials: {
          dockerConfigJson: '{"auths":{"registry.external":{"auth":"generated"}}}',
          secretId: 'external-pull-01jz',
        },
        egressCidr: '203.0.113.10/32',
        endpoint: 'registry.external:5443',
        mode: 'external',
        port: 5443,
      },
    });
    const buildkitPolicy: KubeManifest = manifest(manifests, 'NetworkPolicy', 'buildkit');

    expect(toYaml(manifests)).toMatchSnapshot();
    expect(manifests.some((item: KubeManifest): boolean => item.metadata?.name === 'registry')).toBe(false);
    expect(manifests.some((item: KubeManifest): boolean => item.metadata?.name === 'registry-data')).toBe(false);
    expect(manifests.filter((item: KubeManifest): boolean => item.kind === 'Secret')).toHaveLength(1);
    expect(manifest(manifests, 'Deployment', 'buildkit').metadata?.annotations).toEqual({
      'compartment.dev/registry-endpoint': 'registry.external:5443',
    });
    expect((buildkitPolicy.spec as { egress: object[] }).egress).toContainEqual({
      ports: [{ port: 5443, protocol: 'TCP' }],
      to: [{ ipBlock: { cidr: '203.0.113.10/32' } }],
    });
  });

  it('references the namespace-owned registry pull Secret without emitting deployment-owned credentials', (): void => {
    const manifests: KubeManifest[] = projectApplicationManifests({
      containerPort: 8080,
      deploymentId: 'dep-01jz',
      environmentId: 'env-01jz',
      environmentName: 'Production',
      env: {},
      image: 'registry.example/app@sha256:abc',
      imagePullSecretId: 'pull-01jz',
      namespaceId: 'prj-01jz',
      organizationId: 'org-01jz',
      organizationName: 'Acme',
      projectId: 'prj-01jz',
      projectName: 'Checkout',
      replicas: 1,
      secretId: 'sec-01jz',
      serviceId: 'svc-01jz',
      serviceName: 'Web',
    });
    const podSpec: DeploymentPodSpec = deploymentPodSpec(manifest(manifests, 'Deployment', undefined));

    expect(manifests.some((item: KubeManifest): boolean => item.type === 'kubernetes.io/dockerconfigjson')).toBe(false);
    expect(podSpec.imagePullSecrets).toEqual([{ name: kubeSecretName('pull-01jz') }]);
  });
});

function platformInput(): PlatformBuildProjectionInput {
  return {
    buildkitImage: 'moby/buildkit:v0.30.0-rootless',
    dnsNamespaceSelector: { 'kubernetes.io/metadata.name': 'kube-system' },
    dnsPodSelector: { 'k8s-app': 'kube-dns' },
    internetEgress: { podCidr, serviceCidr },
    platformId: 'platform-01jz',
    registry: {
      credentials: {
        dockerConfigJson: '{"auths":{"registry":{"auth":"generated"}}}',
        htpasswd: 'compartment:$2y$generated',
        secretId: 'registry-pull-01jz',
      },
      image: 'registry:2.8.3',
      mode: 'bundled',
      secretId: 'registry-auth-01jz',
    },
    workerNamespaceSelector: { 'compartment.dev/namespace-id': 'worker-01jz' },
    workerPodSelector: { 'app.kubernetes.io/name': 'worker' },
  };
}

function manifest(manifests: KubeManifest[], kind: string, name: string | undefined): KubeManifest {
  return manifests.find(
    (item: KubeManifest): boolean => item.kind === kind && (name === undefined || item.metadata?.name === name),
  )!;
}

function deploymentPodSpec(deployment: KubeManifest): DeploymentPodSpec {
  return (deployment.spec as { template: { spec: DeploymentPodSpec } }).template.spec;
}

function cronJobContainer(cronJob: KubeManifest): { command?: string[] | undefined } {
  return (cronJob.spec as { jobTemplate: { spec: { template: { spec: { containers: { command?: string[] }[] } } } } })
    .jobTemplate.spec.template.spec.containers[0]!;
}

function toYaml(manifests: KubeManifest[]): string {
  return manifests
    .map((item: KubeManifest): string => stringify(item, { sortMapEntries: true }).trim())
    .join('\n---\n');
}
