# ENV spike report

## Result

The spike infrastructure is ready for the T1–T10 wave. It creates isolated k3d stands, installs the platform chart, deploys the direct benchmark fixture, and also installs the same chart templates under kind with PSA `restricted`.

This is not a claim that Compartment can deploy workloads on Kubernetes yet. API and worker still call the Docker/node-agent runtime contract. That product migration belongs to P1. Rootless BuildKit also cannot run under PSA `restricted`; the kind profile disables it and keeps that incompatibility visible for T10/P1.

## Start here

Run the doctor before any other command:

```bash
spike/env/doctor.sh
```

It installs missing `docker`, `colima`, `k3d`, `kind`, Helm 4, `kubectl`, `hey`, Node.js 24, and `pnpm` with Homebrew, prints versions, and starts or resizes Colima to 6 CPU, 10 GiB memory, and 60 GiB disk.

Create an isolated k3d stand:

```bash
spike/env/up.sh t1
spike/bench/deploy.sh k3d-cpt-t1
```

Remove only that stand:

```bash
spike/env/down.sh t1
```

Create the PSA stand:

```bash
spike/env/up-kind.sh
CONTEXT=kind-cpt-kind-... # use the context printed by up-kind.sh
spike/bench/deploy.sh "$CONTEXT"
spike/env/down.sh kind
```

The lifecycle scripts run `pnpm self-hosted:build`, tag the result with the track ID, import those immutable per-track references, install Helm with `--wait`, and print the context and host URLs. The macOS `lockf` primitive serializes local image builds and host-port allocation and releases automatically if its owner exits. Reservations remain in `${TMPDIR:-/tmp}/compartment-spike-$USER/reservations` until `down.sh` releases them.

`up.sh` always prints `STATUS=ok` or `STATUS=failed` as its final line. Consumers must check that sentinel as well as the process exit code.

## Startup sequencing and resource budget

The chart is installed in two stages without changing templates between k3d and kind:

1. PostgreSQL and registry become Available.
2. The revision migration Job waits for both foundation Deployments and completes.
3. API, worker, edge, Caddy, registry-auth, and optional BuildKit wait for that exact Job before starting.

If either Helm stage fails, `up.sh` waits for the Kubernetes `/readyz` endpoint, clears a pending Helm release, and retries the complete staged install exactly once. A failed `up` waits for a stable Docker API, repeatedly removes resources carrying the standard `k3d.cluster` label plus the cluster network, verifies five consecutive clean polls, and syncs the Colima guest filesystem before releasing the port reservation. If absence cannot be proven, the reservation is retained and `down.sh` completes recovery later. This covers containers restored late after a Colima VM restart without making their host ports available to another stand.

Default requests and limits are intentionally conservative for a 6 CPU/10 GiB Colima VM:

| Component               | Request CPU / memory | Limit CPU / memory |
| ----------------------- | -------------------- | ------------------ |
| api                     | 100m / 256Mi         | 1 / 768Mi          |
| api-migrate             | 50m / 128Mi          | 500m / 512Mi       |
| worker                  | 100m / 256Mi         | 1 / 1Gi            |
| edge                    | 50m / 128Mi          | 500m / 384Mi       |
| caddy                   | 25m / 64Mi           | 500m / 256Mi       |
| postgres                | 100m / 256Mi         | 1 / 1Gi            |
| registry                | 50m / 128Mi          | 500m / 512Mi       |
| registry-auth           | 50m / 128Mi          | 500m / 256Mi       |
| buildkit                | 250m / 512Mi         | 2 / 2Gi            |
| short-lived init waiter | 10m / 32Mi           | 100m / 128Mi       |

The full steady-state request is 725m CPU and 1.69 GiB memory. Kubernetes may reserve the runtime pods and migration Job together for a conservative scheduler bound of 775m CPU and 1.81 GiB. The init gates sequence actual process startup even though they do not reduce that scheduler reservation. Caddy's binary-copy init container has a separate 10m/32Mi request and 100m/128Mi limit.

## Component compatibility

