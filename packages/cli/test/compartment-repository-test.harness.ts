import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cliPackageJsonText: string = JSON.stringify(
  {
    name: '@compartment/cli',
    private: true,
  },
  null,
  2,
);
const rootPackageJsonText: string = JSON.stringify(
  {
    name: 'compartment',
    private: true,
  },
  null,
  2,
);
const pnpmWorkspaceText: string = 'packages:\n  - packages/*\n';
const temporaryCompartmentRepositoryPrefix: string = 'compartment-test-repo-';

export interface TemporaryCompartmentRepository {
  root: string;
}

export async function createTemporaryCompartmentRepository(): Promise<TemporaryCompartmentRepository> {
  const root: string = await mkdtemp(join(tmpdir(), temporaryCompartmentRepositoryPrefix));

  try {
    await mkdir(resolve(root, 'packages/cli'), { recursive: true });
    await Promise.all([
      writeFile(resolve(root, 'package.json'), rootPackageJsonText, 'utf8'),
      writeFile(resolve(root, 'packages/cli/package.json'), cliPackageJsonText, 'utf8'),
      writeFile(resolve(root, 'pnpm-workspace.yaml'), pnpmWorkspaceText, 'utf8'),
    ]);
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }

  return {
    root,
  };
}

export async function removeTemporaryCompartmentRepository(repository: TemporaryCompartmentRepository): Promise<void> {
  await rm(repository.root, { force: true, recursive: true });
}
