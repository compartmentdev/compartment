import { Option, type Command } from 'commander';
import type { SafeParseReturnType } from 'zod';
import {
  type CompartmentSkillInstallFile,
  type CompartmentSkillInstallTarget,
  type CompartmentSkillInstallRequestedTarget,
  compartmentSkillInstallRequestedTargetSchema,
  compartmentSkillInstallRequestedTargetValues,
  type CompartmentSkillInstallResult,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { renderOutput } from '../../output/render';
import { promptVisibleText } from '../../prompts/prompt';
import {
  detectCompartmentSkillInstallAutoTargets,
  installCompartmentSkill,
} from '../../services/skill-install.service';
import type { CliCommandDependencies, SkillInstallCommandOptions } from '../command.types';

const availableSkillInstallTargetsLabel: string = 'auto (detect, fallback: codex), all, codex, claude, cursor, copilot';

export function registerInstallSkillCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('install')
    .description('Install short Compartment onboarding instructions for AI agents')
    .addOption(
      new Option('--agent <target>', 'auto, all, codex, claude, cursor, or copilot (auto falls back to codex)').choices(
        [...compartmentSkillInstallRequestedTargetValues],
      ),
    )
    .option('--interactive', 'prompt for the install target')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SkillInstallCommandOptions): Promise<void> =>
        await executeInstallSkillCommand(dependencies, options),
    );
}

async function executeInstallSkillCommand(
  dependencies: CliCommandDependencies,
  options: SkillInstallCommandOptions,
): Promise<void> {
  validateSkillInstallCommandOptions(options);
  const cwd: string = process.cwd();
  const agent: CompartmentSkillInstallRequestedTarget = await resolveRequestedTarget(dependencies, options, cwd);
  const result: CompartmentSkillInstallResult = await installCompartmentSkill({
    agent,
    cwd,
  });

  renderOutput(dependencies.io, options.output, result, createSkillInstallResultMessage(result));
}

function createSkillInstallResultMessage(result: CompartmentSkillInstallResult): string {
  const scopeLabel: string = result.scopePath === '.' ? 'repository root' : result.scopePath;
  const lines: string[] = result.files.map((file: CompartmentSkillInstallFile): string => {
    return `- ${file.target}: ${file.status} ${file.path}`;
  });

  return `Installed Compartment agent onboarding in ${scopeLabel}.
${lines.join('\n')}`;
}

async function resolveRequestedTarget(
  dependencies: CliCommandDependencies,
  options: SkillInstallCommandOptions,
  cwd: string,
): Promise<CompartmentSkillInstallRequestedTarget> {
  if (hasText(options.agent)) {
    return compartmentSkillInstallRequestedTargetSchema.parse(options.agent);
  }
  if (shouldPromptForRequestedTarget(dependencies, options)) {
    return await promptRequestedTarget(dependencies, cwd);
  }

  return 'auto';
}

function validateSkillInstallCommandOptions(options: SkillInstallCommandOptions): void {
  if (options.interactive === true && hasText(options.agent)) {
    throw new Error('Use either --agent <target> or --interactive.');
  }
}

function shouldPromptForRequestedTarget(
  dependencies: CliCommandDependencies,
  options: SkillInstallCommandOptions,
): boolean {
  if (options.interactive === true) {
    assertInteractiveInput(dependencies);
    return true;
  }

  return isInteractiveInput(dependencies.io.stdin);
}

function assertInteractiveInput(dependencies: CliCommandDependencies): void {
  if (isInteractiveInput(dependencies.io.stdin)) {
    return;
  }

  throw new Error('`compartment skill install --interactive` requires a TTY.');
}

async function promptRequestedTarget(
  dependencies: CliCommandDependencies,
  cwd: string,
): Promise<CompartmentSkillInstallRequestedTarget> {
  await writeRequestedTargetPromptContext(dependencies, cwd);

  for (;;) {
    const answer: string = (
      await promptVisibleText(dependencies.io, 'Agent target', compartmentSkillInstallRequestedTargetValues[0])
    )
      .trim()
      .toLowerCase();
    const parsedTarget: SafeParseReturnType<
      CompartmentSkillInstallRequestedTarget,
      CompartmentSkillInstallRequestedTarget
    > = compartmentSkillInstallRequestedTargetSchema.safeParse(answer);
    if (parsedTarget.success) {
      return parsedTarget.data;
    }

    dependencies.io.stderr(`Expected one of: ${compartmentSkillInstallRequestedTargetValues.join(', ')}.\n`);
  }
}

async function writeRequestedTargetPromptContext(dependencies: CliCommandDependencies, cwd: string): Promise<void> {
  dependencies.io.stderr(`Available targets: ${availableSkillInstallTargetsLabel}.\n`);

  const autoDetectedTargets: CompartmentSkillInstallTarget[] = await detectCompartmentSkillInstallAutoTargets(cwd);
  if (autoDetectedTargets.length > 0) {
    dependencies.io.stderr(`Detected in repository: ${autoDetectedTargets.join(', ')}.\n`);
  }
}

function isInteractiveInput(input: NodeJS.ReadableStream): boolean {
  const ttyInput: Partial<NodeJS.ReadableStream> & { isTTY?: boolean | undefined } = input;
  return ttyInput.isTTY === true;
}
