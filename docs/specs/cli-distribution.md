# CLI Distribution

This document captures the source-repository GitHub Releases flow for the CLI.

Standalone CLI install artifacts are published in `compartmentdev/compartment`:

- public self-hosted image publishing is covered by [Self-Hosted Image Publishing](./self-hosted-image-publishing.md);
- Node SEA binaries and `checksums.txt` are attached to GitHub Releases in this repository;
- the same SEA binary can be installed as `/usr/local/bin/compartment-node-agent` by `sudo compartment install`;
- `install.sh` is checked into the source repository and defaults to releases from `compartmentdev/compartment`;
- rolling `main` binaries publish under immutable `sha-<commit>` prereleases, while the `main` prerelease stores a pointer to the latest immutable build;
- the installer resolves `install.sh --version main` to the latest `sha-<commit>` build, and `install.sh --version sha-<commit>` pins an exact `main` binary.

Stable CLI releases are tag-driven. Release-please maintains one release PR on `main`; merging it updates checked-in versions and `CHANGELOG.md`, creates the semver tag, and may create the GitHub release before the publish workflow runs. The tag workflow edits the existing `vX.Y.Z` release or creates it when missing, then uploads CLI artifacts, `checksums.txt`, and the checked-in `install.sh` with `--clobber`. Stable releases are not prereleases.

## Local Smoke

```bash
pnpm cli:build:sea --distribution-channel source --default-registry-image-tag latest --output-dir ./.compartment/cli-dist
./.compartment/cli-dist/compartment --version
pnpm cli:render:installer --repository compartmentdev/compartment --output ./.compartment/install.sh
```

## Required GitHub Actions Configuration

- repo Actions setting allowing `GITHUB_TOKEN` `contents: write` for release upload jobs;
- repo secret `RELEASE_PLEASE_APP_ID` with a GitHub App ID installed on this repository with contents, issues, and pull request write permissions;
- repo secret `RELEASE_PLEASE_APP_PRIVATE_KEY` with that GitHub App private key contents.
