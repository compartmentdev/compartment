import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { KubeJobResult, KubeJobSpec, KubeRuntime } from '@compartment/kube-runtime';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments, type Document } from 'yaml';
import { readWorkerBuildConfig, type WorkerBuildConfig } from '../src/config';
import { runWorkerBuildJob } from '../src/services/worker-build-job.service';

interface RenderedConfigMap {
  data?: Record<string, string>;
  kind?: string;
}

interface RenderedContainer {
  name: string;
  resources?: RenderedContainerResources;
}

interface RenderedContainerResources {
  limits?: RenderedMemory;
  requests?: RenderedMemory;
}

interface RenderedMemory {
  memory?: string;
}

interface RenderedPodSpec {
  containers?: RenderedContainer[];
  initContainers?: RenderedContainer[];
}

interface RenderedWorkload {
  data?: Record<string, string>;
  kind?: string;
  metadata?: RenderedMetadata;
  spec?: RenderedWorkloadSpec;
}

interface RenderedMetadata {
  name?: string;
}

interface RenderedWorkloadSpec extends RenderedPodSpec {
  jobTemplate?: RenderedJobTemplate;
  template?: RenderedPodTemplate;
  validations?: RenderedValidation[];
}

interface RenderedValidation {
  expression?: string;
  message?: string;
}

type HelmValues = Record<string, string>;

interface RenderedJobTemplate {
  spec?: RenderedJobTemplateSpec;
}

interface RenderedJobTemplateSpec {
  template?: RenderedPodTemplate;
}

interface RenderedPodTemplate {
  spec?: RenderedPodSpec;
}

