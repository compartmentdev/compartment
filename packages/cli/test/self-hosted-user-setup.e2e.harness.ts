import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { installResponseSchema, type InstallResponse } from '@compartment/contracts';
import { readSocketSafeTempRootDirectory } from '@compartment/test-support';
import type { JsonValue } from '@compartment/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonRecord, readRequiredString, type JsonRecord } from '../src/json.helpers';
import {
  createSelfHostedUserSetupAppFixture,
  type SelfHostedUserSetupAppFixture,
} from './self-hosted-user-setup-app-fixture';
import { findDistinctFreePorts, type DistinctFreePorts } from './public-port-test-support';
import { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';
import { buildSelfHostedUserSetupClientEnv } from './self-hosted-user-setup-client-env.harness';
import {
  assertBuiltCliAvailable,
  buildSelfHostedUserSetupCliArgv,
  expectSuccessfulCommand,
  selfHostedUserSetupNodeAgentLogPathEnvName,
  selfHostedComposeFilesScript,
  selfHostedDockerComposeCommand,
  readSelfHostedDiagnostics,
  runCommand,
  runTimedStep,
  type SelfHostedUserSetupCommandResult,
} from './self-hosted-user-setup-command.harness';

export interface SelfHostedUserSetupRuntime {
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly apiUrl: string;
  readonly compartmentUrl: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
}

export interface SelfHostedUserSetupHarness {
  createAppFixture(): Promise<SelfHostedUserSetupAppFixture>;
  createFreshCli(): Promise<SelfHostedUserSetupCli>;
  install(): Promise<SelfHostedUserSetupRuntime>;
}

interface SelfHostedUserSetupInstallCredentials {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly password: string;
  readonly principalEmail: string;
}

interface SelfHostedUserSetupInstallResult extends InstallResponse {
  readonly apiUrl: string;
}

interface SelfHostedUserSetupShimFile {
  readonly content: string;
  readonly name: string;
}

const selfHostedUserSetupEnabledEnvName: string = 'COMPARTMENT_SELF_HOSTED_USER_SETUP_E2E';
const selfHostedUserSetupVersionEnvName: string = 'COMPARTMENT_SELF_HOSTED_USER_SETUP_VERSION';
const selfHostedUserSetupTempRootDirectory: string = readSocketSafeTempRootDirectory('ouse-', 'system-api.sock');
const selfHostedUserSetupRunId: string = randomUUID().replaceAll('-', '').slice(0, 12);
const selfHostedUserSetupFirewallHelperImage: string = `compartment-node-agent-firewall-helper-e2e:${selfHostedUserSetupRunId}`;
const selfHostedUserSetupSystemctlShimDirectory: string = join(
  selfHostedUserSetupTempRootDirectory,
  `ouse-systemctl-${selfHostedUserSetupRunId}`,
);
const dindDockerSocketPath: string = '/runner-docker/docker.sock';
const dindSharedResourceBackupDirectory: string = '/runner-docker/compartment/resource-backups';
const selfHostedUserSetupSystemdStateDirectory: string = join(
  selfHostedUserSetupTempRootDirectory,
  `ouse-systemd-${selfHostedUserSetupRunId}`,
);
const selfHostedUserSetupDockerConfigDirectory: string = join(
  selfHostedUserSetupSystemdStateDirectory,
  'docker-config',
);
const selfHostedUserSetupNodeAgentPidPath: string = join(
  selfHostedUserSetupSystemdStateDirectory,
  'compartment-node-agent.pid',
);
const selfHostedUserSetupNodeAgentProxyPidPath: string = join(
  selfHostedUserSetupSystemdStateDirectory,
  'compartment-node-agent-proxy.pid',
);
const selfHostedUserSetupNodeAgentLogPath: string = join(
  selfHostedUserSetupSystemdStateDirectory,
  'compartment-node-agent.log',
);
const selfHostedUserSetupCommandTimeoutMs: number = 8 * 60_000;
const selfHostedUserSetupClientCommandTimeoutMs: number = 10 * 60_000;
export const selfHostedUserSetupTimeoutMs: number = 25 * 60_000;

function isSelfHostedUserSetupE2eEnabled(): boolean {
  return process.env[selfHostedUserSetupEnabledEnvName] === '1';
}

export function describeSelfHostedUserSetupE2e(name: string, factory: () => void): void {
  describe.sequential(name, (): void => {
    if (!isSelfHostedUserSetupE2eEnabled()) {
      it(`requires ${selfHostedUserSetupEnabledEnvName}=1`, (): void => {
        expect(isSelfHostedUserSetupE2eEnabled()).toBe(false);
        throw new Error(
          `${selfHostedUserSetupEnabledEnvName}=1 is required for self-hosted system e2e. ` +
            `Set ${selfHostedUserSetupVersionEnvName} to the self-hosted image tag under test.`,
        );
      });
      return;
    }

    factory();
  });
}

export function buildSelfHostedAppHostname(
  runtime: SelfHostedUserSetupRuntime,
  projectName: string,
  serviceName: string = 'web',
): string {
  const controlPlaneHostname: string = new URL(runtime.compartmentUrl).hostname;
  const controlPlanePrefix: string = 'console.';
  if (!controlPlaneHostname.startsWith(controlPlanePrefix)) {
    throw new Error(`Expected control-plane host ${controlPlaneHostname} to start with ${controlPlanePrefix}.`);
  }

  const appHostnamePrefix: string = serviceName === 'web' ? projectName : `${serviceName}-${projectName}`;
  return `${appHostnamePrefix}.${controlPlaneHostname.slice(controlPlanePrefix.length)}`;
}

export function expectSelfHostedUserSetupStepCompleted(completedStepCount: number, requiredStepCount: number): void {
  expect(
    completedStepCount,
    `Expected self-hosted e2e step ${requiredStepCount.toString()} to complete before continuing. ` +
      'See the earlier failure for the root cause.',
  ).toBeGreaterThanOrEqual(requiredStepCount);
}

export async function configureSelfHostedTrustedOutboundHosts(hosts: readonly string[]): Promise<void> {
  const trustedHostList: string = hosts.join(',');
  if (/[\n\r]/u.test(trustedHostList)) {
    throw new Error('Trusted outbound host test fixture must not contain control characters.');
  }

  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'sudo',
      '-n',
      'env',
      `COMPARTMENT_E2E_TRUSTED_OUTBOUND_HOSTS=${trustedHostList}`,
      'sh',
      '-c',
      `
set -eu
env_file=/etc/compartment/.env.self-hosted
trusted_hosts="\${COMPARTMENT_E2E_TRUSTED_OUTBOUND_HOSTS:?}"
tmp_file="$(mktemp)"
awk -v trusted_hosts="$trusted_hosts" '
  BEGIN { updated = 0 }
  $0 ~ /^COMPARTMENT_TRUSTED_OUTBOUND_HOSTS=/ {
    print "COMPARTMENT_TRUSTED_OUTBOUND_HOSTS=" trusted_hosts
    updated = 1
    next
  }
  { print }
  END {
    if (updated == 0) {
      print "COMPARTMENT_TRUSTED_OUTBOUND_HOSTS=" trusted_hosts
    }
  }
' "$env_file" > "$tmp_file"
install -m 0600 "$tmp_file" "$env_file"
rm -f "$tmp_file"
${selfHostedComposeFilesScript}
${selfHostedDockerComposeCommand} up -d --force-recreate api worker >/dev/null
set -a
. "$env_file"
set +a
waited=0
while [ "$waited" -lt 60 ]; do
  if curl --fail --silent --show-error "$COMPARTMENT_API_URL/readyz" >/dev/null; then
    exit 0
  fi
  waited="$((waited + 2))"
  sleep 2
done
echo "Timed out waiting for API readiness after trusted outbound host update." >&2
exit 1
`,
    ],
    timeoutMs: selfHostedUserSetupCommandTimeoutMs,
  });
  const diagnostics: string = result.exitCode === 0 ? '' : await readSelfHostedDiagnostics();
  expectSuccessfulCommand(result, 'configure trusted outbound hosts', diagnostics);
}

