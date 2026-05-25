import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { findStoredProjectDescriptor } from '../src/services/project-descriptor.service';

const tempDirectories: string[] = [];

describe('project descriptor service', (): void => {
  afterEach(async (): Promise<void> => {
    await Promise.all(tempDirectories.splice(0).map(removeTempDirectory));
  });

  it('uses the routes file name when compartment.routes.yml contains invalid YAML', async (): Promise<void> => {
    const directory: string = await createTempProjectDirectory();
    await writeFile(
      join(directory, 'compartment.yml'),
      `name: smoke-multi-service
services:
  web: .
  backoffice:
    kind: api
    path: ./api`,
    );
    await writeFile(join(directory, 'compartment.routes.yml'), 'version: 1\nroutes:\n  - on: web\n    path: [\n');

    await expect(findStoredProjectDescriptor(directory)).rejects.toThrow(/Failed to parse compartment\.routes\.yml:/);
  });
});

async function createTempProjectDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-project-descriptor-'));
  tempDirectories.push(directory);

  return directory;
}

async function removeTempDirectory(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}