const executeFile = promisify(execFile);
const chartDirectory: string = resolve(__dirname, '../../../deploy/chart/compartment');
const expectedWorkloadContainers: readonly string[] = [
  'DaemonSet/memory-contract-compartment-log-agent/vector',
  'Deployment/memory-contract-capsule-controller-manager/manager',
  'Deployment/memory-contract-compartment-api/api',
  'Deployment/memory-contract-compartment-api/wait-for-api-migrate',
  'Deployment/memory-contract-compartment-caddy/caddy',
  'Deployment/memory-contract-compartment-caddy/prepare-caddy',
  'Deployment/memory-contract-compartment-caddy/wait-for-api-migrate',
  'Deployment/memory-contract-compartment-capacity-headroom/reserve',
  'Deployment/memory-contract-compartment-dns01/solver',
  'Deployment/memory-contract-compartment-dockerhub-cache/registry',
  'Deployment/memory-contract-compartment-edge/edge',
  'Deployment/memory-contract-compartment-edge/snapshots-ownership',
  'Deployment/memory-contract-compartment-edge/wait-for-api-migrate',
  'Deployment/memory-contract-compartment-postgres/postgres',
  'Deployment/memory-contract-compartment-project-provisioner/project-provisioner',
  'Deployment/memory-contract-compartment-project-provisioner/wait-for-api',
  'Deployment/memory-contract-compartment-project-provisioner/wait-for-api-migrate',
  'Deployment/memory-contract-compartment-project-provisioner/wait-for-api-rollout',
  'Deployment/memory-contract-compartment-registry-auth/registry-auth',
  'Deployment/memory-contract-compartment-registry-auth/wait-for-api-migrate',
  'Deployment/memory-contract-compartment-registry/registry',
  'Deployment/memory-contract-compartment-worker/wait-for-api',
  'Deployment/memory-contract-compartment-worker/wait-for-api-migrate',
  'Deployment/memory-contract-compartment-worker/wait-for-api-rollout',
  'Deployment/memory-contract-compartment-worker/worker',
  'Job/memory-contract-capsule-admission-cleanup/cleanup',
  'Job/memory-contract-compartment-api-migrate-1/api-migrate',
  'Job/memory-contract-compartment-api-migrate-1/wait-for-foundation',
];
describe('shipped platform memory contract', (): void => {
  it('renders every platform container with an honest memory request', async (): Promise<void> => {
    const documents: RenderedWorkload[] = await renderManagedPlatform();
    const workloads: RenderedWorkload[] = documents.filter((document: RenderedWorkload): boolean =>
      ['CronJob', 'DaemonSet', 'Deployment', 'Job', 'Pod', 'StatefulSet'].includes(document.kind ?? ''),
    );
    const renderedIdentities: string[] = [];

    for (const workload of workloads) {
      const podSpec: RenderedPodSpec | undefined = readRenderedPodSpec(workload);
      expect(
        podSpec,
        `${workload.kind ?? 'workload'}/${workload.metadata?.name ?? 'unknown'} has no Pod spec`,
      ).toBeDefined();
      for (const container of [...(podSpec?.initContainers ?? []), ...(podSpec?.containers ?? [])]) {
        const location: string = `${workload.kind ?? 'workload'}/${workload.metadata?.name ?? 'unknown'}/${container.name}`;
        renderedIdentities.push(location);
        expect(container.resources?.requests?.memory, `${location} has no memory request`).toBeDefined();
        expect(container.resources?.requests?.memory, `${location} can use more memory than Kubernetes schedules`).toBe(
          container.resources?.limits?.memory,
        );
      }
    }
    const sortedRenderedIdentities: string[] = renderedIdentities.toSorted((left: string, right: string): number =>
      left.localeCompare(right),
    );
    const sortedExpectedIdentities: string[] = expectedWorkloadContainers.toSorted(
      (left: string, right: string): number => left.localeCompare(right),
    );
    expect(sortedRenderedIdentities).toEqual(sortedExpectedIdentities);
  }, 30_000);

  it('submits the configured BuildKit data size through the rendered worker contract', async (): Promise<void> => {
    const dataSizeLimit: string = '3Gi';
    const documents: RenderedWorkload[] = await renderManagedPlatformWithValues({
      'buildkit.dataSizeLimit': dataSizeLimit,
      'resources.buildkit.limits.memory': '4Gi',
      'resources.buildkit.requests.memory': '4Gi',
    });
    const configMap: RenderedConfigMap | undefined = documents.find(
      (document: RenderedWorkload): boolean =>
        document.kind === 'ConfigMap' && 'COMPARTMENT_API_INTERNAL_HOST' in (document.data ?? {}),
    );
    const config: WorkerBuildConfig = readWorkerBuildConfig({
      ...configMap?.data,
      COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: 'registry-signing-key-with-at-least-32-characters',
      COMPARTMENT_LEADER_ELECTION_IDENTITY: 'memory-contract-worker',
      COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
    });
    expect(config.buildSandbox.dataSizeLimit).toBe(dataSizeLimit);
    const runtime = new CapturingBuildJobRuntime();

    await expect(
      runWorkerBuildJob(runtime, config, {
        build: {
          docker: {
            imageTag: 'memory-contract:latest',
            labels: {},
            pushImageInsecureRegistry: false,
            pushImageTag: 'registry.example.com/memory-contract:latest',
            pushRegistryCredentials: {
              password: 'password',
              serverAddress: 'registry.example.com',
              username: 'username',
            },
          },
          dockerfile: 'FROM scratch',
          kind: 'registry-verification',
        },
        id: 'build_memory_contract',
      }),
    ).rejects.toThrow(/Sandboxed build Job memory-contract failed/u);
    const spec: KubeJobSpec | undefined = runtime.spec;
    expect(spec?.sidecars?.map((sidecar): string => sidecar.name)).toEqual(['buildkit']);
    expect(spec?.emptyDirVolumes?.find((volume): boolean => volume.name === 'buildkit-data')).toMatchObject({
      gvisorTmpfs: true,
      sizeLimit: dataSizeLimit,
    });
    const resources: object[] = [spec?.sidecars?.[0]?.resources, spec?.resources].filter(
      (resource): resource is object => resource !== undefined,
    );
    expect(resources).toHaveLength(2);
    for (const resource of resources) {
      const containerResources: RenderedContainerResources = resource;
      expect(containerResources.requests?.memory).toBe(containerResources.limits?.memory);
    }
    const admissionPolicy: RenderedWorkload | undefined = documents.find(
      (document: RenderedWorkload): boolean => document.kind === 'ValidatingAdmissionPolicy',
    );
    const dataVolumeValidation: RenderedValidation | undefined = admissionPolicy?.spec?.validations?.find(
      (validation: RenderedValidation): boolean => validation.message?.includes('buildkit-data') ?? false,
    );
    expect(dataVolumeValidation?.expression).toContain(`quantity('${dataSizeLimit}')`);
    expect(dataVolumeValidation?.message).toBe(`Build Jobs must use a ${dataSizeLimit} buildkit-data emptyDir.`);
  }, 30_000);
});