export function useSelfHostedUserSetupHarness(): SelfHostedUserSetupHarness {
  const harness: SelfHostedUserSetupHarnessHandle = new SelfHostedUserSetupHarnessHandle();

  beforeAll(async (): Promise<void> => {
    await harness.setup();
  }, selfHostedUserSetupTimeoutMs);

  afterAll(async (): Promise<void> => {
    await harness.cleanup();
  }, selfHostedUserSetupTimeoutMs);

  return harness;
}

class SelfHostedUserSetupHarnessHandle implements SelfHostedUserSetupHarness {
  readonly #appFixtureDirectories: string[] = [];
  readonly #clientHomeDirectories: string[] = [];

  async setup(): Promise<void> {
    await assertBuiltCliAvailable();
    await prepareSelfHostedSystemctlShim();
    await cleanupSelfHostedInstall();
  }

  async cleanup(): Promise<void> {
    await cleanupSelfHostedInstall();
    await rm(selfHostedUserSetupSystemctlShimDirectory, { force: true, recursive: true });
    await rm(selfHostedUserSetupSystemdStateDirectory, { force: true, recursive: true });
    delete process.env[selfHostedUserSetupNodeAgentLogPathEnvName];

    for (const homeDirectory of this.#clientHomeDirectories) {
      await rm(homeDirectory, { force: true, recursive: true });
    }
    this.#clientHomeDirectories.length = 0;

    for (const appFixtureDirectory of this.#appFixtureDirectories) {
      await rm(appFixtureDirectory, { force: true, recursive: true });
    }
    this.#appFixtureDirectories.length = 0;
  }

