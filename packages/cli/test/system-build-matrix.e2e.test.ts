import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import {
  deploymentInspectResponseSchema,
  deploymentLogsResponseSchema,
  deploymentStatusResponseSchema,
  variableResponseSchema,
  type DeploymentInspectResponse,
  type DeploymentInspectRuntimeSummary,
  type DeploymentInspectTarget,
  type DeploymentLogLine,
  type DeploymentLogsResponse,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type VariableResponse,
} from '@compartment/contracts';
import {
  sendCliHttpTextRequest,
  type CliHttpTextRequestOptions,
  type CliHttpTextResponse,
} from './cli-http-test.harness';
import {
  deployCommandResponseParser,
  deploymentStatusCommandResponseParser,
  requireRouteUrl,
  requireSingleActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  buildSelfHostedAppHostname,
  describeSelfHostedUserSetupE2e,
  expectSelfHostedUserSetupStepCompleted,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import { readAppSessionCookieWithRetry } from './self-hosted-user-setup-app-probe.harness';
import { isK3dPlatformMode, readK3dPlatformSeed } from './self-hosted-user-setup-k3d.harness';
import {
  selfHostedMultiServiceBuildFixtures,
  selfHostedSingleServiceBuildFixtures,
  createSelfHostedStaticPoisonDockerfileFixture,
  type SelfHostedMultiServiceBuildFixture,
  type SelfHostedMultiServiceFixtureService,
  type SelfHostedProxyReadyPayload,
  type SelfHostedRuntimeCommandExpectation,
  type SelfHostedSingleServiceBuildFixture,
} from './self-hosted-build-matrix-fixtures';
import {
  expectSuccessfulCommand,
  runCommand,
  runTimedStep,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

type HttpProbeErrorInput = Error | string | number | boolean | symbol | bigint | null | undefined;

const selfHostedBuildMatrixTimeoutMs: number = 40 * 60_000;
const selfHostedBuildMatrixDockerCommandTimeoutMs: number = 60_000;
const selfHostedBuildMatrixHttpProbeAttempts: number = 60;
const selfHostedBuildMatrixHttpProbeDelayMs: number = 1_000;
const selfHostedBuildMatrixHttpProbeTimeoutMs: number = 2_000;
const selfHostedBuildMatrixLogPollAttempts: number = 60;

describeSelfHostedUserSetupE2e('self-hosted system build matrix end-to-end', (): void => {
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

  it(
    'deploys every single-service build fixture one by one',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedStepCount, 1);
      const staticPoisonRootDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-static-poison-'));
      const staticPoisonFixture: SelfHostedSingleServiceBuildFixture =
        await createSelfHostedStaticPoisonDockerfileFixture(staticPoisonRootDirectory);
      try {
        for (const fixture of [...selfHostedSingleServiceBuildFixtures, staticPoisonFixture]) {
          await runTimedStep(`build-matrix single-service ${fixture.name}`, async (): Promise<void> => {
            await seedBuildVariables(admin, fixture);

            const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
              'deploy',
              deployCommandResponseParser,
              { cwd: fixture.directory },
            );
            const deployment: DeploymentReadSummary = requireSingleActiveDeployment(deployPayload, 'web');
            const routeUrl: string = requireRouteUrl(deployPayload, 'web');

            expect(deployPayload.project.name).toBe(fixture.name);
            expect(deployment.status).toBe('succeeded');
            await expectProtectedRouteRedirect(runtime.compartmentUrl, routeUrl);

            if (fixture.expectedAuthorizedBodyText !== undefined) {
              expect(await readAuthorizedRouteBody(routeUrl, runtime)).toContain(fixture.expectedAuthorizedBodyText);
            }

            if (fixture.expectedRuntimeCommand !== undefined) {
              expect(await readRuntimeContainerCommandOutput(deployment.id, fixture.expectedRuntimeCommand)).toContain(
                fixture.expectedRuntimeCommand.expectedText,
              );
            }

            const statusPayload: DeploymentStatusResponse = await admin.runJson(
              `status --project ${fixture.name}`,
              deploymentStatusCommandResponseParser,
            );
            expect(requireRouteUrl(statusPayload, 'web')).toBe(routeUrl);

            await expectSingleServiceFixtureLogs(admin, fixture);
          });
        }
      } finally {
        await rm(staticPoisonRootDirectory, { force: true, recursive: true });
      }
      completedStepCount = 2;
    },
    selfHostedBuildMatrixTimeoutMs,
  );

  it(
    'deploys multi-service fixtures with service-scoped commands and proxy routes',
    async (): Promise<void> => {
      expectSelfHostedUserSetupStepCompleted(completedStepCount, 2);
      for (const fixture of selfHostedMultiServiceBuildFixtures) {
        await runTimedStep(`build-matrix multi-service ${fixture.name}`, async (): Promise<void> => {
          const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
            'deploy',
            deployCommandResponseParser,
            {
              cwd: fixture.directory,
            },
          );
          expect(deployPayload.deployments).toHaveLength(fixture.services.length);

          for (const service of fixture.services) {
            const routeUrl: string = requireServiceRouteUrl(deployPayload, service.name);
            expect(new URL(routeUrl).hostname).toBe(buildSelfHostedAppHostname(runtime, fixture.name, service.name));
            await expectProtectedRouteRedirect(runtime.compartmentUrl, routeUrl);
          }

          const statusPayload: DeploymentStatusResponse = await admin.runJson(
            `status --project ${fixture.name}`,
            deploymentStatusCommandResponseParser,
          );
          expect(statusPayload.deployments).toHaveLength(fixture.services.length);

          const scopedStatusPayload: DeploymentStatusResponse = await admin.runJson(
            `status --project ${fixture.name} --service ${fixture.routedServiceName}`,
            deploymentStatusCommandResponseParser,
          );
          expect(requireSingleDeployment(scopedStatusPayload).serviceName).toBe(fixture.routedServiceName);

          const inspectPayload: DeploymentInspectResponse = await admin.runJson(
            `inspect --project ${fixture.name}`,
            deploymentInspectResponseSchema,
          );
          expect(inspectPayload.deployments).toHaveLength(fixture.services.length);
          expect(inspectPayload.sensitiveTopologyVisible).toBe(true);
          expect(requireServiceInspectTarget(inspectPayload, 'web').routes).toEqual(fixture.routes);

          const scopedInspectPayload: DeploymentInspectResponse = await admin.runJson(
            `inspect --project ${fixture.name} --service ${fixture.routedServiceName}`,
            deploymentInspectResponseSchema,
          );
          expect(requireSingleInspectTarget(scopedInspectPayload).serviceName).toBe(fixture.routedServiceName);

          const logsPayload: DeploymentLogsResponse = await admin.runJson(
            `logs --project ${fixture.name}`,
            deploymentLogsResponseSchema,
          );
          for (const service of fixture.services) {
            expectDeploymentLogs(logsPayload, service.logTexts);
          }

          const scopedLogsPayload: DeploymentLogsResponse = await admin.runJson(
            `logs --project ${fixture.name} --service ${fixture.routedServiceName}`,
            deploymentLogsResponseSchema,
          );
          expect(requireSingleDeployment(scopedLogsPayload).serviceName).toBe(fixture.routedServiceName);
          expectDeploymentLogs(scopedLogsPayload, requireFixtureService(fixture, fixture.routedServiceName).logTexts);
          expect(hasDeploymentLog(scopedLogsPayload, requireFixtureService(fixture, 'web').logTexts[0]!)).toBe(false);

          await expectProxyRoute(fixture, requireServiceRouteUrl(deployPayload, 'web'), runtime);

          if (fixture.checkRollback === true) {
            await expectMultiServiceRollback(admin, fixture, runtime);
          }
        });
      }
      completedStepCount = 3;
    },
    selfHostedBuildMatrixTimeoutMs,
  );
});

