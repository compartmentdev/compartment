import { describe, expect, it } from 'vitest';
import {
  compartmentSkillInstallResultSchema,
  type CompartmentSkillInstallResult,
} from '../src/contracts/skill-install.contract';

describe('skill install contract', (): void => {
  it('accepts a valid skill install result payload', (): void => {
    const result: CompartmentSkillInstallResult = compartmentSkillInstallResultSchema.parse({
      files: [
        {
          kind: 'skill',
          path: 'apps/web/.agents/skills/compartment-app/SKILL.md',
          status: 'created',
          target: 'codex',
        },
      ],
      requestedTarget: 'auto',
      resolvedTargets: ['codex'],
      scopePath: 'apps/web',
    });

    expect(result.files[0]?.path).toBe('apps/web/.agents/skills/compartment-app/SKILL.md');
  });

  it('normalizes repository-relative paths and rejects absolute file paths', (): void => {
    const normalized: CompartmentSkillInstallResult = compartmentSkillInstallResultSchema.parse({
      files: [
        {
          kind: 'rule',
          path: 'apps\\web\\.cursor\\rules\\compartment-agent.mdc',
          status: 'updated',
          target: 'cursor',
        },
      ],
      requestedTarget: 'cursor',
      resolvedTargets: ['cursor'],
      scopePath: '.\\apps\\web',
    });

    expect(normalized.files[0]?.path).toBe('apps/web/.cursor/rules/compartment-agent.mdc');
    expect(normalized.scopePath).toBe('apps/web');
    expect((): void => {
      compartmentSkillInstallResultSchema.parse({
        ...normalized,
        files: [
          {
            ...normalized.files[0],
            path: '/tmp/compartment-agent.mdc',
          },
        ],
      });
    }).toThrow('Expected a normalized repository-relative file path.');
  });
});
