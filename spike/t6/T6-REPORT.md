# T6 · Capture logs before Pod death

## Decision O3

Use a node log agent (Vector prototype here) as the durable capture path for P7. Keep `kubectl logs -f` only as a deployment/debug convenience, never as storage. The adapter can be lossless during an orderly rollout and a container restart, but it has no reliable recovery once the Pod object disappears and it cannot outrun kubelet rotation. Vector survived its own Pod deletion without a gap because its checkpoint was node-local.

The P7 charter must also require a bounded remote/durable sink, backpressure and disk quotas. The spike's intentionally unbounded file sink grew to 940 MiB in about 75 seconds and exhausted the local Colima disk. Node-local files are a capture buffer, not the final store.

## Results

All lines were `T6|RUN|NNNNNNNNNNNN|payload`. Loss is missing sequence IDs up to the greatest emitted ID observed for that mechanism after at least eight seconds of quiescence. Duplicates are reported separately.

| # | Disruption | A: kubectl follow + final/previous | B: Vector `/var/log/pods` → node file |
|---|---|---:|---:|
| 1 | orderly rolling | 0 lost (609/609), 0 duplicate | 0 lost (609/609), 0 duplicate |
| 2 | OOM, 64 MiB | 0 lost (500/500), 0 duplicate | 0 lost (500/500), 500 duplicates after reopen |
| 3 | SIGKILL workload, container restart | 0 lost (668/668), 0 duplicate | 0 lost (1,087/1,087), 668 duplicates after reopen |
| 4 | force-delete Pod object | 944 tail lines lost (776/1,720, 54.9%) | 0 lost (1,720/1,720), 776 duplicates |
| 5 | rotation / unthrottled spam | 2,308,679 lost before read (592,796 unique through ID 2,901,475) | 4,809,245 lost at overload (410,194 unique through ID 5,219,439) |
| 6 | kill Vector Pod and interrupt A follow | 0 lost (19,198/19,198) | 0 lost (19,198/19,198) |

Scenario 5 uses two unthrottled repeats because the first repeat filled the node during evidence copy. Both counts are exact within their repeat, but they are not a paired same-stream comparison. At non-overload rates, scenarios 1–4 and 6 use the same stream for A and B.

Negative-first controls confirmed that after force deletion both `kubectl logs POD` and `kubectl logs POD --previous` return NotFound. `--previous` recovered the immediately preceding container only while its Pod object remained; it cannot recover an older restart or a deleted Pod.

## Throughput and disk

Vector had no missing IDs at achieved rates of 169, 1,201, 4,268, 7,875, 11,642 and 16,072 lines/s (8–9 second windows). The unthrottled generator emitted about 579,938 lines/s over nine seconds and Vector first showed loss there: 4,809,245 of 5,219,439 IDs. Therefore this setup's measured safe point is **at least 16,072 lines/s** and the first observed loss point is **579,938 lines/s**; the exact knee lies between them and is workload/line-size/disk dependent.

K3s did not override `containerLogMaxSize` or `containerLogMaxFiles`; kubelet defaults were therefore 10 MiB and 5 files. A late `kubectl logs` read saw only retained rotated data. Vector moved the constraint to its sink: without rotation/retention, its node footprint grew by roughly the full accepted byte stream. The DaemonSet requested 50m CPU/64 MiB and was limited to 1 CPU/256 MiB; it added a privileged namespace, read-only `/var/log/pods` hostPath and writable `/var/lib/t6-vector` hostPath.

## P7 prototype input

Start from `vector.yaml`, but replace the file sink with the product-owned durable store and preserve these properties:

- DaemonSet reads kubelet files and persists checkpoints independently of the Pod lifecycle.
- Events carry Pod UID, container name/restart identity and a monotonic source offset for idempotent deduplication.
- Local buffering is bounded by size/time, exposes dropped-event and disk-pressure metrics, and cannot fill nodefs.
- P7 load validation covers the expected production line size/rate and a sink outage, with an SLO below the measured 16k lines/s safe point.

The adapter script remains useful for live deploy output, but its data must be explicitly best-effort.

## Reproduction and caveats

Run `setup.sh`, follow `SCENARIOS.md`, and recompute counts with `analyze.py`. Vector `0.49.0-alpine` ran natively as `aarch64`. Raw compact evidence is in `results/SUMMARY.txt`; large spam logs were intentionally reduced to counts and removed from the PR.

The spike is local k3d/containerd, single node and a file sink. A production store, network outage, multi-node scheduling, eviction and node death remain P7 validation items.
