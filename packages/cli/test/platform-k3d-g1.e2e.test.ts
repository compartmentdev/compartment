import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  accessAssignmentResponseSchema,
  accessRoleResponseSchema,
  activateResponseSchema,
  inviteUserResponseSchema,
  type AccessAssignmentResponse,
  type AccessRoleResponse,
  type InviteUserResponse,
} from '@compartment/contracts';
import { expect, it } from 'vitest';
import type { SelfHostedUserSetupAppFixture } from './self-hosted-user-setup-app-fixture';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import {
  describeSelfHostedUserSetupE2e,
  selfHostedUserSetupTimeoutMs,
  useSelfHostedUserSetupHarness,
  type SelfHostedUserSetupHarness,
  type SelfHostedUserSetupRuntime,
} from './self-hosted-user-setup.e2e.harness';
import { readAppSessionCookieWithRetry } from './self-hosted-user-setup-app-probe.harness';
import {
  deployCommandResponseParser,
  deploymentStatusCommandResponseParser,
  requireActivationToken,
  requireRouteUrl,
  requireSingleActiveDeployment,
  type SelfHostedDeployCommandResponse,
} from './self-hosted-user-setup-cli-response.harness';

interface GateExecFileOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeout: number;
}

interface GateExecFileResult {
  readonly stderr: string;
  readonly stdout: string;
}

const execFileAsync: (
  file: string,
  args: readonly string[],
  options: GateExecFileOptions,
) => Promise<GateExecFileResult> = promisify(execFile);
const repositoryRoot: string = resolve(process.cwd(), '../..');

describeSelfHostedUserSetupE2e('platform k3d G1 edge gate', (): void => {
  const setup: SelfHostedUserSetupHarness = useSelfHostedUserSetupHarness();

  it(
    'restores the LKG snapshot and measures live grant revocation convergence',
    async (): Promise<void> => {
      const runtime: SelfHostedUserSetupRuntime = await setup.install();
      const app: SelfHostedUserSetupAppFixture = await setup.createAppFixture();
      const admin: SelfHostedUserSetupCli = await setup.createFreshCli();
      const viewer: SelfHostedUserSetupCli = await setup.createFreshCli();
      await admin.runBrowserLogin(
        `login --api-url ${runtime.apiUrl} --email ${runtime.adminEmail} --output json`,
        { email: runtime.adminEmail, password: runtime.adminPassword },
        { requestOrigin: runtime.apiUrl },
      );
      await admin.run(`variable set E2E_BUILD_MESSAGE g1-build-message --env ${app.environmentName}`, {
        cwd: app.directory,
      });

      const deploy: SelfHostedDeployCommandResponse = await admin.runJson('deploy', deployCommandResponseParser, {
        cwd: app.directory,
      });
      expect(requireSingleActiveDeployment(deploy, app.serviceName).status).toBe('succeeded');
      const routeUrl: string = requireRouteUrl(
        await admin.runJson(`status --project ${app.projectName}`, deploymentStatusCommandResponseParser),
        app.serviceName,
      );

      const viewerEmail: string = `g1-viewer-${process.pid.toString()}@compartment.test`;
      const viewerPassword: string = `${randomUUID()}-Aa1!-${randomUUID()}`;
      const invite: InviteUserResponse = await admin.runJson(`user invite ${viewerEmail}`, inviteUserResponseSchema);
      await viewer.runJson(
        `activate --api-url ${runtime.apiUrl} --email ${viewerEmail} --token ${requireActivationToken(invite)}`,
        activateResponseSchema,
        { input: `${viewerPassword}\n${viewerPassword}\n` },
      );
      const role: AccessRoleResponse = await admin.runJson(
        'role create platform-k3d-g1-reader --permission project.read app.route.access',
        accessRoleResponseSchema,
      );
      const assignment: AccessAssignmentResponse = await admin.runJson(
        `assignment create --role ${role.role.id} --scope project --project ${app.projectName} --user ${viewerEmail}`,
        accessAssignmentResponseSchema,
      );
      const appSessionCookie: string = await readAppSessionCookieWithRetry(routeUrl, {
        email: viewerEmail,
        password: viewerPassword,
      });

      const commandDirectory: string = join(app.directory, 'g1-commands');
      const assignmentStatePath: string = join(commandDirectory, 'assignment-id');
      const appSessionCookiePath: string = join(commandDirectory, 'app-session-cookie');
      const commandEnvironment: NodeJS.ProcessEnv = admin.readCommandEnvironment();
      const cliEnvironment: string = buildCliEnvironment(commandEnvironment);
      await mkdir(commandDirectory, { recursive: true });
      await writeFile(assignmentStatePath, `${assignment.assignment.id}\n`);
      await writeFile(appSessionCookiePath, `${appSessionCookie}\n`);
      const commands: GateCommands = await writeGateCommands({
        appSessionCookiePath,
        assignmentStatePath,
        cliEnvironment,
        commandDirectory,
        projectName: app.projectName,
        roleId: role.role.id,
        routeUrl,
        viewerEmail,
        viewerPassword,
      });

      const result: GateExecFileResult = await execFileAsync(
        join(repositoryRoot, 'packages/edge/test/k3d-lkg-verification.sh'),
        [],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            COMPARTMENT_P10_API_DEPLOYMENT: 'compartment/compartment-compartment-api',
            COMPARTMENT_P10_AUTHORIZED_PROBE_COMMAND: commands.authorized,
            COMPARTMENT_P10_EDGE_DEPLOYMENT: 'compartment/compartment-compartment-edge',
            COMPARTMENT_P10_GRANT_COMMAND: commands.grant,
            COMPARTMENT_P10_KUBE_CONTEXT: 'k3d-compartment-e2e',
            COMPARTMENT_P10_POST_RESTORE_COMMAND: commands.postRestore,
            COMPARTMENT_P10_RELOGIN_PROBE_COMMAND: commands.relogin,
            COMPARTMENT_P10_REVOKE_COMMAND: commands.revoke,
            COMPARTMENT_P10_SNAPSHOT_PATH: '/var/lib/compartment/snapshots/access-state.json',
            COMPARTMENT_P10_SNAPSHOT_HOST: new URL(routeUrl).hostname,
            COMPARTMENT_P10_UPSTREAM_PROBE_COMMAND: commands.upstream,
          },
          timeout: selfHostedUserSetupTimeoutMs,
        },
      );
      expect(result.stdout).toMatch(/revocation_ms p95=\d+ p99=\d+ samples=100/u);
    },
    selfHostedUserSetupTimeoutMs,
  );
});

