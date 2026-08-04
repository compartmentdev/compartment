import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const channelActionPath = new URL('../../.github/actions/publish-self-hosted-channel/action.yml', import.meta.url);
const mainWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-main.yml', import.meta.url);
const kubernetesWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-kubernetes.yml', import.meta.url);

async function readWorkflow(path) {
  return parse(await readFile(path, 'utf8'));
}

describe('self-hosted publish workflows', () => {
  it('preserves the main workflow-run channel and rolling CLI publication', async () => {
    const workflow = await readWorkflow(mainWorkflowPath);
    const publishJob = workflow.jobs['publish-main-images'];
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish self-hosted image channel');

    expect(workflow.on.workflow_run).toMatchObject({ branches: ['main'], workflows: ['Main CI'] });
    expect(publishJob.if).toContain("workflow_run.conclusion == 'success'");
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishJob['timeout-minutes']).toBe(120);
    expect(publishStep.uses).toBe('./.github/actions/publish-self-hosted-channel');
    expect(publishStep.with).toMatchObject({ channel: 'main', 'publish-sha': '${{ env.PUBLISH_SHA }}' });
    expect(workflow.jobs['build-main-cli'].needs).toBe('publish-main-images');
    expect(workflow.jobs['publish-main-cli'].needs).toBe('build-main-cli');
  });

  it('publishes immutable kubernetes images independently of optional branch gates', async () => {
    const workflow = await readWorkflow(kubernetesWorkflowPath);
    const publishJob = workflow.jobs['publish-kubernetes-images'];
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish self-hosted image channel');
    const optionalJobNames = [
      'select-runner',
      'db-integration',
      'self-hosted-image-cache',
      'self-hosted-image-security-gate',
      'platform-k3d-e2e',
    ];

    expect(workflow.on.push.branches).toEqual(['kubernetes']);
    expect(workflow.jobs).not.toHaveProperty('bare-vm-release-approval');
    for (const jobName of optionalJobNames) {
      expect(workflow.jobs[jobName].if).toBe("${{ vars.KUBERNETES_PUBLISH_RUN_TESTS == 'true' }}");
    }
    expect(publishJob).not.toHaveProperty('needs');
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishJob['timeout-minutes']).toBe(120);
    expect(publishStep.uses).toBe('./.github/actions/publish-self-hosted-channel');
    expect(publishStep.with).toMatchObject({
      channel: 'kubernetes',
      'publish-sha': '${{ github.sha }}',
      'promote-mutable': 'false',
    });
  });

  it('builds and publishes a signed kubernetes CLI OCI artifact for all supported platforms', async () => {
    const workflow = await readWorkflow(kubernetesWorkflowPath);
    const buildJob = workflow.jobs['build-kubernetes-cli'];
    const publishJob = workflow.jobs['publish-kubernetes-cli'];
    const promotionJob = workflow.jobs['promote-kubernetes-release'];
    const buildStep = buildJob.steps.find((step) => step.name === 'Build kubernetes CLI binary');
    const orasStep = publishJob.steps.find((step) => step.name === 'Set up ORAS');
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish immutable CLI artifact');
    const anonymousPullStep = publishJob.steps.find((step) => step.name === 'Verify anonymous CLI artifact pulls');
    const signStep = publishJob.steps.find((step) => step.name === 'Sign and verify CLI artifact');
    const promoteImagesStep = promotionJob.steps.find((step) => step.name === 'Promote mutable kubernetes image tags');
    const promoteStep = promotionJob.steps.find((step) => step.name === 'Promote mutable kubernetes CLI tag');
    const expectedPromotionCondition = `
      \${{
        always() &&
        needs.publish-kubernetes-images.result == 'success' &&
        needs.publish-kubernetes-cli.result == 'success' &&
        (
          (
            vars.KUBERNETES_PUBLISH_RUN_TESTS == 'true' &&
            needs.db-integration.result == 'success' &&
            needs.platform-k3d-e2e.result == 'success' &&
            needs.self-hosted-image-security-gate.result == 'success'
          ) ||
          (
            vars.KUBERNETES_PUBLISH_RUN_TESTS != 'true' &&
            needs.db-integration.result == 'skipped' &&
            needs.platform-k3d-e2e.result == 'skipped' &&
            needs.self-hosted-image-security-gate.result == 'skipped'
          )
        )
      }}
    `
      .trim()
      .replace(/\s+/gu, ' ');

    expect(buildJob.strategy.matrix.include).toEqual([
      { artifact_name: 'compartment-darwin-arm64.tar.gz', runner: 'macos-14' },
      { artifact_name: 'compartment-darwin-x64.tar.gz', runner: 'macos-15-intel' },
      { artifact_name: 'compartment-linux-arm64.tar.gz', runner: 'ubuntu-24.04-arm' },
      { artifact_name: 'compartment-linux-x64.tar.gz', runner: 'ubuntu-24.04' },
    ]);
    expect(buildStep.run).toContain('--distribution-channel kubernetes');
    expect(buildStep.run).toContain('--build-commit-sha "${GITHUB_SHA}"');
    expect(publishJob.needs).toEqual(['build-kubernetes-cli']);
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
    expect(signStep.run).toContain('publish-self-hosted-kubernetes.yml@refs/heads/kubernetes');
    expect(signStep.run).toContain('--certificate-oidc-issuer https://token.actions.githubusercontent.com');
    expect(signStep.run).toContain('--certificate-github-workflow-sha "$PUBLISH_SHA"');
    expect(workflow.jobs['publish-kubernetes-cli'].steps.indexOf(anonymousPullStep)).toBeGreaterThan(
      workflow.jobs['publish-kubernetes-cli'].steps.indexOf(signStep),
    );
    expect(publishJob.steps).not.toContain(promoteStep);
    expect(promotionJob.needs).toEqual([
      'db-integration',
      'platform-k3d-e2e',
      'self-hosted-image-security-gate',
      'publish-kubernetes-images',
      'publish-kubernetes-cli',
    ]);
    expect(promotionJob.if.replace(/\s+/gu, ' ')).toBe(expectedPromotionCondition);
    expect(promoteImagesStep.run).toContain('git/ref/heads/kubernetes');
    expect(promoteImagesStep.run).toContain('current_kubernetes_sha" != "$PUBLISH_SHA');
    expect(promoteImagesStep.run).toContain('compartment-${service}:sha-${PUBLISH_SHA}');
    expect(promoteImagesStep.run).toContain('compartment-${service}:kubernetes');
    expect(promoteStep.run).toContain('git/ref/heads/kubernetes');
    expect(promoteStep.run).toContain('current_kubernetes_sha" != "$PUBLISH_SHA');
    expect(promoteStep.run).toContain('${CLI_REPOSITORY}:kubernetes');
    expect(promotionJob.steps).not.toContainEqual(
      expect.objectContaining({ name: 'Verify supported public installer handoff' }),
    );
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
    expect(pushStep.run).toContain(
      '--image-ref "docker.io/compartmentdev/${image_name}@${scanned_digest_by_service[$service]}"',
    );
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
