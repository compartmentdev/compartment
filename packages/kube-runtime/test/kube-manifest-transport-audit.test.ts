import { describe, expect, it } from 'vitest';
import { projectCustomDomainManifests } from '../src/kube-custom-domain-projection';
import type { CustomDomainProjectionRow } from '../src/kube-custom-domain-projection.types';
import { kubeFinalizedJobManifest, kubeJobManifest, kubeJobSecretManifest } from '../src/kube-job-projection';
import { projectLimitRangeManifest } from '../src/kube-limit-range-projection';
import { kubeResourceVolumeName } from '../src/kube-naming';
import { projectNetworkPolicyManifests } from '../src/kube-network-policy-projection';
import type { ProjectNetworkPolicyProjection } from '../src/kube-network-policy-projection.types';
import { organizationGlobalCustomQuotaManifests } from '../src/kube-organization-quota-projection';
import {
  projectProvisioningAuthorityBundle,
  projectProvisioningAuthorityCleanup,
} from '../src/kube-project-provisioning-authority';
import type { ProjectProvisioningAuthorityInput } from '../src/kube-project-provisioning-authority.types';
import { projectApplicationManifests } from '../src/kube-projections';
import type { ApplicationProjectionRow } from '../src/kube-application-projection.types';
import { projectNamespaceDeleteTarget, projectNamespaceProvisioningBundle } from '../src/kube-provisioning';
import type { ProjectNamespaceProvisioningRow } from '../src/kube-provisioning.types';
import {
  organizationQuotaCapacity,
  projectContainerDefaults,
  projectQuota,
  projectResourceConfiguration,
} from './kube-resource-configuration.test.fixture';
import {
  projectResourceBootstrapClaims,
  projectResourceClaimDeleteTargets,
  projectResourceManifests,
  projectResourceRollbackScheduling,
} from '../src/kube-resource-projection';
import type { ObservedResourceClaim, ResourceProjectionRow } from '../src/kube-resource-projection.types';
import type { KubeResourceReachabilityProbe } from '../src/kube-resource-reachability-projection.types';
import { projectResourceQuotaManifest } from '../src/kube-resource-quota-projection';
import { projectSecretManifest, registryPullSecretManifest } from '../src/kube-secret-projection';
import type { RegistryPullSecretProjectionRow, SecretProjectionRow } from '../src/kube-secret-projection.types';
import type { KubeJobSpec, KubeManifest } from '../src/kube-runtime.types';
import {
  auditManifestOnTheWire,
  bundleManifests,
  describeDifference,
  listManifestProjectionExports,
  serializeManifestOnTheWire,
} from './kube-transport-audit.harness';
import type { TransportAuditCase, WireDifference, WireObject } from './kube-transport-audit.test.types';

const infrastructureTimeoutMs: number = 600_000;
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');
const namespace: string = 'cpt-prj-01jz';
const namespaceId: string = 'prj-01jz';
const projectId: string = 'prj-01jz';
const resourceId: string = 'res-01jz';
const jobName: string = 'job-art-123';
const jobLabels: Readonly<Record<string, string>> = { 'compartment.dev/job-class': 'build' };

/**
 * Exported names that read like a manifest projection but never produce a standalone object this package applies.
 * They return Pod or container fragments that only reach the API server embedded in a registered manifest, so the
 * registered case already audits their fields.
 */
const podFragmentProjections: ReadonlySet<string> = new Set<string>([
  'projectConfiguredWorkloadScheduling',
  'projectPodSecurityContext',
  'projectResourceReachabilityInitContainer',
  'projectTenantScheduling',
  'projectVolumeSecurityContext',
]);