interface GateCommandInput {
  readonly appSessionCookiePath: string;
  readonly assignmentStatePath: string;
  readonly cliEnvironment: string;
  readonly commandDirectory: string;
  readonly projectName: string;
  readonly roleId: string;
  readonly routeUrl: string;
  readonly viewerEmail: string;
  readonly viewerPassword: string;
}

interface GateCommands {
  readonly authorized: string;
  readonly grant: string;
  readonly postRestore: string;
  readonly relogin: string;
  readonly revoke: string;
  readonly upstream: string;
}

async function writeGateCommands(input: GateCommandInput): Promise<GateCommands> {
  const routeTarget: URL = new URL(input.routeUrl);
  const routeConnectUrl: URL = new URL(input.routeUrl);
  routeConnectUrl.hostname = '127.0.0.1';
  const routeHostHeader: string = `Host: ${routeTarget.host}`;
  const authorized: string = await writeCommand(
    input.commandDirectory,
    'authorized.sh',
    `cookie="$(cat ${shellQuote(input.appSessionCookiePath)})"\ncurl --silent --show-error --output /dev/null --write-out '%{http_code}\\n' --header ${shellQuote(routeHostHeader)} --header "Cookie: $cookie" ${shellQuote(new URL('/probe/whoami', routeConnectUrl).toString())} | grep --quiet '^200$'`,
  );
  const upstream: string = await writeCommand(
    input.commandDirectory,
    'upstream.sh',
    `cookie="$(cat ${shellQuote(input.appSessionCookiePath)})"\ncurl --fail --silent --show-error --header ${shellQuote(routeHostHeader)} --header "Cookie: $cookie" ${shellQuote(new URL('/probe/build', routeConnectUrl).toString())} | grep --quiet g1-build-message`,
  );
  const relogin: string = await writeCommand(
    input.commandDirectory,
    'relogin.sh',
    `headers="$(mktemp)"\ntrap 'rm -f "$headers"' EXIT\ncurl --fail --retry 30 --retry-all-errors --retry-delay 1 --silent --show-error --header ${shellQuote(routeHostHeader)} --dump-header "$headers" --output /dev/null ${shellQuote(new URL('/probe/whoami', routeConnectUrl).toString())}\ngrep --quiet '^HTTP/.* 302' "$headers"\ngrep --ignore-case --quiet '^location: http://console\\.compartment\\.localhost:18080/login' "$headers"`,
  );
  const grant: string = await writeCommand(
    input.commandDirectory,
    'grant.sh',
    `if [[ -s ${shellQuote(input.assignmentStatePath)} ]]; then exit 0; fi\nresult="$(${input.cliEnvironment} assignment create --role ${shellQuote(input.roleId)} --scope project --project ${shellQuote(input.projectName)} --user ${shellQuote(input.viewerEmail)} --output json)"\nnode -e 'const input = JSON.parse(process.argv[1]); process.stdout.write(input.assignment.id + "\\n");' "$result" > ${shellQuote(input.assignmentStatePath)}`,
  );
  const revoke: string = await writeCommand(
    input.commandDirectory,
    'revoke.sh',
    `assignment_id="$(cat ${shellQuote(input.assignmentStatePath)})"\n${input.cliEnvironment} assignment delete "$assignment_id" --output json >/dev/null\nrm -f ${shellQuote(input.assignmentStatePath)}`,
  );
  const postRestore: string = await writePostRestoreCommand(input);
  return { authorized, grant, postRestore, relogin, revoke, upstream };
}

