import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const workflowPath = new URL('../../.github/workflows/_self-hosted-image-cache.yml', import.meta.url);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('self-hosted image cache workflow', () => {
  it('creates the cache directory before saving images on a cache miss', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'compartment-image-cache-workflow-'));
    const binaryDirectory = join(workspace, 'bin');
    temporaryDirectories.push(workspace);
    await mkdir(binaryDirectory);
    await writeFile(
      join(binaryDirectory, 'docker'),
      `#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
const outputIndex = process.argv.indexOf('--output');
await writeFile(process.argv[outputIndex + 1], '');
`,
      { mode: 0o755 },
    );

    const workflow = parse(await readFile(workflowPath, 'utf8'));
    const saveStep = workflow.jobs['build-and-check-images'].steps.find((step) => step.run?.includes('docker save'));
    expect(saveStep).toBeDefined();

    await execFileAsync('bash', ['-e', '-c', saveStep.run.replaceAll('${{ github.sha }}', 'fixture-sha')], {
      cwd: workspace,
      env: { ...process.env, PATH: `${binaryDirectory}:${process.env.PATH}` },
    });

    await expect(
      Promise.all(
        ['api', 'caddy', 'dns01-solver', 'edge', 'worker'].map((service) =>
          readFile(join(workspace, '.compartment', 'self-hosted-image-cache', `${service}.tar`)),
        ),
      ),
    ).resolves.toHaveLength(5);
  });
});
