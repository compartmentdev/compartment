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

  it('publishes kubernetes only after its branch CI gates pass', async () => {
    const workflow = await readWorkflow(kubernetesWorkflowPath);
    const publishJob = workflow.jobs['publish-kubernetes-images'];
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish self-hosted image channel');

    expect(workflow.on.push.branches).toEqual(['kubernetes']);
    expect(publishJob.needs).toEqual(['db-integration', 'platform-k3d-e2e', 'self-hosted-image-security-gate']);
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishJob['timeout-minutes']).toBe(120);
    expect(publishStep.uses).toBe('./.github/actions/publish-self-hosted-channel');
    expect(publishStep.with).toMatchObject({ channel: 'kubernetes', 'publish-sha': '${{ github.sha }}' });
  });

  it('builds and publishes a signed kubernetes CLI OCI artifact for all supported platforms', async () => {
    const workflow = await readWorkflow(kubernetesWorkflowPath);
    const buildJob = workflow.jobs['build-kubernetes-cli'];
    const publishJob = workflow.jobs['publish-kubernetes-cli'];
    const buildStep = buildJob.steps.find((step) => step.name === 'Build kubernetes CLI binary');
    const publishStep = publishJob.steps.find((step) => step.name === 'Publish immutable CLI artifact');
    const anonymousPullStep = publishJob.steps.find((step) => step.name === 'Enable anonymous CLI artifact pulls');
    const signStep = publishJob.steps.find((step) => step.name === 'Sign and verify CLI artifact');
    const promoteStep = publishJob.steps.find((step) => step.name === 'Promote mutable kubernetes CLI tag');

    expect(buildJob.strategy.matrix.include).toEqual([
      { artifact_name: 'compartment-darwin-arm64.tar.gz', runner: 'macos-14' },
      { artifact_name: 'compartment-darwin-x64.tar.gz', runner: 'macos-15-intel' },
      { artifact_name: 'compartment-linux-arm64.tar.gz', runner: 'ubuntu-24.04-arm' },
      { artifact_name: 'compartment-linux-x64.tar.gz', runner: 'ubuntu-24.04' },
    ]);
    expect(buildStep.run).toContain('--distribution-channel kubernetes');
    expect(buildStep.run).toContain('--build-commit-sha "${GITHUB_SHA}"');
    expect(publishJob.needs).toEqual(['build-kubernetes-cli', 'publish-kubernetes-images']);
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishStep.run).toContain('${CLI_REPOSITORY}:sha-${PUBLISH_SHA}');
    expect(publishStep.run).toContain('Immutable CLI artifact ${immutable_ref} already points to');
    expect(anonymousPullStep.run).toContain('--field visibility=public');
    expect(anonymousPullStep.run).toContain('--registry-config ./.compartment/anonymous-registry-config.json');
    expect(signStep.run).toContain('cosign sign --yes --new-bundle-format "$digest_ref"');
    expect(signStep.run).toContain('publish-self-hosted-kubernetes.yml@refs/heads/kubernetes');
    expect(signStep.run).toContain('--certificate-oidc-issuer https://token.actions.githubusercontent.com');
    expect(workflow.jobs['publish-kubernetes-cli'].steps.indexOf(anonymousPullStep)).toBeGreaterThan(
      workflow.jobs['publish-kubernetes-cli'].steps.indexOf(signStep),
    );
    expect(workflow.jobs['publish-kubernetes-cli'].steps.indexOf(promoteStep)).toBeGreaterThan(
      workflow.jobs['publish-kubernetes-cli'].steps.indexOf(signStep),
    );
    expect(promoteStep.run).toContain('git/ref/heads/kubernetes');
    expect(promoteStep.run).toContain('${CLI_REPOSITORY}:kubernetes');
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
    });
    expect(action.runs.using).toBe('composite');
    expect(cosignStep.with['cosign-release']).toBe('v2.6.1');
    expect(pushStep.run).toContain('Immutable registries disagree for ${image_name}');
    expect(pushStep.run).toContain('canonical_ref="$ghcr_ref"');
    expect(pushStep.run).toContain('Failed to determine whether immutable image');
    expect(pushStep.run).toContain('docker.io/compartmentdev');
    expect(pushStep.run).toContain('ghcr.io/compartmentdev');
    expect(secureStep.run).toContain('--repository-prefix docker.io/compartmentdev');
    expect(secureStep.run).toContain('--repository-prefix ghcr.io/compartmentdev');
    expect(action.runs.steps.indexOf(mutableStep)).toBeGreaterThan(action.runs.steps.indexOf(secureStep));
    expect(mutableStep.run).toContain('git/ref/heads/${CHANNEL}');
    expect(mutableStep.run).toContain('current_channel_sha" != "$PUBLISH_SHA');
    expect(mutableStep.run).toContain('docker.io/compartmentdev/compartment-${service}:${CHANNEL}');
    expect(mutableStep.run).toContain('ghcr.io/compartmentdev/compartment-${service}:${CHANNEL}');
  });
});
