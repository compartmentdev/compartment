import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import {
  deploymentInspectResponseSchema,
  deploymentLogsResponseSchema,
  deploymentStatusResponseSchema,
  projectDeleteResponseSchema,
  projectResponseSchema,
  variableResponseSchema,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentLogLine,
  type DeploymentLogsResponse,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type ProjectDeleteResponse,
  type ProjectResponse,
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
import { expectDeploymentRuntimeImageProjection } from './self-hosted-user-setup-runtime-projection.harness';
import {
  buildSelfHostedAdvertisedCompartmentUrl,
  buildSelfHostedAppHostname,
  describeSelfHostedUserSetupE2e,
  expectSelfHostedUserSetupStepCompleted,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import { readAppSessionCookieWithRetry } from './self-hosted-user-setup-app-probe.harness';
import {
  readK3dPlatformSeed,
  reclaimK3dBuildStorage,
  type K3dPlatformSeed,
} from './self-hosted-user-setup-k3d.harness';
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
  readSelfHostedBuildMatrixPartition,
  type SelfHostedBuildMatrixPartitionDefinition,
} from './self-hosted-build-matrix-partitions';
import {
  expectSuccessfulCommand,
  runCommand,
  runTimedStep,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

type HttpProbeErrorInput = Error | string | number | boolean | symbol | bigint | null | undefined;

const selfHostedBuildMatrixTimeoutMs: number =
  process.env.COMPARTMENT_E2E_GVISOR_ENABLED === '1' ? 90 * 60_000 : 40 * 60_000;
const selfHostedBuildMatrixDeployTimeoutMs: number =
  process.env.COMPARTMENT_E2E_GVISOR_ENABLED === '1' ? 30 * 60_000 : 15 * 60_000;
const selfHostedBuildMatrixRuntimeCommandTimeoutMs: number = 60_000;
const selfHostedBuildMatrixHttpProbeAttempts: number = 60;
const selfHostedBuildMatrixHttpProbeDelayMs: number = 1_000;
const selfHostedBuildMatrixHttpProbeTimeoutMs: number = 2_000;
const selfHostedBuildMatrixLogConvergenceTimeoutMs: number = 3 * 60_000;
const buildMatrixPartition: SelfHostedBuildMatrixPartitionDefinition | undefined = readSelfHostedBuildMatrixPartition(
  process.env.COMPARTMENT_E2E_BUILD_MATRIX_PARTITION,
);

describeSelfHostedUserSetupE2e('self-hosted system build matrix end-to-end', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  let runtime: SelfHostedUserSetupRuntime;
  let admin: SelfHostedUserSetupCli;
  let advertisedCompartmentUrl: string;
  let completedStepCount: number = 0;
  let sandboxProofCompleted: boolean = false;

  it(
    'installs the system and logs in with the CLI',
    async (): Promise<void> => {
      runtime = await setup.install();
      advertisedCompartmentUrl = buildSelfHostedAdvertisedCompartmentUrl(runtime.compartmentUrl);
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
        const fixtures: readonly SelfHostedSingleServiceBuildFixture[] = [
          ...selfHostedSingleServiceBuildFixtures,
          staticPoisonFixture,
        ].filter(
          (fixture: SelfHostedSingleServiceBuildFixture): boolean =>
            buildMatrixPartition === undefined || buildMatrixPartition.singleServiceFixtureNames.includes(fixture.name),
        );
        for (const fixture of fixtures) {
          await runTimedStep(`build-matrix single-service ${fixture.name}`, async (): Promise<void> => {
            await seedBuildVariables(admin, fixture);

            const deployPromise: Promise<SelfHostedDeployCommandResponse> = admin.runJson(
              'deploy',
              deployCommandResponseParser,
              { cwd: fixture.directory, timeoutMs: selfHostedBuildMatrixDeployTimeoutMs },
            );
            if (process.env.COMPARTMENT_E2E_GVISOR_ENABLED === '1' && !sandboxProofCompleted) {
              await expectEphemeralGVisorBuildPod(deployPromise);
              sandboxProofCompleted = true;
            }
            const deployPayload: SelfHostedDeployCommandResponse = await deployPromise;
            const deployment: DeploymentReadSummary = requireSingleActiveDeployment(deployPayload, 'web');
            const routeUrl: string = requireRouteUrl(deployPayload, 'web');

            expect(deployPayload.project.name).toBe(fixture.name);
            expect(deployment.status).toBe('succeeded');
            await expectProtectedRouteRedirect(advertisedCompartmentUrl, routeUrl);

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
            await cleanupK3dBuildFixture(admin, fixture.name);
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
      const fixtures: readonly SelfHostedMultiServiceBuildFixture[] = selfHostedMultiServiceBuildFixtures.filter(
        (fixture: SelfHostedMultiServiceBuildFixture): boolean =>
          buildMatrixPartition === undefined || buildMatrixPartition.multiServiceFixtureNames.includes(fixture.name),
      );
      for (const fixture of fixtures) {
        await runTimedStep(`build-matrix multi-service ${fixture.name}`, async (): Promise<void> => {
          const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson(
            'deploy',
            deployCommandResponseParser,
            {
              cwd: fixture.directory,
              timeoutMs: selfHostedBuildMatrixDeployTimeoutMs,
            },
          );
          expect(deployPayload.deployments).toHaveLength(fixture.services.length);

          for (const service of fixture.services) {
            const routeUrl: string = requireServiceRouteUrl(deployPayload, service.name);
            expect(new URL(routeUrl).hostname).toBe(buildSelfHostedAppHostname(runtime, fixture.name, service.name));
            await expectProtectedRouteRedirect(advertisedCompartmentUrl, routeUrl);
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

          const logsPayload: DeploymentLogsResponse = await readFixtureLogsUntil(
            admin,
            fixture.name,
            fixture.services.flatMap(
              (service: SelfHostedMultiServiceFixtureService): readonly string[] => service.logTexts,
            ),
          );
          for (const service of fixture.services) {
            expectDeploymentLogs(logsPayload, service.logTexts);
          }

          const routedService: SelfHostedMultiServiceFixtureService = requireFixtureService(
            fixture,
            fixture.routedServiceName,
          );
          const scopedLogsPayload: DeploymentLogsResponse = await readFixtureLogsUntil(
            admin,
            fixture.name,
            routedService.logTexts,
            fixture.routedServiceName,
          );
          expect(requireSingleDeployment(scopedLogsPayload).serviceName).toBe(fixture.routedServiceName);
          expectDeploymentLogs(scopedLogsPayload, routedService.logTexts);
          expect(hasDeploymentLog(scopedLogsPayload, requireFixtureService(fixture, 'web').logTexts[0]!)).toBe(false);

          await expectProxyRoute(fixture, requireServiceRouteUrl(deployPayload, 'web'), runtime);

          if (fixture.checkRollback === true) {
            await expectMultiServiceRollback(admin, fixture, runtime);
          }
          await cleanupK3dBuildFixture(admin, fixture.name);
        });
      }
      completedStepCount = 3;
    },
    selfHostedBuildMatrixTimeoutMs,
  );
});

async function cleanupK3dBuildFixture(admin: SelfHostedUserSetupCli, projectName: string): Promise<void> {
  const archivedProject: ProjectResponse = await admin.runJson(
    `project archive --project ${projectName} --yes`,
    projectResponseSchema,
  );
  expect(archivedProject.project.archivedAt).not.toBeNull();
  const deletedProject: ProjectDeleteResponse = await admin.runJson(
    `project delete --project ${projectName} --yes`,
    projectDeleteResponseSchema,
  );
  expect(deletedProject.projectName).toBe(projectName);
  await reclaimK3dBuildStorage();
}

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

  const expectedLogTexts: readonly string[] = [
    ...(fixture.expectedLogTexts ?? []),
    ...(fixture.expectedOrderedLogTexts ?? []),
  ];
  const logsPayload: DeploymentLogsResponse = await readFixtureLogsUntil(admin, fixture.name, expectedLogTexts);

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

async function readFixtureLogsUntil(
  admin: SelfHostedUserSetupCli,
  projectName: string,
  expectedLogTexts: readonly string[],
  serviceName?: string,
): Promise<DeploymentLogsResponse> {
  const deadline: number = Date.now() + selfHostedBuildMatrixLogConvergenceTimeoutMs;
  let logsPayload: DeploymentLogsResponse = await readFixtureLogsForService(admin, projectName, serviceName);

  while (!hasExpectedLogTexts(logsPayload, expectedLogTexts) && Date.now() < deadline) {
    await sleep(selfHostedBuildMatrixHttpProbeDelayMs);
    logsPayload = await readFixtureLogsForService(admin, projectName, serviceName);
  }
  return logsPayload;
}

async function readFixtureLogsForService(
  admin: SelfHostedUserSetupCli,
  projectName: string,
  serviceName?: string,
): Promise<DeploymentLogsResponse> {
  return serviceName === undefined
    ? await readFixtureLogs(admin, projectName)
    : await admin.runJson(`logs --project ${projectName} --service ${serviceName}`, deploymentLogsResponseSchema);
}

function hasExpectedLogTexts(response: DeploymentLogsResponse, expectedLogTexts: readonly string[]): boolean {
  return expectedLogTexts.every((expectedLogText: string): boolean => hasDeploymentLog(response, expectedLogText));
}

async function expectProtectedRouteRedirect(compartmentUrl: string, routeUrl: string): Promise<void> {
  const response: CliHttpTextResponse = await sendCliHttpTextRequestUntilStatus(routeUrl, 302);

  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toContain(`${compartmentUrl}/login`);
}

async function readAuthorizedRouteBody(routeUrl: string, runtime: SelfHostedUserSetupRuntime): Promise<string> {
  const appSessionCookie: string = await readAppSessionCookieWithRetry(routeUrl, {
    email: runtime.adminEmail,
    password: runtime.adminPassword,
  });
  const response: CliHttpTextResponse = await sendCliHttpTextRequestUntilStatus(routeUrl, 200, {
    headers: {
      cookie: appSessionCookie,
    },
  });
  const scriptAssetPath: string | null = readScriptAssetPath(response.body);

  expect(response.statusCode).toBe(200);
  if (scriptAssetPath === null) {
    return response.body;
  }

  const assetResponse: CliHttpTextResponse = await sendCliHttpTextRequestUntilStatus(
    new URL(scriptAssetPath, routeUrl).toString(),
    200,
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
    expect(hasDeploymentLog(response, expectedLogText), `Expected deployment logs to include: ${expectedLogText}`).toBe(
      true,
    );
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
  const proxiedReadyResponse: CliHttpTextResponse = await sendCliHttpTextRequestUntilStatus(
    new URL('/api/ready', webRouteUrl).toString(),
    200,
    {
      headers: {
        cookie: appSessionCookie,
      },
    },
  );
  const primaryHealthResponse: CliHttpTextResponse = await sendCliHttpTextRequestUntilStatus(
    new URL('/healthz', webRouteUrl).toString(),
    200,
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
  expect(primaryHealthResponse.body).not.toBe(proxiedReadyResponse.body);
  expectEscapedProxyPrefixNotForwarded(escapedPrefixResponse, primaryHealthResponse);
}

function expectEscapedProxyPrefixNotForwarded(
  escapedPrefixResponse: CliHttpTextResponse,
  primaryHealthResponse: CliHttpTextResponse,
): void {
  if (escapedPrefixResponse.statusCode === 404) {
    expect(JSON.parse(escapedPrefixResponse.body)).toEqual({ error: 'route_not_found' });
    return;
  }

  expect(escapedPrefixResponse.statusCode).toBe(primaryHealthResponse.statusCode);
  expect(escapedPrefixResponse.body).toBe(primaryHealthResponse.body);
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

async function sendCliHttpTextRequestUntilStatus(
  url: string,
  expectedStatusCode: number,
  options: CliHttpTextRequestOptions = {},
): Promise<CliHttpTextResponse> {
  let response: CliHttpTextResponse = await sendCliHttpTextRequestWithRetry(url, options);

  for (
    let attempt: number = 1;
    response.statusCode !== expectedStatusCode && attempt < selfHostedBuildMatrixHttpProbeAttempts;
    attempt += 1
  ) {
    await sleep(selfHostedBuildMatrixHttpProbeDelayMs);
    response = await sendCliHttpTextRequestWithRetry(url, options);
  }

  return response;
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
    await expectDeploymentRuntimeImageProjection(admin, fixture.name, service.name, rollbackDeployment.id);
  }
  await expectProxyRoute(fixture, requireServiceRouteUrl(rollbackPayload, 'web'), runtime);
}

async function expectEphemeralGVisorBuildPod(deployment: Promise<SelfHostedDeployCommandResponse>): Promise<void> {
  const seed: K3dPlatformSeed = readK3dPlatformSeed();
  const buildNamespace: string = `${seed.platformNamespace}-build`;
  await expectNoLongLivedBuildKitDeployment(seed.kubeContext, buildNamespace);
  const podName: string = await waitForBuildPod(seed.kubeContext, buildNamespace);
  const ready: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'wait',
      '--namespace',
      buildNamespace,
      `pod/${podName}`,
      '--for=condition=Ready',
      '--timeout=60s',
    ],
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
  });
  expectSuccessfulCommand(ready, 'wait for the ephemeral BuildKit pod');
  const version: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      seed.kubeContext,
      'exec',
      '--namespace',
      buildNamespace,
      podName,
      '--container',
      'buildkit',
      '--',
      'dmesg',
    ],
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
  });
  expectSuccessfulCommand(version, 'kubectl exec dmesg in ephemeral BuildKit sidecar');
  expect(version.stdout.toLowerCase()).toContain('gvisor');
  await expectMemoryBackedBuildWorkspace(seed.kubeContext, buildNamespace, podName);
  await deployment;
  await waitForNoBuildPods(seed.kubeContext, buildNamespace);
  await expectNoLongLivedBuildKitDeployment(seed.kubeContext, buildNamespace);
}

/**
 * The build workspace only behaves like an installation when containerd forwards the
 * `dev.gvisor.spec.mount.*` hints to runsc. Without that forwarding the volumes stay gofer-backed,
 * builds never charge the Pod memory cgroup, and the memory budget the chart sizes is untested.
 */
async function expectMemoryBackedBuildWorkspace(
  kubeContext: string,
  namespace: string,
  podName: string,
): Promise<void> {
  const mounts: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      kubeContext,
      'exec',
      '--namespace',
      namespace,
      podName,
      '--container',
      'buildkit',
      '--',
      'cat',
      '/proc/mounts',
    ],
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
  });
  expectSuccessfulCommand(mounts, 'read the build workspace mount table');
  for (const mountPath of ['/var/lib/buildkit', '/buildkit-tmp']) {
    expect(readMountFilesystemType(mounts.stdout, mountPath)).toBe('tmpfs');
  }
}

