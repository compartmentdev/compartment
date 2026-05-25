import type { CompartmentSkillInstallRequestedTarget } from '@compartment/contracts';

export interface InstallCompartmentSkillInput {
  agent: CompartmentSkillInstallRequestedTarget;
  cwd: string;
}

export interface SkillInstallContext {
  cwd: string;
  repositoryRoot: string;
  scopePath: string;
  scopeRoot: string;
}
