import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerInstallSkillCommand } from './install-skill.command';

export function registerSkillCommands(program: Command, dependencies: CliCommandDependencies): void {
  const skillCommand: Command = program.command('skill').description('AI agent onboarding skill commands');
  registerInstallSkillCommand(skillCommand, dependencies);
}
