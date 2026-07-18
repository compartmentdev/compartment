import { describe, expect, it } from 'vitest';
import {
  createCompartmentDescriptorSchemaResponse,
  compartmentDescriptorSchemaResponseSchema,
  type CompartmentDescriptorSchemaResponse,
} from '../src';

describe('compartment descriptor schema contract', (): void => {
  it('returns parseable guide defaults and representative contract anchors', (): void => {
    const response: CompartmentDescriptorSchemaResponse = createCompartmentDescriptorSchemaResponse();

    expect(compartmentDescriptorSchemaResponseSchema.parse(response)).toEqual(response);
    expect(response.fileName).toBe('compartment.yml');
    expect(response.location).toBeTruthy();
    expect(response.defaults.readiness).toBeNull();
    expect(response.defaults.resourceReadiness).toBeNull();
    expect(response.defaults.serviceBuild.strategy).toBe('auto');
    expect(response.defaults.serviceKind).toBe('web');
    expect(response.defaults.serviceRelease).toBeNull();
    expect(response.rules.buildFields).toEqual([
      'command',
      'env',
      'include',
      'outputDirectory',
      'packages',
      'strategy',
    ]);
    expect(response.rules.buildOutputDirectoryAllowedKinds).toEqual(expect.arrayContaining(['static']));
    expect(response.rules.buildOutputDirectoryPathRule).toBe(
      'build.outputDirectory must be a relative path inside the service directory and must not resolve to the service root.',
    );
    expect(response.rules.buildStrategies).toEqual(expect.arrayContaining(['auto', 'dockerfile', 'railpack']));
    expect(response.rules.projectReservedNames).toEqual(['create']);
    expect(response.rules.readinessFields).toEqual(expect.arrayContaining(['type', 'path', 'timeoutMs']));
    expect(response.rules.readinessForbiddenKinds).toEqual(expect.arrayContaining(['static']));
    expect(response.rules.releaseFields).toEqual(['command']);
    expect(response.rules.releaseForbiddenKinds).toEqual(expect.arrayContaining(['static']));
    expect(response.rules.resourceConfigRequiredFieldSets).toEqual([['image'], ['preset']]);
    expect(response.rules.resourceConfigFields).toContain('generatedVariables');
    expect(response.rules.resourceConfigFields).toContain('restart');
    expect(response.rules.resourceGeneratedVariableEncodings).toEqual(['hex', 'base64url']);
    expect(response.rules.resourceGeneratedVariableFields).toEqual(['generator', 'bytes', 'encoding']);
    expect(response.rules.resourceGeneratedVariableGenerators).toEqual(['token']);
    expect(response.rules.resourcePresetRules.postgres.overrideFields).toEqual(['env']);
    expect(response.rules.resourceOperationFields).toEqual(expect.arrayContaining(['image', 'schedule']));
    expect(response.rules.resourceOperationRetentionFields).toEqual(
      expect.arrayContaining(['includeManual', 'keepLast', 'maxAgeDays']),
    );
    expect(response.rules.resourceOperationScheduleIntervals).toEqual(expect.arrayContaining(['daily', 'hourly']));
    expect(response.rules.resourceReadinessTypes).toEqual(['tcp']);
    expect(response.rules.resourceValueForms).toEqual(['resource_config']);
    expect(response.rules.runFields).toEqual(['command', 'restart']);
    expect(response.rules.runForbiddenKinds).toContain('static');
    expect(response.rules.serviceConfigFields).toEqual(expect.arrayContaining(['release']));
    expect(response.rules.serviceConfigFields).toContain('connections');
    expect(response.rules.serviceConnectionShape).toBe('connections.<resource>.env.<KEY>: <resource-output-name>');
    expect(response.rules.serviceConnectionEnvKeyPattern).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
    expect(response.rules.serviceConnectionEnvKeyReservedPrefixRule).toBe('must not start with COMPARTMENT_');
    expect(response.rules.serviceConnectionValidationRules).toContain(
      'connection resource names must reference declared resources',
    );
    expect(response.rules.serviceConfigRequiredFields).toContain('path');
    expect(response.rules.serviceKinds).toEqual(expect.arrayContaining(['web', 'api', 'static']));
    expect(response.rules.serviceObjectOnlyKinds).toEqual(['static']);
    expect(response.rules.serviceValueForms).toEqual(expect.arrayContaining(['string_path', 'service_config']));
    expect(response.relatedFiles).toHaveLength(1);
    expect(response.relatedFiles).toEqual([
      {
        fileName: 'compartment.routes.yml',
        purpose: 'Browser-facing rewrites and proxy rules.',
      },
    ]);
    expect(response.minimalExampleYaml).toContain('name: <project-slug>');
    expect(response.minimalExampleYaml).toContain('services:');
    expect(response.expandedExampleYaml).toContain('kind: static');
    expect(response.expandedExampleYaml).toContain('outputDirectory: dist');
    expect(response.expandedExampleYaml).toContain('resources:');
    expect(response.expandedExampleYaml).toContain('preset: postgres');
    expect(response.expandedExampleYaml).toContain('POSTGRES_DB: app');
    expect(response.expandedExampleYaml).toContain('DATABASE_URL: connection-url');
  });
});
