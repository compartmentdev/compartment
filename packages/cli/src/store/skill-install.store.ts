import type { CompartmentSkillInstallFileStatus } from '@compartment/contracts';
import { readRepositoryTextFile, writeRepositoryTextFile } from './repository-file.store';

export async function writeInstalledSkillFile(
  filePath: string,
  contents: string,
  repositoryRoot: string,
): Promise<CompartmentSkillInstallFileStatus> {
  const currentContents: string | undefined = await readRepositoryTextFile({
    filePath,
    label: 'Skill install target',
    repositoryRoot,
  });
  if (currentContents === contents) {
    return 'unchanged';
  }

  await writeSkillInstallTarget(filePath, contents, repositoryRoot);
  return currentContents === undefined ? 'created' : 'updated';
}

async function writeSkillInstallTarget(filePath: string, contents: string, repositoryRoot: string): Promise<void> {
  await writeRepositoryTextFile({
    contents,
    filePath,
    label: 'Skill install target',
    repositoryRoot,
  });
}
