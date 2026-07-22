# Self-Hosted Image Publishing

This document captures the internal publication rules for platform images installed by the Helm chart.

GitHub Actions publishes platform images to Docker Hub and GitHub Container Registry as attested OCI indexes:

- successful main CI runs publish immutable `sha-<commit>` images, and update
  mutable `main` only when that commit is still the current `main`;
- pushes to `kubernetes` run the Kubernetes line's CI gates, publish immutable
  `sha-<commit>` images, and update mutable `kubernetes` only when that commit is
  still the current `kubernetes` branch head;
- manual `Publish Self-Hosted Images (SHA)` runs publish only `sha-<commit>` for the selected ref;
- semver tags like `v0.2.0` publish `0.2.0`, and update mutable `latest`
  only when that tag is the newest stable semver tag.

Publishing requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Stable semver tags
come from release-please; the tag publish workflow validates the tag version against
checked-in release metadata before building images.

The `kubernetes` tag is the edge channel for the parallel Kubernetes product line.
It is published to both Docker Hub and GHCR from the branch workflow and is not a
stable release: release-please, semver tags, and `latest` remain part of the release
channel. Use the immutable `sha-<commit>` tag when pinning a specific Kubernetes
line build.

Release-please creates stable GitHub Releases as drafts while forcing immediate
git tag creation. The tag publish workflow uploads CLI archives and checksums to
that draft, then publishes the stable release only after the upload succeeds.

Before pushing a tag, the publish job scans each self-hosted runtime image artifact with Trivy and Docker Scout and fails before publication on fixable high or critical vulnerabilities. The scan does not stop on the first failing image; it reports every failing image before exiting.

The published image artifact set contains exactly the long-running platform services: `api`, `caddy`, `edge`, and `worker`.

Pull request and main CI build or restore the platform image cache once per commit, then feed the same tar archives to k3d e2e and a separate image security gate. The gate scans the immutable `sha-<commit>` refs with the same Trivy and Docker Scout policy before the workflow can pass. Main publish runs only after main CI succeeds for the same commit. Fork pull requests cannot receive Docker Hub credentials, so they run the Trivy gate only; internal pull requests, main CI, and publish workflows keep Docker Scout enabled.

The root `.trivyignore.yaml` is the only allowed suppression point for Trivy self-hosted image scans. Docker Scout has no repository suppression path in the CI or publish gates.

Before promoting Docker Hub tags, the publish job pushes each attested image to a workflow-scoped staging tag, scans that staged image with Trivy and Docker Scout, and only then promotes the same image index to the public `main`, `kubernetes`, `sha-<commit>`, semver, or `latest` tags.

After promoting a tag, the publish job resolves the tag to a concrete image digest and secures each unique runtime image digest:

- publishes Docker Hub image indexes with BuildKit SBOM and SLSA provenance attestations for Docker Scout;
- writes an SPDX JSON SBOM and uploads it as a workflow artifact;
- writes a SLSA v1 provenance predicate and uploads it as a workflow artifact;
- signs each runtime digest with keyless cosign through GitHub OIDC using the new Sigstore bundle format;
- verifies each signed digest inside the publishing workflow with `cosign verify --new-bundle-format` and the expected GitHub Actions issuer/identity before attaching SBOM and provenance attestations;
- attaches the SPDX JSON SBOM as a cosign attestation using the new Sigstore bundle format;
- attaches the SLSA v1 provenance predicate as a cosign `slsaprovenance1` attestation using the new Sigstore bundle format.

Mutable tags such as `main` and `latest` share the same digest signature, SBOM attestation, and provenance attestation as their immutable `sha-<commit>` or semver tag when they resolve to the same digest.

Before every CLI-owned Helm activation, the installer verifies the effective `api`, `worker`, `edge`, and `caddy`
references against this signing policy and passes only the resolved digests to the chart.

## Retry after partial publish

After correcting the credential, registry, or runner failure, rerun only the failed jobs from the original workflow
run and watch that rerun to completion:

```bash
gh run rerun <run-id> --failed
gh run watch <run-id> --exit-status
```

For `main` and `kubernetes` branch-channel publishes, workflow-scoped staging tags may be replaced, a missing immutable
tag in either registry is recreated from the digest scanned by the current run, and an existing immutable tag is
accepted only when it matches that scanned digest. Signing, signature verification, SBOM generation, and provenance
generation may be repeated for the same digest. Mutable channel tags are promoted only after both registries complete
the security steps.

A branch-channel failure after immutable-tag creation can leave that digest unsigned until the rerun reaches the
signing step, but it does not promote the mutable channel tag. Stable release publishing has a different ordering: it
can update semver and `latest` tags before the security step, so operators must treat those tags as incomplete until
the rerun succeeds. In both flows the installer rejects unsigned digests. If a branch-channel rerun reports that an
immutable tag resolves to an unscanned digest, do not delete or retag it; preserve the logs and investigate why the
rebuilt digest differs from the immutable tag.

As a manual fallback only, prepare a release commit locally by updating all workspace package versions and `.release-please-manifest.json` together. Add a matching `CHANGELOG.md` section before pushing the tag when the release needs detailed notes; otherwise the distribution release falls back to generic manual-release notes.

```bash
pnpm release:prepare 0.2.0
```
