import { describe, expect, it } from 'vitest';
import { projectApplicationManifests } from '../src';
import type { ApplicationProjectionRow } from '../src/kube-application-projection.types';
import { kubeJobManifest, recoveredJobSpec } from '../src/kube-job-projection';
import type {
  KubeDeploymentManifest,
  KubeJobManifest,
  KubeJobSpec,
  KubeManifest,
  KubeProjectedInitContainer,
  KubeProjectedPodSpec,
  KubeProjectedSidecarContainer,
} from '../src/kube-runtime.types';
import type { KubeResourceReachabilityProbe } from '../src/kube-resource-reachability-projection.types';

const probe: KubeResourceReachabilityProbe = {
  command: ['node', 'dist/await-resources-job.js'],
  env: {
    COMPARTMENT_RESOURCE_REACHABILITY_TARGETS: '[{"host":"resource-db.cpt-p1.svc","port":5432,"timeoutMs":3000}]',
  },
  image: 'compartment-worker@sha256:worker',
};

describe('resource reachability gate', (): void => {
  it('holds an application Pod before its own container until the declared resource answers', (): void => {
    const podSpec: KubeProjectedPodSpec = applicationPodSpec(applicationRow(probe));
    const gate: KubeProjectedInitContainer | KubeProjectedSidecarContainer | undefined = podSpec.initContainers?.[0];

    expect(gate).toMatchObject({
      command: ['node', 'dist/await-resources-job.js'],
      env: [
        {
          name: 'COMPARTMENT_RESOURCE_REACHABILITY_TARGETS',
          value: '[{"host":"resource-db.cpt-p1.svc","port":5432,"timeoutMs":3000}]',
        },
      ],
      image: 'compartment-worker@sha256:worker',
      name: 'await-resources',
    });
    // A restartPolicy would make this a native sidecar that runs alongside the app instead of gating it.
    expect(gate).not.toHaveProperty('restartPolicy');
    expect(podSpec.containers[0]?.name).not.toBe('await-resources');
  });

  it('runs the gate as the platform image user even when the Pod runs as the resource image user', (): void => {
    const podSpec: KubeProjectedPodSpec = jobPodSpec({
      ...jobSpec(),
      resourceProbe: probe,
      securityProfile: 'resource-restricted',
    });

    expect(podSpec.securityContext).toMatchObject({ runAsUser: 70 });
    expect(podSpec.initContainers?.[0]?.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      runAsGroup: 10_001,
      runAsNonRoot: true,
      runAsUser: 10_001,
    });
  });

  it('adds no init container to a workload that declares no resources', (): void => {
    expect(applicationPodSpec(applicationRow(undefined)).initContainers).toBeUndefined();
    expect(jobPodSpec(jobSpec()).initContainers).toBeUndefined();
  });

  it('keeps the BuildKit sidecar when a Job carries both a gate and sidecars', (): void => {
    const podSpec: KubeProjectedPodSpec = jobPodSpec({
      ...jobSpec(),
      jobClass: 'build',
      resourceProbe: probe,
      scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
      sidecars: [{ env: {}, image: 'compartment-worker@sha256:worker', name: 'buildkit', volumeMounts: [] }],
    });

    expect(
      podSpec.initContainers?.map(
        (container: KubeProjectedInitContainer | KubeProjectedSidecarContainer): string => container.name,
      ),
    ).toEqual(['await-resources', 'buildkit']);
  });

  it('finalizes a recovered Job with the gate its immutable Pod template already carries', (): void => {
    const live: KubeJobManifest = kubeJobManifest({ ...jobSpec(), resourceProbe: probe }, 'job-1', {});

    const recovered: KubeJobSpec = recoveredJobSpec({ ...jobSpec(), resourceProbe: undefined }, live);

    expect(recovered.resourceProbe).toEqual(probe);
    expect(jobPodSpec(recovered).initContainers?.[0]?.name).toBe('await-resources');
  });
});

function applicationPodSpec(row: ApplicationProjectionRow): KubeProjectedPodSpec {
  const deployment: KubeManifest | undefined = projectApplicationManifests(row, 600_000).find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  );
  return (deployment as KubeDeploymentManifest).spec!.template.spec;
}

function jobPodSpec(spec: KubeJobSpec): KubeProjectedPodSpec {
  return kubeJobManifest(spec, 'job-1', {}).spec!.template.spec;
}

function applicationRow(resourceProbe: KubeResourceReachabilityProbe | undefined): ApplicationProjectionRow {
  return {
    containerPorts: [3000],
    deploymentId: 'dep_1',
    environmentId: 'env_1',
    environmentName: 'production',
    env: {},
    image: 'registry.example/app@sha256:abc',
    imagePullSecretId: 'prj_1',
    namespaceId: 'prj_1',
    organizationId: 'org_1',
    organizationName: 'Acme',
    projectIsolationVersion: 3,
    projectId: 'prj_1',
    projectName: 'checkout',
    readiness: null,
    replicas: 1,
    ...(resourceProbe === undefined ? {} : { resourceProbe }),
    runCommand: null,
    secretId: 'sec_1',
    serviceId: 'svc_1',
    serviceName: 'web',
    terminationGracePeriodSeconds: 45,
  };
}

function jobSpec(): KubeJobSpec {
  return {
    env: {},
    id: 'operation-op_1',
    image: 'postgres:16-alpine',
    jobClass: 'operation',
    labels: {},
    namespace: 'cpt-p1',
    timeoutMs: 60_000,
  };
}
