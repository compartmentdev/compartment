# Secure gVisor build test follow-up

Open a separate small PR after the production fix ships. Reuse the existing dedicated `gvisor-build` shard to prove
that two Dockerfile source deployments create distinct Job and Pod names and UIDs, both execute a real build, and the
second imports registry cache with `CACHED` vertices. Keep Railpack timing and exact cold/warm metrics as manually
collected spike evidence; do not add timing thresholds, a performance benchmark, a new workflow, or another shard.

The follow-up must remain behavior-focused, avoid mocked forwarding and call-order assertions, run only the narrow
existing shard, and preserve the Python ffmpeg fixture without adding a Python benchmark.
