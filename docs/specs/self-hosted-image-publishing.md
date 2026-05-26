# Self-Hosted Image Publishing

This document captures the internal publication rules for self-hosted runtime images.

GitHub Actions publishes Docker Hub self-hosted images as attested OCI indexes. Generated runtime refs use `docker.io/compartmentdev`; GHCR remains a compatibility target during registry migration:

- pushes to `main` publish `main` and `sha-<commit>`;
- manual `Publish Self-Hosted Images (SHA)` runs publish only `sha-<commit>` for the selected ref;
- semver tags like `v0.2.0` publish `0.2.0` and `latest`.

Publishing requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Stable semver tags
come from release-please; the tag publish workflow validates the tag version against
checked-in release metadata before building images.

The published image artifact set includes the long-running runtime services (`api`, `caddy`, `edge`, `worker`) and the one-shot `runtime-probe` image used by the node agent for readiness and network probes.

Pull request CI scans the locally built or restored self-hosted test images with Trivy before those images are used by the self-hosted e2e jobs. That CI-only scan fails on fixable high or critical vulnerabilities.

The root `.trivyignore.yaml` is the only allowed suppression point for self-hosted image scans. Current suppressions must include a statement and be scoped to the affected binary path.

Before promoting Docker Hub tags, the publish job pushes each attested image to a workflow-scoped staging tag, scans every staged image with Docker Scout, and only then promotes the same image index to the public `main`, `sha-<commit>`, semver, or `latest` tags. The Scout gate fails only on fixable high or critical vulnerabilities. It does not gate on base image recommendation or policy results.

After promoting a tag, the publish job resolves the tag to a concrete image digest and secures each unique runtime image digest:

- publishes Docker Hub image indexes with BuildKit SBOM and SLSA provenance attestations for Docker Scout;
- writes an SPDX JSON SBOM and uploads it as a workflow artifact;
- writes a SLSA v1 provenance predicate and uploads it as a workflow artifact;
- signs each runtime digest with keyless cosign through GitHub OIDC using the new Sigstore bundle format;
- verifies each signed digest with `cosign verify --new-bundle-format` and the GitHub Actions issuer/identity used by the runtime verifier before attaching SBOM and provenance attestations;
- attaches the SPDX JSON SBOM as a cosign attestation using the new Sigstore bundle format;
- attaches the SLSA v1 provenance predicate as a cosign `slsaprovenance1` attestation using the new Sigstore bundle format.

Mutable tags such as `main` and `latest` share the same digest signature, SBOM attestation, and provenance attestation as their immutable `sha-<commit>` or semver tag when they resolve to the same digest.

The CLI resolves registry-sourced Compartment runtime image tags to digests, verifies the digest signatures before pulling, pulls the verified digests, tags them locally for Compose, and verifies pulled local digests before starting containers. Verification trusts only keyless signatures issued by GitHub Actions for `compartmentdev/compartment` on the `publish-self-hosted-main.yml` and `publish-self-hosted-release.yml` workflows. During the workflow rename transition, the verifier also accepts the previous publishing workflow identity for already-published digests so mutable tags do not fail solely because their digest was signed before the rename. Local image installs skip registry signature verification.

As a manual fallback only, prepare a release commit locally by updating all workspace package versions, `.env.self-hosted.example`, and `.release-please-manifest.json` together. Add a matching `CHANGELOG.md` section before pushing the tag when the release needs detailed notes; otherwise the distribution release falls back to generic manual-release notes.

```bash
pnpm release:prepare 0.2.0
```
