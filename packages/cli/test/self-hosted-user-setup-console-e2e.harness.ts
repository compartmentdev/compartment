import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect as connectTcp, type AddressInfo, type Socket } from 'node:net';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import {
  accessAssignmentResponseSchema,
  accessRoleResponseSchema,
  activateResponseSchema,
  createOrganizationResponseSchema,
  inviteUserResponseSchema,
  variableResponseSchema,
  type AccessAssignmentResponse,
  type AccessRoleResponse,
  type ActivateResponse,
  type CreateOrganizationResponse,
  type DeploymentReadSummary,
  type InviteUserResponse,
  type VariableResponse,
} from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import { expect } from 'vitest';
import {
  createSelfHostedUserSetupAppFixture,
  type SelfHostedUserSetupAppFixture,
} from './self-hosted-user-setup-app-fixture';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import {
  deployCommandResponseParser,
  requireActivationToken,
  requireRouteUrl,
  requireSingleActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';
import {
  buildSelfHostedAdvertisedCompartmentUrl,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import { organizationUseResponseSchema, type OrganizationUseResponse } from './system-user-flow-response.harness';
import {
  expectSuccessfulCommand,
  runCommand,
  runTimedStep,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

interface ConsoleE2eLoginPrincipalSeed {
  readonly roleName: string;
  readonly userEmail: string;
  readonly userPassword: string;
}

interface ConsoleE2eAccountFixture {
  readonly email: string;
  readonly organizationName: string;
  readonly password: string;
}

interface ConsoleE2eDeploymentFixture {
  readonly attackerRouteUrl: string;
  readonly deploymentRunId: string;
  readonly environmentName: string;
  readonly projectName: string;
  readonly routeUrl: string;
  readonly serviceName: string;
}

interface ConsoleE2eProxyRouteFixture {
  readonly proxyPath: string;
  readonly routeUrl: string;
}

interface ConsoleE2eCleanupProjectFixture {
  readonly projectName: string;
}

interface ConsoleE2eResourceOwnershipFixture {
  readonly otherOrganizationSlug: string;
}

interface ConsoleE2ePreparedFixture {
  readonly account: ConsoleE2eAccountFixture;
  readonly cleanupProject: ConsoleE2eCleanupProjectFixture;
  readonly deployment: ConsoleE2eDeploymentFixture;
  readonly proxyRoute: ConsoleE2eProxyRouteFixture;
  readonly resourceOwnership: ConsoleE2eResourceOwnershipFixture;
}

class ConsoleE2eIngressProxy {
  readonly url: string;

  constructor(
    private readonly server: Server,
    private readonly tunnelSockets: Set<Duplex>,
    address: AddressInfo,
  ) {
    this.url = `http://127.0.0.1:${address.port.toString()}`;
  }

  async close(): Promise<void> {
    await closeServer(this.server, this.tunnelSockets);
  }
}

const consoleE2eTempRootDirectory: string = readSocketSafeTempRootDirectory('ouce-', 'system-api.sock');
const consoleE2eSetupCommandTimeoutMs: number = 10 * 60_000;
const consoleE2ePlaywrightCommandTimeoutMs: number = 5 * 60_000;
const consoleE2eBuildMessage: string = 'console-e2e-build-message';
const consoleE2eProxyPath: string = '/api/ready';
const consoleE2eMultiServiceSourceDirectory: string = resolve(__dirname, '../../../examples/multi-service');
const consoleE2eLoginPrincipalPermissions: string = [
  'organization.user.read',
  'organization.user.invite',
  'organization.user.block',
  'organization.user.remove',
  'organization.user.credentials.reset',
  'organization.group.read',
  'organization.group.manage',
  'organization.role.read',
  'organization.role.manage',
  'organization.audit.read',
  'project.read',
  'environment.read',
  'deployment.read',
  'deployment.logs.read',
  'deployment.inspect',
  'app.route.access',
].join(' ');
export const consoleE2eCommandTimeoutMs: number = 18 * 60_000;

export async function expectConsoleE2e(runtime: SelfHostedUserSetupRuntime): Promise<void> {
  const tempDirectories: string[] = [];
  let ingressProxy: ConsoleE2eIngressProxy | undefined;
  try {
    const fixture: ConsoleE2ePreparedFixture = await runTimedStep(
      'console e2e setup',
      async (): Promise<ConsoleE2ePreparedFixture> => await prepareConsoleE2eFixture(runtime, tempDirectories),
    );
    const startedIngressProxy: ConsoleE2eIngressProxy = await startConsoleE2eIngressProxy(runtime.compartmentUrl);
    ingressProxy = startedIngressProxy;
    const result: SelfHostedUserSetupCommandResult = await runTimedStep(
      'console e2e',
      async (): Promise<SelfHostedUserSetupCommandResult> =>
        await runCommand({
          argv: ['pnpm', '--filter', '@compartment/console', 'test:e2e'],
          env: buildConsoleE2ePlaywrightEnv(runtime, fixture, startedIngressProxy.url),
          timeoutMs: consoleE2ePlaywrightCommandTimeoutMs,
        }),
    );

    expectSuccessfulCommand(result, 'console e2e');
  } finally {
    await ingressProxy?.close();
    await cleanupConsoleE2eTempDirectories(tempDirectories);
  }
}

async function prepareConsoleE2eFixture(
  runtime: SelfHostedUserSetupRuntime,
  tempDirectories: string[],
): Promise<ConsoleE2ePreparedFixture> {
  const app: SelfHostedUserSetupAppFixture = await createConsoleE2eAppFixture(tempDirectories);
  const admin: SelfHostedUserSetupCli = await createConsoleE2eCli(tempDirectories);
  const viewer: SelfHostedUserSetupCli = await createConsoleE2eCli(tempDirectories);

  await loginConsoleE2eAdmin(admin, runtime);

  const deployment: ConsoleE2eDeploymentFixture = await deployConsoleE2eFixture(admin, app);
  const proxyRoute: ConsoleE2eProxyRouteFixture = await deployConsoleE2eProxyRouteFixture(admin, tempDirectories);
  const cleanupProject: ConsoleE2eCleanupProjectFixture = await deployConsoleE2eCleanupProject(admin, tempDirectories);
  const account: ConsoleE2eAccountFixture = await provisionConsoleE2eLoginPrincipal(admin, viewer, runtime);
  const resourceOwnership: ConsoleE2eResourceOwnershipFixture = await provisionConsoleE2eResourceOwnershipFixture(
    admin,
    app,
    runtime,
    account,
  );

  return { account, cleanupProject, deployment, proxyRoute, resourceOwnership };
}

async function createConsoleE2eAppFixture(tempDirectories: string[]): Promise<SelfHostedUserSetupAppFixture> {
  const fixture: SelfHostedUserSetupAppFixture = await createSelfHostedUserSetupAppFixture(
    consoleE2eTempRootDirectory,
    {
      includeCookieTossAttackerService: true,
    },
  );
  tempDirectories.push(fixture.directory);

  return fixture;
}

async function createConsoleE2eCli(tempDirectories: string[]): Promise<SelfHostedUserSetupCli> {
  const homeDirectory: string = await mkdtemp(join(consoleE2eTempRootDirectory, 'client-home-'));
  tempDirectories.push(homeDirectory);

  return new SelfHostedUserSetupCli(buildSelfHostedUserSetupClientEnv(homeDirectory), consoleE2eSetupCommandTimeoutMs);
}

async function loginConsoleE2eAdmin(admin: SelfHostedUserSetupCli, runtime: SelfHostedUserSetupRuntime): Promise<void> {
  await admin.runBrowserLogin(
    `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
    {
      email: runtime.adminEmail,
      password: runtime.adminPassword,
    },
    { requestOrigin: runtime.apiUrl },
  );
}

async function deployConsoleE2eFixture(
  admin: SelfHostedUserSetupCli,
  app: SelfHostedUserSetupAppFixture,
): Promise<ConsoleE2eDeploymentFixture> {
  await seedConsoleE2eBuildVariables(admin, app);

  const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson('deploy', deployCommandResponseParser, {
    cwd: app.directory,
  });
  const deployment: DeploymentReadSummary = requireSingleActiveDeployment(deployPayload, app.serviceName);
  const attackerServiceName: string = requireConsoleE2eAttackerServiceName(app);
  const attackerDeployment: DeploymentReadSummary = requireSingleActiveDeployment(deployPayload, attackerServiceName);

  expect(deployPayload.project.name).toBe(app.projectName);
  expect(deployment.status).toBe('succeeded');
  expect(attackerDeployment.status).toBe('succeeded');

  return {
    attackerRouteUrl: requireDeploymentRouteUrl(attackerDeployment, attackerServiceName),
    deploymentRunId: deployment.deploymentRunId,
    environmentName: app.environmentName,
    projectName: app.projectName,
    routeUrl: requireDeploymentRouteUrl(deployment, app.serviceName),
    serviceName: app.serviceName,
  };
}

function requireConsoleE2eAttackerServiceName(app: SelfHostedUserSetupAppFixture): string {
  if (app.attackerServiceName === undefined) {
    throw new Error('Expected console e2e app fixture to include a cookie-toss attacker service.');
  }

  return app.attackerServiceName;
}

function requireDeploymentRouteUrl(deployment: DeploymentReadSummary, serviceName: string): string {
  if (deployment.routeUrl === null) {
    throw new Error(`Expected ${serviceName} to expose a route URL.`);
  }

  return deployment.routeUrl;
}

async function deployConsoleE2eProxyRouteFixture(
  admin: SelfHostedUserSetupCli,
  tempDirectories: string[],
): Promise<ConsoleE2eProxyRouteFixture> {
  const directory: string = await createConsoleE2eProxyRouteFixture(tempDirectories);
  const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson('deploy', deployCommandResponseParser, {
    cwd: directory,
  });

  return {
    proxyPath: consoleE2eProxyPath,
    routeUrl: requireRouteUrl(deployPayload, 'web'),
  };
}

async function deployConsoleE2eCleanupProject(
  admin: SelfHostedUserSetupCli,
  tempDirectories: string[],
): Promise<ConsoleE2eCleanupProjectFixture> {
  const projectName: string = `console-e2e-cleanup-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const fixture: SelfHostedUserSetupAppFixture = await createSelfHostedUserSetupAppFixture(
    consoleE2eTempRootDirectory,
    {
      projectName,
    },
  );
  tempDirectories.push(fixture.directory);
  await seedConsoleE2eBuildVariables(admin, fixture);

  const deployPayload: SelfHostedDeployCommandResponse = await admin.runJson('deploy', deployCommandResponseParser, {
    cwd: fixture.directory,
  });
  expect(deployPayload.project.name).toBe(projectName);
  expect(requireSingleActiveDeployment(deployPayload, fixture.serviceName).status).toBe('succeeded');

  return { projectName };
}

async function createConsoleE2eProxyRouteFixture(tempDirectories: string[]): Promise<string> {
  const directory: string = await mkdtemp(join(consoleE2eTempRootDirectory, 'edge-route-auth-'));
  tempDirectories.push(directory);

  await cp(consoleE2eMultiServiceSourceDirectory, directory, { recursive: true });
  await writeFile(join(directory, 'compartment.yml'), createConsoleE2eProxyRouteDescriptor(), 'utf8');

  return directory;
}

function createConsoleE2eProxyRouteDescriptor(): string {
  const projectName: string = `console-e2e-edge-auth-${randomUUID().replaceAll('-', '').slice(0, 12)}`;

  return `name: ${projectName}

services:
  web:
    accessMode: public
    path: ./services/web
    readiness:
      type: http
      path: /healthz
      timeoutMs: 30000
  backoffice:
    accessMode: authenticated
    kind: api
    path: ./services/backoffice
    readiness:
      type: http
      path: /ready
      timeoutMs: 30000
`;
}

async function seedConsoleE2eBuildVariables(
  admin: SelfHostedUserSetupCli,
  app: SelfHostedUserSetupAppFixture,
): Promise<void> {
  const buildVariablePayload: VariableResponse = await admin.runJson(
    `variable set E2E_BUILD_MESSAGE ${consoleE2eBuildMessage} --env ${app.environmentName}`,
    variableResponseSchema,
    { cwd: app.directory },
  );

  expect(buildVariablePayload.variable.keyName).toBe('E2E_BUILD_MESSAGE');
  expect(buildVariablePayload.variable.value).toBe(consoleE2eBuildMessage);
}

async function provisionConsoleE2eResourceOwnershipFixture(
  admin: SelfHostedUserSetupCli,
  app: SelfHostedUserSetupAppFixture,
  runtime: SelfHostedUserSetupRuntime,
  account: ConsoleE2eAccountFixture,
): Promise<ConsoleE2eResourceOwnershipFixture> {
  const suffix: string = randomUUID().replaceAll('-', '').slice(0, 12);
  const otherOrganizationSlug: string = `ownership-${suffix}`;
  const createPayload: CreateOrganizationResponse = await admin.runJson(
    `org create --name "Ownership ${otherOrganizationSlug}" --slug ${otherOrganizationSlug}`,
    createOrganizationResponseSchema,
  );
  expect(createPayload.organization.slug).toBe(otherOrganizationSlug);

  const invitePayload: InviteUserResponse = await admin.runJson(
    `user invite ${account.email}`,
    inviteUserResponseSchema,
  );
  expect(invitePayload.user.email).toBe(account.email);
  expect(invitePayload.invitation).toBeNull();

  const rolePayload: AccessRoleResponse = await admin.runJson(
    [
      `role create console-e2e-resource-ownership-${suffix}`,
      '--permission project.read',
      '--permission deployment.read',
      '--permission deployment.logs.read',
    ].join(' '),
    accessRoleResponseSchema,
  );
  const assignmentPayload: AccessAssignmentResponse = await admin.runJson(
    `assignment create --role ${rolePayload.role.id} --scope organization --user ${account.email}`,
    accessAssignmentResponseSchema,
  );
  expect(assignmentPayload.assignment.roleId).toBe(rolePayload.role.id);

  const otherOrganizationDeployment: ConsoleE2eDeploymentFixture = await deployConsoleE2eFixture(admin, app);
  expect(otherOrganizationDeployment.projectName).toBe(app.projectName);

  const restorePayload: OrganizationUseResponse = await admin.runJson(
    `org use ${runtime.organizationSlug}`,
    organizationUseResponseSchema,
  );
  expect(restorePayload.organization.slug).toBe(runtime.organizationSlug);

  return { otherOrganizationSlug };
}

async function provisionConsoleE2eLoginPrincipal(
  admin: SelfHostedUserSetupCli,
  viewer: SelfHostedUserSetupCli,
  runtime: SelfHostedUserSetupRuntime,
): Promise<ConsoleE2eAccountFixture> {
  const seed: ConsoleE2eLoginPrincipalSeed = createConsoleE2eLoginPrincipalSeed();
  const invitePayload: InviteUserResponse = await admin.runJson(
    `user invite ${seed.userEmail}`,
    inviteUserResponseSchema,
  );
  const activationToken: string = requireActivationToken(invitePayload);
  const activationPayload: ActivateResponse = await viewer.runJson(
    `activate --api-url ${runtime.apiUrl} --email ${seed.userEmail} --token ${activationToken}`,
    activateResponseSchema,
    {
      input: `${seed.userPassword}\n${seed.userPassword}\n`,
    },
  );
  expect(activationPayload.principal.email).toBe(seed.userEmail);

  const rolePayload: AccessRoleResponse = await admin.runJson(
    `role create ${seed.roleName} --permission ${consoleE2eLoginPrincipalPermissions}`,
    accessRoleResponseSchema,
  );
  expect(rolePayload.role.name).toBe(seed.roleName);

  const assignmentPayload: AccessAssignmentResponse = await admin.runJson(
    `assignment create --role ${rolePayload.role.id} --scope organization --user ${seed.userEmail}`,
    accessAssignmentResponseSchema,
  );
  expect(assignmentPayload.assignment.roleId).toBe(rolePayload.role.id);

  return {
    email: seed.userEmail,
    organizationName: runtime.organizationName,
    password: seed.userPassword,
  };
}

function createConsoleE2eLoginPrincipalSeed(): ConsoleE2eLoginPrincipalSeed {
  const suffix: string = randomUUID().replaceAll('-', '').slice(0, 12);

  return {
    roleName: `console-e2e-login-principal-${suffix}`,
    userEmail: `console-e2e-login-${suffix}@compartment.test`,
    userPassword: `ConsoleE2e-${suffix}-${randomUUID().replaceAll('-', '')}!`,
  };
}

function buildConsoleE2ePlaywrightEnv(
  runtime: SelfHostedUserSetupRuntime,
  fixture: ConsoleE2ePreparedFixture,
  ingressProxyUrl: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.COMPARTMENT_E2E_BASE_URL = buildSelfHostedAdvertisedCompartmentUrl(runtime.compartmentUrl);
  env.COMPARTMENT_E2E_HTTP_PROXY = ingressProxyUrl;
  env.COMPARTMENT_E2E_ADMIN_EMAIL = runtime.adminEmail;
  env.COMPARTMENT_E2E_ADMIN_PASSWORD = runtime.adminPassword;
  env.COMPARTMENT_E2E_EMAIL = fixture.account.email;
  env.COMPARTMENT_E2E_ORGANIZATION_NAME = fixture.account.organizationName;
  env.COMPARTMENT_E2E_ORGANIZATION_SLUG = runtime.organizationSlug;
  env.COMPARTMENT_E2E_PASSWORD = fixture.account.password;
  env.COMPARTMENT_E2E_ATTACKER_APP_BASE_URL = fixture.deployment.attackerRouteUrl;
  env.COMPARTMENT_E2E_PROJECT_NAME = fixture.deployment.projectName;
  env.COMPARTMENT_E2E_CLEANUP_PROJECT_NAME = fixture.cleanupProject.projectName;
  env.COMPARTMENT_E2E_APP_BASE_URL = fixture.deployment.routeUrl;
  env.COMPARTMENT_E2E_SERVICE_NAME = fixture.deployment.serviceName;
  env.COMPARTMENT_E2E_DEPLOYMENT_RUN_ID = fixture.deployment.deploymentRunId;
  env.COMPARTMENT_E2E_ENVIRONMENT_NAME = fixture.deployment.environmentName;
  env.COMPARTMENT_E2E_PROXY_ROUTE_URL = fixture.proxyRoute.routeUrl;
  env.COMPARTMENT_E2E_PROXY_TARGET_PATH = fixture.proxyRoute.proxyPath;
  env.COMPARTMENT_E2E_OTHER_ORGANIZATION_SLUG = fixture.resourceOwnership.otherOrganizationSlug;

  return env;
}

async function startConsoleE2eIngressProxy(compartmentConnectUrl: string): Promise<ConsoleE2eIngressProxy> {
  const connectUrl: URL = new URL(compartmentConnectUrl);
  if (connectUrl.protocol !== 'http:' || connectUrl.port === '') {
    throw new Error(`Expected the console e2e ingress connect URL to use HTTP with an explicit port: ${connectUrl}`);
  }

  const ingressHostnameSuffix: string = connectUrl.hostname.replace(/^console\./u, '');
  const tunnelSockets: Set<Duplex> = new Set<Duplex>();
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    forwardConsoleE2eIngressRequest(request, response, ingressHostnameSuffix, connectUrl.port);
  });
  server.on('connect', (request: IncomingMessage, clientSocket: Duplex, head: Buffer): void => {
    tunnelConsoleE2eIngressRequest(request, clientSocket, head, ingressHostnameSuffix, connectUrl.port, tunnelSockets);
  });
  await listenOnLoopback(server);

  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server, tunnelSockets);
    throw new Error('Console e2e ingress proxy did not expose a TCP address.');
  }

  return new ConsoleE2eIngressProxy(server, tunnelSockets, address);
}

