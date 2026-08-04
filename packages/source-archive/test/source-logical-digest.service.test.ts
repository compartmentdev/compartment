import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompartmentAuthoredDescriptor } from '@compartment/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createSourceArchive } from '../src/source-archive.service';
import { createLogicalSourceDigest } from '../src/source-logical-digest.service';
import type { SourceArchiveBuilderInput } from '../src/source-archive.service.types';

describe('logical source digest', (): void => {
  let fixtureDirectories: string[] = [];

  afterEach(async (): Promise<void> => {
    await Promise.all(
      fixtureDirectories.map(
        async (directory: string): Promise<void> => await rm(directory, { force: true, recursive: true }),
      ),
    );
    fixtureDirectories = [];
  });

  it('is independent of creation order and filesystem timestamps', async (): Promise<void> => {
    const firstDirectory: string = await createFixture([
      ['alpha.txt', 'alpha'],
      ['beta.txt', 'beta'],
    ]);
    const secondDirectory: string = await createFixture([
      ['beta.txt', 'beta'],
      ['alpha.txt', 'alpha'],
    ]);
    await utimes(join(firstDirectory, 'alpha.txt'), new Date(1_000), new Date(2_000));
    await utimes(join(secondDirectory, 'alpha.txt'), new Date(3_000), new Date(4_000));

    expect(await digest(firstDirectory)).toBe(await digest(secondDirectory));
  });

  it('orders Unicode paths by UTF-8 bytes inside the digest owner', async (): Promise<void> => {
    const directory: string = await createFixture([
      ['z.txt', 'z'],
      ['ä.txt', 'accented'],
    ]);
    const metadata: string = '{"version":1}';

    expect(
      await createLogicalSourceDigest(directory, ['ä.txt', 'z.txt'], '.compartment/source-package.json', metadata),
    ).toBe(
      await createLogicalSourceDigest(directory, ['z.txt', 'ä.txt'], '.compartment/source-package.json', metadata),
    );
  });

  it('changes for path, entry type, executable mode, and content changes', async (): Promise<void> => {
    const fixtureDirectory: string = await createFixture([['entry', 'same']]);
    const initialDigest: string = await digest(fixtureDirectory);

    await writeFile(join(fixtureDirectory, 'entry'), 'changed');
    const contentDigest: string = await digest(fixtureDirectory);
    await rm(join(fixtureDirectory, 'entry'));
    await writeFile(join(fixtureDirectory, 'renamed'), 'same');
    const pathDigest: string = await digest(fixtureDirectory);
    await chmod(join(fixtureDirectory, 'renamed'), 0o755);
    const modeDigest: string = await digest(fixtureDirectory);
    await rm(join(fixtureDirectory, 'renamed'));
    await mkdir(join(fixtureDirectory, 'renamed'));
    const entryTypeDigest: string = await digest(fixtureDirectory);

    expect(new Set([initialDigest, contentDigest, pathDigest, modeDigest, entryTypeDigest])).toHaveLength(5);
    expect(initialDigest).toMatch(/^v1:sha256:[a-f0-9]{64}$/u);
  });

  it('excludes ignored entries from the digest', async (): Promise<void> => {
    const fixtureDirectory: string = await createFixture([
      ['.gitignore', 'ignored.txt\n'],
      ['included.txt', 'included'],
      ['ignored.txt', 'first'],
    ]);
    const initialDigest: string = await digest(fixtureDirectory);

    await writeFile(join(fixtureDirectory, 'ignored.txt'), 'second');

    expect(await digest(fixtureDirectory)).toBe(initialDigest);
  });

  async function createFixture(entries: readonly (readonly [path: string, content: string])[]): Promise<string> {
    const directory: string = await mkdtemp(join(tmpdir(), 'compartment-source-digest-'));
    fixtureDirectories.push(directory);
    await writeFile(join(directory, '.git'), '');
    await writeFile(join(directory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    for (const [path, content] of entries) {
      await writeFile(join(directory, path), content);
    }
    return directory;
  }
});

async function digest(directory: string): Promise<string> {
  const descriptor: CompartmentAuthoredDescriptor = { name: 'fixture', services: { web: '.' } };
  const input: SourceArchiveBuilderInput = {
    descriptor,
    descriptorFilePath: join(directory, 'compartment.yml'),
  };
  return (await createSourceArchive(input)).sourceDigest;
}
