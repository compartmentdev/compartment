import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const reusableWorkflowPath = new URL('../../.github/workflows/_publish-self-hosted-channel.yml', import.meta.url);
const mainWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-main.yml', import.meta.url);
const kubernetesWorkflowPath = new URL('../../.github/workflows/publish-self-hosted-kubernetes.yml', import.meta.url);

async function readWorkflow(path) {
  return parse(await readFile(path, 'utf8'));
}

describe('self-hosted publish workflows', () => {
  it('preserves the main workflow-run channel and rolling CLI publication', async () => {
    const workflow = await readWorkflow(mainWorkflowPath);
    const publishJob = workflow.jobs['publish-main-images'];

    expect(workflow.on.workflow_run).toMatchObject({ branches: ['main'], workflows: ['Main CI'] });
    expect(publishJob.if).toContain("workflow_run.conclusion == 'success'");
    expect(publishJob.uses).toBe('./.github/workflows/_publish-self-hosted-channel.yml');
    expect(publishJob.with).toEqual({
      channel: 'main',
      publish_sha: '${{ github.event.workflow_run.head_sha }}',
    });
    expect(workflow.jobs['build-main-cli'].needs).toBe('publish-main-images');
    expect(workflow.jobs['publish-main-cli'].needs).toBe('build-main-cli');
  });

  it('publishes kubernetes only after its branch CI gates pass', async () => {
    const workflow = await readWorkflow(kubernetesWorkflowPath);
    const publishJob = workflow.jobs['publish-kubernetes-images'];

    expect(workflow.on.push.branches).toEqual(['kubernetes']);
    expect(publishJob.needs).toEqual(['db-integration', 'platform-k3d-e2e', 'self-hosted-image-security-gate']);
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(publishJob.uses).toBe('./.github/workflows/_publish-self-hosted-channel.yml');
    expect(publishJob.with).toEqual({ channel: 'kubernetes', publish_sha: '${{ github.sha }}' });
  });

  it('publishes, signs, and verifies both registries through one channel workflow', async () => {
    const workflow = await readWorkflow(reusableWorkflowPath);
    const publishJob = workflow.jobs['publish-images'];
    const pushStep = publishJob.steps.find((step) => step.name === 'Push self-hosted images');
    const secureStep = publishJob.steps.find((step) => step.name === 'Secure self-hosted image digests');
    const cosignStep = publishJob.steps.find((step) => step.name === 'Set up Cosign');

    expect(workflow.on.workflow_call.inputs).toMatchObject({
      channel: { required: true, type: 'string' },
      publish_sha: { required: true, type: 'string' },
    });
    expect(workflow.on.workflow_call.secrets).toMatchObject({
      DOCKERHUB_TOKEN: { required: true },
      DOCKERHUB_USERNAME: { required: true },
    });
    expect(publishJob.permissions).toEqual({ contents: 'read', 'id-token': 'write', packages: 'write' });
    expect(cosignStep.with['cosign-release']).toBe('v2.6.1');
    expect(pushStep.run).toContain('git/ref/heads/${CHANNEL}');
    expect(pushStep.run).toContain('docker.io/compartmentdev');
    expect(pushStep.run).toContain('ghcr.io/compartmentdev');
    expect(secureStep.run).toContain('--repository-prefix docker.io/compartmentdev');
    expect(secureStep.run).toContain('--repository-prefix ghcr.io/compartmentdev');
  });
});
