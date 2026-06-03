# Node Layer

Owns:

- runtime node process assembly;
- node registration behavior;
- node liveness surface;
- runtime deploy, inspect, stop, and logs control for local Docker workloads;
- runtime-network reconciliation for `caddy` and workload/resource networks;
- host node-agent socket lifecycle.

May depend on:

- `contracts`;
- `docker`;
- `sdk`.
- `utils`.

Must not:

- reach into `api` internals;
- re-implement request building already owned by `sdk`;
- mix runtime control with public browser ingress or hosted-app auth gating.

Change checklist:

- keep app assembly thin;
- node-to-control-plane communication goes through `sdk`;
- keep public browser entry and app proxy behavior out of `node`;
- bind node control traffic only through `COMPARTMENT_NODE_AGENT_SOCKET`;
- keep the canonical self-hosted agent socket at `/var/run/compartment/node/agent.sock`;
- reject socket paths directly under shared runtime roots such as `/tmp`, `/run`, `/var/run`, or `/var/run/compartment`;
- prepare host node-agent socket directories as `root:compartment-runtime` `0750` directories and sockets as
  `root:compartment-runtime` `0660` so self-hosted API and worker containers can connect without running as root;
- treat service runtime networks as egress-only from runtime containers;
- fail closed when `node` cannot resolve the required `caddy` runtime-network actor;
- if behavior is just scaffolding and only tested locally, treat it as dead runtime code.