  async install(): Promise<SelfHostedUserSetupRuntime> {
    const imageVersion: string = readSelfHostedUserSetupVersion();
    const [publicHttpPort, publicHttpsPort]: DistinctFreePorts = await findDistinctFreePorts();
    const installerHomeDirectory: string = await mkdtemp(join(selfHostedUserSetupTempRootDirectory, 'installer-home-'));
    this.#clientHomeDirectories.push(installerHomeDirectory);

    return await runTimedStep(
      'install',
      async (): Promise<SelfHostedUserSetupRuntime> =>
        await installSelfHostedRuntime(
          imageVersion,
          publicHttpPort,
          publicHttpsPort,
          buildSelfHostedUserSetupClientEnv(installerHomeDirectory),
        ),
    );
  }

  async createFreshCli(): Promise<SelfHostedUserSetupCli> {
    const homeDirectory: string = await mkdtemp(join(selfHostedUserSetupTempRootDirectory, 'client-home-'));
    this.#clientHomeDirectories.push(homeDirectory);

    return new SelfHostedUserSetupCli(
      buildSelfHostedUserSetupClientEnv(homeDirectory),
      selfHostedUserSetupClientCommandTimeoutMs,
    );
  }

  async createAppFixture(): Promise<SelfHostedUserSetupAppFixture> {
    const fixture: SelfHostedUserSetupAppFixture = await createSelfHostedUserSetupAppFixture(
      selfHostedUserSetupTempRootDirectory,
    );
    this.#appFixtureDirectories.push(fixture.directory);

    return fixture;
  }
}

async function installSelfHostedRuntime(
  imageVersion: string,
  publicHttpPort: number,
  publicHttpsPort: number,
  env: NodeJS.ProcessEnv,
): Promise<SelfHostedUserSetupRuntime> {
  const credentials: SelfHostedUserSetupInstallCredentials = createSelfHostedUserSetupInstallCredentials();
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: buildSelfHostedRootCliArgv(
      [
        'install',
        '--local-runtime',
        '--image-source',
        'local',
        '--version',
        imageVersion,
        '--organization-slug',
        credentials.organizationSlug,
        '--public-http-port',
        publicHttpPort.toString(),
        '--public-https-port',
        publicHttpsPort.toString(),
        '--skip-session-persist',
        '--internal-install-result',
        '--output',
        'json',
      ],
      env,
    ),
    env,
    input: buildSelfHostedUserSetupInstallInputText(credentials),
    timeoutMs: selfHostedUserSetupCommandTimeoutMs,
  });
  const diagnostics: string = result.exitCode === 0 ? '' : await readSelfHostedDiagnostics();
  expectSuccessfulCommand(result, 'install', diagnostics);
  await configureSelfHostedDindResourceBackupDirectory(env);

  return SelfHostedUserSetupRuntimeHandle.fromInstallResponse(
    parseSelfHostedUserSetupInstallResult(result.stdout),
    credentials,
  );
}

