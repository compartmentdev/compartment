# CLI Distribution

This document captures the source-repository GitHub Releases flow for the CLI.

Standalone CLI install artifacts are published in `compartmentdev/compartment`:

- public self-hosted image publishing is covered by [Self-Hosted Image Publishing](./self-hosted-image-publishing.md);
- Node SEA binaries, `install.sh`, and `checksums.txt` are attached to stable GitHub Releases in this repository;
- the checked-in public `install.sh` defaults to the signed Kubernetes-line OCI artifact from
  `compartmentdev/compartment`;
- stable release `install.sh` assets install the verified CLI release;
- rolling `main` binaries publish after successful main CI under immutable `sha-<commit>` prereleases;
- the installer resolves `install.sh --version main` by reading the current GitHub `main` commit and downloading the matching `sha-<commit>` release, while `install.sh --version sha-<commit>` pins an exact `main` binary.

Stable CLI releases are tag-driven. Release-please maintains one release PR on `main`; merging it updates checked-in versions and `CHANGELOG.md`, creates the semver tag, and may create the GitHub release before the publish workflow runs. The tag workflow edits the existing `vX.Y.Z` draft release or creates it when missing, renders a self-pinned stable `install.sh`, uploads CLI artifacts, `checksums.txt`, and `install.sh` with `--clobber`, publishes the release, then verifies the release attestation and the `install.sh` asset. Published stable releases are immutable and are not prereleases. If the release is already published, the workflow validates the existing asset digests instead of replacing assets.

Stable `checksums.txt` includes the CLI archives and `install.sh`. The checksum file protects installer downloads against accidental corruption; GitHub immutable release verification protects the published release and local asset from post-publication replacement.

Releases created before repository release immutability was enabled are not retroactively attested.

The public installer resolves the current `kubernetes` commit, resolves `ghcr.io/compartmentdev/compartment-cli` to
an immutable digest, and verifies the Cosign certificate identity, GitHub OIDC issuer, and exact workflow SHA before
pulling the platform-specific archive. Stable release installer assets remain pinned to their release version.

## Local Smoke

```bash
pnpm cli:build:sea --distribution-channel source --output-dir ./.compartment/cli-dist
./.compartment/cli-dist/compartment --version
pnpm cli:render:installer --repository compartmentdev/compartment --output ./.compartment/install.sh
```

## Required GitHub Actions Configuration

- repo Actions setting allowing `GITHUB_TOKEN` `contents: write` for release upload jobs;
- repo release immutability enabled so GitHub creates release attestations for published stable releases;
- GitHub CLI 2.81.0 or newer available in the release job for `gh release verify` and `gh release verify-asset`;
- repo secret `RELEASE_PLEASE_APP_ID` with a GitHub App ID installed on this repository with contents, issues, and pull request write permissions;
- repo secret `RELEASE_PLEASE_APP_PRIVATE_KEY` with that GitHub App private key contents.