// Rendering the whole chart takes several seconds, so both tests read one shared render.
let renderedPlatform: Promise<RenderedWorkload[]> | undefined;

async function renderManagedPlatform(): Promise<RenderedWorkload[]> {
  renderedPlatform ??= renderManagedPlatformOnce();
  return await renderedPlatform;
}

async function renderManagedPlatformWithValues(values: HelmValues): Promise<RenderedWorkload[]> {
  return await renderManagedPlatformOnce(values);
}

async function renderManagedPlatformOnce(values: HelmValues = {}): Promise<RenderedWorkload[]> {
  const { stdout } = await executeFile('helm', [
    'template',
    'memory-contract',
    chartDirectory,
    '--namespace',
    'compartment',
    ...managedPlatformValues(values),
  ]);
  return parseAllDocuments(stdout).map((document: Document): RenderedWorkload => document.toJSON() as RenderedWorkload);
}

function readRenderedPodSpec(workload: RenderedWorkload): RenderedPodSpec | undefined {
  if (workload.kind === 'Pod') {
    return workload.spec;
  }
  if (workload.kind === 'CronJob') {
    return workload.spec?.jobTemplate?.spec?.template?.spec;
  }
  return workload.spec?.template?.spec;
}

function managedPlatformValues(overrides: HelmValues = {}): string[] {
  const values: Record<string, string> = {
    'platform.startupStage': 'full',
    'platform.installationId': 'test-memory',
    'platform.domainMode': 'managed',
    'platform.baseDomain': 'managed.compartment.run',
    'platform.publicProtocol': 'https',
    'platform.tlsMode': 'broker-dns01',
    'platform.acmeEmail': 'admin@example.com',
    'nodePools.data.nodeSelector.compartment\\.dev/node-pool': 'data',
    'registry.hostname': ['10', '43', '250', '250'].join('.'),
    'registry.issuerRef.kind': 'Issuer',
    'registry.issuerRef.name': 'compartment-platform',
    'secrets.installToken': 'test-install-token',
    'secrets.postgresPassword': 'test-postgres-password',
    'secrets.registryCredentialSigningKey': 'test-registry-signing-key-with-at-least-32-characters',
    'secrets.edgeToken': 'test-edge-token',
    'secrets.productLogIngestToken': 'test-product-log-token',
    'secrets.runtimeControlToken': 'test-runtime-control-token',
    'secrets.sessionSecret': 'test-session-secret',
    'secrets.systemToken': 'test-system-token',
    'secrets.tenantSecretsKek': 'a'.repeat(64),
    'secrets.variablesMasterKey': 'test-variables-master-key',
    'secrets.managedDomainAcmeDnsToken': 'broker-token',
    ...overrides,
  };
  return Object.entries(values).flatMap(([name, value]: [string, string]): string[] => [
    '--set-string',
    `${name}=${value}`,
  ]);
}

class FailedBuildJobResult implements KubeJobResult {
  public readonly completedAt: Date = new Date(0);
  public readonly exitCode: number = 1;
  public readonly jobName: string = 'memory-contract';
  public readonly logs: string = '';
  public readonly podName: string = 'memory-contract-pod';
  public readonly status: 'failed' = 'failed';

  public async finalize(): Promise<void> {
    await Promise.resolve();
  }
}

class CapturingBuildJobRuntime implements Pick<KubeRuntime, 'runJob'> {
  public spec: KubeJobSpec | undefined;

  public async runJob(spec: KubeJobSpec): Promise<KubeJobResult> {
    this.spec = spec;
    return await Promise.resolve(new FailedBuildJobResult());
  }
}