async function configureSelfHostedDindResourceBackupDirectory(env: NodeJS.ProcessEnv): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'sudo',
      '-n',
      'env',
      ...buildSelfHostedRootCliEnvArgs(env),
      'sh',
      '-c',
      `
set -eu
if [ ! -S ${dindDockerSocketPath} ] || [ "$(readlink /var/run/docker.sock 2>/dev/null || true)" != "${dindDockerSocketPath}" ]; then
  exit 0
fi

env_file=/etc/compartment/.env.self-hosted
backup_dir=${dindSharedResourceBackupDirectory}
install -d -m 0700 "$backup_dir"
tmp_file="$(mktemp)"
awk -v backup_dir="$backup_dir" '
  BEGIN { updated = 0 }
  $0 ~ /^COMPARTMENT_RESOURCE_BACKUP_DIR=/ {
    print "COMPARTMENT_RESOURCE_BACKUP_DIR=" backup_dir
    updated = 1
    next
  }
  { print }
  END {
    if (updated == 0) {
      print "COMPARTMENT_RESOURCE_BACKUP_DIR=" backup_dir
    }
  }
' "$env_file" > "$tmp_file"
install -m 0600 "$tmp_file" "$env_file"
rm -f "$tmp_file"

set -a
. "$env_file"
set +a
systemctl restart compartment-node-agent.service
waited=0
while [ "$waited" -lt 60 ]; do
  if curl --fail --silent --show-error --unix-socket "$COMPARTMENT_NODE_AGENT_SOCKET" http://localhost/healthz >/dev/null; then
    break
  fi
  waited="$((waited + 2))"
  sleep 2
done
if [ "$waited" -ge 60 ]; then
  echo "Timed out waiting for node-agent readiness after dind resource backup directory update." >&2
  exit 1
fi

${selfHostedComposeFilesScript}
${selfHostedDockerComposeCommand} up -d --force-recreate api >/dev/null
waited=0
while [ "$waited" -lt 60 ]; do
  if curl --fail --silent --show-error "$COMPARTMENT_API_URL/readyz" >/dev/null; then
    exit 0
  fi
  waited="$((waited + 2))"
  sleep 2
done
echo "Timed out waiting for API readiness after dind resource backup directory update." >&2
exit 1
`,
    ],
    timeoutMs: selfHostedUserSetupCommandTimeoutMs,
  });
  const diagnostics: string = result.exitCode === 0 ? '' : await readSelfHostedDiagnostics();
  expectSuccessfulCommand(result, 'configure dind resource backup directory', diagnostics);
}

function parseSelfHostedUserSetupInstallResult(output: string): SelfHostedUserSetupInstallResult {
  const parsed: JsonValue = JSON.parse(output.trim()) as JsonValue;
  const record: JsonRecord = readJsonRecord(parsed, 'self-hosted install result');
  const response: InstallResponse = installResponseSchema.parse({
    adminEmail: record.adminEmail,
    baseDomain: record.baseDomain,
    dnsRecords: record.dnsRecords,
    operation: record.operation,
    organization: record.organization,
    compartmentUrl: record.compartmentUrl,
    sessionToken: record.sessionToken,
  });

  return {
    ...response,
    apiUrl: readRequiredString(record, 'apiUrl', 'self-hosted install result'),
  };
}

function buildSelfHostedRootCliArgv(args: readonly string[], env: NodeJS.ProcessEnv): readonly string[] {
  return ['sudo', '-n', 'env', ...buildSelfHostedRootCliEnvArgs(env), ...buildSelfHostedUserSetupCliArgv(args)];
}

function buildSelfHostedRootCliEnvArgs(env: NodeJS.ProcessEnv): readonly string[] {
  const path: string = [
    selfHostedUserSetupSystemctlShimDirectory,
    env.PATH ?? process.env.PATH ?? '/usr/bin:/bin',
  ].join(':');
  const values: string[] = [
    `PATH=${path}`,
    `COMPARTMENT_SELF_HOSTED_USER_SETUP_SYSTEMD_STATE_DIR=${selfHostedUserSetupSystemdStateDirectory}`,
    `DOCKER_CONFIG=${selfHostedUserSetupDockerConfigDirectory}`,
  ];

  if (env.HOME !== undefined) {
    values.push(`HOME=${env.HOME}`);
  }
  if (env.XDG_CONFIG_HOME !== undefined) {
    values.push(`XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME}`);
  }

  return values;
}

async function prepareSelfHostedSystemctlShim(): Promise<void> {
  await mkdir(selfHostedUserSetupSystemctlShimDirectory, { recursive: true });
  await mkdir(selfHostedUserSetupSystemdStateDirectory, { recursive: true });
  process.env[selfHostedUserSetupNodeAgentLogPathEnvName] = selfHostedUserSetupNodeAgentLogPath;
  const shimFiles: SelfHostedUserSetupShimFile[] = [
    {
      content: renderSelfHostedSystemctlShim(),
      name: 'systemctl',
    },
    {
      content: renderSelfHostedFirewallCommandShim('iptables'),
      name: 'iptables',
    },
    {
      content: renderSelfHostedFirewallCommandShim('nft'),
      name: 'nft',
    },
  ];

  for (const shimFile of shimFiles) {
    const shimPath: string = join(selfHostedUserSetupSystemctlShimDirectory, shimFile.name);
    await writeFile(shimPath, shimFile.content, 'utf8');
    await chmod(shimPath, 0o755);
  }
}