const transportAuditRegistry: readonly TransportAuditCase[] = [
  {
    manifests: (): KubeManifest[] => projectApplicationManifests(applicationRow(), infrastructureTimeoutMs),
    projection: 'projectApplicationManifests',
  },
  {
    manifests: (): KubeManifest[] => projectResourceManifests(resourceRow(), infrastructureTimeoutMs),
    projection: 'projectResourceManifests',
  },
  {
    manifests: (): KubeManifest[] =>
      projectResourceRollbackScheduling(
        projectResourceManifests(resourceRow(), infrastructureTimeoutMs),
        resourceRow(),
      ),
    projection: 'projectResourceRollbackScheduling',
  },
  {
    manifests: (): KubeManifest[] => projectResourceBootstrapClaims(resourceRow()),
    projection: 'projectResourceBootstrapClaims',
  },
  {
    manifests: (): KubeManifest[] => projectResourceClaimDeleteTargets(resourceRow(), observedResourceClaims()),
    projection: 'projectResourceClaimDeleteTargets',
  },
  { manifests: (): KubeManifest[] => [projectSecretManifest(secretRow())], projection: 'projectSecretManifest' },
  {
    manifests: (): KubeManifest[] => [registryPullSecretManifest(registryPullSecretRow())],
    projection: 'registryPullSecretManifest',
  },
  {
    manifests: (): KubeManifest[] => projectCustomDomainManifests(customDomainRow()),
    projection: 'projectCustomDomainManifests',
  },
  {
    manifests: (): KubeManifest[] => projectNetworkPolicyManifests(namespace, namespaceId, projectId, networkPolicy()),
    projection: 'projectNetworkPolicyManifests',
  },
  {
    manifests: (): KubeManifest[] => [
      projectLimitRangeManifest(namespace, namespaceId, projectId, projectContainerDefaults),
    ],
    projection: 'projectLimitRangeManifest',
  },
  {
    manifests: (): KubeManifest[] => [
      projectResourceQuotaManifest(namespace, namespaceId, projectId, projectQuota, projectContainerDefaults),
    ],
    projection: 'projectResourceQuotaManifest',
  },
  {
    manifests: (): KubeManifest[] =>
      organizationGlobalCustomQuotaManifests({
        capacity: organizationQuotaCapacity,
        organizationId: 'org-01jz',
        reconciliationRequestedAt: '2026-08-11T10:00:00.000Z',
      }),
    projection: 'organizationGlobalCustomQuotaManifests',
  },
  {
    manifests: (): KubeManifest[] =>
      bundleManifests(projectNamespaceProvisioningBundle(provisioningRow(), projectResourceConfiguration)),
    projection: 'projectNamespaceProvisioningBundle',
  },
  {
    manifests: (): KubeManifest[] => [projectNamespaceDeleteTarget(namespaceId)],
    projection: 'projectNamespaceDeleteTarget',
  },
  {
    manifests: (): KubeManifest[] => bundleManifests(projectProvisioningAuthorityBundle(authorityInput())),
    projection: 'projectProvisioningAuthorityBundle',
  },
  {
    manifests: (): KubeManifest[] => bundleManifests(projectProvisioningAuthorityCleanup(authorityInput())),
    projection: 'projectProvisioningAuthorityCleanup',
  },
  {
    manifests: (): KubeManifest[] => [kubeJobManifest(buildJobSpec(), jobName, jobLabels)],
    projection: 'kubeJobManifest',
  },
  {
    manifests: (): KubeManifest[] => [kubeFinalizedJobManifest(operationJobSpec(), jobName, jobLabels)],
    projection: 'kubeFinalizedJobManifest',
  },
  {
    manifests: (): KubeManifest[] => [kubeJobSecretManifest(operationJobSpec(), jobLabels)],
    projection: 'kubeJobSecretManifest',
  },
];

