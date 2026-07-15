import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const githubApiBaseUrl = 'https://api.github.com';
const githubApiVersion = '2026-03-10';
const hcloudApiBaseUrl = 'https://api.hetzner.cloud/v1';
const runnerNamePrefix = 'compartment-ci';
const runnerQueueWorkflowId = 'ci.yml';
const apiPageSize = 100;
const defaultPollIntervalMs = 10_000;
const defaultRunnerWaitMs = 15 * 60 * 1000;
const defaultCleanupMinimumAgeMs = 45 * 60 * 1000;
const defaultFleetBootstrapGraceMs = 10 * 60 * 1000;
const defaultFleetLeaseTtlMs = 90 * 60 * 1000;
const defaultFleetMaxAgeMs = 8 * 60 * 60 * 1000;
const defaultFleetBillingPeriodMs = 60 * 60 * 1000;
const defaultFleetBillingDeleteWindowMs = 15 * 60 * 1000;
const defaultFleetMinimumReusableBillingMs = 15 * 60 * 1000;
const defaultFleetMaxServers = 1;
const defaultFleetRequestedSlots = 4;
const defaultFleetSlotsPerServer = 4;
const runnerManagedByLabel = runnerNamePrefix;
const fleetLeaseExpiresAtLabel = 'lease-expires-at';
const fleetPoolLabel = 'runner-pool';
const fleetSlotsLabel = 'runner-slots';
const runnerIsolationLabel = 'runner-isolation';
const runnerIsolationValue = 'container-dind';
const trackedCreatedServers = new Map();
let shutdownCleanupStarted = false;

class ApiRequestError extends Error {
  constructor({ data, method, status, url }) {
    super(`${method} ${url} failed with ${status}: ${JSON.stringify(data)}`);
    this.data = data;
    this.method = method;
    this.status = status;
    this.url = url;
  }
}