function readMountFilesystemType(mountTable: string, mountPath: string): string {
  const entry: string | undefined = mountTable
    .split('\n')
    .find((line: string): boolean => line.split(' ')[1] === mountPath);
  if (entry === undefined) {
    throw new Error(`Expected the build sandbox to mount ${mountPath}.`);
  }
  return entry.split(' ')[2] ?? '';
}

async function expectNoLongLivedBuildKitDeployment(kubeContext: string, namespace: string): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['kubectl', '--context', kubeContext, 'get', 'deployments', '--namespace', namespace, '--output', 'name'],
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
  });
  expectSuccessfulCommand(result, 'verify the long-lived BuildKit Deployment is absent');
  expect(result.stdout.trim()).toBe('');
}

async function waitForBuildPod(kubeContext: string, namespace: string): Promise<string> {
  for (let attempt: number = 0; attempt < 240; attempt += 1) {
    const podName: string = await readBuildPodName(kubeContext, namespace);
    if (podName !== '') {
      return podName;
    }
    await sleep(250);
  }
  throw new Error('Expected an ephemeral build pod to appear.');
}

async function waitForNoBuildPods(kubeContext: string, namespace: string): Promise<void> {
  for (let attempt: number = 0; attempt < 240; attempt += 1) {
    if ((await readBuildPodName(kubeContext, namespace)) === '') {
      return;
    }
    await sleep(250);
  }
  throw new Error('Expected the ephemeral build pod to disappear after the build.');
}