| Component         | k3d                    | kind + restricted           | Minimum startup input                                                                                     | Missing Kubernetes runtime behavior                                                                                                                                                                                                                                |
| ----------------- | ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| api-migrate       | starts                 | starts                      | `COMPARTMENT_DATABASE_URL`                                                                                | A revision-named Job is the only migration runner. Only short-lived waiter init containers receive projected tokens and use namespace-scoped read-only RBAC. Application containers do not receive them. The completed Job remains as a durable restart condition. |
| api               | starts with stub       | starts with stub            | API config and generated secrets listed below; writable `/var/run/compartment` and `/var/lib/compartment` | `COMPARTMENT_NODE_AGENT_SOCKET` is syntactically valid but no agent creates it. Deploy, stop, logs, runtime inspection, and resource operations that use the agent are P1 blockers.                                                                                |
| worker            | starts                 | starts with BuildKit absent | API/registry endpoints, credentials, runtime token, poll interval, `BUILDKIT_ADDR`                        | Build work can reach BuildKit on k3d, but deployment still reaches the node-agent contract returned by API. On kind, BuildKit is intentionally absent.                                                                                                             |
| edge              | starts                 | starts                      | API host/port, edge bind host/port, base domain, protocol, matching edge token, log level                 | Runtime upstream routing has no Kubernetes workload provider until P1.                                                                                                                                                                                             |
| caddy             | starts                 | starts                      | API/edge endpoints, base domain, TLS mode, allocated high HTTP/HTTPS ports                                | The self-hosted image carries `cap_net_bind_service`; PSA rejects direct execution. An init container copies the binary without file capabilities, then it runs as UID 1000 on the advertised stand ports.                                                         |
| postgres          | starts                 | starts                      | database, username, generated password, PVC                                                               | `PGDATA` must be a process-owned subdirectory and `/var/run` must be writable for non-root restricted operation.                                                                                                                                                   |
| registry          | starts                 | starts                      | relative URLs/delete flags, PVC                                                                           | Cluster-internal only. No external registry endpoint is exposed.                                                                                                                                                                                                   |
| registry-auth     | starts                 | starts                      | target URL, bind port, read/write usernames and generated passwords                                       | Cluster-internal only.                                                                                                                                                                                                                                             |
| buildkit rootless | starts with exceptions | blocker; disabled in values | TCP address, writable rootless state/runtime directories                                                  | RootlessKit needs setuid helpers, `allowPrivilegeEscalation`, and Unconfined seccomp/AppArmor inside k3d. PSA `restricted` forbids those settings. Do not replace it with privileged/rootful BuildKit; resolve the execution model in T10/P1.                      |

### API minimum environment

The chart supplies the strict self-hosted schema rather than relying on application defaults:

- connectivity: `COMPARTMENT_API_BIND_HOST`, `COMPARTMENT_API_PORT`, `COMPARTMENT_DATABASE_URL`, `COMPARTMENT_EDGE_INTERNAL_HOST`, `COMPARTMENT_EDGE_PORT`, `COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST`, and `COMPARTMENT_LOG_LEVEL`;
- public host: `COMPARTMENT_BASE_DOMAIN`, `COMPARTMENT_PUBLIC_PROTOCOL`, `COMPARTMENT_PUBLIC_HTTP_PORT`, `COMPARTMENT_PUBLIC_HTTPS_PORT`, `COMPARTMENT_CADDY_TLS_MODE`, `COMPARTMENT_CUSTOM_TLS_DIR`, public ingress address fields;
- runtime paths: `COMPARTMENT_NODE_AGENT_SOCKET`, `COMPARTMENT_SYSTEM_API_SOCKET`, resource backup/source archive paths and archive limit;
- retention/audit: retention days, cleanup cron/batch settings, file sink toggle/path/rotation/retention, rollback retention;
- auth: all login/activate/reset-password throttle windows, limits, and blocks, plus session TTL;
- optional integrations represented explicitly as empty values: managed-domain broker URL/token and trusted outbound hosts;
- generated/preserved secrets: PostgreSQL password and matching URL, edge token, runtime-control token, system token, 64-hex session secret, and 64-hex variables master key.

The node-agent socket path is `/var/run/compartment/node/agent.sock`. Its parent path is writable, but the socket does not exist. API readiness does not require the agent.

### Worker minimum environment

- `BUILDKIT_ADDR=tcp://<release>-compartment-buildkit:1234`;
- API host/port;
- internal and advertised registry host/port;
- registry read/write usernames and passwords;
- Docker namespace, log level, poll interval, trusted outbound hosts, and runtime-control token;
- writable `TMPDIR` and `DOCKER_CONFIG` locations.

The worker process starts without a node-agent socket. A real deployment cannot finish without replacing the Docker/node-agent orchestration path.

### Edge, registry-auth, and Caddy minimum environment

- edge: API host/port, base domain, bind/internal host, port, edge token, log level, public protocol;
- registry-auth: proxy bind host/port, registry target URL, and both credential pairs;
- Caddy: API/edge host and port, base domain, TLS mode, and public ports. The `custom-http` profile does not consume ACME settings.

## Secrets and upgrades

The Secret template generates hex values with Helm helpers and reuses existing Secret data through `lookup`. Explicit `values.secrets.*` entries set initial values. The PostgreSQL password is immutable after PVC initialization; rotate it with a future explicit credential-rotation workflow, not a values change. Workload checksum annotations roll components when effective config or secret data changes without rotating unrelated generated credentials.

Validated on k3d:

- `helm upgrade` with a changed `platform.rolloutMarker` rolled the configured workloads;
- the Secret data SHA-256 was unchanged (`secret_preserved=yes`);
- the console returned HTTP 302 after the rollout.

