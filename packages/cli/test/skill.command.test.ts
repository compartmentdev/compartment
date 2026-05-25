import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compartmentSkillInstallResultSchema, type CompartmentSkillInstallResult } from '@compartment/contracts';
import {
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStderr,
  readCliStdout,
  runCliCommand,
  runCliJson,
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
} from './cli-test.harness';

describe.sequential('compartment skill install command', (): void => {
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async (): Promise<void> => {
    originalCwd = process.cwd();
    tempRoot = await mkdtemp(join(tmpdir(), 'compartment-skill-install-'));
  });

  afterEach(async (): Promise<void> => {
    process.chdir(originalCwd);
    await rm(tempRoot, { force: true, recursive: true });
  });

  it('installs a codex skill by default when no repository markers are present', async (): Promise<void> => {
    await createGitRepositoryRoot(tempRoot);
    process.chdir(tempRoot);

    const result: CliJsonResult<CompartmentSkillInstallResult> = await runCliJson(
      ['skill', 'install', '--output', 'json'],
      compartmentSkillInstallResultSchema,
    );
    expectCliSuccess(result);

    expect(result.payload).toEqual({
      files: [
        {
          kind: 'skill',
          path: '.agents/skills/compartment-app/SKILL.md',
          status: 'created',
          target: 'codex',
        },
      ],
      requestedTarget: 'auto',
      resolvedTargets: ['codex'],
      scopePath: '.',
    });
    await expect(readFile(join(tempRoot, '.agents/skills/compartment-app/SKILL.md'), 'utf8')).resolves.toContain(
      'Compartment hosts this application.',
    );
  });

  it('uses the nearest compartment.yml ancestor as the install scope', async (): Promise<void> => {
    const appRoot: string = join(tempRoot, 'apps/web');
    const nestedDirectory: string = join(appRoot, 'src/components');

    await createGitRepositoryRoot(tempRoot);
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(join(appRoot, 'compartment.yml'), 'name: web\n\nservices:\n  web: .\n', 'utf8');
    process.chdir(nestedDirectory);

    const result: CliJsonResult<CompartmentSkillInstallResult> = await runCliJson(
      ['skill', 'install', '--agent', 'codex', '--output', 'json'],
      compartmentSkillInstallResultSchema,
    );
    expectCliSuccess(result);

    expect(result.payload.scopePath).toBe('apps/web');
    expect(result.payload.files[0]?.path).toBe('apps/web/.agents/skills/compartment-app/SKILL.md');
  });

  it('auto-detects multiple supported agent formats from repository markers', async (): Promise<void> => {
    const scopeDirectory: string = join(tempRoot, 'apps/web');

    await createGitRepositoryRoot(tempRoot);
    await mkdir(join(tempRoot, '.claude/skills/existing'), { recursive: true });
    await mkdir(join(tempRoot, '.github'), { recursive: true });
    await mkdir(scopeDirectory, { recursive: true });
    await writeFile(join(tempRoot, '.claude/skills/existing/SKILL.md'), '# existing\n', 'utf8');
    await writeFile(join(tempRoot, '.github/copilot-instructions.md'), '# existing\n', 'utf8');
    await writeFile(join(scopeDirectory, 'compartment.yml'), 'name: web\n\nservices:\n  web: .\n', 'utf8');
    process.chdir(scopeDirectory);

    const result: CliJsonResult<CompartmentSkillInstallResult> = await runCliJson(
      ['skill', 'install', '--output', 'json'],
      compartmentSkillInstallResultSchema,
    );
    expectCliSuccess(result);

    expect(result.payload.resolvedTargets).toEqual(['claude', 'copilot']);
    expect(result.payload.files).toEqual([
      {
        kind: 'skill',
        path: 'apps/web/.claude/skills/compartment-app/SKILL.md',
        status: 'created',
        target: 'claude',
      },
      {
        kind: 'instructions',
        path: '.github/instructions/compartment-apps-web.instructions.md',
        status: 'created',
        target: 'copilot',
      },
    ]);
  });

  it('writes a cursor rule when the cursor target is selected', async (): Promise<void> => {
    await createGitRepositoryRoot(tempRoot);
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install', '--agent', 'cursor']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain('cursor: created .cursor/rules/compartment-agent.mdc');
    await expect(readFile(join(tempRoot, '.cursor/rules/compartment-agent.mdc'), 'utf8')).resolves.toContain(
      'alwaysApply: true',
    );
  });

  it('prompts for the install target by default in a TTY session', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    await createGitRepositoryRoot(tempRoot);
    capture.stdin.end('\n');
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain(
      'Available targets: auto (detect, fallback: codex), all, codex, claude, cursor, copilot.',
    );
    expect(readCliStderr(capture)).toContain('Agent target [auto]: ');
    expect(readCliStdout(result.capture)).toContain('codex: created .agents/skills/compartment-app/SKILL.md');
  });

  it('shows detected targets in interactive mode', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture({ isTTY: true });

    await createGitRepositoryRoot(tempRoot);
    await mkdir(join(tempRoot, '.claude/skills/existing'), { recursive: true });
    await writeFile(join(tempRoot, '.claude/skills/existing/SKILL.md'), '# existing\n', 'utf8');
    capture.stdin.end('\n');
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install', '--interactive'], capture);

    expectCliSuccess(result);
    expect(readCliStderr(capture)).toContain(
      'Available targets: auto (detect, fallback: codex), all, codex, claude, cursor, copilot.',
    );
    expect(readCliStderr(capture)).toContain('Detected in repository: claude.');
    expect(readCliStderr(capture)).toContain('Agent target [auto]: ');
    expect(readCliStdout(result.capture)).toContain('claude: created .claude/skills/compartment-app/SKILL.md');
  });

  it('fails when interactive mode is requested without a TTY', async (): Promise<void> => {
    await createGitRepositoryRoot(tempRoot);
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install', '--interactive']);

    expectCliFailure(result, '`compartment skill install --interactive` requires a TTY.');
  });

  it('rejects combining --agent with --interactive', async (): Promise<void> => {
    await createGitRepositoryRoot(tempRoot);
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install', '--agent', 'codex', '--interactive']);

    expectCliFailure(result, 'Use either --agent <target> or --interactive.');
  });

  it('fails outside a git repository', async (): Promise<void> => {
    process.chdir(tempRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install']);

    expectCliFailure(result, 'Run `compartment skill install` from inside a Git repository.');
  });

  it('fails without writing through a symlinked skill parent directory', async (): Promise<void> => {
    const repositoryRoot: string = join(tempRoot, 'repo');
    const outsideRoot: string = join(tempRoot, 'outside');

    await mkdir(repositoryRoot);
    await mkdir(outsideRoot);
    await createGitRepositoryRoot(repositoryRoot);
    await symlink(outsideRoot, join(repositoryRoot, '.agents'), 'dir');
    process.chdir(repositoryRoot);

    const result: CliCommandResult = await runCliCommand(['skill', 'install', '--agent', 'codex']);

    expectCliFailure(result, 'must not include symlinks');
    await expect(readFile(join(outsideRoot, 'skills/compartment-app/SKILL.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function createGitRepositoryRoot(root: string): Promise<void> {
  await writeFile(join(root, '.git'), 'gitdir: ./.git/worktrees/test\n', 'utf8');
}
