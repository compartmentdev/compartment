import { execFile, type ExecFileOptions } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  compartmentSourcePackageMetadataArchivePath,
  type CompartmentAuthoredDescriptor,
} from '@compartment/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createSourceArchive } from '../src/source-archive.service';
import type { SourceArchiveBuilderInput } from '../src/source-archive.service.types';

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

describe('createSourceArchive', (): void => {
  let fixtureDirectory: string | null = null;

  afterEach(async (): Promise<void> => {
    if (fixtureDirectory !== null) {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('archives the descriptor directory by default and honors the archive-root .gitignore', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), '.env.*\n!.env.example\ndist/*\n!dist/keep.txt\n');
    await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');
    await writeFile(join(fixtureDirectory, '.env.example'), 'EXAMPLE_VALUE=true');
    await writeFile(join(fixtureDirectory, '.env.production'), 'NODE_ENV=production');
    await mkdir(join(fixtureDirectory, 'dist'));
    await writeFile(join(fixtureDirectory, 'dist', 'drop.txt'), 'drop');
    await writeFile(join(fixtureDirectory, 'dist', 'keep.txt'), 'keep');

    const extractionDirectory: string = await extractArchive(
      await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: '.' } })),
    );

    expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
    expect(await readFile(join(extractionDirectory, '.env.example'), 'utf8')).toBe('EXAMPLE_VALUE=true');
    expect(await readFile(join(extractionDirectory, 'dist', 'keep.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath), 'utf8')).toContain(
      '"descriptorDirectoryRelativePath": "."',
    );
    await expect(access(join(extractionDirectory, '.env.production'))).rejects.toThrow();
    await expect(access(join(extractionDirectory, 'dist', 'drop.txt'))).rejects.toThrow();
  });

  it('honors the repository-root .gitignore when the descriptor directory is archived as root', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), '.env.*\n!apps/web/.env.example\n');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'app.txt'), 'safe');
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.env.example'), 'EXAMPLE_VALUE=true');
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.env.production'), 'NODE_ENV=production');

    const extractionDirectory: string = await extractArchive(
      await createArchive(createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), { services: { web: '.' } })),
    );

    expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
    expect(await readFile(join(extractionDirectory, '.env.example'), 'utf8')).toBe('EXAMPLE_VALUE=true');
    expect(await readFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath), 'utf8')).toContain(
      '"descriptorDirectoryRelativePath": "."',
    );
    await expect(access(join(extractionDirectory, '.env.production'))).rejects.toThrow();
  });

  it('packages descriptor-relative build.include paths without uploading unrelated repo files', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), 'shared/\n');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'packages', 'ignored'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'server.mjs'), 'console.log("ready");\n');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');
    await writeFile(join(fixtureDirectory, 'packages', 'ignored', 'secret.txt'), 'ignore-me');

    const descriptor: SourceArchiveBuilderInput = createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
      services: {
        web: {
          build: {
            include: ['../../shared'],
          },
          path: '.',
        },
      },
    });
    const extractionDirectory: string = await extractArchive(await createArchive(descriptor));

    expect(await readFile(join(extractionDirectory, 'apps', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}\n');
    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    expect(await readFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath), 'utf8')).toContain(
      '"descriptorDirectoryRelativePath": "apps/web"',
    );
    expect(await readFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath), 'utf8')).toContain(
      '"web": "."',
    );
    await expect(access(join(extractionDirectory, 'packages', 'ignored', 'secret.txt'))).rejects.toThrow();
  });

  it('preserves descriptor-relative service paths in generated source-package metadata', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'apps', 'api'), { recursive: true });
    await writeFile(
      join(fixtureDirectory, 'apps', 'web', 'compartment.yml'),
      'name: fixture\nservices:\n  api: ../api\n  web: .\n',
    );
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'apps', 'api', 'package.json'), '{"name":"api"}\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(
          join(fixtureDirectory, 'apps', 'web'),
          {
            services: {
              api: '../api',
              web: '.',
            },
          },
          'api',
        ),
      ),
    );
    const metadataContents: string = await readFile(
      join(extractionDirectory, compartmentSourcePackageMetadataArchivePath),
      'utf8',
    );

    expect(JSON.parse(metadataContents)).toMatchObject({
      descriptorDirectoryRelativePath: 'web',
      servicePaths: {
        api: '../api',
      },
      version: 1,
    });
  });

  it('archives only the requested service paths and includes when deploy --service narrows a multi-service descriptor', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, 'services', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'services', 'api'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'packages', 'web-shared'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'packages', 'api-shared'), { recursive: true });
    await writeFile(
      join(fixtureDirectory, 'compartment.yml'),
      `name: fixture
services:
  web:
    path: ./services/web
    build:
      include:
        - ./packages/web-shared
  api:
    path: ./services/api
    build:
      include:
        - ./packages/api-shared
`,
    );
    await writeFile(join(fixtureDirectory, 'services', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'services', 'api', 'package.json'), '{"name":"api"}\n');
    await writeFile(join(fixtureDirectory, 'packages', 'web-shared', 'message.txt'), 'web\n');
    await writeFile(join(fixtureDirectory, 'packages', 'api-shared', 'message.txt'), 'api\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(
          fixtureDirectory,
          {
            services: {
              api: {
                build: {
                  include: ['./packages/api-shared'],
                },
                path: './services/api',
              },
              web: {
                build: {
                  include: ['./packages/web-shared'],
                },
                path: './services/web',
              },
            },
          },
          'web',
        ),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'services', 'web', 'package.json'), 'utf8')).toBe(
      '{"name":"web"}\n',
    );
    expect(await readFile(join(extractionDirectory, 'packages', 'web-shared', 'message.txt'), 'utf8')).toBe('web\n');
    expect(
      JSON.parse(await readFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath), 'utf8')),
    ).toMatchObject({
      descriptorDirectoryRelativePath: '.',
      servicePaths: {
        web: 'services/web',
      },
      version: 1,
    });
    await expect(access(join(extractionDirectory, 'services', 'api', 'package.json'))).rejects.toThrow();
    await expect(access(join(extractionDirectory, 'packages', 'api-shared', 'message.txt'))).rejects.toThrow();
  });

  it('replaces any authored source-package metadata with the generated deployment metadata', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, '.compartment'), { recursive: true });
    await writeFile(
      join(fixtureDirectory, compartmentSourcePackageMetadataArchivePath),
      '{"descriptorDirectoryRelativePath":"stale"}\n',
    );
    await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');

    const sourceArchive: Buffer = await createArchive(
      createSourceArchiveInput(fixtureDirectory, {
        services: { web: '.' },
      }),
    );
    const metadataContents: string = await readArchiveFile(sourceArchive, compartmentSourcePackageMetadataArchivePath);

    expect(metadataContents).toContain('"descriptorDirectoryRelativePath": "."');
    expect(metadataContents).not.toContain('stale');
  });

  it('drops authored source-package metadata subtrees before adding generated metadata', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, compartmentSourcePackageMetadataArchivePath), { recursive: true });
    await writeFile(join(fixtureDirectory, compartmentSourcePackageMetadataArchivePath, 'stale.txt'), 'stale');
    await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(fixtureDirectory, {
          services: { web: '.' },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath), 'utf8')).toContain(
      '"descriptorDirectoryRelativePath": "."',
    );
    await expect(
      access(join(extractionDirectory, compartmentSourcePackageMetadataArchivePath, 'stale.txt')),
    ).rejects.toThrow();
  });

  it('keeps descriptor-directory .gitignore rules when build.include widens the archive root', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.gitignore'), '.env.production\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.env.production'), 'NODE_ENV=production');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    await expect(access(join(extractionDirectory, 'apps', 'web', '.env.production'))).rejects.toThrow();
  });

  it('keeps the selected service when the archive-root .gitignore ignores that service path', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), 'apps/web/\n');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.gitignore'), 'secret.txt\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'secret.txt'), 'secret\n');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'apps', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}\n');
    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    await expect(access(join(extractionDirectory, 'apps', 'web', 'secret.txt'))).rejects.toThrow();
  });

  it('keeps descendant ignore rules from the same ancestor .gitignore when the selected service root is forced in', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), 'apps/web/\napps/web/.env.production\n');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.env.production'), 'NODE_ENV=production');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'apps', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}\n');
    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    await expect(access(join(extractionDirectory, 'apps', 'web', '.env.production'))).rejects.toThrow();
  });

  it('honors ancestor .gitignore precedence when build.include widens the archive root', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), 'apps/web/dist/*\n');
    await mkdir(join(fixtureDirectory, 'apps', 'web', 'dist'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'apps', 'web', '.cache'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', '.gitignore'), 'web/.cache/\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.gitignore'), '!dist/keep.txt\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'dist', 'drop.txt'), 'drop');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'dist', 'keep.txt'), 'keep');
    await writeFile(join(fixtureDirectory, 'apps', 'web', '.cache', 'state.json'), '{"ignored":true}\n');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'apps', 'web', 'dist', 'keep.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    await expect(access(join(extractionDirectory, 'apps', 'web', 'dist', 'drop.txt'))).rejects.toThrow();
    await expect(access(join(extractionDirectory, 'apps', 'web', '.cache', 'state.json'))).rejects.toThrow();
  });

  it('lets explicit build.include paths override archive-root ignore rules', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), 'shared/\n');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'shared', '.gitignore'), 'secret.txt\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');
    await writeFile(join(fixtureDirectory, 'shared', 'secret.txt'), 'secret\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    await expect(access(join(extractionDirectory, 'shared', 'secret.txt'))).rejects.toThrow();
  });

  it('always excludes vcs metadata directories', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(
      join(fixtureDirectory, 'compartment.yml'),
      'name: fixture\nservices:\n  web:\n    path: .\n    build:\n      include:\n        - .hg\n        - .svn/wc.db\n',
    );
    await mkdir(join(fixtureDirectory, '.hg'));
    await mkdir(join(fixtureDirectory, '.svn'));
    await writeFile(join(fixtureDirectory, '.hg', 'store'), 'store\n');
    await writeFile(join(fixtureDirectory, '.svn', 'wc.db'), 'sqlite\n');
    await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');

    const extractionDirectory: string = await extractArchive(
      await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: '.' } })),
    );

    expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
    await expect(access(join(extractionDirectory, '.git'))).rejects.toThrow();
    await expect(access(join(extractionDirectory, '.hg'))).rejects.toThrow();
    await expect(access(join(extractionDirectory, '.svn'))).rejects.toThrow();
  });

  it('does not split source paths with newlines into host file-list entries', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    const outsideDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-outside-'));
    const outsideFilePath: string = join(outsideDirectory, 'outside-host-file.txt');
    const maliciousRepoPath: string = `app.txt\n${outsideFilePath}`;
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');
    await writeFile(outsideFilePath, 'outside-host-secret');
    await mkdir(dirname(join(fixtureDirectory, maliciousRepoPath)), { recursive: true });
    await writeFile(join(fixtureDirectory, maliciousRepoPath), 'repo-host');

    try {
      const extractionDirectory: string = await extractArchive(
        await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: '.' } })),
      );
      const escapedOutsideArchivePath: string = outsideFilePath.startsWith('/')
        ? outsideFilePath.slice(1)
        : outsideFilePath;

      expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
      expect(await readFile(join(extractionDirectory, maliciousRepoPath), 'utf8')).toBe('repo-host');
      await expect(readFile(join(extractionDirectory, escapedOutsideArchivePath), 'utf8')).rejects.toThrow();
    } finally {
      await rm(outsideDirectory, { force: true, recursive: true });
    }
  });

  it('keeps source paths beginning with tar option syntax as file-list entries', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, '--checkpoint-action=exec=touch unsafe'), 'repo-file');

    const extractionDirectory: string = await extractArchive(
      await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: '.' } })),
    );

    expect(await readFile(join(extractionDirectory, '--checkpoint-action=exec=touch unsafe'), 'utf8')).toBe(
      'repo-file',
    );
  });

  it('does not treat cwd vcs path segments as source-archive vcs metadata', async (): Promise<void> => {
    const originalWorkingDirectory: string = process.cwd();
    const cwdFixtureDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-cwd-'));
    const cwdDirectory: string = join(cwdFixtureDirectory, '.git', 'runner');

    try {
      await mkdir(cwdDirectory, { recursive: true });
      process.chdir(cwdDirectory);

      fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
      await writeFile(join(fixtureDirectory, '.git'), '');
      await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
      await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');

      const extractionDirectory: string = await extractArchive(
        await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: '.' } })),
      );

      expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
    } finally {
      process.chdir(originalWorkingDirectory);
      await rm(cwdFixtureDirectory, { force: true, recursive: true });
    }
  });

  it('does not treat vcs-like ancestor directories outside the repository as source-archive vcs metadata', async (): Promise<void> => {
    const parentFixtureDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-parent-'));
    fixtureDirectory = parentFixtureDirectory;
    const repositoryDirectory: string = join(parentFixtureDirectory, '.svn', 'repo');

    await mkdir(repositoryDirectory, { recursive: true });
    await writeFile(join(repositoryDirectory, '.git'), '');
    await writeFile(join(repositoryDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(repositoryDirectory, 'app.txt'), 'safe');

    const extractionDirectory: string = await extractArchive(
      await createArchive(createSourceArchiveInput(repositoryDirectory, { services: { web: '.' } })),
    );

    expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
  });

  it('rejects symlinked descriptor entries outside selected service paths', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, 'app'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'real-compartment.yml'), 'name: fixture\nservices:\n  web: ./app\n');
    await symlink('real-compartment.yml', join(fixtureDirectory, 'compartment.yml'));
    await writeFile(join(fixtureDirectory, 'app', 'package.json'), '{"name":"web"}\n');

    await expect(
      createArchive(
        createSourceArchiveInput(fixtureDirectory, {
          services: {
            web: './app',
          },
        }),
      ),
    ).rejects.toThrow('must not include symlinks');
  });

  it('rejects symlinked build.include targets that resolve outside the repository boundary', async (): Promise<void> => {
    const externalDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-external-'));

    try {
      fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
      await writeFile(join(fixtureDirectory, '.git'), '');
      await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
      await mkdir(join(externalDirectory, 'shared'));
      await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
      await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
      await writeFile(join(externalDirectory, 'shared', 'secret.txt'), 'secret');
      await symlink(join(externalDirectory, 'shared'), join(fixtureDirectory, 'outside-link'));

      await expect(
        createArchive(
          createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
            services: {
              web: {
                build: {
                  include: ['../../outside-link'],
                },
                path: '.',
              },
            },
          }),
        ),
      ).rejects.toThrow('must not include symlinks');
    } finally {
      await rm(externalDirectory, { force: true, recursive: true });
    }
  });

  it('rejects symlinked service paths that resolve outside the repository boundary', async (): Promise<void> => {
    const externalDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-external-'));

    try {
      fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
      await writeFile(join(fixtureDirectory, '.git'), '');
      await mkdir(join(fixtureDirectory, 'apps'), { recursive: true });
      await mkdir(join(externalDirectory, 'shared'));
      await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: ./apps/web-link\n');
      await writeFile(join(externalDirectory, 'shared', 'package.json'), '{"name":"shared"}\n');
      await symlink(join(externalDirectory, 'shared'), join(fixtureDirectory, 'apps', 'web-link'));

      await expect(
        createArchive(
          createSourceArchiveInput(fixtureDirectory, {
            services: {
              web: './apps/web-link',
            },
          }),
        ),
      ).rejects.toThrow('must not include symlinks');
    } finally {
      await rm(externalDirectory, { force: true, recursive: true });
    }
  });

  it('rejects symlink entries inside the selected service directory', async (): Promise<void> => {
    const externalDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-external-'));

    try {
      fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
      await writeFile(join(fixtureDirectory, '.git'), '');
      await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
      await mkdir(join(externalDirectory, 'shared'));
      await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
      await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
      await writeFile(join(externalDirectory, 'shared', 'secret.txt'), 'secret');
      await symlink(join(externalDirectory, 'shared'), join(fixtureDirectory, 'apps', 'web', 'escape-link'));

      await expect(
        createArchive(createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), { services: { web: '.' } })),
      ).rejects.toThrow('must not include symlinks');
    } finally {
      await rm(externalDirectory, { force: true, recursive: true });
    }
  });

  it('skips ignored symlinked directories inside the selected service tree', async (): Promise<void> => {
    const externalDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-external-'));

    try {
      fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
      await writeFile(join(fixtureDirectory, '.git'), '');
      await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: ./apps/web\n');
      await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
      await mkdir(join(externalDirectory, 'shared'));
      await writeFile(join(fixtureDirectory, 'apps', 'web', '.gitignore'), 'ignored-link\n');
      await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
      await writeFile(join(externalDirectory, 'shared', 'secret.txt'), 'secret');
      await symlink(join(externalDirectory, 'shared'), join(fixtureDirectory, 'apps', 'web', 'ignored-link'));

      const extractionDirectory: string = await extractArchive(
        await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: './apps/web' } })),
      );

      expect(await readFile(join(extractionDirectory, 'apps', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}\n');
      await expect(access(join(extractionDirectory, 'apps', 'web', 'ignored-link'))).rejects.toThrow();
    } finally {
      await rm(externalDirectory, { force: true, recursive: true });
    }
  });

  it('excludes unrelated root-level symlinks outside the selected archive entries', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await symlink('.git/reddit-scraper/shared.env', join(fixtureDirectory, '.env.shared'));
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, 'apps', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}\n');
    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    await expect(access(join(extractionDirectory, '.env.shared'))).rejects.toThrow();
  });

  it('rejects build.include paths that escape the descriptor directory when no repository boundary exists', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, 'shared'), { recursive: true });
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, 'shared', 'message.mjs'), 'export const message = "shared";\n');

    await expect(
      createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    ).rejects.toThrow('must stay within the current repository or worktree');
  });

  it('allows included paths whose names begin with two dots when they stay inside the repository boundary', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await mkdir(join(fixtureDirectory, 'apps', 'web'), { recursive: true });
    await mkdir(join(fixtureDirectory, '..shared'));
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
    await writeFile(join(fixtureDirectory, '..shared', 'message.mjs'), 'export const message = "dotdot";\n');

    const extractionDirectory: string = await extractArchive(
      await createArchive(
        createSourceArchiveInput(join(fixtureDirectory, 'apps', 'web'), {
          services: {
            web: {
              build: {
                include: ['../../..shared'],
              },
              path: '.',
            },
          },
        }),
      ),
    );

    expect(await readFile(join(extractionDirectory, '..shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "dotdot";\n',
    );
  });

  it('skips traversing ignored service directories', async (): Promise<void> => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-'));
    await writeFile(join(fixtureDirectory, '.git'), '');
    await writeFile(join(fixtureDirectory, '.gitignore'), 'ignored/\n');
    await writeFile(join(fixtureDirectory, 'compartment.yml'), 'name: fixture\nservices:\n  web: .\n');
    await writeFile(join(fixtureDirectory, 'app.txt'), 'safe');
    const ignoredDirectoryPath: string = join(fixtureDirectory, 'ignored');
    await mkdir(ignoredDirectoryPath);
    await chmod(ignoredDirectoryPath, 0o000);

    try {
      const extractionDirectory: string = await extractArchive(
        await createArchive(createSourceArchiveInput(fixtureDirectory, { services: { web: '.' } })),
      );

      expect(await readFile(join(extractionDirectory, 'app.txt'), 'utf8')).toBe('safe');
      await expect(access(join(extractionDirectory, 'ignored'))).rejects.toThrow();
    } finally {
      await chmod(ignoredDirectoryPath, 0o755);
    }
  });
});