function renderSelfHostedSystemctlShim(): string {
  return `#!/bin/sh
set -eu

state_dir="\${COMPARTMENT_SELF_HOSTED_USER_SETUP_SYSTEMD_STATE_DIR:?}"
pid_file="$state_dir/compartment-node-agent.pid"
child_pid_file="$state_dir/compartment-node-agent.child.pid"
proxy_pid_file="$state_dir/compartment-node-agent-proxy.pid"
proxy_port_file="$state_dir/compartment-node-agent-proxy.port"
log_file="$state_dir/compartment-node-agent.log"
supervisor_file="$state_dir/compartment-node-agent-supervisor.sh"
proxy_file="$state_dir/compartment-node-agent-proxy.mjs"
proxy_container_name="compartment-node-agent-socket-proxy-e2e"
command="\${1:-}"
service="\${2:-}"

is_dind_runner() {
  [ -S /runner-docker/docker.sock ] && [ "$(readlink /var/run/docker.sock 2>/dev/null || true)" = "/runner-docker/docker.sock" ]
}

is_agent_running() {
  [ -s "$pid_file" ] || return 1
  pid="$(cat "$pid_file")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_pid() {
  pid="$1"
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
}

force_stop_pid() {
  pid="$1"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

stop_agent() {
  if is_agent_running; then
    pid="$(cat "$pid_file")"
    stop_pid "$pid"
  else
    pid=""
  fi
  if [ -s "$child_pid_file" ]; then
    child_pid="$(cat "$child_pid_file")"
    stop_pid "$child_pid"
  else
    child_pid=""
  fi
  sleep 1
  force_stop_pid "$child_pid"
  force_stop_pid "$pid"
  rm -f "$pid_file" "$child_pid_file"
  if [ -s "$proxy_pid_file" ]; then
    proxy_pid="$(cat "$proxy_pid_file")"
    kill "$proxy_pid" 2>/dev/null || true
    rm -f "$proxy_pid_file" "$proxy_port_file"
  fi
  if is_dind_runner; then
    docker rm -f "$proxy_container_name" >/dev/null 2>&1 || true
  fi
}

start_dind_socket_proxy() {
  set -a
  . /etc/compartment/.env.self-hosted
  set +a
  : "\${COMPARTMENT_NODE_AGENT_SOCKET:?}"
  : "\${COMPARTMENT_RUNTIME_GID:?}"
  : "\${COMPARTMENT_RUNTIME_PROBE_IMAGE:?}"

  cat > "$proxy_file" <<'PROXY'
import fs from 'node:fs';
import net from 'node:net';

const socketPath = process.env.NODE_AGENT_SOCKET;
const portFile = process.env.NODE_AGENT_PROXY_PORT_FILE;
if (socketPath === undefined || socketPath === '' || portFile === undefined || portFile === '') {
  throw new Error('Invalid node-agent socket proxy configuration.');
}

const server = net.createServer((client) => {
  const upstream = net.createConnection({ path: socketPath });
  const destroyBoth = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', destroyBoth);
  upstream.on('error', destroyBoth);
  client.pipe(upstream);
  upstream.pipe(client);
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Invalid node-agent socket proxy listener address.');
  }
  fs.writeFileSync(portFile, address.port.toString());
  console.log(\`node-agent tcp proxy listening on 127.0.0.1:\${address.port.toString()}\`);
});
PROXY

  rm -f "$proxy_port_file"
  NODE_AGENT_SOCKET="$COMPARTMENT_NODE_AGENT_SOCKET" NODE_AGENT_PROXY_PORT_FILE="$proxy_port_file" node "$proxy_file" >> "$log_file" 2>&1 &
  echo "$!" > "$proxy_pid_file"
  proxy_wait=0
  while [ "$proxy_wait" -lt 100 ] && [ ! -s "$proxy_port_file" ]; do
    proxy_pid="$(cat "$proxy_pid_file")"
    kill -0 "$proxy_pid" 2>/dev/null || {
      cat "$log_file" >&2
      return 1
    }
    proxy_wait="$((proxy_wait + 1))"
    sleep 0.1
  done
  [ -s "$proxy_port_file" ] || {
    cat "$log_file" >&2
    return 1
  }
  proxy_port="$(cat "$proxy_port_file")"

  docker rm -f "$proxy_container_name" >/dev/null 2>&1 || true
  docker run --detach \\
    --name "$proxy_container_name" \\
	    --network host \\
	    --env "NODE_AGENT_SOCKET=$COMPARTMENT_NODE_AGENT_SOCKET" \\
	    --env "NODE_AGENT_PROXY_PORT=$proxy_port" \\
	    --env "COMPARTMENT_RUNTIME_GID=$COMPARTMENT_RUNTIME_GID" \\
	    --user 0:0 \\
	    --volume /var/run/compartment/node:/var/run/compartment/node \\
	    "$COMPARTMENT_RUNTIME_PROBE_IMAGE" \\
	    node -e 'const fs = require("node:fs"); const net = require("node:net"); const path = require("node:path"); const socketPath = process.env.NODE_AGENT_SOCKET; const port = Number(process.env.NODE_AGENT_PROXY_PORT); const runtimeGid = Number(process.env.COMPARTMENT_RUNTIME_GID); if (!socketPath || !Number.isInteger(port) || port <= 0 || !Number.isInteger(runtimeGid) || runtimeGid <= 0) throw new Error("Invalid node-agent dind proxy configuration."); const socketDir = path.dirname(socketPath); fs.mkdirSync(socketDir, { recursive: true, mode: 0o750 }); fs.chownSync(socketDir, 0, runtimeGid); fs.chmodSync(socketDir, 0o750); try { const stats = fs.lstatSync(socketPath); if (!stats.isSocket()) throw new Error("Refusing to replace non-socket path at " + socketPath + "."); fs.unlinkSync(socketPath); } catch (error) { if (error?.code !== "ENOENT") throw error; } const server = net.createServer((client) => { const upstream = net.createConnection({ host: "127.0.0.1", port }); const destroyBoth = () => { client.destroy(); upstream.destroy(); }; client.on("error", destroyBoth); upstream.on("error", destroyBoth); client.pipe(upstream); upstream.pipe(client); }); server.listen(socketPath, () => { fs.chownSync(socketPath, 0, runtimeGid); fs.chmodSync(socketPath, 0o660); console.log("node-agent dind socket proxy listening on " + socketPath); });' \\
    >> "$log_file" 2>&1
}

case "$command" in
  cat)
    [ "$service" = "compartment-node-agent.service" ]
    [ -f /etc/systemd/system/compartment-node-agent.service ]
    cat /etc/systemd/system/compartment-node-agent.service
    exit 0
    ;;
  daemon-reload)
    exit 0
    ;;
  enable)
    [ "$service" = "compartment-node-agent.service" ]
    exit 0
    ;;
  restart)
    [ "$service" = "compartment-node-agent.service" ]
    mkdir -p "$state_dir"
    stop_agent
    cat > "$supervisor_file" <<'SUPERVISOR'
#!/bin/sh
state_dir="\${COMPARTMENT_SELF_HOSTED_USER_SETUP_SYSTEMD_STATE_DIR:?}"
log_file="$state_dir/compartment-node-agent.log"
child_pid_file="$state_dir/compartment-node-agent.child.pid"

while :; do
  set -a
  . /etc/compartment/.env.self-hosted
  set +a
  : "\${COMPARTMENT_NODE_AGENT_SOCKET:?}"
  /usr/local/bin/compartment-node-agent >> "$log_file" 2>&1 &
  child_pid="$!"
  echo "$child_pid" > "$child_pid_file"
  if wait "$child_pid"; then
    exit_code=0
  else
    exit_code="$?"
  fi
  rm -f "$child_pid_file"
  echo "compartment-node-agent exited with code $exit_code; restarting" >> "$log_file"
  sleep 1
done
SUPERVISOR
    chmod 755 "$supervisor_file"
    : > "$log_file"
    if is_dind_runner; then
      start_dind_socket_proxy
    fi
    setsid "$supervisor_file" >/dev/null 2>&1 &
    echo "$!" > "$pid_file"
    exit 0
    ;;
  stop)
    [ "$service" = "compartment-node-agent.service" ]
    stop_agent
    exit 0
    ;;
  is-active)
    [ "$service" = "compartment-node-agent.service" ]
    if is_agent_running; then
      echo active
      exit 0
    fi
    echo inactive
    exit 3
    ;;
  *)
    echo "Unsupported e2e systemctl command: $*" >&2
    exit 1
    ;;
esac
`;
}

