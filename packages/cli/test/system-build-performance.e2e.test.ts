import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  deployResponseSchema,
  deploymentRunLogsResponseSchema,
  deploymentInspectResponseSchema,
  type DeployResponse,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentRunLogLine,
  type DeploymentRunLogsResponse,
  type DeploymentRunStepSummary,
  type DeploymentSummary,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { expect, it } from 'vitest';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  describeSelfHostedUserSetupE2e,
  expectSelfHostedUserSetupStepCompleted,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import { readK3dPlatformSeed, type K3dPlatformSeed } from './self-hosted-user-setup-k3d.harness';
import {
  expectSuccessfulCommand,
  runCommand,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

interface BuildFixture {
  readonly sourceKind: 'dockerfile' | 'railpack';
  readonly liveLogPattern: RegExp;
  readonly mutatePath: string;
  readonly name: string;
  readonly sourceDirectory: string;
}

interface BuildJobEvidence {
  readonly jobNames: Set<string>;
  readonly jobUids: Set<string>;
  readonly podDocuments: Map<string, KubernetesPodDocument>;
}

interface KubernetesContainer {
  readonly args?: readonly string[] | undefined;
  readonly env?: readonly KubernetesEnvironmentVariable[] | undefined;
  readonly name: string;
  readonly securityContext?: KubernetesSecurityContext | undefined;
  readonly volumeMounts?: readonly KubernetesVolumeMount[] | undefined;
}

interface KubernetesEnvironmentVariable {
  readonly name: string;
  readonly value?: string | undefined;
  readonly valueFrom?: KubernetesEnvironmentValueFrom | undefined;
}

interface KubernetesEnvironmentValueFrom {
  readonly secretKeyRef?: KubernetesSecretKeyReference | undefined;
}

interface KubernetesSecretKeyReference {
  readonly name?: string | undefined;
}

interface KubernetesMetadata {
  readonly name: string;
  readonly namespace: string;
  readonly ownerReferences?: readonly KubernetesOwnerReference[] | undefined;
  readonly uid: string;
}

interface KubernetesListMetadata {
  readonly resourceVersion: string;
}

interface KubernetesJobList {
  readonly metadata: KubernetesListMetadata;
}

interface KubernetesJobWatchEvent {
  readonly type: string;
  readonly object: KubernetesWatchedJob;
}

interface KubernetesWatchedJob {
  readonly metadata: KubernetesWatchedJobMetadata;
}

interface KubernetesWatchedJobMetadata {
  readonly name: string;
  readonly uid: string;
}

interface KubernetesOwnerReference {
  readonly kind: string;
  readonly name: string;
  readonly uid: string;
}

interface KubernetesPodDocument {
  readonly metadata: KubernetesMetadata;
  readonly spec: KubernetesPodSpec;
}

interface KubernetesPodList {
  readonly items: readonly KubernetesPodDocument[];
}

interface KubernetesPodSpec {
  readonly containers: readonly KubernetesContainer[];
  readonly hostNetwork?: boolean | undefined;
  readonly hostUsers?: boolean | undefined;
  readonly initContainers?: readonly KubernetesContainer[] | undefined;
  readonly runtimeClassName?: string | undefined;
  readonly securityContext?: KubernetesSecurityContext | undefined;
  readonly volumes?: readonly KubernetesVolume[] | undefined;
}

interface KubernetesAppArmorProfile {
  readonly type?: string | undefined;
}

interface KubernetesCapabilities {
  readonly add?: readonly string[] | undefined;
  readonly drop?: readonly string[] | undefined;
}

interface KubernetesSeccompProfile {
  readonly type?: string | undefined;
}

interface KubernetesSecurityContext {
  readonly allowPrivilegeEscalation?: boolean | undefined;
  readonly appArmorProfile?: KubernetesAppArmorProfile | undefined;
  readonly capabilities?: KubernetesCapabilities | undefined;
  readonly privileged?: boolean | undefined;
  readonly seccompProfile?: KubernetesSeccompProfile | undefined;
}

interface KubernetesVolume {
  readonly emptyDir?: object | undefined;
  readonly hostPath?: object | undefined;
  readonly name: string;
  readonly persistentVolumeClaim?: object | undefined;
  readonly secret?: object | undefined;
}

interface KubernetesVolumeMount {
  readonly mountPath: string;
  readonly name: string;
}

interface ObservedDeploy {
  readonly durationMs: number;
  readonly evidence: BuildJobEvidence;
  readonly imageRef: string;
  readonly liveLogs: string;
  readonly persistedLogs: string;
}

interface ObservedConcurrentDeploys {
  readonly evidence: BuildJobEvidence;
}

interface BuildJobWatcher {
  stop(): Promise<ReadonlySet<string>>;
}

interface IdentifiedDeployment {
  readonly id: string;
}

const buildPerformanceTimeoutMs: number = 60 * 60_000;
const kubectlTimeoutMs: number = 60_000;
const unchangedSampleCount: number = 20;
const unchangedP95LimitMs: number = 5_000;
const detachedDeploymentSettlementTimeoutMs: number = 15 * 60_000;
const fixtures: readonly BuildFixture[] = [
  {
    sourceKind: 'dockerfile',
    liveLogPattern: /Build strategy: Dockerfile\./u,
    mutatePath: 'server.mjs',
    name: 'build-performance-dockerfile',
    sourceDirectory: resolve(__dirname, '../../../examples/dockerfile'),
  },
  {
    sourceKind: 'railpack',
    liveLogPattern: /Build strategy: Railpack\./u,
    mutatePath: 'server.mjs',
    name: 'build-performance-railpack',
    sourceDirectory: resolve(__dirname, '../../../examples/railpack'),
  },
];

describeSelfHostedUserSetupE2e('self-hosted build performance acceptance', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();
  let runtime: SelfHostedUserSetupRuntime;
  let admin: SelfHostedUserSetupCli;
  let completedStepCount: number = 0;

  it(
    'installs the system and logs in with the CLI',
    async (): Promise<void> => {
      runtime = await setup.install();
      admin = await setup.createFreshCli();
      await admin.runBrowserLogin(
        `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
        {
          email: runtime.adminEmail,
          password: runtime.adminPassword,
        },
        { requestOrigin: runtime.apiUrl },
      );
      completedStepCount = 1;
    },
    selfHostedUserSetupTimeoutMs,
  );

  for (const fixture of fixtures) {
    it(
      `accepts cold, changed, unchanged, concurrent, and isolated ${fixture.name} builds`,
      async (): Promise<void> => {
        expectSelfHostedUserSetupStepCompleted(completedStepCount, 1);
        const fixtureDirectory: string = await copyFixture(fixture);
        try {
          const cold: ObservedDeploy = await observeDeploy(
            admin,
            fixture.name,
            fixtureDirectory,
            fixture.liveLogPattern,
          );
          expect(cold.evidence.jobUids.size).toBe(1);
          expectBuildJobIsolation(cold.evidence);
          expect(cold.liveLogs).toMatch(fixture.liveLogPattern);
          expect(cold.persistedLogs).toContain('Mandatory SBOM stored.');
          if (fixture.sourceKind === 'dockerfile') {
            expect(await readFile(join(fixtureDirectory, 'Dockerfile'), 'utf8')).toContain('FROM');
            expect(cold.liveLogs).not.toMatch(/Build strategy: Railpack\./u);
          } else {
            await expect(readFile(join(fixtureDirectory, 'Dockerfile'), 'utf8')).rejects.toMatchObject({
              code: 'ENOENT',
            });
          }

          await mutateFixture(fixtureDirectory, fixture.mutatePath, 'warm-changed');
          const changed: ObservedDeploy = await observeDeploy(
            admin,
            fixture.name,
            fixtureDirectory,
            fixture.liveLogPattern,
          );
          expect(changed.evidence.jobUids.size).toBe(1);
          expect(changed.liveLogs).toMatch(fixture.liveLogPattern);
          expect(changed.persistedLogs).toMatch(/importing cache manifest|import-cache/iu);
          expect(changed.persistedLogs).toMatch(/\bCACHED\b/u);
          expect(changed.persistedLogs).toContain('Mandatory SBOM stored.');
          expectBuildJobIsolation(changed.evidence);

          const unchangedDurations: number[] = [];
          for (let sample: number = 0; sample < unchangedSampleCount; sample += 1) {
            const unchanged: ObservedDeploy = await observeUnchangedResolution(admin, fixture.name, fixtureDirectory);
            unchangedDurations.push(unchanged.durationMs);
            expect(unchanged.evidence.jobUids.size).toBe(0);
            expect(`${unchanged.liveLogs}\n${unchanged.persistedLogs}`).not.toMatch(
              /downloading|extracting|unpacking/iu,
            );
          }
          const unchangedP95Ms: number = readP95(unchangedDurations);
          process.stdout.write(
            `build_performance fixture=${fixture.name} cold_ms=${cold.durationMs} changed_ms=${changed.durationMs} unchanged_p95_ms=${unchangedP95Ms}\n`,
          );
          expect(unchangedP95Ms).toBeLessThanOrEqual(unchangedP95LimitMs);

          await mutateFixture(fixtureDirectory, fixture.mutatePath, 'concurrent');
          const concurrent: ObservedConcurrentDeploys = await observeConcurrentDeploys(
            admin,
            fixture.name,
            fixtureDirectory,
          );
          expect(concurrent.evidence.jobUids.size).toBe(1);
          expectBuildJobIsolation(concurrent.evidence);
        } finally {
          await cleanupProject(admin, fixture.name);
          await rm(fixtureDirectory, { force: true, recursive: true });
        }
      },
      buildPerformanceTimeoutMs,
    );
  }

  it(
    'keeps simultaneous tenant build jobs isolated',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedStepCount, 1);
      const firstDirectory: string = await copyFixture(fixtures[1]!);
      const secondDirectory: string = await copyFixture(fixtures[1]!);
      const firstName: string = 'build-isolation-first';
      const secondName: string = 'build-isolation-second';
      const secondOrganizationSlug: string = `build-isolation-${Date.now()}`;
      const secondAdmin: SelfHostedUserSetupCli = await setup.createFreshCli();
      try {
        await renameFixture(firstDirectory, firstName);
        await renameFixture(secondDirectory, secondName);
        await secondAdmin.runBrowserLogin(
          `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
          { email: runtime.adminEmail, password: runtime.adminPassword },
          { requestOrigin: runtime.apiUrl },
        );
        await secondAdmin.run(`org create --name "Build Isolation" --slug ${secondOrganizationSlug}`);
        await secondAdmin.run(`org use ${secondOrganizationSlug}`);
        const [first, second]: [ObservedDeploy, ObservedDeploy] = await Promise.all([
          observeDeploy(admin, firstName, firstDirectory),
          observeDeploy(secondAdmin, secondName, secondDirectory),
        ]);
        const evidence: BuildJobEvidence = mergeEvidence(first.evidence, second.evidence);
        expect(evidence.jobUids.size).toBe(2);
        expectBuildJobIsolation(evidence);
        expectDistinctWritableBuildState(evidence);
      } finally {
        await Promise.all([cleanupProject(admin, firstName), cleanupProject(secondAdmin, secondName)]);
        await Promise.all([
          rm(firstDirectory, { force: true, recursive: true }),
          rm(secondDirectory, { force: true, recursive: true }),
        ]);
      }
    },
    buildPerformanceTimeoutMs,
  );
});