async function seedBuildVariables(
  admin: SelfHostedUserSetupCli,
  fixture: SelfHostedSingleServiceBuildFixture,
): Promise<void> {
  for (const variable of fixture.buildVariables ?? []) {
    const response: VariableResponse = await admin.runJson(
      `variable set ${variable.key} "${variable.value}" --project ${fixture.name} --env production`,
      variableResponseSchema,
      { cwd: fixture.directory },
    );

    expect(response.variable.keyName).toBe(variable.key);
    expect(response.variable.value).toBe(variable.value);
  }
}

async function expectSingleServiceFixtureLogs(
  admin: SelfHostedUserSetupCli,
  fixture: SelfHostedSingleServiceBuildFixture,
): Promise<void> {
  if (
    fixture.expectedLogTexts === undefined &&
    fixture.expectedOrderedLogTexts === undefined &&
    fixture.unexpectedLogTexts === undefined
  ) {
    return;
  }

  let logsPayload: DeploymentLogsResponse = await readFixtureLogs(admin, fixture.name);
  for (let attempt: number = 1; attempt < selfHostedBuildMatrixLogPollAttempts; attempt += 1) {
    if (hasExpectedFixtureLogs(logsPayload, fixture)) {
      break;
    }
    await sleep(selfHostedBuildMatrixHttpProbeDelayMs);
    logsPayload = await readFixtureLogs(admin, fixture.name);
  }

  if (fixture.expectedLogTexts !== undefined) {
    expectDeploymentLogs(logsPayload, fixture.expectedLogTexts);
  }
  if (fixture.expectedOrderedLogTexts !== undefined) {
    expectDeploymentLogsInOrder(logsPayload, fixture.expectedOrderedLogTexts);
  }
  for (const unexpectedLogText of fixture.unexpectedLogTexts ?? []) {
    expect(hasDeploymentLog(logsPayload, unexpectedLogText)).toBe(false);
  }
}

