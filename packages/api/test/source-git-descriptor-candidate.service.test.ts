import type { GitDescriptorCandidate } from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import { buildDescriptorCandidates } from '../src/services/git-source/git-source-descriptor-candidate.service';
import type { GitHubRepositoryTreeEntry } from '../src/services/git-source/github-app-client.adapter.types';

describe('git source descriptor candidates', (): void => {
  it('builds a starter-app candidate when the repository only has metadata files', (): void => {
    const [candidate] = buildDescriptorCandidates('internal-tools', [blob('README.md'), blob('.gitignore')]);

    expect(candidate).toMatchObject({
      appFolder: '.',
      descriptorPath: 'compartment.yml',
      files: [
        expect.objectContaining({
          path: 'compartment.yml',
        }),
        expect.objectContaining({
          path: 'apps/site/index.html',
        }),
      ],
      packageJsonPath: null,
      projectName: 'internal-tools',
    });
    expect(candidate?.files[0]?.content).toContain('kind: static');
    expect(candidate?.files[0]?.content).toContain('outputDirectory: apps/site');
    expect(candidate?.files[1]?.content).toContain('Hello, this is your first Compartment app.');
  });

  it('keeps descriptor-only candidates when app markers already exist', (): void => {
    const [candidate] = buildDescriptorCandidates('internal-tools', [blob('package.json')]);

    expect(candidate).toMatchObject({
      appFolder: '.',
      descriptorPath: 'compartment.yml',
      files: [
        {
          content: 'name: internal-tools\n\nservices:\n  web: .\n',
          path: 'compartment.yml',
        },
      ],
      packageJsonPath: 'package.json',
      projectName: 'internal-tools',
    });
  });

  it('does not enter starter mode when the repository already has an HTML entrypoint', (): void => {
    const [candidate] = buildDescriptorCandidates('internal-tools', [blob('index.html')]);

    expect(candidate?.files).toEqual([
      {
        content: 'name: internal-tools\n\nservices:\n  web: .\n',
        path: 'compartment.yml',
      },
    ]);
  });

  it('keeps starter mode for GitHub-only metadata under .github', (): void => {
    const [candidate] = buildDescriptorCandidates('internal-tools', [
      blob('README.md'),
      blob('.github/workflows/ci.yml'),
    ]);

    expect(candidate?.files.map((file: { path: string }): string => file.path)).toEqual([
      'compartment.yml',
      'apps/site/index.html',
    ]);
  });

  it('does not enter starter mode when the repository already has root source files', (): void => {
    const [candidate] = buildDescriptorCandidates('internal-tools', [blob('app.py')]);

    expect(candidate?.files).toEqual([
      {
        content: 'name: internal-tools\n\nservices:\n  web: .\n',
        path: 'compartment.yml',
      },
    ]);
  });

  it('orders package.json app folder candidates by root, apps, then services', (): void => {
    const candidates: GitDescriptorCandidate[] = buildDescriptorCandidates('mono', [
      blob('services/api/package.json'),
      blob('apps/web/package.json'),
      blob('package.json'),
    ]);

    expect(
      candidates.map(
        (candidate: GitDescriptorCandidate): Pick<GitDescriptorCandidate, 'appFolder' | 'packageJsonPath'> => ({
          appFolder: candidate.appFolder,
          packageJsonPath: candidate.packageJsonPath,
        }),
      ),
    ).toEqual([
      { appFolder: '.', packageJsonPath: 'package.json' },
      { appFolder: 'apps/web', packageJsonPath: 'apps/web/package.json' },
      { appFolder: 'services/api', packageJsonPath: 'services/api/package.json' },
    ]);
  });
});

function blob(path: string): GitHubRepositoryTreeEntry {
  return {
    path,
    type: 'blob',
  };
}