function forwardConsoleE2eIngressRequest(
  request: IncomingMessage,
  response: ServerResponse,
  ingressHostnameSuffix: string,
  ingressConnectPort: string,
): void {
  const targetUrl: URL | undefined = parseConsoleE2eProxyTarget(request.url);
  if (targetUrl?.protocol !== 'http:' || !targetsIngress(targetUrl, ingressHostnameSuffix)) {
    response.writeHead(502).end('Console e2e proxy only forwards HTTP requests to the test ingress.');
    return;
  }

  const headers: IncomingHttpHeaders = { ...request.headers, host: targetUrl.host };
  delete headers['proxy-connection'];
  const upstreamRequest: ClientRequest = httpRequest(
    {
      headers,
      hostname: '127.0.0.1',
      method: request.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      port: Number.parseInt(ingressConnectPort, 10),
    },
    (upstreamResponse: IncomingMessage): void => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstreamRequest.on('error', (error: Error): void => {
    if (!response.headersSent) {
      response.writeHead(502);
    }
    response.end(`Console e2e ingress proxy failed: ${error.message}`);
  });
  request.pipe(upstreamRequest);
}

function tunnelConsoleE2eIngressRequest(
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  ingressHostnameSuffix: string,
  ingressConnectPort: string,
  tunnelSockets: Set<Duplex>,
): void {
  tunnelSockets.add(clientSocket);
  clientSocket.once('close', (): void => {
    tunnelSockets.delete(clientSocket);
  });
  const targetUrl: URL | undefined = parseConsoleE2eProxyConnectTarget(request.url);
  if (targetUrl === undefined || !targetsIngress(targetUrl, ingressHostnameSuffix)) {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    return;
  }

  let tunnelEstablished: boolean = false;
  const upstreamSocket: Socket = connectTcp(
    { host: '127.0.0.1', port: Number.parseInt(ingressConnectPort, 10) },
    (): void => {
      tunnelEstablished = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    },
  );
  tunnelSockets.add(upstreamSocket);
  upstreamSocket.once('close', (): void => {
    tunnelSockets.delete(upstreamSocket);
  });
  upstreamSocket.on('error', (): void => {
    if (tunnelEstablished) {
      clientSocket.destroy();
      return;
    }
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
  });
  clientSocket.on('error', (): void => {
    upstreamSocket.destroy();
  });
}

function parseConsoleE2eProxyTarget(requestUrl: string | undefined): URL | undefined {
  if (requestUrl === undefined) {
    return undefined;
  }

  try {
    return new URL(requestUrl);
  } catch {
    return undefined;
  }
}

function parseConsoleE2eProxyConnectTarget(requestUrl: string | undefined): URL | undefined {
  if (requestUrl === undefined) {
    return undefined;
  }

  try {
    const targetUrl: URL = new URL(`http://${requestUrl}`);
    const targetsHttpPort: boolean = targetUrl.port === '' || targetUrl.port === '80';
    const hasOnlyAuthority: boolean =
      targetUrl.pathname === '/' &&
      targetUrl.search === '' &&
      targetUrl.hash === '' &&
      targetUrl.username === '' &&
      targetUrl.password === '';
    return targetsHttpPort && hasOnlyAuthority ? targetUrl : undefined;
  } catch {
    return undefined;
  }
}

function targetsIngress(targetUrl: URL, ingressHostnameSuffix: string): boolean {
  return targetUrl.hostname === ingressHostnameSuffix || targetUrl.hostname.endsWith(`.${ingressHostnameSuffix}`);
}

async function listenOnLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolveListen: () => void, rejectListen: (reason?: Error) => void): void => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', (): void => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
}

async function closeServer(server: Server, tunnelSockets: Set<Duplex>): Promise<void> {
  await new Promise<void>((resolveClose: () => void, rejectClose: (reason?: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error === undefined) {
        resolveClose();
        return;
      }
      rejectClose(error);
    });
    server.closeAllConnections();
    for (const socket of tunnelSockets) {
      socket.destroy();
    }
  });
}

async function cleanupConsoleE2eTempDirectories(tempDirectories: string[]): Promise<void> {
  for (const directory of tempDirectories) {
    await rm(directory, { force: true, recursive: true });
  }
}
