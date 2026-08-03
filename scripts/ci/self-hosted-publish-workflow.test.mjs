import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const channelActionPath = new URL('../../.github/actions/publish-self-hosted-channel/action.yml', import.meta.url);
const mainWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-main.yml', import.meta.url);
const kubernetesWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-kubernetes.yml', import.meta.url);
const bareVmGateWorkflowPath = new URL('../../.github/workflows/bare-vm-release-gate.yml', import.meta.url);

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
    const approvalJob = workflow.jobs['bare-vm-release-approval'];
    const approvalStep = approvalJob.steps.find(
      (step) => step.name === 'Require a successful protected bare VM gate for this commit',
    );

    expect(approvalJob.needs).toEqual(['publish-kubernetes-cli']);
    expect(approvalStep.run).toContain('bare-vm-release-gate.yml/runs?head_sha=${RELEASE_SHA}');
    expect(approvalStep.run).toContain('event=workflow_dispatch&status=completed');
    expect(publishJob.needs).toEqual(['db-integration', 'platform-k3d-e2e', 'self-hosted-image-security-gate']);
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishJob['timeout-minutes']).toBe(120);
    expect(publishStep.uses).toBe('./.github/actions/publish-self-hosted-channel');
    expect(publishStep.with).toMatchObject({
      channel: 'kubernetes',
      'publish-sha': '${{ github.sha }}',
      'promote-mutable': 'false',
    });
    expect(workflow.jobs['promote-kubernetes-release'].needs).toEqual(['bare-vm-release-approval']);
  });

  it('runs the bare VM gate only on a protected, explicitly designated disposable host', async () => {
    const workflow = await readWorkflow(bareVmGateWorkflowPath);
    const job = workflow.jobs['fresh-vm'];
    const accessStep = job.steps.find((step) => step.name === 'Configure pinned disposable VM access');
    const probesStep = job.steps.find((step) => step.name === 'Probe public and isolated ports externally');
    const statusStep = job.steps.find((step) => step.name === 'Verify resumable install and readiness JSON');
    const deployStep = job.steps.find((step) => step.name === 'Deploy the first application and verify registry pull');
    const resetStep = job.steps.find((step) => step.name === 'Destructively reset the disposable VM');

    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('host');
    expect(job.environment).toBe('bare-vm-release-gate');
    expect(job.env).toEqual({
      FRESH_VM_HOST: '${{ inputs.host }}',
      OWNER_EMAIL: '${{ inputs.owner_email }}',
      OWNER_ORGANIZATION: '${{ inputs.organization }}',
      RELEASE_SHA: '${{ github.sha }}',
    });
    expect(accessStep.env.SSH_KNOWN_HOSTS).toBe('${{ secrets.FRESH_VM_SSH_KNOWN_HOSTS }}');
    expect(accessStep.run).not.toContain('ssh-keyscan');
    expect(probesStep.run).toContain('nmap -Pn -p 2379,2380,6443,10250');
    expect(probesStep.run).toContain('nmap -Pn -sU -p 8472');
    expect(statusStep.run).toContain("jq -e '.host.k3sActive == true");
    const installStep = job.steps.find((step) => step.name === 'Install from the public bootstrap');
    const packagedCliStep = job.steps.find((step) => step.name === 'Verify exact packaged CLI build');
    expect(installStep.run).toContain('--version "sha-${RELEASE_SHA}"');
    expect(packagedCliStep.run).toContain('-kubernetes+');
    expect(deployStep.run).toContain('sudo compartment deploy');
    expect(deployStep.run).toContain('sudo compartment whoami --output json');
    expect(job.steps.some((step) => step.name === 'Verify managed update')).toBe(true);
    expect(job.steps.some((step) => step.name === 'Verify reboot recovery')).toBe(true);
    expect(resetStep.if).toBe('always()');
    expect(resetStep.run).toContain('test ! -e /var/lib/compartment/installer/state.json');

    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toContain("'${{ inputs.host }}'");
    expect(serialized).not.toContain('ssh-keyscan');
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
    const publicInstallerStep = promotionJob.steps.find(
      (step) => step.name === 'Verify supported public installer handoff',
    );

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
    expect(promotionJob.needs).toEqual(['bare-vm-release-approval']);
    expect(promoteImagesStep.run).toContain('compartment-${service}:sha-${PUBLISH_SHA}');
    expect(promoteImagesStep.run).toContain('compartment-${service}:kubernetes');
    expect(promoteStep.run).toContain('git/ref/heads/kubernetes');
    expect(promoteStep.run).toContain('${CLI_REPOSITORY}:kubernetes');
    expect(promoteStep.id).toBe('promote-kubernetes-cli');
    expect(promoteStep.run).toContain('echo \'promoted=false\' >> "$GITHUB_OUTPUT"');
    expect(promoteStep.run).toContain('echo \'promoted=true\' >> "$GITHUB_OUTPUT"');
    expect(promotionJob.steps.indexOf(publicInstallerStep)).toBeGreaterThan(promotionJob.steps.indexOf(promoteStep));
    expect(publicInstallerStep.if).toBe("steps.promote-kubernetes-cli.outputs.promoted == 'true'");
    expect(publicInstallerStep.run).toContain('https://compartment.dev/install.sh');
    expect(publicInstallerStep.run).toMatch(
      /curl -fsSL[\s\S]*--write-out '%\{http_code\}'[\s\S]*https:\/\/compartment\.dev\/install\.sh/u,
    );
    expect(publicInstallerStep.run).toContain('received_sha256=""');
    expect(publicInstallerStep.run).toContain('received_size=""');
    expect(publicInstallerStep.run).toContain('expected_sha256="$(sha256sum install.sh');
    expect(publicInstallerStep.run).toContain('expected_size="$(wc -c < install.sh)"');
    expect(publicInstallerStep.run).toContain('[ "$http_status" = 200 ]');
    expect(publicInstallerStep.run).toMatch(
      /cmp --silent install\.sh \.\/\.compartment\/public-install\.sh; then[\s\S]*expected sha256[\s\S]*received sha256[\s\S]*exit 0/u,
    );
    expect(publicInstallerStep.run).toContain('HTTP 200 served different content');
    expect(publicInstallerStep.run).not.toContain('last_result=redirect');
    expect(publicInstallerStep.run.trimEnd().endsWith('exit 1')).toBe(true);
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
