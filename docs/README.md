# Docs

Internal documentation for this repository.

The repo keeps three internal doc families:

- `docs/layers/`: package boundaries and ownership rules.
- `docs/specs/`: internal design, decision, and behavior docs, including shipped architecture decisions and future-facing proposals when they still matter.
- package-local docs: specs or runbooks that belong to one package and should move with it.

## Operational Specs

- [specs/local-development.md](./specs/local-development.md): local prerequisites and `pnpm dev` behavior.
- [specs/k8s-runtime.md](./specs/k8s-runtime.md): Kubernetes runtime and provisioning architecture.
- [specs/self-hosted-image-publishing.md](./specs/self-hosted-image-publishing.md): self-hosted image tag and release rules.
- [specs/cli-distribution.md](./specs/cli-distribution.md): private-source to public-installer distribution flow.

## Canonical Files

- [layers/README.md](./layers/README.md): index for package boundary docs.
- [specs/local-development.md](./specs/local-development.md): local prerequisites and repo runtime boot notes.
- [specs/k8s-runtime.md](./specs/k8s-runtime.md): Kubernetes runtime and provisioning contract.
- [specs/self-hosted-image-publishing.md](./specs/self-hosted-image-publishing.md): self-hosted image publication rules.
- [specs/cli-distribution.md](./specs/cli-distribution.md): CLI distribution pipeline and constraints.
- [specs/system-architecture.md](./specs/system-architecture.md): durable runtime, auth, ingress, and deployment invariants.
- [specs/type-placement.md](./specs/type-placement.md): package-local type ownership and placement rules.
- [specs/compartment-yaml.md](./specs/compartment-yaml.md): durable descriptor ownership and non-goals.
- [specs/compartment-routes.md](./specs/compartment-routes.md): durable browser-routing scope and ingress policy split.
- [specs/managed-platform-domains.md](./specs/managed-platform-domains.md): install-level domain ownership and invariants.
- [specs/app-custom-domains.md](./specs/app-custom-domains.md): app-level custom-domain behavior and ownership split.
- [specs/stateful-resources.md](./specs/stateful-resources.md): resource lifecycle, safety, and non-goals.
- [specs/variables.md](./specs/variables.md): runtime-variable scope, precedence, security model, and non-goals.
- [specs/git-sources.md](./specs/git-sources.md): Git-source coexistence, ownership split, and adoption rules.

If a behavior is not covered by these files and is not present in contracts or runtime code, treat it as not part of the documented current surface.
