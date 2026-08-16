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
import { readAppSessionCookieWithRetry } from './self-hosted-user-setup-app-probe.harness';
import { sendCliHttpTextRequest } from './cli-http-test.harness';

interface AvailabilityProbeResult {
  readonly requestCount: number;
  readonly failures: readonly string[];
}

interface ActiveAvailabilityProbe {
  finish(): Promise<AvailabilityProbeResult>;
}

interface AppliedDeployment {
  readonly metadata: { readonly annotations?: Readonly<Record<string, string>> | undefined };
  readonly spec: { readonly replicas?: number | undefined };
}

interface AppliedDeploymentList {
  readonly items: readonly AppliedDeployment[];
}

interface ExecResult {
  readonly stderr: string;
  readonly stdout: string;
}

const observedLoadedReadinessLatencyMs: number = 2_802;
const probeIntervalMs: number = 100;
const kubeContext: string = process.env.COMPARTMENT_E2E_KUBE_CONTEXT ?? 'k3d-compartment-e2e';
const execFileAsync: (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => Promise<ExecResult> = promisify(execFile);

describeSelfHostedUserSetupE2e('platform k3d readiness availability gate', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  it(
    'keeps a one-replica route available while loaded readiness exceeds one second during redeploy',
    async (): Promise<void> => {
      const runtime: SelfHostedUserSetupRuntime = await setup.install();
      const app: SelfHostedUserSetupAppFixture = await setup.createAppFixture({
        projectName: 'readiness-availability-gate',
      });
      const admin: SelfHostedUserSetupCli = await loginAdmin(setup, runtime);
      await admin.run('variable set E2E_BUILD_MESSAGE readiness-v1 --env production', { cwd: app.directory });

      const firstDeploy: SelfHostedDeployCommandResponse = await admin.runJson('deploy', deployCommandResponseParser, {
        cwd: app.directory,
      });
      expect(requireSingleActiveDeployment(firstDeploy, app.serviceName).status).toBe('succeeded');
      await expectAppliedReplicaCount(app.projectName, app.serviceName, 1);
      const routeUrl: string = requireRouteUrl(firstDeploy, app.serviceName);
      const appSessionCookie: string = await readAppSessionCookieWithRetry(routeUrl, {
        email: runtime.adminEmail,
        password: runtime.adminPassword,
      });

      await delayActiveReadiness(routeUrl, appSessionCookie);
      await admin.run(`variable set READINESS_DELAY_MS ${observedLoadedReadinessLatencyMs.toString()}`, {
        cwd: app.directory,
      });
      await admin.run('variable set E2E_BUILD_MESSAGE readiness-v2 --env production', { cwd: app.directory });
      const probe: ActiveAvailabilityProbe = startAvailabilityProbe(routeUrl, appSessionCookie);
      await delay(1_000);
      let result: AvailabilityProbeResult;
      try {
        const secondDeploy: SelfHostedDeployCommandResponse = await admin.runJson(
          'deploy',
          deployCommandResponseParser,
          { cwd: app.directory },
        );
        expect(requireSingleActiveDeployment(secondDeploy, app.serviceName).status).toBe('succeeded');
      } finally {
        result = await probe.finish();
      }

      expect(result.requestCount).toBeGreaterThan(0);
      expect(result.failures).toEqual([]);
    },
    selfHostedUserSetupTimeoutMs,
  );
});

async function expectAppliedReplicaCount(projectName: string, serviceName: string, expected: number): Promise<void> {
  const result: ExecResult = await execFileAsync(
    'kubectl',
    [
      '--context',
      kubeContext,
      'get',
      'deployments',
      '--all-namespaces',
      '--selector',
      'app=application',
      '--output=json',
    ],
    { timeout: 60_000 },
  );
  const deployments: AppliedDeploymentList = JSON.parse(result.stdout) as AppliedDeploymentList;
  const deployment: AppliedDeployment | undefined = deployments.items.find(
    (candidate: AppliedDeployment): boolean =>
      candidate.metadata.annotations?.['compartment.dev/project-name'] === projectName &&
      candidate.metadata.annotations['compartment.dev/service-name'] === serviceName,
  );
  expect(deployment?.spec.replicas).toBe(expected);
}

async function delayActiveReadiness(routeUrl: string, appSessionCookie: string): Promise<void> {
  const url: URL = new URL('/probe/readiness-delay', routeUrl);
  url.searchParams.set('ms', observedLoadedReadinessLatencyMs.toString());
  const response = await sendCliHttpTextRequest(url.toString(), {
    headers: { cookie: appSessionCookie },
    method: 'POST',
  });
  expect(response.statusCode).toBe(200);
}

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

function startAvailabilityProbe(routeUrl: string, appSessionCookie: string): ActiveAvailabilityProbe {
  return new RunningAvailabilityProbe(routeUrl, appSessionCookie).start();
}

class RunningAvailabilityProbe implements ActiveAvailabilityProbe {
  readonly #appSessionCookie: string;
  readonly #failures: string[] = [];
  #loop: Promise<void> = Promise.resolve();
  readonly #probeUrl: string;
  #requestCount: number = 0;
  #stopped: boolean = false;

  constructor(routeUrl: string, appSessionCookie: string) {
    this.#appSessionCookie = appSessionCookie;
    this.#probeUrl = new URL('/probe/env', routeUrl).toString();
  }

  start(): ActiveAvailabilityProbe {
    this.#loop = this.run();
    return this;
  }

  async finish(): Promise<AvailabilityProbeResult> {
    this.#stopped = true;
    await this.#loop;
    return { failures: this.#failures, requestCount: this.#requestCount };
  }

  private async run(): Promise<void> {
    for (;;) {
      if (this.#stopped) {
        return;
      }
      try {
        const response = await sendCliHttpTextRequest(this.#probeUrl, {
          headers: { cookie: this.#appSessionCookie },
        });
        this.#requestCount += 1;
        if (response.statusCode !== 200) {
          this.#failures.push(`http:${response.statusCode.toString()}`);
        }
      } catch (error) {
        this.#requestCount += 1;
        this.#failures.push(error instanceof Error ? error.message : String(error));
      }
      await delay(probeIntervalMs);
    }
  }
}
