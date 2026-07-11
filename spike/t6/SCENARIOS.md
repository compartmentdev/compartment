# T6 scenarios

All commands pin `k3d-cpt-t6`. `RUN` uniquely identifies one attempt. Before each attempt, set the Deployment environment, wait for rollout, resolve the current Pod, and start `capture-a.sh`.

Negative-first controls:

1. Force-delete a talker Pod without either collector, then confirm both `kubectl logs POD` and `kubectl logs POD --previous` return NotFound.
2. Restart a container twice and confirm `--previous` exposes only the immediately preceding instance, not older instances.

Scenarios:

1. Rolling: stream at 100 lines/s, change `RUN`, and wait for rollout.
2. OOM: set `MODE=oom` and verify `.status.containerStatuses[0].lastState.terminated.reason` is `OOMKilled`.
3. SIGKILL: stream, then `kubectl exec POD -- kill -9 1`; verify restart count increments and reason is `Error`/exit 137, not OOM.
4. Pod deletion: stream, then `kubectl delete pod POD --grace-period=0 --force`.
5. Rotation: set payload to 1000 and rate 0 (unthrottled), run until node log bytes exceed the measured kubelet retention window. Stop A between two reads to measure rotation loss.
6. Collector restart: stream at a fixed rate, delete the Vector Pod and separately interrupt/restart A follow. Reconcile after 15 seconds of quiescence.

For every run, copy `/var/lib/t6-vector/captured.log` from `k3d-cpt-t6-server-0`, retain A's `follow/final/previous/unique` files, and run `analyze.py RUN ...`. Missing IDs, duplicate IDs, maximum ID, pod status, rotated file names/sizes, and disk deltas are raw evidence. A bounded 15-second sink quiescence avoids counting flush latency as loss.

Rate sweep: 100, 1,000, 5,000, 10,000 and unthrottled lines/s for 30 seconds each. The first rate with a repeatable missing ID after quiescence is the loss threshold.
