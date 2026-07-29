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

  it('formats every compartment.yml schema issue without exposing Zod internals', async (): Promise<void> => {
    const directory: string = await createTempProjectDirectory();
    await writeFile(
      join(directory, 'compartment.yml'),
      `name: 42
services:
  web:
    path: .
    ports:
      - invalid
    unexpected: true`,
    );

    const error: Error = await readDescriptorError(directory);

    expect(error.message).toBe(`compartment.yml: name: Expected string, received number
compartment.yml: services.web.ports[0]: Expected number, received string
compartment.yml: services.web: Unrecognized key(s) in object: 'unexpected'`);
    expect(error.message).not.toMatch(/ZodError|"code"|at parse/u);
  });

  it('quotes dynamic descriptor keys that are not unambiguous path identifiers', async (): Promise<void> => {
    const directory: string = await createTempProjectDirectory();
    await writeFile(
      join(directory, 'compartment.yml'),
      `name: smoke
services:
  web: .
resources:
  database:
    image: postgres:16
    volumes:
      data.cache:
        mountPath: relative`,
    );

    const error: Error = await readDescriptorError(directory);

    expect(error.message).toBe('compartment.yml: resources.database.volumes["data.cache"].mountPath: Invalid');
  });

  it('formats nested compartment.routes.yml array paths without exposing Zod internals', async (): Promise<void> => {
    const directory: string = await createTempProjectDirectory();
    await writeFile(join(directory, 'compartment.yml'), 'name: smoke\nservices:\n  web: .\n');
    await writeFile(
      join(directory, 'compartment.routes.yml'),
      `version: 2
routes:
  - on: web
    path: /api
    methods:
      - 42`,
    );

    const error: Error = await readDescriptorError(directory);

    expect(error.message).toContain('compartment.routes.yml: version: Invalid literal value, expected 1');
    expect(error.message).toContain(
      "compartment.routes.yml: routes[0].methods[0]: Expected 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT', received number",
    );
    expect(error.message).not.toMatch(/ZodError|"code"|at parse/u);
  });
});

async function readDescriptorError(directory: string): Promise<Error> {
  try {
    await findStoredProjectDescriptor(directory);
  } catch (error) {
    return error instanceof Error ? error : new Error('Descriptor validation failed without an Error.');
  }

  throw new Error('Expected descriptor validation to fail.');
}

async function createTempProjectDirectory(): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-project-descriptor-'));
  tempDirectories.push(directory);

  return directory;
}

async function removeTempDirectory(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}