function renderSelfHostedFirewallCommandShim(command: 'iptables' | 'nft'): string {
  return `#!/bin/sh
set -eu

firewall_command="${command}"
firewall_helper_image="${selfHostedUserSetupFirewallHelperImage}"
export DOCKER_CONFIG="${selfHostedUserSetupDockerConfigDirectory}"

is_dind_runner() {
  [ -S /runner-docker/docker.sock ] && [ "$(readlink /var/run/docker.sock 2>/dev/null || true)" = "/runner-docker/docker.sock" ]
}

find_real_command() {
  for candidate in \\
    "/usr/sbin/$firewall_command" \\
    "/usr/bin/$firewall_command" \\
    "/sbin/$firewall_command" \\
    "/bin/$firewall_command"
  do
    if [ -x "$candidate" ]; then
      printf '%s\\n' "$candidate"
      return 0
    fi
  done
  return 1
}

prepare_dind_firewall_helper() {
  : "\${COMPARTMENT_RUNTIME_PROBE_IMAGE:?}"
  if docker image inspect "$firewall_helper_image" >/dev/null 2>&1; then
    return 0
  fi

  docker build \\
    --build-arg "BASE_IMAGE=$COMPARTMENT_RUNTIME_PROBE_IMAGE" \\
    --tag "$firewall_helper_image" \\
    - <<'DOCKERFILE'
ARG BASE_IMAGE
FROM \${BASE_IMAGE}
USER 0
RUN apt-get update \\
  && apt-get install --yes --no-install-recommends iptables nftables \\
  && rm -rf /var/lib/apt/lists/*
DOCKERFILE
}

run_dind_firewall_helper() {
  prepare_dind_firewall_helper
  if [ "$firewall_command" = "nft" ] && [ "\${1:-}" = "-f" ]; then
    batch_file="\${2:-}"
    if [ -z "$batch_file" ] || [ "$#" -ne 2 ] || [ ! -f "$batch_file" ]; then
      echo "Unsupported e2e nft batch invocation: $*" >&2
      return 1
    fi

    docker run --rm --privileged --network host --user 0:0 --interactive "$firewall_helper_image" sh -eu -c '
batch_file="$(mktemp)"
trap "rm -f \\"$batch_file\\"" EXIT
cat > "$batch_file"
nft -f "$batch_file"
' < "$batch_file"
    return "$?"
  fi

  docker run --rm --privileged --network host --user 0:0 "$firewall_helper_image" "$firewall_command" "$@"
}

real_command="$(find_real_command)" || {
  if is_dind_runner; then
    run_dind_firewall_helper "$@"
    exit "$?"
  fi
  echo "Missing $firewall_command command." >&2
  exit 127
}

if "$real_command" "$@"; then
  exit 0
fi

if is_dind_runner; then
  run_dind_firewall_helper "$@"
  exit "$?"
fi

exit 1
`;
}

