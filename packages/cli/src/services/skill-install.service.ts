import { join, resolve } from 'node:path';
import {
  compartmentDescriptorFileName,
  type CompartmentSkillInstallFileStatus,
  compartmentSkillInstallResultSchema,
  compartmentSkillInstallTargetValues,
  type CompartmentSkillInstallFile,
  type CompartmentSkillInstallFileKind,
  type CompartmentSkillInstallRequestedTarget,
  type CompartmentSkillInstallResult,
  type CompartmentSkillInstallTarget,
} from '@compartment/contracts';
import { writeInstalledSkillFile } from '../store/skill-install.store';
import { listDirectoryLineageWithinBoundary, pathExists } from './directory-lineage.service';
import { findGitRepositoryRoot, toRepositoryRelativePath } from './git-repository.service';
import type { InstallCompartmentSkillInput, SkillInstallContext } from './skill-install.service.types';

const compartmentSkillDirectoryName: string = 'compartment-app';
const codexSkillFilePath: string = join('.agents', 'skills', compartmentSkillDirectoryName, 'SKILL.md');
const claudeSkillFilePath: string = join('.claude', 'skills', compartmentSkillDirectoryName, 'SKILL.md');
const cursorRuleFilePath: string = join('.cursor', 'rules', 'compartment-agent.mdc');

interface InstalledTargetFilePlan {
  contents: string;
  filePath: string;
  kind: CompartmentSkillInstallFileKind;
}

export async function installCompartmentSkill(
  input: InstallCompartmentSkillInput,
): Promise<CompartmentSkillInstallResult> {
  const context: SkillInstallContext = await createSkillInstallContext(input.cwd);
  const targets: CompartmentSkillInstallTarget[] = await resolveInstallTargets(input.agent, context);
  const files: CompartmentSkillInstallFile[] = [];

  for (const target of targets) {
    files.push(await installTargetFile(target, context));
  }

  return compartmentSkillInstallResultSchema.parse({
    files,
    requestedTarget: input.agent,
    resolvedTargets: targets,
    scopePath: context.scopePath,
  });
}

export async function detectCompartmentSkillInstallAutoTargets(cwd: string): Promise<CompartmentSkillInstallTarget[]> {
  return await detectAutoTargets(await createSkillInstallContext(cwd));
}

async function createSkillInstallContext(cwd: string): Promise<SkillInstallContext> {
  const normalizedCwd: string = resolve(cwd);
  const repositoryRoot: string | undefined = await findGitRepositoryRoot(normalizedCwd);
  if (repositoryRoot === undefined) {
    throw new Error('Run `compartment skill install` from inside a Git repository.');
  }
  const scopeRoot: string = await findSkillScopeRoot(normalizedCwd, repositoryRoot);

  return {
    cwd: normalizedCwd,
    repositoryRoot,
    scopePath: toRepositoryRelativePath(repositoryRoot, scopeRoot),
    scopeRoot,
  };
}

async function resolveInstallTargets(
  requestedTarget: CompartmentSkillInstallRequestedTarget,
  context: SkillInstallContext,
): Promise<CompartmentSkillInstallTarget[]> {
  if (requestedTarget === 'all') {
    return [...compartmentSkillInstallTargetValues];
  }
  if (requestedTarget !== 'auto') {
    return [requestedTarget];
  }

  const autoDetectedTargets: CompartmentSkillInstallTarget[] = await detectAutoTargets(context);
  return autoDetectedTargets.length > 0 ? autoDetectedTargets : ['codex'];
}

async function installTargetFile(
  target: CompartmentSkillInstallTarget,
  context: SkillInstallContext,
): Promise<CompartmentSkillInstallFile> {
  const plan: InstalledTargetFilePlan = createInstalledTargetFilePlan(target, context);
  const status: CompartmentSkillInstallFileStatus = await writeInstalledSkillFile(
    plan.filePath,
    plan.contents,
    context.repositoryRoot,
  );

  return {
    kind: plan.kind,
    path: toRepositoryRelativePath(context.repositoryRoot, plan.filePath),
    status,
    target,
  };
}