describe('Kubernetes manifest transport audit', (): void => {
  it('audits every manifest projection the package exports', async (): Promise<void> => {
    const covered: ReadonlySet<string> = new Set<string>(
      transportAuditRegistry.map((auditCase: TransportAuditCase): string => auditCase.projection),
    );
    const exported: string[] = await listManifestProjectionExports();

    const unaudited: string[] = exported.filter(
      (name: string): boolean => !covered.has(name) && !podFragmentProjections.has(name),
    );
    const renamed: string[] = [...covered].filter((name: string): boolean => !exported.includes(name));

    expect(unaudited, 'Add a transportAuditRegistry case for every manifest projection this package exports.').toEqual(
      [],
    );
    expect(renamed, 'A transportAuditRegistry case names a projection this package no longer exports.').toEqual([]);
  });

  for (const auditCase of transportAuditRegistry) {
    it(`sends every ${auditCase.projection} field to the Kubernetes API server`, async (): Promise<void> => {
      const manifests: KubeManifest[] = auditCase.manifests();
      // An empty projection serializes nothing, so without this the case would report "no losses" while auditing air.
      expect(
        manifests.length,
        `${auditCase.projection} built no manifest on its audit input, so this case compares nothing.`,
      ).toBeGreaterThan(0);

      const losses: string[] = [];
      for (const manifest of manifests) {
        const serialized: WireObject = await serializeManifestOnTheWire(manifest);
        const differences: WireDifference[] = auditManifestOnTheWire(manifest, serialized);
        losses.push(
          ...differences.map((difference: WireDifference): string =>
            describeDifference(auditCase.projection, manifest, difference),
          ),
        );
      }

      expect(losses).toEqual([]);
    });
  }
});

function applicationRow(): ApplicationProjectionRow {
  return {
    containerPorts: [8080],
    deploymentId: 'dep-01jz',
    environmentId: 'env-01jz',
    environmentName: 'Production',
    env: { FEATURE_FLAG: 'enabled', LOG_LEVEL: 'info' },
    image: 'registry.example/app@sha256:abc',
    imagePullSecretId: 'pull-01jz',
    namespaceId,
    organizationId: 'org-01jz',
    organizationName: 'Acme',
    projectIsolationVersion: 3,
    projectId,
    projectName: 'Checkout',
    readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
    replicas: 2,
    resourceProbe: reachabilityProbe(),
    runCommand: 'npm run start:override',
    scheduling: { nodeSelector: { 'compartment.dev/pool': 'tenant' }, tolerations: [] },
    secretId: 'sec-01jz',
    serviceId: 'svc-01jz',
    serviceName: 'Web',
    terminationGracePeriodSeconds: 45,
  };
}

function resourceRow(): ResourceProjectionRow {
  return {
    command: ['postgres', '-c', 'shared_buffers=256MB'],
    dataScheduling: {
      nodeSelector: { 'compartment.dev/node-pool': 'data' },
      runtimeClassName: 'gvisor',
      tolerations: [],
    },
    deleteData: false,
    environmentId: 'env-01jz',
    env: { POSTGRES_PASSWORD: 'generated' },
    image: 'docker.io/library/postgres:16-alpine@sha256:abc',
    namespaceId,
    operation: 'reconcile',
    ports: [5432, 9187],
    readiness: { port: 5432, timeoutMs: 30_000, type: 'tcp' },
    replicas: 1,
    resourceId,
    secretId: 'sec-resource',
    volumes: [{ mountPath: '/var/lib/postgresql/data', size: '10Gi', volumeHandle: 'data' }],
  };
}

function observedResourceClaims(): ObservedResourceClaim[] {
  return projectResourceBootstrapClaims(resourceRow()).map(
    (claim: KubeManifest, index: number): ObservedResourceClaim => ({
      bound: true,
      claimName: claim.metadata?.name ?? kubeResourceVolumeName(resourceId, 'data'),
      resourceVersion: `${index + 1}`,
      uid: `uid-${index + 1}`,
    }),
  );
}

