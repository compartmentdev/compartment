import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import {
  KubernetesObjectApi,
  RequestContext,
  type HttpMethod,
  type KubernetesObject,
  type RequestBody,
} from '@kubernetes/client-node';
import {
  KubeRuntime,
  type ApplyBundle,
  type KubeJobResult,
  type KubeJobSpec,
  type KubeManifest,
} from '@compartment/kube-runtime';
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
}

interface RenderedJobTemplate {
  spec?: RenderedJobTemplateSpec;
}

interface RenderedJobTemplateSpec {
  template?: RenderedPodTemplate;
}

interface RenderedPodTemplate {
  spec?: RenderedPodSpec;
}

interface SerializedJobPodSpec {
  containers: RenderedContainer[];
  initContainers?: RenderedContainer[];
}

interface SerializedJob {
  spec: { template: { spec: SerializedJobPodSpec } };
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
const platformResourcePaths: readonly string[] = [
  'resources.api',
  'resources.apiMigrate',
  'resources.worker',
  'resources.projectProvisioner',
  'resources.edge',
  'resources.edgeInit',
  'resources.caddy',
  'resources.caddyInit',
  'resources.postgres',
  'resources.registry',
  'resources.registryAuth',
  'resources.dns01Solver',
  'resources.buildkit',
  'resources.buildRunner',
  'resources.productLogAgent',
  'resources.wait',
  'capsule.manager.resources',
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
  });

  it.each(platformResourcePaths)('rejects an unequal %s operator override', async (path: string): Promise<void> => {
    await expect(
      executeFile('helm', [
        'template',
        'memory-contract',
        chartDirectory,
        '--set-string',
        `${path}.requests.memory=127Mi`,
      ]),
    ).rejects.toThrow(`${path} requests.memory must equal limits.memory`);
  });

  it('serializes honest chart memory into the Kubernetes build Job', async (): Promise<void> => {
    const documents: RenderedWorkload[] = await renderManagedPlatform();
    const configMap: RenderedConfigMap | undefined = documents.find(
      (document: RenderedWorkload): boolean => document.kind === 'ConfigMap',
    );
    const config: WorkerBuildConfig = readWorkerBuildConfig({
      ...configMap?.data,
      COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: 'registry-signing-key-with-at-least-32-characters',
      COMPARTMENT_LEADER_ELECTION_IDENTITY: 'memory-contract-worker',
      COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
    });
    const runtime = new SerializedBuildJobRuntime();

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
    const serialized: SerializedJob = JSON.parse(runtime.jobBody ?? '') as SerializedJob;
    const podSpec: SerializedJobPodSpec = serialized.spec.template.spec;
    const buildContainers: RenderedContainer[] = [...(podSpec.initContainers ?? []), ...podSpec.containers];

    expect(buildContainers.map((container: RenderedContainer): string => container.name)).toEqual(['buildkit', 'job']);
    for (const container of buildContainers) {
      expect(container.resources?.requests?.memory).toBe(container.resources?.limits?.memory);
    }
  });
});

async function renderManagedPlatform(): Promise<RenderedWorkload[]> {
  const { stdout } = await executeFile('helm', [
    'template',
    'memory-contract',
    chartDirectory,
    '--namespace',
    'compartment',
    ...managedPlatformValues(),
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

function managedPlatformValues(): string[] {
  const values: Record<string, string> = {
    'platform.startupStage': 'full',
    'platform.installationId': 'test-memory',
    'platform.domainMode': 'managed',
    'platform.baseDomain': 'managed.compartment.run',
    'platform.publicProtocol': 'https',
    'platform.tlsMode': 'broker-dns01',
    'platform.acmeEmail': 'admin@example.com',
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

class SerializedBuildJobRuntime implements Pick<KubeRuntime, 'runJob'> {
  private readonly api = new CapturingKubernetesObjectApi();
  private readonly execution: KubeRuntime;
  private readonly transport: KubeRuntime;

  public constructor() {
    this.transport = new KubeRuntime({ makeApiClient: (): KubernetesObjectApi => this.api } as never);
    this.execution = Object.create(KubeRuntime.prototype) as KubeRuntime;
    Object.assign(this.execution, {
      apply: async (bundle: ApplyBundle): Promise<KubeManifest[]> => await this.transport.apply(bundle),
      captureJob: (): KubeJobResult => new FailedBuildJobResult(),
      completeJob: async (): Promise<object> => await Promise.resolve({ exitCode: 1, logs: '', status: 'failed' }),
      read: async (): Promise<null> => await Promise.resolve(null),
    });
  }

  public get jobBody(): string | null {
    return this.api.jobBody;
  }

  public async runJob(spec: KubeJobSpec): Promise<KubeJobResult> {
    return await this.execution.runJob(spec);
  }
}

class CapturingKubernetesObjectApi extends KubernetesObjectApi {
  public jobBody: string | null = null;

  public constructor() {
    super({
      baseServer: {
        makeRequestContext: (path: string, method: HttpMethod): RequestContext =>
          new RequestContext(`https://kubernetes.test${path}`, method),
      },
    } as never);
  }

  protected override async specUriPath(): Promise<string> {
    return await Promise.resolve('/apis/batch/v1/namespaces/compartment/jobs/memory-contract');
  }

  protected override async requestPromise<T extends KubernetesObject>(requestContext: RequestContext): Promise<T> {
    const body: RequestBody = requestContext.getBody();
    if (typeof body !== 'string') {
      throw new Error('Expected the Kubernetes request body to be serialized JSON.');
    }
    const object: KubernetesObject = JSON.parse(body) as KubernetesObject;
    if (object.kind === 'Job') {
      this.jobBody = body;
    }
    return await Promise.resolve(object as T);
  }
}