async function readFixtureLogs(admin: SelfHostedUserSetupCli, projectName: string): Promise<DeploymentLogsResponse> {
  return await admin.runJson(`logs --project ${projectName}`, deploymentLogsResponseSchema);
}

function hasExpectedFixtureLogs(
  response: DeploymentLogsResponse,
  fixture: SelfHostedSingleServiceBuildFixture,
): boolean {
  return [...(fixture.expectedLogTexts ?? []), ...(fixture.expectedOrderedLogTexts ?? [])].every(
    (expectedLogText: string): boolean => hasDeploymentLog(response, expectedLogText),
  );
}

async function expectProtectedRouteRedirect(compartmentUrl: string, routeUrl: string): Promise<void> {
  const response: CliHttpTextResponse = await sendCliHttpTextRequestWithRetry(routeUrl);

  expect(response.statusCode).toBeGreaterThanOrEqual(300);
  expect(response.statusCode).toBeLessThan(400);
  expect(response.headers.location).toContain(`${compartmentUrl}/login`);
}

async function readAuthorizedRouteBody(routeUrl: string, runtime: SelfHostedUserSetupRuntime): Promise<string> {
  const appSessionCookie: string = await readAppSessionCookieWithRetry(routeUrl, {
    email: runtime.adminEmail,
    password: runtime.adminPassword,
  });
  const response: CliHttpTextResponse = await sendCliHttpTextRequestWithRetry(routeUrl, {
    headers: {
      cookie: appSessionCookie,
    },
  });
  const scriptAssetPath: string | null = readScriptAssetPath(response.body);

  expect(response.statusCode).toBe(200);
  if (scriptAssetPath === null) {
    return response.body;
  }

  const assetResponse: CliHttpTextResponse = await sendCliHttpTextRequestWithRetry(
    new URL(scriptAssetPath, routeUrl).toString(),
    {
      headers: {
        cookie: appSessionCookie,
      },
    },
  );

  expect(assetResponse.statusCode).toBe(200);
  return assetResponse.body;
}

function expectDeploymentLogs(response: DeploymentLogsResponse, expectedLogTexts: readonly string[]): void {
  for (const expectedLogText of expectedLogTexts) {
    expect(hasDeploymentLog(response, expectedLogText)).toBe(true);
  }
}