async function copyFixture(fixture: BuildFixture): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), `${fixture.name}-`));
  await cp(fixture.sourceDirectory, directory, { recursive: true });
  await renameFixture(directory, fixture.name);
  return directory;
}

function createBuildJobEvidence(): BuildJobEvidence {
  return {
    jobNames: new Set<string>(),
    jobUids: new Set<string>(),
    podDocuments: new Map<string, KubernetesPodDocument>(),
  };
}

async function mutateFixture(directory: string, path: string, marker: string): Promise<void> {
  const target: string = join(directory, path);
  const comment: string = path.endsWith('.py') ? '#' : '//';
  await writeFile(target, `${await readFile(target, 'utf8')}\n${comment} ${marker}-${Date.now()}\n`);
}

async function renameFixture(directory: string, name: string): Promise<void> {
  const configPath: string = join(directory, 'compartment.yml');
  await writeFile(configPath, (await readFile(configPath, 'utf8')).replace(/^name: .*$/mu, `name: ${name}`));
}

async function observeDeploy(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  cwd: string,
  liveLogPattern?: RegExp,
): Promise<ObservedDeploy> {
  const existingPodUids: Set<string> = await readBuildPodUids();
  const evidence: BuildJobEvidence = createBuildJobEvidence();
  const jobWatcher: BuildJobWatcher = await startBuildJobWatcher();
  let observing: boolean = true;
  const observer: Promise<void> = observeBuildJobs(evidence, existingPodUids, (): boolean => observing);
  let result: SelfHostedUserSetupCommandResult;
  let payload: DeployResponse;
  let liveLogs: string = '';
  const startedAt: number = performance.now();
  try {
    result = await cli.run('deploy --detach --output json', { cwd });
    payload = deployResponseSchema.parse(JSON.parse(result.stdout) as JsonValue);
    const liveLogsPromise: Promise<string> =
      liveLogPattern === undefined
        ? Promise.resolve('')
        : waitForLiveBuildLogs(cli, projectName, payload.deploymentRunId, liveLogPattern);
    [liveLogs] = await Promise.all([liveLogsPromise, waitForDetachedDeployment(cli, projectName, payload)]);
  } finally {
    observing = false;
    const [, jobUids]: [void, ReadonlySet<string>] = await Promise.all([observer, jobWatcher.stop()]);
    addObservedJobUids(evidence, jobUids);
  }
  const settledDurationMs: number = performance.now() - startedAt;
  const observed: ObservedDeploy = await buildObservedDeploy(
    cli,
    projectName,
    result,
    evidence,
    requireSingleDeploymentId(payload.deployments),
    payload.deploymentRunId,
    liveLogs,
  );
  return { ...observed, durationMs: settledDurationMs };
}

