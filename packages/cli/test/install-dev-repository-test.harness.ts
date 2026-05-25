import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createTemporaryCompartmentRepository,
  removeTemporaryCompartmentRepository,
  type TemporaryCompartmentRepository,
} from './compartment-repository-test.harness';

export async function withInstallDevRepository<TResult>(
  envFileText: string,
  action: () => Promise<TResult>,
): Promise<TResult> {
  const repository: TemporaryCompartmentRepository = await createTemporaryCompartmentRepository();
  const previousCwd: string = process.cwd();

  try {
    await writeFile(resolve(repository.root, '.env'), envFileText, 'utf8');
    process.chdir(repository.root);

    return await action();
  } finally {
    process.chdir(previousCwd);
    await removeTemporaryCompartmentRepository(repository);
  }
}