function expectDeploymentLogsInOrder(response: DeploymentLogsResponse, expectedLogTexts: readonly string[]): void {
  let previousIndex: number = -1;

  for (const expectedLogText of expectedLogTexts) {
    const index: number = response.lines.findIndex(
      (line: DeploymentLogLine, lineIndex: number): boolean =>
        lineIndex > previousIndex && line.message.includes(expectedLogText),
    );

    expect(index, `Expected log text after index ${previousIndex}: ${expectedLogText}`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function hasDeploymentLog(response: DeploymentLogsResponse, expectedText: string): boolean {
  return response.lines.some((line: DeploymentLogLine): boolean => line.message.includes(expectedText));
}

function requireServiceRouteUrl(response: DeploymentStatusResponse, serviceName: string): string {
  const routeUrl: string | null = requireServiceDeployment(response, serviceName).routeUrl;
  if (routeUrl === null) {
    throw new Error(`Expected active route URL for ${serviceName}.`);
  }

  return routeUrl;
}

function requireServiceDeployment(response: DeploymentStatusResponse, serviceName: string): DeploymentReadSummary {
  const deployment: DeploymentReadSummary | undefined = response.deployments.find(
    (candidate: DeploymentReadSummary): boolean => candidate.serviceName === serviceName,
  );
  if (deployment === undefined) {
    throw new Error(`Expected deployment for ${serviceName}.`);
  }

  return deployment;
}

function requireSingleDeployment(response: DeploymentStatusResponse | DeploymentLogsResponse): DeploymentReadSummary {
  const deployment: DeploymentReadSummary | undefined = response.deployments[0];
  if (deployment === undefined || response.deployments.length !== 1) {
    throw new Error('Expected one deployment.');
  }

  return deployment;
}

function requireServiceInspectTarget(
  response: DeploymentInspectResponse,
  serviceName: string,
): DeploymentInspectTarget {
  const deployment: DeploymentInspectTarget | undefined = response.deployments.find(
    (candidate: DeploymentInspectTarget): boolean => candidate.serviceName === serviceName,
  );
  if (deployment === undefined) {
    throw new Error(`Expected inspect target for ${serviceName}.`);
  }

  return deployment;
}

function requireSingleInspectTarget(response: DeploymentInspectResponse): DeploymentInspectTarget {
  const deployment: DeploymentInspectTarget | undefined = response.deployments[0];
  if (deployment === undefined || response.deployments.length !== 1) {
    throw new Error('Expected one inspect target.');
  }

  return deployment;
}

async function expectProxyRoute(
  fixture: SelfHostedMultiServiceBuildFixture,
  webRouteUrl: string,
  runtime: SelfHostedUserSetupRuntime,
): Promise<void> {
  const appSessionCookie: string = await readAppSessionCookieWithRetry(webRouteUrl, {
    email: runtime.adminEmail,
    password: runtime.adminPassword,
  });
  const proxiedReadyResponse: CliHttpTextResponse = await sendCliHttpTextRequestWithRetry(
    new URL('/api/ready', webRouteUrl).toString(),
    {
      headers: {
        cookie: appSessionCookie,
      },
    },
  );
  const escapedPrefixResponse: CliHttpTextResponse = await sendCliHttpTextRequestWithRetry(webRouteUrl, {
    headers: {
      cookie: appSessionCookie,
    },
    requestPath: '/api/%2e%2e/healthz',
  });

  expect(proxiedReadyResponse.statusCode).toBe(200);
  expect(JSON.parse(proxiedReadyResponse.body) as SelfHostedProxyReadyPayload).toEqual(fixture.proxyPayload);
  expect(escapedPrefixResponse.statusCode).toBe(404);
  expect(JSON.parse(escapedPrefixResponse.body)).toEqual({ error: 'route_not_found' });
}

async function sendCliHttpTextRequestWithRetry(
  url: string,
  options: CliHttpTextRequestOptions = {},
): Promise<CliHttpTextResponse> {
  let lastError: Error | null = null;
  for (let attempt: number = 0; attempt < selfHostedBuildMatrixHttpProbeAttempts; attempt += 1) {
    try {
      return await sendCliHttpTextRequest(url, {
        ...options,
        timeoutMs: options.timeoutMs ?? selfHostedBuildMatrixHttpProbeTimeoutMs,
      });
    } catch (error) {
      const probeError: HttpProbeErrorInput = error as HttpProbeErrorInput;
      if (!isRetryableHttpProbeError(probeError)) {
        throw error;
      }

      lastError = probeError instanceof Error ? probeError : new Error(String(probeError));
      await sleep(selfHostedBuildMatrixHttpProbeDelayMs);
    }
  }

  throw new Error(
    `HTTP probe failed for ${url} after ${selfHostedBuildMatrixHttpProbeAttempts.toString()} attempts. Last error: ${
      lastError?.message ?? 'none'
    }`,
  );
}

function isRetryableHttpProbeError(error: HttpProbeErrorInput): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code: string | number | undefined = (error as NodeJS.ErrnoException).code;
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT';
}

async function expectMultiServiceRollback(
  admin: SelfHostedUserSetupCli,
  fixture: SelfHostedMultiServiceBuildFixture,
  runtime: SelfHostedUserSetupRuntime,
): Promise<void> {
  const firstStatus: DeploymentStatusResponse = await admin.runJson(
    `status --project ${fixture.name}`,
    deploymentStatusCommandResponseParser,
  );
  const firstInspect: DeploymentInspectResponse = await admin.runJson(
    `inspect --project ${fixture.name}`,
    deploymentInspectResponseSchema,
  );
  const redeployedServices: DeploymentReadSummary[] = [];

  for (const service of fixture.services) {
    const serviceDeployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
      `deploy --service ${service.name}`,
      deployCommandResponseParser,
      { cwd: fixture.directory },
    );
    redeployedServices.push(requireSingleActiveDeployment(serviceDeployPayload, service.name));
  }

  const rollbackPayload: DeploymentStatusResponse = await admin.runJson(
    `rollback --project ${fixture.name}`,
    deploymentStatusResponseSchema,
  );
  const rollbackInspect: DeploymentInspectResponse = await admin.runJson(
    `inspect --project ${fixture.name}`,
    deploymentInspectResponseSchema,
  );

  expect(rollbackPayload.deployments).toHaveLength(fixture.services.length);
  for (const service of fixture.services) {
    const redeployedService: DeploymentReadSummary | undefined = redeployedServices.find(
      (deployment: DeploymentReadSummary): boolean => deployment.serviceName === service.name,
    );
    const firstDeployment: DeploymentReadSummary = requireServiceDeployment(firstStatus, service.name);
    const rollbackDeployment: DeploymentReadSummary = requireServiceDeployment(rollbackPayload, service.name);

    expect(firstDeployment.status).toBe('succeeded');
    expect(redeployedService).toBeDefined();
    expect(rollbackDeployment.id).not.toBe(redeployedService?.id);
    expect(rollbackDeployment.id).not.toBe(firstDeployment.id);
    expect(rollbackDeployment.operation.type).toBe('deployment.rollback');
    expect(rollbackDeployment.status).toBe('succeeded');
    expect(requireInspectRuntimeImageRef(rollbackInspect, service.name)).toBe(
      requireInspectRuntimeImageRef(firstInspect, service.name),
    );
  }
  await expectProxyRoute(fixture, requireServiceRouteUrl(rollbackPayload, 'web'), runtime);
}

function requireInspectRuntimeImageRef(response: DeploymentInspectResponse, serviceName: string): string {
  const runtime: DeploymentInspectRuntimeSummary | null = requireServiceInspectTarget(response, serviceName).runtime;
  if (runtime === null) {
    throw new Error(`Expected inspect runtime for ${serviceName}.`);
  }

  return runtime.imageRef;
}

async function readRuntimeContainerCommandOutput(
  deploymentId: string,
  expectation: SelfHostedRuntimeCommandExpectation,
): Promise<string> {
  if (isK3dPlatformMode()) {
    return await readK3dRuntimeCommandOutput(deploymentId, expectation);
  }
  const containerResult: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['docker', 'ps', '-q', '--filter', `label=compartment.deploymentId=${deploymentId}`],
    timeoutMs: selfHostedBuildMatrixDockerCommandTimeoutMs,
  });
  expectSuccessfulCommand(containerResult, `docker ps for deployment ${deploymentId}`);
  const containerId: string = containerResult.stdout.trim();
  if (containerId === '') {
    throw new Error(`Expected runtime container for deployment ${deploymentId}.`);
  }

  const outputResult: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['docker', 'exec', containerId, ...expectation.command],
    timeoutMs: selfHostedBuildMatrixDockerCommandTimeoutMs,
  });
  expectSuccessfulCommand(outputResult, `docker exec ${expectation.command.join(' ')}`);

  return outputResult.stdout.trim();
}

