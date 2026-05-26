import { describe, expect, it } from 'vitest';

import { findForkPullRequestRunnerValidationErrors } from './check-fork-pr-runners.mjs';

describe('findForkPullRequestRunnerValidationErrors', () => {
  it('allows runner labels selected by reusable workflow inputs', () => {
    const content = `
name: reusable
jobs:
  e2e:
    runs-on: \${{ fromJson(inputs.runner_labels_json) }}
    steps: []
`;

    expect(findForkPullRequestRunnerValidationErrors('.github/workflows/reusable.yml', content)).toEqual([]);
  });

  it('rejects multiline self-hosted runs-on labels', () => {
    const content = `
name: bad
jobs:
  deploy:
    runs-on:
      - self-hosted
      - ubuntu-24.04
    steps: []
`;

    expect(findForkPullRequestRunnerValidationErrors('.github/workflows/bad.yml', content)).toEqual([
      '.github/workflows/bad.yml: job "deploy" must not hard-code self-hosted runner label "self-hosted" in runs-on.',
    ]);
  });

  it('rejects self-hosted labels routed through a matrix runner', () => {
    const content = `
name: bad
jobs:
  cli:
    strategy:
      matrix:
        include:
          - artifact_name: compartment-linux-x64.tar.gz
            runner:
              - self-hosted
              - compartment-ci-deploy-e2e
    runs-on: \${{ matrix.runner }}
    steps: []
`;

    expect(findForkPullRequestRunnerValidationErrors('.github/workflows/bad.yml', content)).toEqual([
      '.github/workflows/bad.yml: job "cli" must not route runs-on through matrix reference "runner" to self-hosted runner label "self-hosted".',
      '.github/workflows/bad.yml: job "cli" must not route runs-on through matrix reference "runner" to self-hosted runner label "compartment-ci-deploy-e2e".',
    ]);
  });

  it('allows hosted matrix runners', () => {
    const content = `
name: ok
jobs:
  cli:
    strategy:
      matrix:
        include:
          - artifact_name: compartment-linux-x64.tar.gz
            runner: ubuntu-24.04
          - artifact_name: compartment-darwin-arm64.tar.gz
            runner: macos-14
    runs-on: \${{ matrix.runner }}
    steps: []
`;

    expect(findForkPullRequestRunnerValidationErrors('.github/workflows/ok.yml', content)).toEqual([]);
  });
});