class HcloudServerDeletedBeforeRunningError extends Error {
  constructor({ serverId }) {
    super(`Hetzner server ${serverId} disappeared before becoming running.`);
    this.serverId = serverId;
  }
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readOptionalEnv(name) {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readIntegerEnv(name, fallback) {
  const value = readOptionalEnv(name);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function sanitizeLabelValue(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildFleetRunnerLabel({ pool }) {
  const safePool = sanitizeLabelValue(pool);
  if (safePool === '') {
    throw new Error('HETZNER_RUNNER_POOL must contain at least one alphanumeric character.');
  }

  return `${runnerNamePrefix}-${safePool}`;
}

export function buildFleetServerName({ pool, suffix }) {
  const runnerLabel = buildFleetRunnerLabel({ pool });
  const safeSuffix = sanitizeLabelValue(suffix);
  if (safeSuffix === '') {
    throw new Error('Fleet server suffix must contain at least one alphanumeric character.');
  }

  const name = `${runnerLabel}-${safeSuffix}`;
  return name.slice(0, 64);
}

export function buildRunnerSlotName({ serverName, slot }) {
  const suffix = `-s${slot.toString()}`;
  return `${serverName.slice(0, 64 - suffix.length)}${suffix}`;
}

function parseList(value) {
  if (value === undefined) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function readRequiredListEnv(name) {
  const values = parseList(readRequiredEnv(name));
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value.`);
  }
  return values;
}

export function rotateFleetLocations({ locations, startIndex }) {
  if (locations.length === 0) {
    throw new Error('HETZNER_RUNNER_LOCATIONS must contain at least one value.');
  }

  const offset = startIndex % locations.length;
  return [...locations.slice(offset), ...locations.slice(0, offset)];
}

function buildShellAssignment(name, value) {
  return `${name}=${JSON.stringify(value)}\n`;
}

export function buildRunnerInstallScript({
  githubRepository,
  registrationToken,
  runnerDir,
  runnerLabels,
  runnerName,
  runnerSlots,
  runnerVersion,
}) {
  return `#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
${buildShellAssignment('GITHUB_REPOSITORY', githubRepository)}${buildShellAssignment('REGISTRATION_TOKEN', registrationToken)}${buildShellAssignment('RUNNER_DIR', runnerDir)}${buildShellAssignment('RUNNER_LABELS', runnerLabels)}${buildShellAssignment('RUNNER_NAME', runnerName)}${buildShellAssignment('RUNNER_SLOTS', runnerSlots.toString())}${buildShellAssignment('RUNNER_VERSION', runnerVersion)}

apt-get update
apt-get install --yes ca-certificates curl docker.io git gzip jq libatomic1 sudo tar
systemctl enable --now docker

mkdir -p "$RUNNER_DIR/scripts"

cat >"$RUNNER_DIR/scripts/cleanup-hetzner-github-runner-job.sh" <<'CLEANUP'
#!/usr/bin/env bash
set -uo pipefail

RUNNER_ROOT="/home/runner"

if [ -d "\${RUNNER_TEMP:-}" ] && [[ "$RUNNER_TEMP" == "$RUNNER_ROOT"* ]]; then
  find "$RUNNER_TEMP" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

if [ -d "\${RUNNER_WORKSPACE:-}" ] && [[ "$RUNNER_WORKSPACE" == "$RUNNER_ROOT"* ]]; then
  find "$RUNNER_WORKSPACE" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

docker system prune --all --force --volumes >/dev/null 2>&1 || true
docker builder prune --all --force >/dev/null 2>&1 || true
CLEANUP

cat >"$RUNNER_DIR/scripts/entrypoint.sh" <<'ENTRYPOINT'
#!/usr/bin/env bash
set -euo pipefail

cd /home/runner
export DEBIAN_FRONTEND=noninteractive
export DOCKER_HOST=unix:///runner-docker/docker.sock

if ! ldconfig -p 2>/dev/null | grep -q 'libatomic.so.1'; then
  sudo apt-get update
  sudo apt-get install --yes --no-install-recommends libatomic1
  sudo rm -rf /var/lib/apt/lists/*
fi

for attempt in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "Timed out waiting for the slot Docker daemon." >&2
    exit 1
  fi
  sleep 2
done

printf 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/bin/cleanup-hetzner-github-runner-job.sh\\n' > .env

if [ ! -f .runner ]; then
  config_args=(
    --unattended
    --url "https://github.com/\${GITHUB_REPOSITORY}"
    --token "\${REGISTRATION_TOKEN}"
    --name "\${RUNNER_NAME}"
    --labels "\${RUNNER_LABELS}"
    --no-default-labels
    --disableupdate
    --replace
    --work "_work"
  )

  ./config.sh "\${config_args[@]}"
fi

exec ./run.sh
ENTRYPOINT
chmod 0755 "$RUNNER_DIR/scripts/cleanup-hetzner-github-runner-job.sh" "$RUNNER_DIR/scripts/entrypoint.sh"

runner_image="ghcr.io/actions/actions-runner:$RUNNER_VERSION"
docker pull "$runner_image"
docker pull docker:dind

for slot in $(seq 1 "$RUNNER_SLOTS"); do
  slot_suffix="-s$slot"
  slot_name="\${RUNNER_NAME:0:$((64 - \${#slot_suffix}))}$slot_suffix"
  dind_name="compartment-actions-dind-$slot"
  runner_container_name="compartment-actions-runner-$slot"
  socket_volume="compartment-actions-dind-socket-$slot"

  docker rm --force "$runner_container_name" "$dind_name" >/dev/null 2>&1 || true
  docker volume rm "$socket_volume" >/dev/null 2>&1 || true
  docker volume create "$socket_volume" >/dev/null

  docker run \\
    --detach \\
    --name "$dind_name" \\
    --privileged \\
    --restart always \\
    --env DOCKER_TLS_CERTDIR= \\
    --volume "$socket_volume:/runner-docker" \\
    docker:dind \\
    --host=unix:///runner-docker/docker.sock

  for attempt in $(seq 1 60); do
    if docker exec "$dind_name" sh -c 'test -S /runner-docker/docker.sock && chmod 666 /runner-docker/docker.sock && docker --host unix:///runner-docker/docker.sock info' >/dev/null 2>&1; then
      break
    fi
    if [ "$attempt" -eq 60 ]; then
      echo "Timed out waiting for $dind_name." >&2
      exit 1
    fi
    sleep 2
  done

  docker run \\
    --detach \\
    --name "$runner_container_name" \\
    --restart always \\
    --network "container:$dind_name" \\
    --cap-add NET_ADMIN \\
    --env "GITHUB_REPOSITORY=$GITHUB_REPOSITORY" \\
    --env "REGISTRATION_TOKEN=$REGISTRATION_TOKEN" \\
    --env "RUNNER_LABELS=$RUNNER_LABELS" \\
    --env "RUNNER_NAME=$slot_name" \\
    --env HOME=/home/runner \\
    --env DOCKER_CONFIG=/home/runner/.docker \\
    --env DOCKER_HOST=unix:///runner-docker/docker.sock \\
    --env XDG_CACHE_HOME=/home/runner/.cache \\
    --env npm_config_cache=/home/runner/.npm \\
    --env RUNNER_TOOL_CACHE=/home/runner/_tool \\
    --env AGENT_TOOLSDIRECTORY=/home/runner/_tool \\
    --volume "$socket_volume:/runner-docker" \\
    --volume "$RUNNER_DIR/scripts/cleanup-hetzner-github-runner-job.sh:/usr/local/bin/cleanup-hetzner-github-runner-job.sh:ro" \\
    --volume "$RUNNER_DIR/scripts/entrypoint.sh:/usr/local/bin/entrypoint.sh:ro" \\
    "$runner_image" \\
    /usr/local/bin/entrypoint.sh
done
`;
}

export function buildCloudInit(installScript) {
  return `#cloud-config
package_update: false
package_upgrade: false
write_files:
  - path: /usr/local/bin/install-hetzner-github-runner.sh
    owner: root:root
    permissions: '0755'
    encoding: b64
    content: ${Buffer.from(installScript, 'utf8').toString('base64')}
runcmd:
  - [bash, /usr/local/bin/install-hetzner-github-runner.sh]
`;
}

export function buildCreateServerPayload({
  fleetLeaseExpiresAt,
  fleetPool,
  fleetSlots,
  githubRepositoryId,
  githubRepositoryOwnerId,
  githubRunAttempt,
  githubRunId,
  image,
  location,
  runnerClass,
  runnerName,
  serverType,
  sshKeyIds,
  userData,
}) {
  const labels = {
    'gh-owner-id': githubRepositoryOwnerId,
    'gh-repo-id': githubRepositoryId,
    'gh-run-attempt': githubRunAttempt,
    'gh-run-id': githubRunId,
    [fleetLeaseExpiresAtLabel]: fleetLeaseExpiresAt.toString(),
    [fleetPoolLabel]: fleetPool,
    [fleetSlotsLabel]: fleetSlots.toString(),
    'managed-by': runnerManagedByLabel,
    'runner-class': runnerClass,
    [runnerIsolationLabel]: runnerIsolationValue,
    type: 'github-runner',
  };

  return {
    automount: false,
    image,
    labels,
    location,
    name: runnerName,
    public_net: {
      enable_ipv4: true,
      enable_ipv6: true,
    },
    server_type: serverType,
    ssh_keys: sshKeyIds,
    start_after_create: true,
    user_data: userData,
  };
}

async function requestApiJson({ body, headers, method = 'GET', url }) {
  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  });

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const data = text === '' ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new ApiRequestError({ data, method, status: response.status, url });
  }

  return data;
}

function buildBearerJsonHeaders(token, extraHeaders = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

async function requestJson({ body, method = 'GET', token, url }) {
  return await requestApiJson({
    body,
    headers: buildBearerJsonHeaders(token, {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': githubApiVersion,
    }),
    method,
    url,
  });
}

async function requestHcloudJson({ body, method = 'GET', token, url }) {
  return await requestApiJson({
    body,
    headers: buildBearerJsonHeaders(token),
    method,
    url,
  });
}

async function createRegistrationToken({ githubRepository, githubToken }) {
  const data = await requestJson({
    method: 'POST',
    token: githubToken,
    url: `${githubApiBaseUrl}/repos/${githubRepository}/actions/runners/registration-token`,
  });
  return data.token;
}

async function listRepositoryRunners({ githubRepository, githubToken }) {
  const runners = [];
  for (let page = 1; ; page += 1) {
    const data = await requestJson({
      token: githubToken,
      url: `${githubApiBaseUrl}/repos/${githubRepository}/actions/runners?per_page=${apiPageSize.toString()}&page=${page.toString()}`,
    });
    const pageRunners = data.runners ?? [];
    runners.push(...pageRunners);
    if (pageRunners.length < apiPageSize) {
      return runners;
    }
  }
}

async function listWorkflowRunsByStatus({ githubRepository, githubToken, status, workflowId }) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const data = await requestJson({
      token: githubToken,
      url: `${githubApiBaseUrl}/repos/${githubRepository}/actions/workflows/${workflowId}/runs?status=${status}&per_page=${apiPageSize.toString()}&page=${page.toString()}`,
    });
    const pageRuns = data.workflow_runs ?? [];
    runs.push(...pageRuns);
    if (pageRuns.length < apiPageSize) {
      return runs;
    }
  }
}

async function listWorkflowRunJobs({ githubRepository, githubToken, runId }) {
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const data = await requestJson({
      token: githubToken,
      url: `${githubApiBaseUrl}/repos/${githubRepository}/actions/runs/${runId.toString()}/jobs?per_page=${apiPageSize.toString()}&page=${page.toString()}`,
    });
    const pageJobs = data.jobs ?? [];
    jobs.push(...pageJobs);
    if (pageJobs.length < apiPageSize) {
      return jobs;
    }
  }
}

async function deleteRepositoryRunner({ githubRepository, githubToken, runnerId }) {
  await requestJson({
    method: 'DELETE',
    token: githubToken,
    url: `${githubApiBaseUrl}/repos/${githubRepository}/actions/runners/${runnerId}`,
  });
}

async function createServer({ hcloudToken, payload }) {
  const data = await requestHcloudJson({
    body: payload,
    method: 'POST',
    token: hcloudToken,
    url: `${hcloudApiBaseUrl}/servers`,
  });
  return data.server;
}

function isHcloudPlacementResourceUnavailable(error) {
  return error instanceof ApiRequestError && error.status === 412 && error.data?.error?.code === 'resource_unavailable';
}

function isHcloudPlacementFallbackError(error) {
  return error instanceof HcloudServerDeletedBeforeRunningError || isHcloudPlacementResourceUnavailable(error);
}

async function createServerWithLocationFallback({
  githubRepository,
  githubToken,
  hcloudToken,
  locationAttemptOrder,
  payload,
  pollIntervalMs,
  runnerWaitMs,
  serverName,
}) {
  let lastResourceUnavailableError;

  for (const [index, location] of locationAttemptOrder.entries()) {
    let serverId;
    try {
      const server = await createServer({ hcloudToken, payload: { ...payload, location } });
      serverId = String(server.id);
      trackCreatedServer({ githubRepository, githubToken, hcloudToken, serverId, serverName });
      await waitForServerRunning({ hcloudToken, pollIntervalMs, serverId, timeoutMs: runnerWaitMs });
      if (location !== locationAttemptOrder[0]) {
        process.stdout.write(`Created Hetzner runner server ${serverName} in fallback location ${location}.\n`);
      }
      return server;
    } catch (error) {
      if (serverId !== undefined) {
        try {
          await deleteServer({ hcloudToken, ignoreNotFound: true, serverId });
        } finally {
          try {
            await removeRepositoryRunnersByNamePrefix({
              githubRepository,
              githubToken,
              runnerNamePrefixValue: serverName,
            });
          } finally {
            untrackCreatedServer(serverId);
          }
        }
      }

      if (!isHcloudPlacementFallbackError(error)) {
        throw error;
      }

      lastResourceUnavailableError = error;
      const nextAction =
        index === locationAttemptOrder.length - 1 ? 'no fallback locations remain' : 'trying another location';
      process.stderr.write(`Hetzner runner server ${serverName} could not be placed in ${location}; ${nextAction}.\n`);
    }
  }

  throw lastResourceUnavailableError ?? new Error(`No Hetzner runner location could place ${serverName}.`);
}

async function readServer({ hcloudToken, serverId }) {
  const response = await fetch(`${hcloudApiBaseUrl}/servers/${serverId}`, {
    headers: buildBearerJsonHeaders(hcloudToken),
  });

  if (response.status === 404) {
    return undefined;
  }

  const text = await response.text();
  const data = text === '' ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`GET server ${serverId} failed with ${response.status}: ${JSON.stringify(data)}`);
  }

  return data.server;
}

export async function deleteServer({ hcloudToken, ignoreNotFound = false, serverId }) {
  const response = await fetch(`${hcloudApiBaseUrl}/servers/${serverId}`, {
    headers: buildBearerJsonHeaders(hcloudToken),
    method: 'DELETE',
  });

  if (response.status === 204) {
    return true;
  }

  if (response.status === 404 && ignoreNotFound) {
    return false;
  }

  const text = await response.text();
  const data = text === '' ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`DELETE server ${serverId} failed with ${response.status}: ${JSON.stringify(data)}`);
  }

  return true;
}

function trackCreatedServer({ githubRepository, githubToken, hcloudToken, serverId, serverName }) {
  trackedCreatedServers.set(serverId, { githubRepository, githubToken, hcloudToken, serverName });
}

function untrackCreatedServer(serverId) {
  trackedCreatedServers.delete(serverId);
}

async function deleteTrackedServer({ githubRepository, githubToken, hcloudToken, serverId, serverName }) {
  try {
    await deleteServer({ hcloudToken, serverId });
    process.stderr.write(`Deleted in-flight Hetzner runner server ${serverName} after cancellation.\n`);
  } catch (error) {
    process.stderr.write(
      `Failed to delete in-flight Hetzner runner server ${serverName}: ${formatErrorMessage(error)}\n`,
    );
  }

  try {
    await removeRepositoryRunnersByNamePrefix({ githubRepository, githubToken, runnerNamePrefixValue: serverName });
  } catch (error) {
    process.stderr.write(
      `Failed to delete in-flight GitHub runner records for ${serverName}: ${formatErrorMessage(error)}\n`,
    );
  }
}

async function cleanupTrackedServersForSignal(signal) {
  if (shutdownCleanupStarted) {
    return;
  }
  shutdownCleanupStarted = true;

  const servers = [...trackedCreatedServers.entries()];
  if (servers.length > 0) {
    process.stderr.write(
      `Received ${signal}; deleting ${servers.length.toString()} in-flight Hetzner runner server(s).\n`,
    );
    await Promise.all(
      servers.map(([serverId, server]) =>
        deleteTrackedServer({
          githubRepository: server.githubRepository,
          githubToken: server.githubToken,
          hcloudToken: server.hcloudToken,
          serverId,
          serverName: server.serverName,
        }),
      ),
    );
  }

  process.exit(signal === 'SIGINT' ? 130 : 143);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanupTrackedServersForSignal(signal);
  });
}

async function updateServerLabels({ hcloudToken, labels, serverId }) {
  await requestHcloudJson({
    body: { labels },
    method: 'PUT',
    token: hcloudToken,
    url: `${hcloudApiBaseUrl}/servers/${serverId}`,
  });
}

async function listHcloudRunnerServers({ githubRepositoryId, hcloudToken }) {
  const servers = [];
  const labelSelector = encodeURIComponent(
    `type=github-runner,managed-by=${runnerManagedByLabel},gh-repo-id=${githubRepositoryId}`,
  );
  for (let page = 1; ; page += 1) {
    const data = await requestHcloudJson({
      token: hcloudToken,
      url: `${hcloudApiBaseUrl}/servers?label_selector=${labelSelector}&per_page=${apiPageSize.toString()}&page=${page.toString()}`,
    });
    const pageServers = data.servers ?? [];
    servers.push(...pageServers);
    if (pageServers.length < apiPageSize) {
      return servers;
    }
  }
}

async function waitForServerRunning({ hcloudToken, pollIntervalMs, serverId, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const server = await readServer({ hcloudToken, serverId });
    if (server === undefined) {
      throw new HcloudServerDeletedBeforeRunningError({ serverId });
    }
    if (server?.status === 'running') {
      return;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Hetzner server ${serverId} did not become running in time.`);
}

async function waitForRunnerRegistration({ githubRepository, githubToken, pollIntervalMs, runnerName, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runners = await listRepositoryRunners({ githubRepository, githubToken });
    const runner = runners.find((candidate) => candidate.name === runnerName && candidate.status === 'online');
    if (runner !== undefined) {
      return runner;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`GitHub runner ${runnerName} did not come online in time.`);
}

async function removeRepositoryRunnersByNamePrefix({ githubRepository, githubToken, runnerNamePrefixValue }) {
  const runners = await listRepositoryRunners({ githubRepository, githubToken });
  for (const runner of runners) {
    if (runner.name.startsWith(runnerNamePrefixValue)) {
      await deleteRepositoryRunner({ githubRepository, githubToken, runnerId: runner.id });
    }
  }
}

async function deleteRunnerServer({ githubRepository, githubToken, hcloudToken, server }) {
  await deleteServer({ hcloudToken, ignoreNotFound: true, serverId: String(server.id) });
  await removeRepositoryRunnersByNamePrefix({ githubRepository, githubToken, runnerNamePrefixValue: server.name });
}

function readRunnerLabelNames(runner) {
  return new Set((runner.labels ?? []).map((label) => label.name).filter((name) => typeof name === 'string'));
}

function hasRunnerLabels(runner, requiredLabels) {
  const labels = readRunnerLabelNames(runner);
  return requiredLabels.every((label) => labels.has(label));
}

export function hasQueuedJobForRunnerLabels({ jobs, requiredLabels }) {
  return jobs.some((job) => {
    if (job.status !== 'queued') {
      return false;
    }

    const labels = new Set((job.labels ?? []).filter((label) => typeof label === 'string'));
    return requiredLabels.every((label) => labels.has(label));
  });
}

function readLabelInteger(labels, name) {
  const value = labels?.[name];
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function readServerCreatedAtMs(server) {
  const createdAt = Date.parse(server.created);
  return Number.isFinite(createdAt) ? createdAt : undefined;
}

export function calculateBillingPeriodRemainingMs({ billingPeriodMs, createdAtMs, now }) {
  if (billingPeriodMs <= 0) {
    throw new Error('billingPeriodMs must be greater than zero.');
  }

  const ageMs = Math.max(0, now - createdAtMs);
  const elapsedMs = ageMs % billingPeriodMs;
  return elapsedMs === 0 ? billingPeriodMs : billingPeriodMs - elapsedMs;
}

export function isInsideBillingDeleteWindow({ billingDeleteWindowMs, billingPeriodMs, createdAtMs, now }) {
  return (
    calculateBillingPeriodRemainingMs({ billingPeriodMs, createdAtMs, now }) <=
    Math.min(billingDeleteWindowMs, billingPeriodMs)
  );
}

export function isFleetServerBootstrapExpired({ bootstrapGraceMs, now, server }) {
  const createdAtMs = readServerCreatedAtMs(server);
  return createdAtMs !== undefined && now - createdAtMs >= bootstrapGraceMs;
}

function calculateLeaseExpiresAt({ billingDeleteWindowMs, billingPeriodMs, fleetLeaseTtlMs, now, serverCreatedAtMs }) {
  const billingRemainingMs = calculateBillingPeriodRemainingMs({
    billingPeriodMs,
    createdAtMs: serverCreatedAtMs,
    now,
  });
  const billingDeleteAt = now + Math.max(0, billingRemainingMs - billingDeleteWindowMs);
  return Math.min(now + fleetLeaseTtlMs, billingDeleteAt);
}

function isFleetServerReusable({ billingPeriodMs, fleetMaxAgeMs, minimumReusableBillingMs, now, server }) {
  const createdAtMs = readServerCreatedAtMs(server);
  if (createdAtMs === undefined) {
    return false;
  }

  if (now - createdAtMs >= fleetMaxAgeMs) {
    return false;
  }

  const billingRemainingMs = calculateBillingPeriodRemainingMs({ billingPeriodMs, createdAtMs, now });
  return billingRemainingMs > minimumReusableBillingMs;
}

function shouldDeleteIdleServer({ billingDeleteWindowMs, billingPeriodMs, fleetMaxAgeMs, minimumAgeMs, now, server }) {
  const createdAtMs = readServerCreatedAtMs(server);
  if (createdAtMs === undefined || now - createdAtMs < minimumAgeMs) {
    return false;
  }

  if (now - createdAtMs >= fleetMaxAgeMs) {
    return true;
  }

  const leaseExpiresAt = readLabelInteger(server.labels, fleetLeaseExpiresAtLabel);
  if (leaseExpiresAt !== undefined && leaseExpiresAt > now) {
    return false;
  }

  return isInsideBillingDeleteWindow({ billingDeleteWindowMs, billingPeriodMs, createdAtMs, now });
}

function readRunnerRuntimeConfig() {
  return {
    githubRepository: readRequiredEnv('GITHUB_REPOSITORY'),
    githubRepositoryId: readRequiredEnv('GITHUB_REPOSITORY_ID'),
    githubRepositoryOwnerId: readRequiredEnv('GITHUB_REPOSITORY_OWNER_ID'),
    githubRunAttempt: readRequiredEnv('GITHUB_RUN_ATTEMPT'),
    githubRunId: readRequiredEnv('GITHUB_RUN_ID'),
    githubToken: readRequiredEnv('GITHUB_TOKEN'),
    hcloudToken: readRequiredEnv('HCLOUD_TOKEN'),
    image: readRequiredEnv('HETZNER_RUNNER_IMAGE'),
    locations: readRequiredListEnv('HETZNER_RUNNER_LOCATIONS'),
    pollIntervalMs: readIntegerEnv('HETZNER_RUNNER_POLL_INTERVAL_MS', defaultPollIntervalMs),
    runnerClass: readRequiredEnv('HETZNER_RUNNER_CLASS'),
    runnerDir: readRequiredEnv('HETZNER_RUNNER_DIR'),
    runnerVersion: readRequiredEnv('HETZNER_RUNNER_VERSION'),
    runnerWaitMs: readIntegerEnv('HETZNER_RUNNER_WAIT_MS', defaultRunnerWaitMs),
    serverType: readRequiredEnv('HETZNER_RUNNER_SERVER_TYPE'),
    sshKeyIds: parseList(readOptionalEnv('HETZNER_RUNNER_SSH_KEY_IDS')),
  };
}

function isRunnerPoolServer({ pool, runnerClass, server }) {
  return (
    server.name.startsWith(`${runnerNamePrefix}-`) &&
    server.labels?.[fleetPoolLabel] === pool &&
    server.labels?.['runner-class'] === runnerClass &&
    server.labels?.[runnerIsolationLabel] === runnerIsolationValue
  );
}

function isRunnerForServer({ runner, serverName }) {
  return runner.name.startsWith(`${serverName}-s`);
}

function listServerRunners({ runners, serverName }) {
  return runners.filter((runner) => isRunnerForServer({ runner, serverName }));
}

function isServerBusy({ runners, serverName }) {
  return listServerRunners({ runners, serverName }).some((runner) => runner.busy === true);
}

function countOnlineServerRunners({ runners, serverName }) {
  return listServerRunners({ runners, serverName }).filter((runner) => runner.status === 'online').length;
}

export function hasOnlineServerRunner({ runners, serverName }) {
  return countOnlineServerRunners({ runners, serverName }) > 0;
}

export function isFleetServerUnderCapacity({ bootstrapGraceMs, now, runners, server }) {
  const expectedSlots = readLabelInteger(server.labels, fleetSlotsLabel);
  if (expectedSlots === undefined || expectedSlots < 1) {
    return false;
  }

  const onlineSlots = countOnlineServerRunners({ runners, serverName: server.name });
  return (
    onlineSlots > 0 && onlineSlots < expectedSlots && isFleetServerBootstrapExpired({ bootstrapGraceMs, now, server })
  );
}

function countAvailablePoolRunners({ poolRunnerLabel, runnerClass, runners }) {
  return runners.filter(
    (runner) =>
      runner.status === 'online' && runner.busy !== true && hasRunnerLabels(runner, [poolRunnerLabel, runnerClass]),
  ).length;
}

export function calculateFleetServersToCreate({
  availableSlots,
  maxServers,
  requestedSlots,
  retainedServerCount,
  runnerSlots,
}) {
  const missingSlots = Math.max(0, requestedSlots - availableSlots);
  const neededServers = Math.ceil(missingSlots / runnerSlots);
  return Math.min(neededServers, Math.max(0, maxServers - retainedServerCount));
}

async function extendFleetServerLease({ hcloudToken, leaseExpiresAt, server }) {
  await updateServerLabels({
    hcloudToken,
    labels: {
      ...server.labels,
      [fleetLeaseExpiresAtLabel]: leaseExpiresAt.toString(),
    },
    serverId: String(server.id),
  });
}

async function createFleetServer({
  fleetLeaseExpiresAt,
  githubRepository,
  githubRepositoryId,
  githubRepositoryOwnerId,
  githubRunAttempt,
  githubRunId,
  githubToken,
  hcloudToken,
  image,
  locationAttemptOrder,
  pool,
  poolRunnerLabel,
  pollIntervalMs,
  runnerClass,
  runnerDir,
  runnerSlots,
  runnerVersion,
  runnerWaitMs,
  serverType,
  sshKeyIds,
}) {
  const registrationToken = await createRegistrationToken({ githubRepository, githubToken });
  const serverName = buildFleetServerName({
    pool,
    suffix: `${githubRunId}-${githubRunAttempt}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const installScript = buildRunnerInstallScript({
    githubRepository,
    registrationToken,
    runnerDir,
    runnerLabels: [poolRunnerLabel, 'hetzner', runnerClass, serverName].join(','),
    runnerName: serverName,
    runnerSlots,
    runnerVersion,
  });
  const payload = buildCreateServerPayload({
    fleetLeaseExpiresAt,
    fleetPool: pool,
    fleetSlots: runnerSlots,
    githubRepositoryId,
    githubRepositoryOwnerId,
    githubRunAttempt,
    githubRunId,
    image,
    location: locationAttemptOrder[0],
    runnerClass,
    runnerName: serverName,
    serverType,
    sshKeyIds,
    userData: buildCloudInit(installScript),
  });
  const server = await createServerWithLocationFallback({
    githubRepository,
    githubToken,
    hcloudToken,
    locationAttemptOrder,
    payload,
    pollIntervalMs,
    runnerWaitMs,
    serverName,
  });
  const serverId = String(server.id);

  try {
    for (let slot = 1; slot <= runnerSlots; slot += 1) {
      await waitForRunnerRegistration({
        githubRepository,
        githubToken,
        pollIntervalMs,
        runnerName: buildRunnerSlotName({ serverName, slot }),
        timeoutMs: runnerWaitMs,
      });
    }
    untrackCreatedServer(serverId);
  } catch (error) {
    try {
      await deleteServer({ hcloudToken, serverId });
    } finally {
      try {
        await removeRepositoryRunnersByNamePrefix({ githubRepository, githubToken, runnerNamePrefixValue: serverName });
      } finally {
        untrackCreatedServer(serverId);
      }
    }
    throw error;
  }

  process.stdout.write(`Hetzner runner fleet server ${serverName} is ready with ${runnerSlots.toString()} slot(s).\n`);
}

async function ensureFleet() {
  const pool = readRequiredEnv('HETZNER_RUNNER_POOL');
  const bootstrapGraceMs = readIntegerEnv('HETZNER_RUNNER_BOOTSTRAP_GRACE_MS', defaultFleetBootstrapGraceMs);
  const fleetLeaseTtlMs = readIntegerEnv('HETZNER_RUNNER_FLEET_LEASE_TTL_MS', defaultFleetLeaseTtlMs);
  const fleetMaxAgeMs = readIntegerEnv('HETZNER_RUNNER_FLEET_MAX_AGE_MS', defaultFleetMaxAgeMs);
  const fleetBillingPeriodMs = readIntegerEnv('HETZNER_RUNNER_BILLING_PERIOD_MS', defaultFleetBillingPeriodMs);
  const fleetBillingDeleteWindowMs = readIntegerEnv(
    'HETZNER_RUNNER_BILLING_DELETE_WINDOW_MS',
    defaultFleetBillingDeleteWindowMs,
  );
  const minimumReusableBillingMs = readIntegerEnv(
    'HETZNER_RUNNER_MIN_REUSABLE_BILLING_MS',
    defaultFleetMinimumReusableBillingMs,
  );
  const requestedSlots = readIntegerEnv('HETZNER_RUNNER_REQUESTED_SLOTS', defaultFleetRequestedSlots);
  const runnerSlots = readIntegerEnv('HETZNER_RUNNER_SLOT_COUNT', defaultFleetSlotsPerServer);
  const maxServers = readIntegerEnv('HETZNER_RUNNER_MAX_SERVERS', defaultFleetMaxServers);
  const {
    githubRepository,
    githubRepositoryId,
    githubRepositoryOwnerId,
    githubRunAttempt,
    githubRunId,
    githubToken,
    hcloudToken,
    image,
    locations,
    pollIntervalMs,
    runnerClass,
    runnerDir,
    runnerVersion,
    runnerWaitMs,
    serverType,
    sshKeyIds,
  } = readRunnerRuntimeConfig();

  if (requestedSlots < 1) {
    throw new Error('HETZNER_RUNNER_REQUESTED_SLOTS must be greater than zero.');
  }
  if (runnerSlots < 1) {
    throw new Error('HETZNER_RUNNER_SLOT_COUNT must be greater than zero.');
  }
  if (maxServers < 1) {
    throw new Error('HETZNER_RUNNER_MAX_SERVERS must be greater than zero.');
  }

  const now = Date.now();
  const poolRunnerLabel = buildFleetRunnerLabel({ pool });
  const servers = (await listHcloudRunnerServers({ githubRepositoryId, hcloudToken })).filter((server) =>
    isRunnerPoolServer({ pool, runnerClass, server }),
  );
  const runners = await listRepositoryRunners({ githubRepository, githubToken });
  const reusableServers = [];
  const retainedServers = [];

  for (const server of servers) {
    const serverRunners = listServerRunners({ runners, serverName: server.name });
    if (
      !hasOnlineServerRunner({ runners: serverRunners, serverName: server.name }) &&
      isFleetServerBootstrapExpired({ bootstrapGraceMs, now, server })
    ) {
      await deleteRunnerServer({ githubRepository, githubToken, hcloudToken, server });
      process.stdout.write(`Deleted unavailable Hetzner runner server ${server.name} after bootstrap grace.\n`);
      continue;
    }

    if (
      isFleetServerUnderCapacity({ bootstrapGraceMs, now, runners: serverRunners, server }) &&
      !isServerBusy({ runners: serverRunners, serverName: server.name })
    ) {
      await deleteRunnerServer({ githubRepository, githubToken, hcloudToken, server });
      process.stdout.write(`Deleted under-capacity Hetzner runner server ${server.name} after bootstrap grace.\n`);
      continue;
    }

    const reusable = isFleetServerReusable({
      billingPeriodMs: fleetBillingPeriodMs,
      fleetMaxAgeMs,
      minimumReusableBillingMs,
      now,
      server,
    });
    if (reusable) {
      reusableServers.push(server);
      retainedServers.push(server);
      continue;
    }

    if (!isServerBusy({ runners, serverName: server.name })) {
      await deleteRunnerServer({ githubRepository, githubToken, hcloudToken, server });
      process.stdout.write(`Deleted idle Hetzner runner ${server.name} before the next billing hour.\n`);
      continue;
    }

    retainedServers.push(server);
  }

  for (const server of reusableServers) {
    const serverRunners = listServerRunners({ runners, serverName: server.name });
    if (serverRunners.some((runner) => runner.status === 'online')) {
      const createdAtMs = readServerCreatedAtMs(server);
      if (createdAtMs === undefined) {
        continue;
      }
      const leaseExpiresAt = calculateLeaseExpiresAt({
        billingDeleteWindowMs: fleetBillingDeleteWindowMs,
        billingPeriodMs: fleetBillingPeriodMs,
        fleetLeaseTtlMs,
        now,
        serverCreatedAtMs: createdAtMs,
      });
      await extendFleetServerLease({ hcloudToken, leaseExpiresAt, server });
    }
  }

  const reusableServerNames = new Set(reusableServers.map((server) => server.name));
  const reusableRunners = runners.filter((runner) =>
    [...reusableServerNames].some((serverName) => isRunnerForServer({ runner, serverName })),
  );
  const availableSlots = countAvailablePoolRunners({ poolRunnerLabel, runnerClass, runners: reusableRunners });
  const serversToCreate = calculateFleetServersToCreate({
    availableSlots,
    maxServers,
    requestedSlots,
    retainedServerCount: retainedServers.length,
    runnerSlots,
  });

  const createResults = await Promise.allSettled(
    Array.from({ length: serversToCreate }, async (_, index) => {
      const fleetLeaseExpiresAt = calculateLeaseExpiresAt({
        billingDeleteWindowMs: fleetBillingDeleteWindowMs,
        billingPeriodMs: fleetBillingPeriodMs,
        fleetLeaseTtlMs,
        now,
        serverCreatedAtMs: now,
      });
      await createFleetServer({
        fleetLeaseExpiresAt,
        githubRepository,
        githubRepositoryId,
        githubRepositoryOwnerId,
        githubRunAttempt,
        githubRunId,
        githubToken,
        hcloudToken,
        image,
        locationAttemptOrder: rotateFleetLocations({ locations, startIndex: index }),
        pool,
        poolRunnerLabel,
        pollIntervalMs,
        runnerClass,
        runnerDir,
        runnerSlots,
        runnerVersion,
        runnerWaitMs,
        serverType,
        sshKeyIds,
      });
    }),
  );
  const createFailures = createResults.filter((result) => result.status === 'rejected');
  if (createFailures.length > 0) {
    throw new AggregateError(
      createFailures.map((result) => result.reason),
      `Failed to create ${createFailures.length.toString()} Hetzner runner server(s).`,
    );
  }

  process.stdout.write(
    `Hetzner runner fleet ${poolRunnerLabel} is ready with ${availableSlots.toString()} existing available slot(s), ${retainedServers.length.toString()} retained server(s), and ${serversToCreate.toString()} new server(s).\n`,
  );
}

async function cleanupStaleRunners() {
  const githubRepository = readRequiredEnv('GITHUB_REPOSITORY');
  const githubRepositoryId = readRequiredEnv('GITHUB_REPOSITORY_ID');
  const githubToken = readRequiredEnv('GITHUB_TOKEN');
  const hcloudToken = readRequiredEnv('HCLOUD_TOKEN');
  const minimumAgeMs = readIntegerEnv('HETZNER_RUNNER_CLEANUP_MIN_AGE_MS', defaultCleanupMinimumAgeMs);
  const fleetMaxAgeMs = readIntegerEnv('HETZNER_RUNNER_FLEET_MAX_AGE_MS', defaultFleetMaxAgeMs);
  const fleetBillingPeriodMs = readIntegerEnv('HETZNER_RUNNER_BILLING_PERIOD_MS', defaultFleetBillingPeriodMs);
  const fleetBillingDeleteWindowMs = readIntegerEnv(
    'HETZNER_RUNNER_BILLING_DELETE_WINDOW_MS',
    defaultFleetBillingDeleteWindowMs,
  );
  const now = Date.now();
  const servers = await listHcloudRunnerServers({ githubRepositoryId, hcloudToken });
  const runners = await listRepositoryRunners({ githubRepository, githubToken });
  const staleServers = servers.filter((server) => {
    if (!server.name.startsWith(`${runnerNamePrefix}-`)) {
      return false;
    }

    const createdAt = Date.parse(server.created);
    if (!Number.isFinite(createdAt) || now - createdAt < minimumAgeMs) {
      return false;
    }

    if (isServerBusy({ runners, serverName: server.name })) {
      return false;
    }

    if (server.labels?.[runnerIsolationLabel] !== runnerIsolationValue) {
      return true;
    }

    return shouldDeleteIdleServer({
      billingDeleteWindowMs: fleetBillingDeleteWindowMs,
      billingPeriodMs: fleetBillingPeriodMs,
      fleetMaxAgeMs,
      minimumAgeMs,
      now,
      server,
    });
  });

  for (const server of staleServers) {
    await deleteRunnerServer({ githubRepository, githubToken, hcloudToken, server });
    process.stdout.write(`Deleted stale Hetzner runner ${server.name} (${server.id}).\n`);
  }

  process.stdout.write(`Stale Hetzner runner cleanup completed. Deleted ${staleServers.length} server(s).\n`);
}

async function hasQueuedFleetWork() {
  const pool = readRequiredEnv('HETZNER_RUNNER_POOL');
  const runnerClass = readRequiredEnv('HETZNER_RUNNER_CLASS');
  const githubRepository = readRequiredEnv('GITHUB_REPOSITORY');
  const githubToken = readOptionalEnv('GITHUB_ACTIONS_TOKEN') ?? readRequiredEnv('GITHUB_TOKEN');
  const poolRunnerLabel = buildFleetRunnerLabel({ pool });
  const requiredLabels = [poolRunnerLabel, runnerClass];
  const runs = [
    ...(await listWorkflowRunsByStatus({
      githubRepository,
      githubToken,
      status: 'queued',
      workflowId: runnerQueueWorkflowId,
    })),
    ...(await listWorkflowRunsByStatus({
      githubRepository,
      githubToken,
      status: 'in_progress',
      workflowId: runnerQueueWorkflowId,
    })),
  ];

  for (const run of runs) {
    const jobs = await listWorkflowRunJobs({ githubRepository, githubToken, runId: run.id });
    if (hasQueuedJobForRunnerLabels({ jobs, requiredLabels })) {
      process.stdout.write(`Detected queued Hetzner runner work in CI run ${run.id.toString()}.\n`);
      return true;
    }
  }

  return false;
}

async function reconcileFleet() {
  const queuedFleetWork = await hasQueuedFleetWork();
  await cleanupStaleRunners();

  if (queuedFleetWork) {
    await ensureFleet();
  }
}

async function main() {
  const [, , command] = process.argv;

  if (command === 'ensure-fleet') {
    await ensureFleet();
    return;
  }

  if (command === 'cleanup') {
    await cleanupStaleRunners();
    return;
  }

  if (command === 'reconcile') {
    await reconcileFleet();
    return;
  }

  throw new Error('Usage: node ./scripts/ci/hetzner-runner.mjs <ensure-fleet|cleanup|reconcile>');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
