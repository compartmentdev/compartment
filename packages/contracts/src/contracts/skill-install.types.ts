export type CompartmentSkillInstallTarget = 'codex' | 'claude' | 'cursor' | 'copilot';

export type CompartmentSkillInstallRequestedTarget = 'auto' | 'all' | CompartmentSkillInstallTarget;

export type CompartmentSkillInstallFileKind = 'instructions' | 'rule' | 'skill';

export type CompartmentSkillInstallFileStatus = 'created' | 'unchanged' | 'updated';

export interface CompartmentSkillInstallFile {
  kind: CompartmentSkillInstallFileKind;
  path: string;
  status: CompartmentSkillInstallFileStatus;
  target: CompartmentSkillInstallTarget;
}

export interface CompartmentSkillInstallResult {
  files: CompartmentSkillInstallFile[];
  requestedTarget: CompartmentSkillInstallRequestedTarget;
  resolvedTargets: CompartmentSkillInstallTarget[];
  scopePath: string;
}