function createSourceArchiveInput(
  directory: string,
  descriptor: Omit<CompartmentAuthoredDescriptor, 'name'>,
  serviceName?: string,
): SourceArchiveBuilderInput {
  return {
    descriptor: {
      name: 'fixture',
      ...descriptor,
    },
    descriptorFilePath: join(directory, 'compartment.yml'),
    ...(serviceName !== undefined ? { serviceName } : {}),
  };
}

async function createArchive(input: SourceArchiveBuilderInput): Promise<Buffer> {
  return (await createSourceArchive(input)).sourceArchive;
}

async function extractArchive(sourceArchive: Buffer): Promise<string> {
  const archiveDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-file-'));
  const archivePath: string = join(archiveDirectory, 'source.tgz');
  const extractionDirectory: string = join(archiveDirectory, 'extract');

  await mkdir(dirname(archivePath), { recursive: true });
  await mkdir(extractionDirectory, { recursive: true });
  await writeFile(archivePath, sourceArchive);
  await executeFileAsync('tar', ['-xzf', archivePath, '-C', extractionDirectory]);

  return extractionDirectory;
}

async function readArchiveFile(sourceArchive: Buffer, archivePath: string): Promise<string> {
  const archiveDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-cli-source-archive-file-'));
  const sourceArchivePath: string = join(archiveDirectory, 'source.tgz');

  await writeFile(sourceArchivePath, sourceArchive);

  return (
    await executeFileAsync('tar', ['-xOzf', sourceArchivePath, archivePath], {
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
}
