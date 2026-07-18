import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowPath = new URL('../../.github/workflows/_platform-k3d-e2e.yml', import.meta.url);
const ciWorkflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const imageSecurityWorkflowPath = new URL(
  '../../.github/workflows/_self-hosted-image-security-gate.yml',
  import.meta.url,
);

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
    const cleanupStep = job.steps.find((step) => step.name === 'Ensure shard cleanup');
    expect(job.env.COMPARTMENT_E2E_KEEP_ON_FAILURE).toContain('vars.COMPARTMENT_E2E_KEEP_ON_FAILURE');
    expect(cleanupStep.if).toContain("env.COMPARTMENT_E2E_KEEP_ON_FAILURE != '1'");
    expect(cleanupStep.env.COMPARTMENT_E2E_CLEANUP_ONLY).toBe('1');
    const finalDiagnosticsStep = job.steps.find((step) => step.name === 'Collect final shard diagnostics');
    expect(finalDiagnosticsStep.if).toContain("steps.cleanup-shard.outcome == 'failure'");
    expect(finalDiagnosticsStep.if).toContain("steps.run-shard.outcome != 'failure'");
    expect(finalDiagnosticsStep.run).toContain('platform-k3d-diagnostics-${{ matrix.shard }}');
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

  it('protects shared cache tags while the image security gate scans them', async () => {
    const workflow = parse(await readFile(imageSecurityWorkflowPath, 'utf8'));
    const job = workflow.jobs['scan-images'];
    const steps = job.steps;
    const acquireIndex = steps.findIndex((step) => step.name === 'Acquire shared image cache lock');
    const scanIndex = steps.findIndex((step) => step.name === 'Check self-hosted image vulnerabilities');
    const releaseIndex = steps.findIndex((step) => step.name === 'Release shared image cache lock');
    const protectedSteps = steps.slice(acquireIndex + 1, releaseIndex);

    expect(acquireIndex).toBeGreaterThan(-1);
    expect(scanIndex).toBeGreaterThan(acquireIndex);
    expect(releaseIndex).toBeGreaterThan(scanIndex);
    expect(job['timeout-minutes']).toBe(75);
    expect(protectedSteps.reduce((total, step) => total + step['timeout-minutes'], 0)).toBeLessThan(30);
    expect(protectedSteps.every((step) => Number.isInteger(step['timeout-minutes']))).toBe(true);
    expect(steps[releaseIndex].if).toContain("steps.acquire-image-cache-lock.outcome == 'success'");
    expect(steps[acquireIndex].run).toContain('manage-platform-image-cache-lock.mjs acquire');
    expect(steps[releaseIndex].run).toContain('manage-platform-image-cache-lock.mjs release');
  });
});
