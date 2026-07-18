import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = new URL('../../.github/workflows/_platform-k3d-e2e.yml', import.meta.url);
const ciWorkflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);

describe('platform k3d e2e workflow', () => {
  it('runs every isolated shard in a non-fail-fast matrix with shard diagnostics', async () => {
    const workflow = parse(await readFile(workflowPath, 'utf8'));
    const job = workflow.jobs['run-platform-k3d-e2e'];

    expect(job.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: ['managed-install', 'user-flow', 'build-gates'] },
    });
    expect(job.name).toContain('${{ matrix.shard }}');
    const runStep = job.steps.find((step) => step.name === 'Run isolated k3d e2e shard');
    expect(runStep.run).toContain('run-platform-k3d-e2e-shard.mjs "${{ matrix.shard }}"');
    const diagnosticsStep = job.steps.find((step) => step.name === 'Upload shard diagnostics');
    expect(diagnosticsStep.with.name).toContain('${{ matrix.shard }}');
    expect(diagnosticsStep.with.path).toContain('platform-k3d-diagnostics-${{ matrix.shard }}');
  });

  it('keeps the reusable matrix result in the aggregate check:ci gate', async () => {
    const workflow = parse(await readFile(ciWorkflowPath, 'utf8'));
    const aggregateJob = workflow.jobs['check-ci'];

    expect(aggregateJob.needs).toContain('platform-k3d-e2e');
    expect(aggregateJob.steps[0].run).toContain('needs.platform-k3d-e2e.result');
  });
});
