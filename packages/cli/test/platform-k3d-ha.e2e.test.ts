import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import type { SelfHostedUserSetupAppFixture } from './self-hosted-user-setup-app-fixture';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  deployCommandResponseParser,
  requireRouteUrl,
  requireSingleActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import {
  describeSelfHostedUserSetupE2e,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';

interface ExecResult {
  stderr: string;
  stdout: string;
}

interface ProbeTarget {
  host: string;
  path: string;
}

interface AvailabilityWindow {
  failedRequests: number;
  maxWindowMs: number;
}

interface ActiveProbe {
  finish(): Promise<AvailabilityWindow>;
}

interface BuildJobIdentityMonitor {
  finish(): Promise<readonly string[]>;
  waitForJob(): Promise<void>;
}

const execFileAsync: (file: string, args: readonly string[], options: { timeout: number }) => Promise<ExecResult> =
  promisify(execFile);
const kubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const platformNamespace: string = process.env.COMPARTMENT_E2E_PLATFORM_NAMESPACE ?? 'compartment';
const buildNamespace: string = `${platformNamespace}-build`;
const platformName: string = 'compartment';
const probeIntervalMs: number = 100;
const probeRequestTimeoutMs: number = 1_000;
const settleMs: number = 1_000;

describeSelfHostedUserSetupE2e('platform k3d minimal HA gate', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  it(
    'keeps hosted and control-plane traffic available while each HA pod is replaced',
    async (): Promise<void> => {
      const runtime: SelfHostedUserSetupRuntime = await setup.install();
      const appFixture: SelfHostedUserSetupAppFixture = await setup.createAppFixture({
        projectName: 'minimal-ha-gate',
      });
      const admin: SelfHostedUserSetupCli = await loginAdmin(setup, runtime);
      await admin.run(`variable set E2E_BUILD_MESSAGE ha-availability --env ${appFixture.environmentName}`, {
        cwd: appFixture.directory,
      });
      const initialDeploy: SelfHostedDeployCommandResponse = await admin.runJson(
        'deploy',
        deployCommandResponseParser,
        { cwd: appFixture.directory },
      );
      expect(requireSingleActiveDeployment(initialDeploy, appFixture.serviceName).status).toBe('succeeded');
      const hostedUrl: string = requireRouteUrl(initialDeploy, appFixture.serviceName);
      const targets: readonly ProbeTarget[] = buildProbeTargets(runtime.apiUrl, hostedUrl);

      for (const component of ['api', 'edge', 'caddy']) {
        const podNames: readonly string[] = await listComponentPods(component);
        expect(podNames).toHaveLength(2);
        for (const podName of podNames) {
          const window: AvailabilityWindow = await replacePodUnderProbe(component, podName, targets);
          process.stdout.write(
            `ha_kill component=${component} pod=${podName} failed_requests=${window.failedRequests.toString()} max_window_ms=${window.maxWindowMs.toString()}\n`,
          );
          expect(window.maxWindowMs).toBeLessThanOrEqual(2_000);
        }
      }
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'finishes an in-flight deployment after an API pod is killed',
    async (): Promise<void> => {
      const runtime: SelfHostedUserSetupRuntime = await setup.install();
      const appFixture: SelfHostedUserSetupAppFixture = await setup.createAppFixture({
        projectName: 'minimal-ha-deploy-gate',
      });
      const admin: SelfHostedUserSetupCli = await loginAdmin(setup, runtime);
      await admin.run(`variable set E2E_BUILD_MESSAGE ha-api-kill --env ${appFixture.environmentName}`, {
        cwd: appFixture.directory,
      });
      const deployPromise: Promise<SelfHostedDeployCommandResponse> = admin.runJson(
        'deploy',
        deployCommandResponseParser,
        { cwd: appFixture.directory },
      );
      await waitForRunningDeployment();
      const [apiPod] = await listComponentPods('api');
      if (apiPod === undefined) {
        throw new Error('Expected an API pod during the in-flight deployment gate.');
      }
      await kubectl(['delete', `pod/${apiPod}`, '--wait=false']);
      await waitForComponentRollout('api');
      const deploy: SelfHostedDeployCommandResponse = await deployPromise;
      expect(requireSingleActiveDeployment(deploy, appFixture.serviceName).status).toBe('succeeded');
      process.stdout.write(`ha_deploy_kill pod=${apiPod} status=succeeded\n`);
    },
    selfHostedUserSetupTimeoutMs,
  );

  it(
    'finishes an in-flight deployment once after the worker leader is killed',
    async (): Promise<void> => {
      const runtime: SelfHostedUserSetupRuntime = await setup.install();
      const appFixture: SelfHostedUserSetupAppFixture = await setup.createAppFixture({
        projectName: 'worker-leader-failover-gate',
      });
      const admin: SelfHostedUserSetupCli = await loginAdmin(setup, runtime);
      await admin.run(`variable set E2E_BUILD_MESSAGE worker-leader-kill --env ${appFixture.environmentName}`, {
        cwd: appFixture.directory,
      });
      const leaderPod: string = await readLeaseHolder('compartment-worker');
      const jobMonitor: BuildJobIdentityMonitor = await startBuildJobIdentityMonitor();
      const deployPromise: Promise<SelfHostedDeployCommandResponse> = admin.runJson(
        'deploy',
        deployCommandResponseParser,
        { cwd: appFixture.directory },
      );
      await waitForRunningDeployment();
      await jobMonitor.waitForJob();
      const killedAt: number = Date.now();
      await kubectl(['delete', `pod/${leaderPod}`, '--wait=false']);
      const replacementLeader: string = await waitForLeaseTakeover('compartment-worker', leaderPod);
      const takeoverMs: number = Date.now() - killedAt;
      const deploy: SelfHostedDeployCommandResponse = await deployPromise;
      const observedBuildJobUids: readonly string[] = await jobMonitor.finish();

      expect(requireSingleActiveDeployment(deploy, appFixture.serviceName).status).toBe('succeeded');
      expect(observedBuildJobUids).toHaveLength(1);
      process.stdout.write(
        `ha_worker_leader_kill pod=${leaderPod} replacement=${replacementLeader} takeover_ms=${takeoverMs.toString()} duplicate_build_jobs=0 losses=0 status=succeeded\n`,
      );
    },
    selfHostedUserSetupTimeoutMs,
  );
});

async function loginAdmin(
  setup: SelfHostedUserSetupHarness,
  runtime: SelfHostedUserSetupRuntime,
): Promise<SelfHostedUserSetupCli> {
  const admin: SelfHostedUserSetupCli = await setup.createFreshCli();
  await admin.runBrowserLogin(
    `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
    { email: runtime.adminEmail, password: runtime.adminPassword },
    { requestOrigin: runtime.apiUrl },
  );
  return admin;
}

function buildProbeTargets(apiUrl: string, hostedUrl: string): readonly ProbeTarget[] {
  return [apiUrl, hostedUrl].map((rawUrl: string): ProbeTarget => {
    const url: URL = new URL(rawUrl);
    return {
      host: url.hostname,
      path: `${url.pathname}${url.search}`,
    };
  });
}

async function replacePodUnderProbe(
  component: string,
  podName: string,
  targets: readonly ProbeTarget[],
): Promise<AvailabilityWindow> {
  const probe: ActiveProbe = startAvailabilityProbe(targets);
  await delay(settleMs);
  await kubectl(['delete', `pod/${podName}`, '--wait=false']);
  await waitForComponentRollout(component);
  await delay(settleMs);
  return await probe.finish();
}

function startAvailabilityProbe(targets: readonly ProbeTarget[]): ActiveProbe {
  return new RunningAvailabilityProbe(targets).start();
}

class RunningAvailabilityProbe implements ActiveProbe {
  #loop: Promise<void> = Promise.resolve();
  readonly #targets: readonly ProbeTarget[];
  #failedRequests: number = 0;
  #failureStartedAt: number | null = null;
  #maxWindowMs: number = 0;
  #stopped: boolean = false;

  constructor(targets: readonly ProbeTarget[]) {
    this.#targets = targets;
  }

  start(): ActiveProbe {
    this.#loop = this.run();
    return this;
  }

  async finish(): Promise<AvailabilityWindow> {
    this.#stopped = true;
    await this.#loop;
    if (this.#failureStartedAt !== null) {
      this.#maxWindowMs = Math.max(this.#maxWindowMs, Date.now() - this.#failureStartedAt);
    }
    return { failedRequests: this.#failedRequests, maxWindowMs: this.#maxWindowMs };
  }

  async run(): Promise<void> {
    while (!this.#stopped) {
      const startedAt: number = Date.now();
      const succeeded: boolean = (await Promise.all(this.#targets.map(probeTarget))).every(Boolean);
      if (succeeded) {
        if (this.#failureStartedAt !== null) {
          this.#maxWindowMs = Math.max(this.#maxWindowMs, Date.now() - this.#failureStartedAt);
          this.#failureStartedAt = null;
        }
      } else {
        this.#failedRequests += 1;
        this.#failureStartedAt ??= startedAt;
      }
      await delay(probeIntervalMs);
    }
  }
}

async function probeTarget(target: ProbeTarget): Promise<boolean> {
  const controller: AbortController = new AbortController();
  const timeout: NodeJS.Timeout = setTimeout((): void => controller.abort(), probeRequestTimeoutMs);
  try {
    const response: Response = await fetch(`http://127.0.0.1:${readIngressPort()}${target.path}`, {
      headers: { host: target.host },
      redirect: 'manual',
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function readIngressPort(): string {
  return new URL(process.env.COMPARTMENT_E2E_API_URL ?? 'http://console.compartment.localhost:18080').port;
}

async function listComponentPods(component: string): Promise<readonly string[]> {
  const output: string = await kubectl([
    'get',
    'pods',
    '--selector',
    `app.kubernetes.io/instance=compartment,app.kubernetes.io/component=${component}`,
    '--output=jsonpath={.items[*].metadata.name}',
  ]);
  return output.trim().split(/\s+/u).filter(Boolean);
}

async function waitForComponentRollout(component: string): Promise<void> {
  await kubectl(['rollout', 'status', `deployment/${platformName}-${component}`, '--timeout=4m']);
}

async function waitForRunningDeployment(): Promise<void> {
  for (let attempt: number = 0; attempt < 300; attempt += 1) {
    const status: string = await kubectl([
      'exec',
      `deployment/${platformName}-postgres`,
      '--',
      'psql',
      '--username',
      'postgres',
      '--dbname',
      'compartment',
      '--tuples-only',
      '--no-align',
      '--command',
      'select status from deployments order by created_at desc limit 1;',
    ]);
    if (status.trim() === 'running') {
      return;
    }
    await delay(100);
  }
  throw new Error('Deployment did not enter running state before the API kill.');
}

async function readLeaseHolder(leaseName: string): Promise<string> {
  const holder: string = await kubectl(['get', `lease/${leaseName}`, '--output=jsonpath={.spec.holderIdentity}']);
  if (holder.trim() === '') {
    throw new Error(`Lease ${leaseName} does not have a leader.`);
  }
  return holder.trim();
}

async function waitForLeaseTakeover(leaseName: string, previousHolder: string): Promise<string> {
  for (let attempt: number = 0; attempt < 600; attempt += 1) {
    const holder: string = await readLeaseHolder(leaseName);
    if (holder !== previousHolder) {
      return holder;
    }
    await delay(100);
  }
  throw new Error(`Lease ${leaseName} did not move away from ${previousHolder}.`);
}

async function startBuildJobIdentityMonitor(): Promise<BuildJobIdentityMonitor> {
  return new RunningBuildJobIdentityMonitor(new Set(await listBuildJobUids())).start();
}

class RunningBuildJobIdentityMonitor implements BuildJobIdentityMonitor {
  readonly #baseline: ReadonlySet<string>;
  readonly #observed: Set<string> = new Set<string>();
  #loop: Promise<void> = Promise.resolve();
  #stopped: boolean = false;

  public constructor(baseline: ReadonlySet<string>) {
    this.#baseline = baseline;
  }

  public start(): BuildJobIdentityMonitor {
    this.#loop = this.run();
    return this;
  }

  public async finish(): Promise<readonly string[]> {
    this.#stopped = true;
    await this.#loop;
    return [...this.#observed];
  }

  public async waitForJob(): Promise<void> {
    for (let attempt: number = 0; attempt < 600; attempt += 1) {
      if (this.#observed.size > 0) {
        return;
      }
      await delay(100);
    }
    throw new Error('Build Job did not start before the worker leader kill.');
  }

  private async run(): Promise<void> {
    while (!this.#stopped) {
      for (const uid of await listBuildJobUids()) {
        if (!this.#baseline.has(uid)) {
          this.#observed.add(uid);
        }
      }
      await delay(50);
    }
  }
}

async function listBuildJobUids(): Promise<readonly string[]> {
  const output: string = await kubectlInNamespace(buildNamespace, [
    'get',
    'jobs',
    '--selector',
    'compartment.dev/job-class=build',
    '--output=jsonpath={.items[*].metadata.uid}',
  ]);
  return output.trim().split(/\s+/u).filter(Boolean);
}

async function kubectl(args: readonly string[]): Promise<string> {
  return await kubectlInNamespace(platformNamespace, args);
}

async function kubectlInNamespace(namespace: string, args: readonly string[]): Promise<string> {
  const result: ExecResult = await execFileAsync(
    'kubectl',
    ['--context', kubeContext, '--namespace', namespace, ...args],
    { timeout: 5 * 60_000 },
  );
  return result.stdout;
}
