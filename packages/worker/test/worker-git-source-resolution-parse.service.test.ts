import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compartmentRoutesFileName,
  readGitSourceDescriptorProjectMismatchMessage,
  type CompartmentAuthoredDescriptor,
} from '@compartment/contracts';
import {
  readGitSourceDescriptorFiles,
  requireMatchingDescriptorProjectName,
} from '../src/services/worker-git-source-resolution-parse.service';
import * as workerGitSourceYamlService from '../src/services/worker-git-source-yaml.service';

const tempDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

describe('worker git source resolution parse service', (): void => {
  it('treats missing descriptors as non-retryable', async (): Promise<void> => {
    const repositoryRoot: string = await createRepositoryFixture({});

    await expect(readGitSourceDescriptorFiles(repositoryRoot, 'apps/billing/compartment.yml')).rejects.toMatchObject({
      message: 'Descriptor apps/billing/compartment.yml was not found on the source branch.',
      name: 'NonRetryableGitSourceResolutionError',
    });
  });

  it('treats invalid descriptor yaml as non-retryable', async (): Promise<void> => {
    const repositoryRoot: string = await createRepositoryFixture({
      'apps/billing/compartment.yml': 'name: billing:\nservices:\n  web: .\n',
    });

    await expect(readGitSourceDescriptorFiles(repositoryRoot, 'apps/billing/compartment.yml')).rejects.toMatchObject({
      name: 'NonRetryableGitSourceResolutionError',
      retryable: false,
    });
  });

  it('treats invalid routes yaml as non-retryable', async (): Promise<void> => {
    const repositoryRoot: string = await createRepositoryFixture({
      [`apps/billing/${compartmentRoutesFileName}`]: 'routes:\n  - path: /\n    target:\n',
      'apps/billing/compartment.yml': 'name: billing\nservices:\n  web: .\n',
    });

    await expect(readGitSourceDescriptorFiles(repositoryRoot, 'apps/billing/compartment.yml')).rejects.toMatchObject({
      name: 'NonRetryableGitSourceResolutionError',
      retryable: false,
    });
  });

  it('treats descriptor project-name mismatches as non-retryable', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = {
      name: 'billing-renamed',
      services: {
        web: '.',
      },
    };

    expect((): void => {
      requireMatchingDescriptorProjectName(descriptor, 'billing', 'apps/billing/compartment.yml');
    }).toThrow(
      readGitSourceDescriptorProjectMismatchMessage('apps/billing/compartment.yml', 'billing-renamed', 'billing'),
    );
  });

  it('rethrows unexpected parser failures as retryable internal errors', async (): Promise<void> => {
    vi.spyOn(workerGitSourceYamlService, 'parseGitSourceYaml').mockImplementation((): never => {
      throw new Error('Unexpected parser bug.');
    });
    const repositoryRoot: string = await createRepositoryFixture({
      'apps/billing/compartment.yml': 'name: billing\nservices:\n  web: .\n',
    });

    await expect(readGitSourceDescriptorFiles(repositoryRoot, 'apps/billing/compartment.yml')).rejects.toThrow(
      'Unexpected parser bug.',
    );
  });
});

async function createRepositoryFixture(files: Record<string, string>): Promise<string> {
  const repositoryRoot: string = await mkdtemp(join(tmpdir(), 'compartment-worker-git-source-parse-'));
  tempDirectories.push(repositoryRoot);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]: [string, string]): Promise<void> => {
      const filePath: string = join(repositoryRoot, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
    }),
  );

  return repositoryRoot;
}