async function waitForLiveBuildLogs(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  deploymentRunId: string,
  expectedPattern: RegExp,
): Promise<string> {
  const deadline: number = Date.now() + detachedDeploymentSettlementTimeoutMs;
  for (;;) {
    const payload: DeploymentRunLogsResponse = await cli.runJson(
      `deployment logs --project ${projectName} --run ${deploymentRunId}`,
      deploymentRunLogsResponseSchema,
    );
    const logs: string = payload.lines.map((line: DeploymentRunLogLine): string => line.message).join('\n');
    const completedStep: DeploymentRunStepSummary | undefined = payload.steps.find(
      (step: DeploymentRunStepSummary): boolean => step.stepKey === 'completed',
    );
    if (completedStep?.status === 'failed' || completedStep?.status === 'succeeded') {
      throw new Error(`Deployment run ${deploymentRunId} completed before expected live build logs were observed.`);
    }
    if (expectedPattern.test(logs)) {
      return logs;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Expected live build logs were not observed for deployment run ${deploymentRunId}.`);
    }
    await sleep(250);
  }
}

async function observeUnchangedResolution(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  cwd: string,
): Promise<ObservedDeploy> {
  const existingPodUids: Set<string> = await readBuildPodUids();
  const evidence: BuildJobEvidence = createBuildJobEvidence();
  const jobWatcher: BuildJobWatcher = await startBuildJobWatcher();
  let observing: boolean = true;
  const observer: Promise<void> = observeBuildJobs(evidence, existingPodUids, (): boolean => observing);
  let result: SelfHostedUserSetupCommandResult;
  let payload: DeployResponse;
  const startedAt: number = performance.now();
  let resolutionDurationMs: number;
  try {
    result = await cli.run('deploy --detach --output json', { cwd });
    payload = deployResponseSchema.parse(JSON.parse(result.stdout) as JsonValue);
    await waitForSuccessfulBuildResolution(cli, projectName, payload.deploymentRunId);
    resolutionDurationMs = performance.now() - startedAt;
    await waitForDetachedDeployment(cli, projectName, payload);
  } finally {
    observing = false;
    const [, jobUids]: [void, ReadonlySet<string>] = await Promise.all([observer, jobWatcher.stop()]);
    addObservedJobUids(evidence, jobUids);
  }
  const observed: ObservedDeploy = await buildObservedDeploy(
    cli,
    projectName,
    result,
    evidence,
    requireSingleDeploymentId(payload.deployments),
    payload.deploymentRunId,
  );
  return { ...observed, durationMs: resolutionDurationMs };
}

async function observeConcurrentDeploys(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  cwd: string,
): Promise<ObservedConcurrentDeploys> {
  const existingPodUids: Set<string> = await readBuildPodUids();
  const evidence: BuildJobEvidence = createBuildJobEvidence();
  const jobWatcher: BuildJobWatcher = await startBuildJobWatcher();
  let observing: boolean = true;
  const observer: Promise<void> = observeBuildJobs(evidence, existingPodUids, (): boolean => observing);
  try {
    const results: readonly SelfHostedUserSetupCommandResult[] = await Promise.all([
      cli.run('deploy --detach --output json', { cwd }),
      cli.run('deploy --detach --output json', { cwd }),
    ]);
    const payloads: readonly DeployResponse[] = results.map(
      (result: SelfHostedUserSetupCommandResult): DeployResponse =>
        deployResponseSchema.parse(JSON.parse(result.stdout) as JsonValue),
    );
    const deploymentIds: readonly string[] = payloads.flatMap((payload: DeployResponse): string[] =>
      payload.deployments.map((deployment: DeploymentSummary): string => deployment.id),
    );
    expect(new Set(deploymentIds).size).toBe(2);
    expect(new Set(payloads.map((payload: DeployResponse): string => payload.deploymentRunId)).size).toBe(2);
    await Promise.all(
      payloads.map(async (payload: DeployResponse): Promise<void> => {
        await waitForSuccessfulBuildResolution(cli, projectName, payload.deploymentRunId);
      }),
    );
    await waitForDeploymentsToSettle(cli, projectName, new Set(deploymentIds), false);
  } finally {
    observing = false;
    const [, jobUids]: [void, ReadonlySet<string>] = await Promise.all([observer, jobWatcher.stop()]);
    addObservedJobUids(evidence, jobUids);
  }

  return { evidence };
}

async function readDeploymentInspectWithTransientRetry(
  cli: SelfHostedUserSetupCli,
  projectName: string,
): Promise<DeploymentInspectResponse | null> {
  try {
    return await cli.runJson(`inspect --project ${projectName}`, deploymentInspectResponseSchema);
  } catch (error) {
    if (/status 5\d\d|An unexpected error occurred/iu.test(String(error))) {
      return null;
    }
    throw error;
  }
}

function requireSingleDeploymentId(deployments: readonly IdentifiedDeployment[]): string {
  if (deployments.length !== 1 || deployments[0] === undefined) {
    throw new Error('Expected one deployment.');
  }
  return deployments[0].id;
}

async function waitForDetachedDeployment(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  payload: DeployResponse,
): Promise<void> {
  const deploymentIds: Set<string> = new Set<string>(
    payload.deployments.map((deployment: DeploymentSummary): string => deployment.id),
  );
  await waitForDeploymentsToSettle(cli, projectName, deploymentIds, true);
}

async function waitForSuccessfulBuildResolution(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  deploymentRunId: string,
): Promise<void> {
  const deadline: number = Date.now() + detachedDeploymentSettlementTimeoutMs;
  for (;;) {
    const payload: DeploymentRunLogsResponse = await cli.runJson(
      `deployment logs --project ${projectName} --run ${deploymentRunId}`,
      deploymentRunLogsResponseSchema,
    );
    const buildStep: DeploymentRunStepSummary | undefined = payload.steps.find(
      (step: DeploymentRunStepSummary): boolean => step.stepKey === 'building_image',
    );
    if (buildStep?.status === 'succeeded' || buildStep?.status === 'skipped') {
      return;
    }
    if (buildStep?.status === 'failed' || payload.deployment.status === 'failed') {
      throw new Error(
        `Deployment run ${deploymentRunId} failed before resolving its build: ${payload.deployment.failureMessage ?? 'unknown failure'}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(`Deployment run ${deploymentRunId} did not resolve its build before the timeout.`);
    }
    await sleep(250);
  }
}

