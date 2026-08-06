import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const channelActionPath = new URL('../../.github/actions/publish-self-hosted-channel/action.yml', import.meta.url);
const mainWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-main.yml', import.meta.url);
const releaseWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-release.yml', import.meta.url);

async function readWorkflow(path) {
  return parse(await readFile(path, 'utf8'));
}

describe('self-hosted publish workflows', () => {
  it('archives every canonical runtime image before stable release scanning', async () => {
    const workflow = await readWorkflow(releaseWorkflowPath);
    const buildJob = workflow.jobs['build-release-images'];
    const installStep = buildJob.steps.find((step) => step.name === 'Install dependencies');
    const checkStep = buildJob.steps.find((step) => step.name === 'Check release version files');
    const archiveStep = buildJob.steps.find((step) => step.name === 'Archive self-hosted images');

    expect(installStep.run).toBe('pnpm install --frozen-lockfile');
    expect(buildJob.steps.indexOf(checkStep)).toBeGreaterThan(buildJob.steps.indexOf(installStep));
    expect(archiveStep.run).toContain('node ./scripts/deploy/list-self-hosted-runtime-image-artifacts.mjs');
    expect(archiveStep.run).toContain('compartment-${service}:${{ steps.release.outputs.value }}');
    expect(archiveStep.run).toContain('docker image save "${image_refs[@]}"');
  });

  it('publishes immutable main images from direct main pushes', async () => {
    const workflow = await readWorkflow(mainWorkflowPath);
    const publishJob = workflow.jobs['publish-main-images'];
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish self-hosted image channel');
    expect(workflow.on.push.branches).toEqual(['main']);
    expect(workflow.on).not.toHaveProperty('workflow_run');
    expect(workflow.jobs).not.toHaveProperty('select-runner');
    expect(workflow.jobs).not.toHaveProperty('platform-k3d-e2e');
    expect(publishJob).not.toHaveProperty('needs');
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishJob['timeout-minutes']).toBe(120);
    expect(publishStep.uses).toBe('./.github/actions/publish-self-hosted-channel');
    expect(publishStep.with).toMatchObject({
      channel: 'main',
      'publish-sha': '${{ github.sha }}',
      'promote-mutable': 'false',
    });
  });

  it('builds and publishes a signed main CLI OCI artifact for all supported platforms', async () => {
    const workflow = await readWorkflow(mainWorkflowPath);
    const buildJob = workflow.jobs['build-main-cli'];
    const publishJob = workflow.jobs['publish-main-cli'];
    const promotionJob = workflow.jobs['promote-main-release'];
    const buildStep = buildJob.steps.find((step) => step.name === 'Build main CLI binary');
    const orasStep = publishJob.steps.find((step) => step.name === 'Set up ORAS');
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish immutable CLI artifact');
    const anonymousPullStep = publishJob.steps.find((step) => step.name === 'Verify anonymous CLI artifact pulls');
    const signStep = publishJob.steps.find((step) => step.name === 'Sign and verify CLI artifact');
    const promoteStep = promotionJob.steps.find((step) => step.name === 'Promote mutable main release');
    expect(buildJob.strategy.matrix.include).toEqual([
      { artifact_name: 'compartment-darwin-arm64.tar.gz', runner: 'macos-14' },
      { artifact_name: 'compartment-darwin-x64.tar.gz', runner: 'macos-15-intel' },
      { artifact_name: 'compartment-linux-arm64.tar.gz', runner: 'ubuntu-24.04-arm' },
      { artifact_name: 'compartment-linux-x64.tar.gz', runner: 'ubuntu-24.04' },
    ]);
    expect(buildStep.run).toContain('--distribution-channel main');
    expect(buildStep.run).toContain('--build-commit-sha "${GITHUB_SHA}"');
    expect(publishJob.needs).toEqual(['build-main-cli', 'publish-main-images']);
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(orasStep.uses).toBe('oras-project/setup-oras@1d808f7d7f6995cc68b7bf507bfe5c5446e1dc9d');
    expect(orasStep.with).toEqual({
      url: 'https://github.com/oras-project/oras/releases/download/v1.3.3/oras_1.3.3_linux_amd64.tar.gz',
      checksum: '9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59',
    });
    expect(publishStep.run).toContain('${CLI_REPOSITORY}:sha-${PUBLISH_SHA}');
    expect(publishStep.run).toContain('Immutable CLI artifact ${immutable_ref} already points to');
    expect(anonymousPullStep.run).toContain('--registry-config ./.compartment/anonymous-registry-config.json');
    expect(signStep.run).toContain('cosign sign --yes --new-bundle-format "$digest_ref"');
    expect(signStep.run).toContain('publish-self-hosted-main.yml@refs/heads/main');
    expect(signStep.run).toContain('--certificate-oidc-issuer https://token.actions.githubusercontent.com');
    expect(signStep.run).toContain('--certificate-github-workflow-sha "$PUBLISH_SHA"');
    expect(workflow.jobs['publish-main-cli'].steps.indexOf(anonymousPullStep)).toBeGreaterThan(
      workflow.jobs['publish-main-cli'].steps.indexOf(signStep),
    );
    expect(publishJob.steps).not.toContain(promoteStep);
    expect(promotionJob.needs).toEqual(['publish-main-images', 'publish-main-cli']);
    expect(promotionJob).not.toHaveProperty('if');
    expect(promoteStep.run).toContain('git/ref/heads/main');
    expect(promoteStep.run).toContain('current_main_sha" != "$PUBLISH_SHA');
    expect(promoteStep.run).toContain('compartment-${service}:sha-${PUBLISH_SHA}');
    expect(promoteStep.run).toContain('compartment-${service}:main');
    expect(promoteStep.run).toContain('${CLI_REPOSITORY}:main');
    expect(promoteStep.run.match(/git\/ref\/heads\/main/gu)).toHaveLength(1);
  });

  it('publishes, signs, and verifies both registries through one channel action', async () => {
    const action = await readWorkflow(channelActionPath);
    const pushStep = action.runs.steps.find((step) => step.name === 'Push immutable self-hosted images');
    const secureStep = action.runs.steps.find((step) => step.name === 'Secure self-hosted image digests');
    const mutableStep = action.runs.steps.find((step) => step.name === 'Promote mutable channel tags');
    const cosignStep = action.runs.steps.find((step) => step.name === 'Set up Cosign');

    expect(action.inputs).toMatchObject({
      channel: { required: true },
      'publish-sha': { required: true },
      'promote-mutable': { required: false, default: 'true' },
    });
    expect(action.runs.using).toBe('composite');
    expect(cosignStep.with['cosign-release']).toBe('v2.6.1');
    expect(pushStep.run).toContain('scan_args+=(--image-ref "${scanned_ref_by_service[$service]}")');
    expect(pushStep.run).toContain('--metadata-file "$metadata_file"');
    expect(pushStep.run).toContain('--read-build-metadata-digest "$metadata_file"');
    expect(pushStep.run).toContain('--resolve-scanned-digest');
    expect(pushStep.run).toContain('canonical_ref="$scanned_ref"');
    expect(pushStep.run).toContain('Failed to determine whether immutable image');
    expect(pushStep.run).toContain('docker.io/compartmentdev');
    expect(pushStep.run).toContain('ghcr.io/compartmentdev');
    expect(secureStep.run).toContain('--image-ref "docker.io/compartmentdev/compartment-${service}@${digest}"');
    expect(secureStep.run).toContain('--image-ref "ghcr.io/compartmentdev/compartment-${service}@${digest}"');
    expect(secureStep.run).not.toContain('sha-${PUBLISH_SHA}');
    expect(action.runs.steps.indexOf(mutableStep)).toBeGreaterThan(action.runs.steps.indexOf(secureStep));
    expect(mutableStep.run).toContain('git/ref/heads/${CHANNEL}');
    expect(mutableStep.run).toContain('current_channel_sha" != "$PUBLISH_SHA');
    expect(mutableStep.run).toContain('docker.io/compartmentdev/compartment-${service}:${CHANNEL}');
    expect(mutableStep.run).toContain('ghcr.io/compartmentdev/compartment-${service}:${CHANNEL}');
    expect(mutableStep.if).toBe("inputs.promote-mutable == 'true'");
  });
});
