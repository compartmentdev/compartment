# T1 rolling deployment scenarios

All commands are pinned to `k3d-cpt-t1`. The initial bench deployment is
recreated once because server-side apply cannot remove fields owned by the
bench fixture's client-side manager. Every subsequent apply uses field manager
`t1`.

```bash
spike/env/doctor.sh
spike/env/up.sh t1
spike/bench/deploy.sh k3d-cpt-t1
kubectl --context k3d-cpt-t1 -n compartment-bench delete deployment bench-web bench-ws
spike/t1/build-and-apply.sh k3d-cpt-t1
```

The tested rollout spec is in `manifests/base.yaml`. Variant specs are produced
without persistent copies:

```bash
# Ready v2
sed 's/value: v1/value: v2/g' spike/t1/manifests/base.yaml |
  kubectl --context k3d-cpt-t1 apply --server-side --field-manager=t1 --force-conflicts -f -

# NotReady v2
sed -e 's/value: v1/value: v2/g' -e "s/value: 'true'/value: 'false'/g" \
  spike/t1/manifests/base.yaml |
  kubectl --context k3d-cpt-t1 apply --server-side --field-manager=t1 --force-conflicts -f -

# Restore the saved active spec after any failed rollout
kubectl --context k3d-cpt-t1 apply --server-side --field-manager=t1 \
  --force-conflicts -f spike/t1/manifests/base.yaml
```

Use the repository clients for load and WebSockets:

```bash
spike/bench/load.sh k3d-cpt-t1 70 200 0
spike/bench/ws.sh k3d-cpt-t1 50 70
```

For the release gate, delete any previous Job, apply
`manifests/release-job-fail.yaml`, wait for completion, and only apply the
Deployment after a successful wait. A failed wait must stop the command chain.

For OOM, apply the ready v2 variant with the web memory limit changed from
`128Mi` to `64Mi`, wait until rollout completes, then request `/oom` through
the Kubernetes service proxy while `load.sh` runs.

Always clean up only this track:

```bash
spike/env/down.sh t1
```