function createSelfHostedUserSetupInstallCredentials(): SelfHostedUserSetupInstallCredentials {
  const suffix: string = randomUUID().replaceAll('-', '').slice(0, 12);

  return {
    organizationName: `SelfHosted E2E ${suffix}`,
    organizationSlug: `self-hosted-e2e-${suffix}`,
    password: `SelfHostedE2e-${suffix}-${randomUUID().replaceAll('-', '')}!`,
    principalEmail: `admin-${suffix}@compartment.test`,
  };
}

function buildSelfHostedUserSetupInstallInputText(credentials: SelfHostedUserSetupInstallCredentials): string {
  return `${credentials.principalEmail}
${credentials.organizationName}
${credentials.password}
${credentials.password}
`;
}

async function cleanupSelfHostedInstall(): Promise<void> {
  assertSelfHostedUserSetupEnabled();
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: [
      'sudo',
      '-n',
      'sh',
      '-c',
      `
set -eu
if [ -f "${selfHostedUserSetupNodeAgentPidPath}" ]; then
  node_agent_pid="$(cat "${selfHostedUserSetupNodeAgentPidPath}")"
  if [ -n "$node_agent_pid" ]; then
    kill "$node_agent_pid" 2>/dev/null || true
  fi
fi
if [ -f "${join(selfHostedUserSetupSystemdStateDirectory, 'compartment-node-agent.child.pid')}" ]; then
  node_agent_child_pid="$(cat "${join(selfHostedUserSetupSystemdStateDirectory, 'compartment-node-agent.child.pid')}")"
  if [ -n "$node_agent_child_pid" ]; then
    kill "$node_agent_child_pid" 2>/dev/null || true
  fi
fi
sleep 1
if [ -n "\${node_agent_child_pid:-}" ] && kill -0 "$node_agent_child_pid" 2>/dev/null; then
  kill -KILL "$node_agent_child_pid" 2>/dev/null || true
fi
if [ -n "\${node_agent_pid:-}" ] && kill -0 "$node_agent_pid" 2>/dev/null; then
  kill -KILL "$node_agent_pid" 2>/dev/null || true
fi
rm -f "${selfHostedUserSetupNodeAgentPidPath}" "${join(selfHostedUserSetupSystemdStateDirectory, 'compartment-node-agent.child.pid')}"
if [ -f "${selfHostedUserSetupNodeAgentProxyPidPath}" ]; then
  node_agent_proxy_pid="$(cat "${selfHostedUserSetupNodeAgentProxyPidPath}")"
  if [ -n "$node_agent_proxy_pid" ]; then
    kill "$node_agent_proxy_pid" 2>/dev/null || true
  fi
  rm -f "${selfHostedUserSetupNodeAgentProxyPidPath}"
fi
docker rm -f compartment-node-agent-socket-proxy-e2e >/dev/null 2>&1 || true
docker image rm -f "${selfHostedUserSetupFirewallHelperImage}" >/dev/null 2>&1 || true
rm -rf "${selfHostedUserSetupDockerConfigDirectory}"

docker_namespace="$(
  if [ -f /etc/compartment/.env.self-hosted ]; then
    awk -F= '$1 == "COMPARTMENT_DOCKER_NAMESPACE" { print $2; exit }' /etc/compartment/.env.self-hosted
  fi
)"
if [ -z "$docker_namespace" ]; then
  docker_namespace="compartment"
fi

if [ -f /etc/compartment/.env.self-hosted ] && [ -f /etc/compartment/docker-compose.self-hosted.yml ]; then
${selfHostedComposeFilesScript}
  ${selfHostedDockerComposeCommand} down -v --remove-orphans
fi

compose_container_ids="$(docker ps -aq --filter "label=com.docker.compose.project=$docker_namespace")"
if [ -n "$compose_container_ids" ]; then
  docker rm -f $compose_container_ids
fi

runtime_container_ids="$(docker ps -aq --filter "label=compartment.namespace=$docker_namespace")"
if [ -n "$runtime_container_ids" ]; then
  docker rm -f $runtime_container_ids
fi

compose_volume_names="$(docker volume ls -q --filter "label=com.docker.compose.project=$docker_namespace")"
if [ -n "$compose_volume_names" ]; then
  docker volume rm -f $compose_volume_names
fi

runtime_volume_names="$(docker volume ls -q --filter "label=compartment.namespace=$docker_namespace")"
if [ -n "$runtime_volume_names" ]; then
  docker volume rm -f $runtime_volume_names
fi

compose_network_names="$(docker network ls -q --filter "label=com.docker.compose.project=$docker_namespace")"
if [ -n "$compose_network_names" ]; then
  docker network rm $compose_network_names
fi

runtime_network_prefix="compartment-$(printf '%s' "$docker_namespace" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')-"
runtime_network_names="$(docker network ls --format '{{.Name}}' | awk -v prefix="$runtime_network_prefix" 'index($0, prefix) == 1 { print }')"
if [ -n "$runtime_network_names" ]; then
  docker network rm $runtime_network_names
fi

rm -f /usr/local/bin/compartment-node-agent /etc/systemd/system/compartment-node-agent.service
rm -rf /etc/compartment /var/lib/compartment /var/run/compartment
rm -rf /runner-docker/compartment
`,
    ],
    timeoutMs: selfHostedUserSetupCommandTimeoutMs,
  });
  expectSuccessfulCommand(result, 'self-hosted cleanup');
}

