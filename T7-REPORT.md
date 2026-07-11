# T7: edge last-known-good snapshot and sessions

Date: 2026-07-11. Track: `t7`. Base: `spike/env` at `776206c7`.

## Result

The current gap is proven. With API scaled to zero, the public bench route stayed available from the in-memory edge snapshot (`200` in 25 ms) while the console failed (`502` in 6 ms). Restarting edge with API still down changed the bench route to `502` at 3, 6, 9, 12, and 15 seconds. The outage is unbounded until API returns a route snapshot; the direct bench fixture is not stored in the API database, so this stand cannot repopulate that route merely by scaling API back up.

The SPIKE-T7 prototype implements a persisted last-known-good snapshot. Package tests prove that a fresh snapshot starts edge after an API connection refusal and that an expired snapshot is rejected while bootstrap continues waiting for API. The cluster-level replay was blocked after the baseline by a Colima/containerd storage failure (`metadata_v2.db: input/output error`); both pre-existing k3d servers became `0/1`. Restarting only `cpt-t7` also failed with an I/O error. Colima was not restarted because that would disrupt the out-of-scope `t6` stand.

## Measurements

| Scenario                 | Observation                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| API=0, existing edge     | bench `200`, 0.025 s; console `502`, 0.006 s                                              |
| API=0, edge restarted    | bench `502` at 3/6/9/12/15 s                                                              |
| Fresh LKG, API refused   | automated boundary test restores route after one failed API request                       |
| Expired LKG              | automated boundary test rejects it and waits for the next successful API request          |
| Refresh/revocation proxy | refresh interval is 5,000 ms; automated test applies changed route state on that boundary |

Wall-clock revocation propagation could not be measured after the runtime failure. The code path is one 5 s poll plus API fetch, atomic disk write, and in-memory replacement. Therefore the expected steady-state window is `0..5 s + fetch/write/processing`; P8 must obtain a real p95/p99 wall-clock measurement. This spike used route-state propagation as the allowed proxy, not a complete authenticated grant-revocation flow.

## Prototype

- API remains authoritative and is attempted first on startup.
- A successful non-null response is written before it is exposed in memory, using a same-directory temporary file and atomic rename.
- Authoritative `state:null` clears memory and deletes the persisted snapshot.
- On retryable `ECONNREFUSED`, edge accepts only strict, contract-valid JSON whose timestamp is neither in the future nor older than max-age, then starts serving and retains the existing 5 s refresh loop.
- Missing, corrupt, future, null, or expired disk state fails closed.
- The spike chart adds an edge RWO PVC mounted at `/var/lib/compartment-edge`.

Proposed max-age default: **24 hours**. This covers a normal control-plane incident or maintenance window without permitting indefinite stale authorization. It is a security/product policy, not merely a tuning value: P8 should expose it explicitly, alert as the deadline approaches, and document that traffic fails closed at expiry. Environments with stricter revocation requirements should choose a shorter value.

## Disk security inventory

The JSON file contains `persistedAt`, console URL, route hosts, upstream internal hosts and ports, organization IDs/slugs, scope IDs/types, principal IDs, permissions/grants, proxy rules, and on-demand TLS hosts. It does **not** contain the edge internal token, auth cookies, app-session bearer tokens, principal email addresses from sessions, or session expiry values.

The directory is forced to mode `0700`; the temporary/final file is mode `0600`; the pod runs as uid/gid 1000. Contents are never logged. The PVC is still sensitive authorization metadata at rest. P8 security review must decide storage encryption, node/PVC backup exposure, deletion/rotation, corruption handling, and whether filesystem ownership should be set by an init container instead of relying on the provisioner/fsGroup behavior.

## O4: sessions

App sessions remain memory-only. After edge restart, the browser can still send its old app-session cookie, but edge cannot find the token. For an authenticated route it responds with a redirect to the control-plane `/login`, clears the stale app cookie, and sets a new flow-state cookie. The expected UX is a single re-login, not `401`; a loop is possible only if the control plane is still unavailable, because the redirect target cannot complete login during that outage. Public routes are unaffected.

Recommendation: **accept re-login after edge restart** for P8. Persisting sessions would put bearer tokens plus principal email/ID, auth-session ID, host, and expiry on disk; it also needs encrypted storage, key rotation, expiry cleanup, atomic revocation semantics, multi-replica coordination, and backup policy. That complexity and credential exposure are disproportionate to the uncommon restart UX. Revisit only if availability SLOs explicitly require authenticated sessions to survive edge replacement; prefer stateless, signed, short-lived app-session credentials over a plaintext session database on the snapshot PVC.

## Validation and limitations

Passed:

- `pnpm --filter @compartment/edge typecheck`
- `pnpm --filter @compartment/edge lint`
- `pnpm --filter @compartment/edge test` — 98 tests
- `helm template compartment spike/chart/compartment`
- `git diff --check`

Environment warning: host Node was 24.14.0 while the repo requests 24.15.0. Container builds use 24.15.0. The first full rebuild and the subsequent edge-only rebuild both failed in Docker/containerd metadata with I/O errors, not compilation errors. A workspace dependency build of edge completed locally.

## P8 charter inputs

1. Resolve the layer exception: `docs/layers/edge.md` currently forbids durable persistence. Assign PVC lifecycle/backup/security ownership explicitly.
2. Keep API-first startup, strict validation, atomic replacement, future-timestamp rejection, and fail-closed expiry.
3. Add metrics for snapshot age, restore source, persistence failures, refresh failures, and fail-closed expiry.
4. Measure real revocation p95/p99 and define max-age against the security policy.
5. Keep sessions memory-only and make post-restart re-login an explicit supported UX.
6. Add corruption, ENOSPC, permission, partial-write, clock-skew, PVC remount, and multi-replica tests.

## SPIKE-T7 diff appendix

The prototype diff is intentionally confined to these package-owned/runtime spike surfaces:

- `packages/edge/src/config.ts`: snapshot path and 24 h max-age configuration.
- `packages/edge/src/services/edge-bootstrap.service.ts`: API-first persistence, restore, age validation, atomic write, and authoritative deletion.
- `packages/edge/src/services/edge-bootstrap.service.types.ts`: named disk-envelope types.
- `packages/edge/test/config.test.ts`, `edge-bootstrap.service.test.ts`, `edge-test.utils.ts`: fresh restore, expired fail-closed, persistence, and config coverage.
- `spike/chart/compartment/values.yaml`, `templates/pvc.yaml.tpl`, `templates/edge.yaml.tpl`: prototype PVC, mount, and env wiring.

Exact review command: `git diff spike/env...spike/t7`. Every prototype source/chart addition is marked `SPIKE-T7`; this report is the decision artifact and the branch must not be merged.