async function writePostRestoreCommand(input: GateCommandInput): Promise<string> {
  const scriptPath: string = join(input.commandDirectory, 'post-restore.mjs');
  await writeFile(scriptPath, buildPostRestoreScript(input));
  return await writeCommand(input.commandDirectory, 'post-restore.sh', `node ${shellQuote(scriptPath)}`);
}

function buildPostRestoreScript(input: GateCommandInput): string {
  return `import { writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
const routeUrl = ${JSON.stringify(input.routeUrl)};
const first = await waitForLoginRedirect(routeUrl);
const loginUrl = new URL(first.headers.get('location'));
const state = loginUrl.searchParams.get('state');
const flowName = \`__Host-compartment_app_flow_\${state}\`;
const flowCookie = readCookie(first, flowName);
const page = await request(loginUrl, { redirect: 'manual' });
const csrf = readCookie(page, '__Host-compartment_csrf');
const login = await request(new URL('/v1/auth/login', loginUrl), {
  body: JSON.stringify({ email: ${JSON.stringify(input.viewerEmail)}, host: loginUrl.searchParams.get('host'), password: ${JSON.stringify(input.viewerPassword)}, path: loginUrl.searchParams.get('path'), sessionDelivery: 'cookie', state }),
  headers: { 'content-type': 'application/json', cookie: \`__Host-compartment_csrf=\${csrf}\`, origin: loginUrl.origin, 'x-compartment-csrf': csrf },
  method: 'POST',
  redirect: 'manual',
});
const payload = await login.json();
const callback = await request(payload.redirectTo, { headers: { cookie: \`\${flowName}=\${flowCookie}\` }, redirect: 'manual' });
const appSession = readCookie(callback, '__Host-compartment_app_session');
await writeFile(${JSON.stringify(input.appSessionCookiePath)}, \`__Host-compartment_app_session=\${appSession}\\n\`);
async function waitForLoginRedirect(url) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request(url, { redirect: 'manual' });
    lastStatus = response.status;
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) return response;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(\`Route did not converge to a login redirect. Last status: \${lastStatus}.\`);
}
async function request(url, options) {
  const target = new URL(url);
  const connect = new URL(target);
  const headers = new Headers(options?.headers);
  if (target.hostname.endsWith('.localhost')) {
    connect.hostname = '127.0.0.1';
    headers.set('host', target.host);
  }
  return await new Promise((resolve, reject) => {
    const request = httpRequest(connect, { headers: Object.fromEntries(headers), method: options?.method }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on('error', reject);
      incoming.on('end', () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
            responseHeaders.append(name, item);
          }
        }
        resolve(new Response(Buffer.concat(chunks), { headers: responseHeaders, status: incoming.statusCode ?? 500 }));
      });
    });
    request.on('error', reject);
    request.end(options?.body);
  });
}
function readCookie(response, name) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';', 1)[0];
    if (pair.startsWith(\`\${name}=\`)) return pair.slice(name.length + 1);
  }
  throw new Error(\`Missing cookie \${name} from HTTP \${response.status}.\`);
}
`;
}

async function writeCommand(directory: string, name: string, body: string): Promise<string> {
  const path: string = join(directory, name);
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o700);
  return path;
}

function buildCliEnvironment(env: NodeJS.ProcessEnv): string {
  const cliPath: string = join(repositoryRoot, '.compartment/cli-dist/compartment');
  const assignments: string[] = ['HOME', 'XDG_CONFIG_HOME'].map((name: string): string => {
    const value: string | undefined = env[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is missing from the G1 CLI environment.`);
    }
    return `${name}=${shellQuote(value)}`;
  });
  return `env -u COMPARTMENT_CLI_CONFIG_DIR ${assignments.join(' ')} ${shellQuote(cliPath)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