async function waitForDeploymentsToSettle(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  deploymentIds: ReadonlySet<string>,
  requireSuccess: boolean,
): Promise<void> {
  const deadline: number = Date.now() + detachedDeploymentSettlementTimeoutMs;
  for (;;) {
    const inspect: DeploymentInspectResponse | null = await readDeploymentInspectWithTransientRetry(cli, projectName);
    const deployments: DeploymentInspectTarget[] =
      inspect?.deployments.filter((deployment: DeploymentInspectTarget): boolean => deploymentIds.has(deployment.id)) ??
      [];
    const failed: DeploymentInspectTarget | undefined = requireSuccess
      ? deployments.find((deployment: DeploymentInspectTarget): boolean => deployment.operation.status === 'failed')
      : undefined;
    if (failed !== undefined && requireSuccess) {
      throw new Error(`Detached deployment ${failed.id} failed: ${failed.failureMessage ?? 'unknown failure'}`);
    }
    if (
      deployments.length === deploymentIds.size &&
      deployments.every(
        (deployment: DeploymentInspectTarget): boolean =>
          deployment.completedAt !== null &&
          (!requireSuccess || (deployment.operation.status === 'succeeded' && deployment.status === 'succeeded')),
      )
    ) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Deployments ${[...deploymentIds].join(', ')} did not settle before the timeout.`);
    }
    await sleep(250);
  }
}

async function buildObservedDeploy(
  cli: SelfHostedUserSetupCli,
  projectName: string,
  result: SelfHostedUserSetupCommandResult,
  evidence: BuildJobEvidence,
  deploymentId: string,
  deploymentRunId: string,
  liveLogs: string = result.stderr,
): Promise<ObservedDeploy> {
  const logsResult: SelfHostedUserSetupCommandResult = await cli.run(
    `deployment logs --project ${projectName} --run ${deploymentRunId} --output json`,
  );
  const inspect: DeploymentInspectResponse = await cli.runJson(
    `inspect --project ${projectName}`,
    deploymentInspectResponseSchema,
  );
  const inspectedDeployment: DeploymentInspectTarget | undefined = inspect.deployments.find(
    (deployment: DeploymentInspectTarget): boolean => deployment.id === deploymentId,
  );
  const imageRef: string | undefined = inspectedDeployment?.runtime?.imageRef;
  if (imageRef?.includes('@sha256:') !== true) {
    throw new Error('Expected deploy inspection to contain an immutable image digest reference.');
  }
  return {
    durationMs: result.durationMs,
    evidence,
    imageRef,
    liveLogs,
    persistedLogs: logsResult.stdout,
  };
}

async function readBuildPodUids(): Promise<Set<string>> {
  return new Set<string>((await readBuildPods()).items.map((pod: KubernetesPodDocument): string => pod.metadata.uid));
}

async function observeBuildJobs(
  evidence: BuildJobEvidence,
  existingPodUids: ReadonlySet<string>,
  isActive: () => boolean,
): Promise<void> {
  while (isActive()) {
    const pods: KubernetesPodList = await readBuildPods();
    for (const pod of pods.items) {
      if (existingPodUids.has(pod.metadata.uid)) {
        continue;
      }
      const owner: KubernetesOwnerReference | undefined = pod.metadata.ownerReferences?.find(
        (reference: KubernetesOwnerReference): boolean => reference.kind === 'Job',
      );
      if (owner !== undefined) {
        evidence.jobNames.add(owner.name);
        evidence.jobUids.add(owner.uid);
      }
      evidence.podDocuments.set(pod.metadata.uid, pod);
    }
    await sleep(100);
  }
}

async function readBuildPods(): Promise<KubernetesPodList> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'get',
      'pods',
      '--namespace',
      `${seed.platformNamespace}-build`,
      '--selector',
      'compartment.dev/job-class=build',
      '--output',
      'json',
    ],
    timeoutMs: kubectlTimeoutMs,
  });
  expectSuccessfulCommand(result, 'inspect ephemeral build Pods');
  return JSON.parse(result.stdout) as KubernetesPodList;
}

async function startBuildJobWatcher(): Promise<BuildJobWatcher> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const namespace: string = `${seed.platformNamespace}-build`;
  const listPath: string =
    `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs` +
    `?labelSelector=${encodeURIComponent('compartment.dev/job-class=build')}`;
  const initialResult: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['kubectl', '--context', seed.kubeContext, 'get', '--raw', listPath],
    timeoutMs: kubectlTimeoutMs,
  });
  expectSuccessfulCommand(initialResult, 'read build Job watch resource version');
  const resourceVersion: string = (JSON.parse(initialResult.stdout) as KubernetesJobList).metadata.resourceVersion;
  const watchPath: string = `${listPath}&watch=1&resourceVersion=${encodeURIComponent(resourceVersion)}`;
  const child: ChildProcessWithoutNullStreams = spawn('kubectl', [
    '--context',
    seed.kubeContext,
    'get',
    '--raw',
    watchPath,
  ]);
  const watcher: KubernetesBuildJobWatcher = new KubernetesBuildJobWatcher(child);
  await watcher.waitUntilStarted();
  return watcher;
}

class KubernetesBuildJobWatcher implements BuildJobWatcher {
  private readonly closed: Promise<number | null>;
  private stderr: string = '';
  private stdout: string = '';

  public constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string): void => {
      this.stdout += chunk;
    });
    child.stderr.on('data', (chunk: string): void => {
      this.stderr += chunk;
    });
    this.closed = new Promise<number | null>((resolveClose: (value: number | null) => void): void => {
      child.once('close', (code: number | null): void => resolveClose(code));
    });
  }

  public async waitUntilStarted(): Promise<void> {
    await once(this.child, 'spawn');
  }

  public async stop(): Promise<ReadonlySet<string>> {
    const running: boolean = this.child.exitCode === null && this.child.signalCode === null;
    if (running) {
      this.child.kill('SIGTERM');
    }
    const exitCode: number | null = await this.closed;
    const stderr: string = this.stderr.trim();
    if (!running && exitCode !== 0) {
      throw new Error(
        `Build Job watch exited before completion: ${stderr !== '' ? stderr : `status ${String(exitCode)}`}`,
      );
    }
    return new Set(
      this.stdout
        .split('\n')
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line !== '')
        .map((line: string): KubernetesJobWatchEvent => JSON.parse(line) as KubernetesJobWatchEvent)
        .filter((event: KubernetesJobWatchEvent): boolean => event.type === 'ADDED')
        .map((event: KubernetesJobWatchEvent): string => event.object.metadata.uid),
    );
  }
}

function addObservedJobUids(evidence: BuildJobEvidence, jobUids: ReadonlySet<string>): void {
  for (const jobUid of jobUids) {
    evidence.jobUids.add(jobUid);
  }
}

function expectBuildJobIsolation(evidence: BuildJobEvidence): void {
  expect(evidence.podDocuments.size).toBeGreaterThan(0);
  for (const pod of evidence.podDocuments.values()) {
    expect(pod.spec.hostNetwork).not.toBe(true);
    expect(pod.spec.hostUsers).toBe(false);
    expect(pod.spec.securityContext?.seccompProfile?.type).toBe('RuntimeDefault');
    expect(pod.spec.volumes?.some((volume: KubernetesVolume): boolean => volume.hostPath !== undefined)).toBe(false);
    expect(
      pod.spec.volumes?.some((volume: KubernetesVolume): boolean => volume.persistentVolumeClaim !== undefined),
    ).toBe(false);
    for (const container of [...pod.spec.containers, ...(pod.spec.initContainers ?? [])]) {
      expect(container.securityContext?.privileged).not.toBe(true);
      expect(container.securityContext?.allowPrivilegeEscalation).not.toBe(true);
      expect(container.securityContext?.appArmorProfile?.type).not.toBe('Unconfined');
      expect(container.securityContext?.capabilities?.drop).toEqual(['ALL']);
      expect(container.securityContext?.capabilities?.add ?? []).toEqual(
        container.name === 'buildkit'
          ? [
              'SYS_ADMIN',
              'CHOWN',
              'SETUID',
              'SETGID',
              'DAC_OVERRIDE',
              'FOWNER',
              'FSETID',
              'SETFCAP',
              'SETPCAP',
              'SYS_CHROOT',
              'MKNOD',
              'KILL',
              'AUDIT_WRITE',
              'NET_BIND_SERVICE',
              'NET_RAW',
            ]
          : [],
      );
      expect((container.args ?? []).join(' ')).not.toMatch(/containerd\.sock|docker\.sock|no-process-sandbox/iu);
      expect(
        container.volumeMounts?.some((mount: KubernetesVolumeMount): boolean =>
          /containerd\.sock|docker\.sock/u.test(mount.mountPath),
        ),
      ).toBe(false);
    }
  }
}

function expectDistinctWritableBuildState(evidence: BuildJobEvidence): void {
  const pods: readonly KubernetesPodDocument[] = [...evidence.podDocuments.values()];
  const names: Set<string> = new Set<string>(pods.map((pod: KubernetesPodDocument): string => pod.metadata.name));
  const credentialSecretNames: Set<string> = new Set<string>();
  expect(names.size).toBe(2);
  for (const pod of pods) {
    const writableVolumes: readonly KubernetesVolume[] = (pod.spec.volumes ?? []).filter(
      (volume: KubernetesVolume): boolean => volume.emptyDir !== undefined,
    );
    expect(writableVolumes.length).toBeGreaterThan(0);
    for (const container of pod.spec.containers) {
      expect(
        container.env?.some(
          (variable: KubernetesEnvironmentVariable): boolean => variable.name === 'COMPARTMENT_RUNTIME_CONTROL_TOKEN',
        ),
      ).toBe(false);
      for (const variable of container.env ?? []) {
        const secretName: string | undefined = variable.valueFrom?.secretKeyRef?.name;
        if (variable.name === 'COMPARTMENT_BUILD_JOB_INPUT' && secretName !== undefined) {
          credentialSecretNames.add(secretName);
        }
      }
    }
  }
  expect(credentialSecretNames.size).toBe(2);
}

function mergeEvidence(...items: readonly BuildJobEvidence[]): BuildJobEvidence {
  return {
    jobNames: new Set(items.flatMap((item: BuildJobEvidence): readonly string[] => [...item.jobNames])),
    jobUids: new Set(items.flatMap((item: BuildJobEvidence): readonly string[] => [...item.jobUids])),
    podDocuments: new Map(
      items.flatMap((item: BuildJobEvidence): readonly [string, KubernetesPodDocument][] => [...item.podDocuments]),
    ),
  };
}

function readP95(values: readonly number[]): number {
  const sorted: readonly number[] = [...values].sort((left: number, right: number): number => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

async function cleanupProject(cli: SelfHostedUserSetupCli, projectName: string): Promise<void> {
  await cli.run(`project archive --project ${projectName} --yes`);
  await cli.run(`project delete --project ${projectName} --yes`);
}
