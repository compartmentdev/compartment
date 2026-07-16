import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTemporaryCompartmentRepository,
  removeTemporaryCompartmentRepository,
  type TemporaryCompartmentRepository,
} from './compartment-repository-test.harness';
import { readCompartmentDevInstallContext } from '../src/repo-root';

describe('readCompartmentDevInstallContext', (): void => {
  const temporaryRepositories: TemporaryCompartmentRepository[] = [];

  afterEach(async (): Promise<void> => {
    await Promise.all(
      temporaryRepositories.map(async (repository: TemporaryCompartmentRepository): Promise<void> => {
        return await removeTemporaryCompartmentRepository(repository);
      }),
    );
    temporaryRepositories.length = 0;
  });

  it('reads quoted values from the repository root .env file', async (): Promise<void> => {
    const repository: TemporaryCompartmentRepository = await createTemporaryCompartmentRepository();
    temporaryRepositories.push(repository);
    await writeFile(
      repositoryRootEnvPath(repository.root),
      'COMPARTMENT_API_URL="http://127.0.0.1:9443" # comment\n',
      'utf8',
    );

    await expect(
      readCompartmentDevInstallContext(repository.root, {
        COMPARTMENT_INSTALL_TOKEN: 'test-install-token',
      }),
    ).resolves.toEqual({
      apiUrl: 'http://127.0.0.1:9443',
      installToken: 'test-install-token',
    });
  });

  it('requires the install token in the process environment', async (): Promise<void> => {
    const repository: TemporaryCompartmentRepository = await createTemporaryCompartmentRepository();
    temporaryRepositories.push(repository);
    await writeFile(repositoryRootEnvPath(repository.root), 'COMPARTMENT_API_URL=http://127.0.0.1:9443\n', 'utf8');

    await expect(readCompartmentDevInstallContext(repository.root, {})).rejects.toThrow(
      'The environment is missing COMPARTMENT_INSTALL_TOKEN.',
    );
  });

  it('rejects nested package directories and requires running from the repo root', async (): Promise<void> => {
    const repository: TemporaryCompartmentRepository = await createTemporaryCompartmentRepository();
    temporaryRepositories.push(repository);

    await expect(readCompartmentDevInstallContext(resolve(repository.root, 'packages', 'cli'))).rejects.toThrow(
      'Expected to run from the compartment repository root.',
    );
  });
});

function repositoryRootEnvPath(repositoryRoot: string): string {
  return resolve(repositoryRoot, '.env');
}