async function detectAutoTargets(context: SkillInstallContext): Promise<CompartmentSkillInstallTarget[]> {
  const detectedTargets: Set<CompartmentSkillInstallTarget> = new Set<CompartmentSkillInstallTarget>();
  const directories: string[] = listDirectoryLineageWithinBoundary(context.cwd, context.repositoryRoot);

  if (await hasAnyPath(directories, ['.agents/skills', '.codex/skills'])) {
    detectedTargets.add('codex');
  }
  if (await hasAnyPath(directories, ['.claude/skills', 'CLAUDE.md', '.claude/CLAUDE.md'])) {
    detectedTargets.add('claude');
  }
  if (await hasAnyPath(directories, ['.cursor/rules', '.cursorrules'])) {
    detectedTargets.add('cursor');
  }
  if (
    (await pathExists(join(context.repositoryRoot, '.github', 'copilot-instructions.md'))) ||
    (await pathExists(join(context.repositoryRoot, '.github', 'instructions')))
  ) {
    detectedTargets.add('copilot');
  }

  return compartmentSkillInstallTargetValues.filter((target: CompartmentSkillInstallTarget): boolean =>
    detectedTargets.has(target),
  );
}

function createInstalledTargetFilePlan(
  target: CompartmentSkillInstallTarget,
  context: SkillInstallContext,
): InstalledTargetFilePlan {
  if (target === 'codex') {
    return createInstalledTargetFilePlanForSkill(target, join(context.scopeRoot, codexSkillFilePath));
  }
  if (target === 'claude') {
    return createInstalledTargetFilePlanForSkill(target, join(context.scopeRoot, claudeSkillFilePath));
  }
  if (target === 'cursor') {
    return createCursorInstalledTargetFilePlan(context.scopeRoot);
  }

  return createCopilotInstalledTargetFilePlan(context);
}

function createInstalledTargetFilePlanForSkill(target: 'claude' | 'codex', filePath: string): InstalledTargetFilePlan {
  return {
    contents: createAgentSkillContents(target),
    filePath,
    kind: 'skill',
  };
}

function createCursorInstalledTargetFilePlan(scopeRoot: string): InstalledTargetFilePlan {
  return {
    contents: createCursorRuleContents(),
    filePath: join(scopeRoot, cursorRuleFilePath),
    kind: 'rule',
  };
}

function createCopilotInstalledTargetFilePlan(context: SkillInstallContext): InstalledTargetFilePlan {
  return {
    contents: createCopilotInstructionsContents(context.scopePath),
    filePath: join(
      context.repositoryRoot,
      '.github',
      'instructions',
      readCopilotInstructionsFileName(context.scopePath),
    ),
    kind: 'instructions',
  };
}

function createAgentSkillContents(target: 'claude' | 'codex'): string {
  const description: string =
    target === 'codex'
      ? 'Use when working in this Compartment-hosted app repository and you need basic Compartment CLI onboarding, deploy, or descriptor guidance.'
      : 'Use when working in this Compartment-hosted app repository and you need basic Compartment CLI onboarding, deployment, or descriptor guidance.';

  return `---
name: ${compartmentSkillDirectoryName}
description: ${description}
---

${createCompartmentOnboardingBody()}
`;
}

function createCursorRuleContents(): string {
  return `---
description: Short Compartment CLI onboarding for this app scope.
alwaysApply: true
---

${createCompartmentOnboardingBody()}
`;
}

function createCopilotInstructionsContents(scopePath: string): string {
  return `---
applyTo: "${readCopilotApplyTo(scopePath)}"
---

${createCompartmentOnboardingBody()}
`;
}

function createCompartmentOnboardingBody(): string {
  return `Compartment hosts this application.

Start with:
- \`compartment --help\`
- \`compartment descriptor schema\`
- If \`compartment.yml\` is missing, run \`compartment init\`
- If you need runtime access, run \`compartment login --api-url <url>\`
- To deploy from this directory, run \`compartment deploy\`
- To inspect the current project, run \`compartment status\`

Keep Compartment guidance short unless the user asks for more detail.`;
}

async function findSkillScopeRoot(cwd: string, repositoryRoot: string): Promise<string> {
  for (const directory of listDirectoryLineageWithinBoundary(cwd, repositoryRoot)) {
    if (await pathExists(join(directory, compartmentDescriptorFileName))) {
      return directory;
    }
  }

  return repositoryRoot;
}

async function hasAnyPath(directories: readonly string[], candidatePaths: readonly string[]): Promise<boolean> {
  for (const directory of directories) {
    for (const candidatePath of candidatePaths) {
      if (await pathExists(join(directory, candidatePath))) {
        return true;
      }
    }
  }

  return false;
}

function readCopilotApplyTo(scopePath: string): string {
  return scopePath === '.' ? '**' : `${scopePath}/**`;
}

function readCopilotInstructionsFileName(scopePath: string): string {
  if (scopePath === '.') {
    return 'compartment.instructions.md';
  }

  return `compartment-${scopePath.replaceAll('/', '-').replaceAll(/[^a-zA-Z0-9-]/g, '-')}.instructions.md`;
}
