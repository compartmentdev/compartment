import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  compartmentSkillInstallResultSchema,
  compartmentSkillInstallTargetValues,
  type CompartmentSkillInstallFile,
  type CompartmentSkillInstallFileStatus,
  type CompartmentSkillInstallResult,
} from '@compartment/contracts';
import { expect } from 'vitest';
import type { SelfHostedUserSetupCli } from './self-hosted-user-setup-cli.harness';

export async function expectCompartmentSkillInstallOnboarding(
  cli: SelfHostedUserSetupCli,
  appDirectory: string,
): Promise<void> {
  await writeFile(join(appDirectory, '.git'), 'gitdir: ./.git/worktrees/self-hosted-e2e\n', 'utf8');

  const skillInstallPayload: CompartmentSkillInstallResult = await cli.runJson(
    'skill install --agent all',
    compartmentSkillInstallResultSchema,
    { cwd: appDirectory },
  );
  expectSkillInstallPayload(skillInstallPayload, 'created');
  await expectInstalledSkillFiles(appDirectory);

  const repeatedSkillInstallPayload: CompartmentSkillInstallResult = await cli.runJson(
    'skill install --agent all',
    compartmentSkillInstallResultSchema,
    { cwd: appDirectory },
  );
  expectSkillInstallPayload(repeatedSkillInstallPayload, 'unchanged');
}

function expectSkillInstallPayload(
  payload: CompartmentSkillInstallResult,
  status: CompartmentSkillInstallFileStatus,
): void {
  expect(payload).toEqual({
    files: createExpectedSkillInstallFiles(status),
    requestedTarget: 'all',
    resolvedTargets: [...compartmentSkillInstallTargetValues],
    scopePath: '.',
  });
}

function createExpectedSkillInstallFiles(status: CompartmentSkillInstallFileStatus): CompartmentSkillInstallFile[] {
  return [
    {
      kind: 'skill',
      path: '.agents/skills/compartment-app/SKILL.md',
      status,
      target: 'codex',
    },
    {
      kind: 'skill',
      path: '.claude/skills/compartment-app/SKILL.md',
      status,
      target: 'claude',
    },
    {
      kind: 'rule',
      path: '.cursor/rules/compartment-agent.mdc',
      status,
      target: 'cursor',
    },
    {
      kind: 'instructions',
      path: '.github/instructions/compartment.instructions.md',
      status,
      target: 'copilot',
    },
  ];
}

async function expectInstalledSkillFiles(appDirectory: string): Promise<void> {
  await expect(readFile(join(appDirectory, '.agents/skills/compartment-app/SKILL.md'), 'utf8')).resolves.toContain(
    'Compartment hosts this application.',
  );
  await expect(readFile(join(appDirectory, '.claude/skills/compartment-app/SKILL.md'), 'utf8')).resolves.toContain(
    'Compartment hosts this application.',
  );
  await expect(readFile(join(appDirectory, '.cursor/rules/compartment-agent.mdc'), 'utf8')).resolves.toContain(
    'alwaysApply: true',
  );
  await expect(
    readFile(join(appDirectory, '.github/instructions/compartment.instructions.md'), 'utf8'),
  ).resolves.toContain('Compartment hosts this application.');
}