function reachabilityProbe(): KubeResourceReachabilityProbe {
  return {
    command: ['/usr/local/bin/compartment-wait', '--timeout', '30s'],
    env: { COMPARTMENT_RESOURCE_HOST: 'res-01jz', COMPARTMENT_RESOURCE_PORT: '5432' },
    image: 'compartment-worker@sha256:runner',
  };
}

function secretRow(): SecretProjectionRow {
  return { data: { DATABASE_URL: 'postgres://app' }, deploymentId: 'dep-01jz', namespaceId, secretId: 'sec-01jz' };
}

function registryPullSecretRow(): RegistryPullSecretProjectionRow {
  return { dockerConfigJson: '{"auths":{}}', namespaceId, secretId: 'pull-01jz' };
}

function customDomainRow(): CustomDomainProjectionRow {
  return {
    caddyServiceName: 'compartment-caddy',
    domainId: 'cdom_immutable',
    host: 'app.customer.example.com',
    ingressClassName: 'traefik',
    issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
    namespace: 'compartment',
  };
}

function networkPolicy(): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPorts: [8080],
    edgeNamespaceName: 'compartment',
    edgePodLabels: { 'app.kubernetes.io/component': 'proxy' },
    podCidr,
    resourcePodLabels: { app: 'resource' },
    resourcePorts: [5432],
    serviceCidr,
  };
}

function provisioningRow(): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: { name: 'bootstrap', namespace: 'compartment' },
    installationId: 'inst-01jz',
    namespaceId,
    networkPolicy: networkPolicy(),
    organizationId: 'org-01jz',
    projectId,
    projectName: 'Checkout',
    registryPullCredentials: { dockerConfigJson: '{"auths":{}}', secretId: 'pull-01jz' },
    workerServiceAccount: { name: 'worker', namespace: 'compartment' },
  };
}

function authorityInput(): ProjectProvisioningAuthorityInput {
  return { jobId: 'art-123', namespace, serviceAccountName: 'compartment-project-bootstrap' };
}

function buildJobSpec(): KubeJobSpec {
  return {
    configMapVolumes: [{ configMapName: 'compartment-buildkit', name: 'buildkit-config' }],
    emptyDirVolumes: [
      { gvisorTmpfs: true, name: 'buildkit-data', sizeLimit: '3Gi' },
      { containerMountPath: '/tmp', gvisorTmpfs: true, name: 'tmp', sizeLimit: '1Gi' },
    ],
    env: { BUILD_INPUT: 'secret' },
    id: 'art_123',
    image: 'compartment-worker@sha256:runner',
    jobClass: 'build',
    labels: jobLabels,
    namespace,
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    securityProfile: 'restricted',
    sidecars: [
      {
        args: ['--addr', 'tcp://127.0.0.1:1234', '--oci-worker=true'],
        command: ['/usr/local/bin/buildkitd'],
        env: { HOME: '/tmp' },
        image: 'compartment-worker@sha256:runner',
        name: 'buildkit',
        volumeMounts: [
          { mountPath: '/var/lib/buildkit', name: 'buildkit-data' },
          {
            mountPath: '/etc/buildkit/buildkitd.toml',
            name: 'buildkit-config',
            readOnly: true,
            subPath: 'buildkitd.toml',
          },
        ],
      },
    ],
    timeoutMs: 900_000,
  };
}

function operationJobSpec(): KubeJobSpec {
  return {
    args: ['migrate'],
    command: ['/bin/sh', '-c'],
    env: { DATABASE_URL: 'postgres://app' },
    id: 'art_456',
    image: 'registry.example/app@sha256:abc',
    imagePullSecretId: 'pull-01jz',
    jobClass: 'operation',
    labels: jobLabels,
    namespace,
    resourceProbe: reachabilityProbe(),
    resources: { limits: { cpu: '1', memory: '1Gi' }, requests: { cpu: '50m', memory: '128Mi' } },
    securityProfile: 'project-restricted',
    serviceAccountName: namespace,
    timeoutMs: 300_000,
  };
}