function readSelfHostedUserSetupVersion(): string {
  const version: string | undefined = process.env[selfHostedUserSetupVersionEnvName]?.trim();
  if (version === undefined || version === '') {
    throw new Error(`Set ${selfHostedUserSetupVersionEnvName} to the locally built self-hosted image tag.`);
  }

  return version;
}

function assertSelfHostedUserSetupEnabled(): void {
  if (!isSelfHostedUserSetupE2eEnabled()) {
    throw new Error(`${selfHostedUserSetupEnabledEnvName}=1 is required for destructive self-hosted setup cleanup.`);
  }
}

class SelfHostedUserSetupRuntimeHandle implements SelfHostedUserSetupRuntime {
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly apiUrl: string;
  readonly compartmentUrl: string;
  readonly organizationName: string;
  readonly organizationSlug: string;

  private constructor(
    adminEmail: string,
    adminPassword: string,
    apiUrl: string,
    compartmentUrl: string,
    organizationName: string,
    organizationSlug: string,
  ) {
    this.adminEmail = adminEmail;
    this.adminPassword = adminPassword;
    this.apiUrl = apiUrl;
    this.compartmentUrl = compartmentUrl;
    this.organizationName = organizationName;
    this.organizationSlug = organizationSlug;
  }

  static fromInstallResponse(
    result: SelfHostedUserSetupInstallResult,
    credentials: SelfHostedUserSetupInstallCredentials,
  ): SelfHostedUserSetupRuntime {
    return new SelfHostedUserSetupRuntimeHandle(
      result.adminEmail,
      credentials.password,
      result.apiUrl,
      result.compartmentUrl,
      result.organization.name,
      result.organization.slug,
    );
  }
}