async function readK3dRuntimeCommandOutput(
  deploymentId: string,
  expectation: SelfHostedRuntimeCommandExpectation,
): Promise<string> {
  const kubeContext: string = readK3dPlatformSeed().kubeContext;
  const podResult: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      kubeContext,
      'get',
      'pods',
      '--all-namespaces',
      '--selector',
      `compartment.dev/deployment-id=${deploymentId}`,
      '--output',
      'jsonpath={.items[0].metadata.namespace}{"\\t"}{.items[0].metadata.name}',
    ],
    timeoutMs: selfHostedBuildMatrixDockerCommandTimeoutMs,
  });
  expectSuccessfulCommand(podResult, `kubectl get pod for deployment ${deploymentId}`);
  const [namespace, podName] = podResult.stdout.trim().split('\t');
  if (namespace === undefined || podName === undefined) {
    throw new Error(`Expected Kubernetes Pod for deployment ${deploymentId}.`);
  }
  const outputResult: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      kubeContext,
      'exec',
      '--namespace',
      namespace,
      podName,
      '--',
      ...expectation.command,
    ],
    timeoutMs: selfHostedBuildMatrixDockerCommandTimeoutMs,
  });
  expectSuccessfulCommand(outputResult, `kubectl exec ${expectation.command.join(' ')}`);
  return outputResult.stdout.trim();
}

function requireFixtureService(
  fixture: SelfHostedMultiServiceBuildFixture,
  serviceName: string,
): SelfHostedMultiServiceFixtureService {
  const service: SelfHostedMultiServiceFixtureService | undefined = fixture.services.find(
    (candidate: SelfHostedMultiServiceFixtureService): boolean => candidate.name === serviceName,
  );
  if (service === undefined) {
    throw new Error(`Expected fixture service ${serviceName}.`);
  }

  return service;
}

function readScriptAssetPath(html: string): string | null {
  const match: RegExpExecArray | null = /<script[^>]+src="([^"]+\.js)"/u.exec(html);

  return match?.[1] ?? null;
}