async function readBuildPodName(kubeContext: string, namespace: string): Promise<string> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'kubectl',
      '--context',
      kubeContext,
      'get',
      'pods',
      '--namespace',
      namespace,
      '--selector',
      'compartment.dev/job-class=build',
      '--output',
      'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}',
    ],
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
  });
  expectSuccessfulCommand(result, 'read ephemeral build pod');
  return result.stdout.trim().split('\n')[0] ?? '';
}

async function readRuntimeContainerCommandOutput(
  deploymentId: string,
  expectation: SelfHostedRuntimeCommandExpectation,
): Promise<string> {
  return await readK3dRuntimeCommandOutput(deploymentId, expectation);
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
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
  });
  expectSuccessfulCommand(podResult, `kubectl get pod for deployment ${deploymentId}`);
  const [namespace, podName] = podResult.stdout.trim().split('\t');
  if (namespace === undefined || podName === undefined) {
    throw new Error(`Expected Kubernetes Pod for deployment ${deploymentId}.`);
  }
  if (process.env.COMPARTMENT_E2E_GVISOR_ENABLED === '1') {
    const versionResult: SelfHostedUserSetupCommandResult = await runCommand({
      argv: ['kubectl', '--context', kubeContext, 'exec', '--namespace', namespace, podName, '--', 'dmesg'],
      timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
    });
    expectSuccessfulCommand(versionResult, `kubectl exec dmesg for deployment ${deploymentId}`);
    expect(versionResult.stdout.toLowerCase()).toContain('gvisor');
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
    timeoutMs: selfHostedBuildMatrixRuntimeCommandTimeoutMs,
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