## Required scenarios

### Isolation

Validated with `a` and `b` concurrently:

```text
a_before=302
b_before=302
b_after=302
```

`a` used host port 18081 and `b` used 18080. `down.sh a` removed only `cpt-a`; `cpt-b` remained Ready with both k3d containers running.

### PostgreSQL restart

Deleting the PostgreSQL pod recreated it from the same PVC. API briefly restarted while PostgreSQL was unavailable, then recovered without intervention in 15 seconds. The console returned HTTP 302 after recovery. A transient 502 is expected during the single-replica restart window.

### Upgrade

The revision migration Job completed, Deployments became Available, the stand stayed reachable, and generated secrets were preserved.

### Load and drops

Deploy the fixture and run:

```bash
spike/bench/load.sh k3d-cpt-b 60 200 30
```

The fourth argument deletes the web pod after 30 seconds. The validated result was:

```text
rps=185.57 p50_ms=32.40 p99_ms=317.40 drops=1336 http_failures=656 missing_responses=680 responses=11320 expected=12000 hey_exit=0
```

`http_failures` counts completed non-2xx/3xx responses. `missing_responses` shows transport failures or under-generated requests. `drops` is their sum, so achieved volume and application failures remain distinguishable.

### WebSockets

Run:

```bash
spike/bench/ws.sh k3d-cpt-b 100 60
```

The client must reach the requested concurrent connection count before the hold timer starts. It logs errors and closes with UTC timestamps, reconnects until the duration expires, and exits nonzero if the initial set is not established. The summary reports total opens, maximum concurrency, and disconnects.

Validated with five connections and a forced web-pod deletion: all five disconnected with code 1006, reconnects raised `totalOpened` to 10, `maxConcurrent` stayed at 5, and the UTC disconnect timestamp was logged.

### Failure recovery

- Kubernetes API disruption during the first Helm install produced one `Retrying Helm install once.` event; the retry completed and the final line was `STATUS=ok`.
- Stopping Colima during an active install and terminating the failed run produced `STATUS=failed`; after Docker recovery there were zero labeled containers, no cluster network, and no reservation. A subsequent full Colima restart did not resurrect them.
- Running the cleanup sweep again against the absent cluster succeeded, confirming idempotence.
- The same chart templates installed under kind with namespace PSA `enforce=restricted`; all seven enabled Deployments became Available.

## Instructions for T1–T10 authors

1. Use a short lowercase track ID: `spike/env/up.sh t3`.
2. Keep `kubectl` and Helm commands pinned to the printed context; never rely on the current context.
3. Deploy the shared fixture with `spike/bench/deploy.sh k3d-cpt-t3`.
4. Treat API/edge readiness as control-plane startup only. It does not prove Kubernetes workload deployment.
5. Use direct manifests for spike fixtures until P1 provides the Kubernetes deployment primitive.
6. Do not add Docker socket, hostPath, privileged/rootful BuildKit, or public `/internal/*` exposure to bypass a blocker.
7. Use `values-kind.yaml` for T10. Do not weaken the namespace PSA labels.
8. Record node-agent and BuildKit incompatibilities as P1/T10 inputs rather than changing `packages/*` in a spike track.
9. Run the load and WebSocket clients before and during pod disruption.
10. Always finish with `spike/env/down.sh <track-id>` so host-port reservations are released.

## Known limits

- No Kubernetes node-agent or runtime provider exists. Product deploy/rollback/log/resource flows are not functional.
- BuildKit cannot run under PSA `restricted` with the current rootless execution model. The kind profile installs the rest of the platform with `buildkit.enabled=false`.
- k3d BuildKit is non-root but needs setuid helpers plus Unconfined seccomp/AppArmor. This is suitable only for the spike.
- Registry backend ingress is limited to `registry-auth` by NetworkPolicy. Production clusters must use a CNI that enforces NetworkPolicy; kind's default CNI only validates the manifest shape.
- Platform and database are single-replica. PostgreSQL restart causes a short readiness/502 window.
- Local storage uses the cluster default StorageClass unless `storage.storageClass` is set. Deleting the cluster deletes its data.
- `custom-http` and `.localhost` are local spike settings; TLS/ACME and production ingress are not covered.
- The benchmark fixture is deployed directly and is not evidence of Compartment-managed deployment.
- Completed migration Jobs are retained so API pods can restart safely; periodic cleanup needs a production lifecycle design before chart H1.
- Every `up` validates the branch through `pnpm self-hosted:build`; Docker cache keeps warm runs fast. On the 6 CPU/10 GiB reference profile, a fresh isolated BuildKit cache took 3m33s and the immediately repeated warm k3d start took 1m19s. Both include image build, cluster creation, import, staged Helm install, and readiness, and both are below ten minutes.
