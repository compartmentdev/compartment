# P2 Rolling Application Deployment Report

## Result

P2 adds a worker-owned `DeploymentReconcileArea` to the P4 controller host.
The build worker persists the published image and Kubernetes `desired` row
before the controller writes Kubernetes. The controller runs the durable P4
release Job first, applies one stable Deployment and Service identity by SSA,
and promotes the deployment only after the informer observes the current
generation Ready.

Failed releases do not apply the candidate. A rollout that reaches
`ProgressDeadlineExceeded` or the 50-second controller timeout force-applies
the saved active projection with the same field manager and waits for Ready
before persisting the candidate failure. It never calls rollout undo.

Application routes resolve to the stable Service DNS name on port 80. The
Kubernetes path does not reserve published ports or call the legacy runtime
deploy/release path.

## T1 parameters

- `maxUnavailable: 0`, `maxSurge: 1`;
- 45-second progress deadline;
- configurable termination grace, validated at 45 seconds or greater;
- 3-second `preStop` delay;
- readiness initial delay 1 second, period 2 seconds, timeout 1 second,
  failure threshold 3, success threshold 1.

## LOC

`packages/kube-runtime/src/**/*.ts` contains 2,036 physical lines after P2,
below the 3,000-line D33 limit. Tests and harnesses are excluded from this
runtime budget.

## k3d verification

The T1 bench image and manifests were run on a live `k3d-cpt-t1` cluster.
Because Colima did not publish the generated Kubernetes API port to the host,
`kubectl` and `hey` ran in the k3d server network namespace; Kubernetes,
container lifecycle, Services, probes, and SSA remained real cluster paths.

- Ready rollout v2 to v3 under 200 target rps for 60 seconds: 12,000 HTTP 200
  responses, zero HTTP failures, p50 1.4 ms, p99 7.3 ms.
- Permanently NotReady v4: `ProgressDeadlineExceeded` at 45 seconds;
  force-SSA of the saved v3 spec converged to one Ready v3 pod.
- Deleted active Deployment: saved-spec SSA recreated it and reached Ready in
  2 seconds; the Deployment UID changed, proving deletion/recreation.
- Controller-process interruption before apply followed by the same
  label-scoped SSA: one application Deployment converged Ready, ReplicaSets
  changed from 1 to 2 with no duplicate Deployment.

Captured command logs: `/tmp/p2-rollout-http.log`,
`/tmp/p2-stalled-status.log`, `/tmp/p2-recovery-apply.log`,
`/tmp/p2-active-drift-reapply.log`, and `/tmp/p2-kill-worker-retry.log`.

## Delete list for P10 cutover

P2 is additive and does not delete the legacy blue-green implementation. P10
must remove:

- `worker-runtime-deploy` and deployment-movement runtime coordination;
- published-port reservation and port-finder behavior;
- the probe container and its image;
- all `deployments.upstreamHost` and `deployments.upstreamPort` reads/writes;
- `packages/worker/src/services/worker-runtime-release.service.ts`;
- `packages/node/src/routes/post-runtime-release.route.ts`.

Acceptance grep must show that Kubernetes deployments contain no handmade
route switching, drain coordination, or port finder.
