import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../src/command-runner';
import { readLocalGitSourcePlan } from '../src/services/source-git-local.service';
import type { LocalGitSourcePlan } from '../src/services/source-git-local.service.types';

vi.mock('../src/command-runner');

describe('local Git remote parsing', (): void => {
  beforeEach((): void => {
    vi.mocked(runCommand).mockReset();
  });

  it.each<RemoteCase>([
    {
      remoteUrl: 'https://gitlab.com/group/sub/project.git',
      providerHost: 'gitlab.com',
      repositoryOwner: 'group/sub',
      repositoryName: 'project',
    },
    {
      remoteUrl: 'ssh://git@gitlab.com/group/sub/project.git',
      providerHost: 'gitlab.com',
      repositoryOwner: 'group/sub',
      repositoryName: 'project',
    },
    {
      remoteUrl: 'ssh://git@GitLab.Example.com:2222/group/sub/project.git',
      providerHost: 'gitlab.example.com',
      repositoryOwner: 'group/sub',
      repositoryName: 'project',
    },
    {
      remoteUrl: 'https://GitLab.Example.com:8443/group/sub/project.git/',
      providerHost: 'gitlab.example.com:8443',
      repositoryOwner: 'group/sub',
      repositoryName: 'project',
    },
    {
      remoteUrl: 'https://gitlab.com/group%20name/sub/project.git.git',
      providerHost: 'gitlab.com',
      repositoryOwner: 'group name/sub',
      repositoryName: 'project.git',
    },
    {
      remoteUrl: 'git@gitlab.com:/group/sub/project.git',
      providerHost: 'gitlab.com',
      repositoryOwner: 'group/sub',
      repositoryName: 'project',
    },
    {
      remoteUrl: 'git@gitlab.com:group/sub/project.git',
      providerHost: 'gitlab.com',
      repositoryOwner: 'group/sub',
      repositoryName: 'project',
    },
    {
      remoteUrl: 'https://github.com/acme/project.git',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
      repositoryName: 'project',
    },
  ])(
    'parses $remoteUrl',
    async ({ remoteUrl, providerHost, repositoryOwner, repositoryName }: RemoteCase): Promise<void> => {
      vi.mocked(runCommand)
        .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'origin\n' })
        .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: `${remoteUrl}\n` });
      await expect(readLocalGitSourcePlan('/repo')).resolves.toEqual({
        providerHost,
        repositoryName,
        repositoryOwner,
      });
    },
  );

  it('rejects a single-segment remote without echoing embedded credentials', async (): Promise<void> => {
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'origin\n' }).mockResolvedValueOnce({
      exitCode: 0,
      stderr: '',
      stdout: 'https://secret@example.com/repository.git\n',
    });
    const result: Promise<LocalGitSourcePlan> = readLocalGitSourcePlan('/repo');
    await expect(result).rejects.toThrow('Unsupported Git remote URL. Use an HTTPS or SSH repository remote.');
    await expect(result).rejects.not.toThrow('secret');
  });
});

interface RemoteCase {
  providerHost: string;
  remoteUrl: string;
  repositoryName: string;
  repositoryOwner: string;
}
