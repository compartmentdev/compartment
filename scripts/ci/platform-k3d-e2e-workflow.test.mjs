import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { platformK3dShardDefinitions, platformK3dShardNames } from '../deploy/platform-k3d-e2e-shards.mjs';
import { readSelfHostedBuildMatrixPartition } from '../../packages/cli/test/self-hosted-build-matrix-partitions';

const workflowPath = new URL('../../.github/workflows/_platform-k3d-e2e.yml', import.meta.url);
const ciWorkflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const imageSecurityWorkflowPath = new URL(
  '../../.github/workflows/_self-hosted-image-security-gate.yml',
  import.meta.url,
);

function readKubernetesMinor(version) {
  const match = /v1\.(?<minor>\d+)\./u.exec(version);

  expect(match?.groups?.minor).toBeDefined();

  return Number(match.groups.minor);
}

describe('platform k3d e2e workflow', () => {
  it('runs every isolated shard in a non-fail-fast matrix with shard diagnostics', async () => {
    const workflow = parse(await readFile(workflowPath, 'utf8'));
    const job = workflow.jobs['run-platform-k3d-e2e'];

    expect(job.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: platformK3dShardNames },
    });
    expect(job.name).toContain('${{ matrix.shard }}');
    expect(job.env.COMPARTMENT_E2E_GVISOR_ENABLED).toBeUndefined();
    expect(platformK3dShardDefinitions['gvisor-build']).toMatchObject({
      buildMatrixPartition: 'gvisor',
      gvisorEnabled: true,
      suites: ['install', 'build-matrix'],
    });
    expect(Object.values(platformK3dShardDefinitions).every((definition) => definition.gvisorEnabled)).toBe(true);
    const buildMatrixShards = Object.values(platformK3dShardDefinitions).filter(
      (definition) => definition.suites.includes('build-matrix') && definition.buildMatrixPartition !== 'gvisor',
    );
    expect(buildMatrixShards).toHaveLength(5);
    expect(buildMatrixShards.every((definition) => definition.suites.join(',') === 'bootstrap,build-matrix')).toBe(
      true,
    );
    expect(buildMatrixShards.map((definition) => definition.buildMatrixPartition).toSorted()).toEqual([
      'a-1',
      'a-2',
      'b-1',
      'b-2',
      'b-3',
    ]);
    for (const definition of Object.values(platformK3dShardDefinitions)) {
      if (definition.buildMatrixPartition !== undefined) {
        expect(readSelfHostedBuildMatrixPartition(definition.buildMatrixPartition)).toBeDefined();
      }
    }
    const toolInstallStep = job.steps.find(
      (step) => step.name === 'Install pinned k3d, kubectl, Helm, and helm-unittest',
    );
    const k3sMinor = readKubernetesMinor(job.env.COMPARTMENT_E2E_K3S_IMAGE);
    const kubectlMinor = readKubernetesMinor(toolInstallStep.env.KUBECTL_VERSION);

    expect(Math.abs(k3sMinor - kubectlMinor)).toBeLessThanOrEqual(1);
    expect(toolInstallStep.env.KUBECTL_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(toolInstallStep.run).toContain('helm plugin install');
    expect(toolInstallStep.run).toContain('https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl');
    expect(toolInstallStep.run).toContain('k3d version');
    expect(toolInstallStep.run).toContain('kubectl version --client');
    expect(toolInstallStep.run).toContain('helm version');
    const gvisorInstallStep = job.steps.find((step) => step.name === 'Install pinned gVisor');
    expect(gvisorInstallStep.if).toBeUndefined();
    expect(gvisorInstallStep.env.GVISOR_VERSION).toMatch(/^release\/\d{8}\.\d+$/);
    expect(gvisorInstallStep.run).toContain('gvisor.tar.bz2');
    expect(gvisorInstallStep.run).toContain('sha256sum --check');
    expect(gvisorInstallStep.run).toContain('/usr/bin/runsc');
    expect(gvisorInstallStep.run).toContain('/usr/bin/containerd-shim-runsc-v1');
    expect(gvisorInstallStep.run).toContain('/usr/bin/gvisor-bin');
    expect(gvisorInstallStep.run).toContain('checkpointgofer');
    expect(gvisorInstallStep.run).toContain('runsc-metric-server');
    expect(gvisorInstallStep.run).toContain('/etc/containerd/runsc.toml');
    expect(gvisorInstallStep.run).toContain('runsc --version');
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
