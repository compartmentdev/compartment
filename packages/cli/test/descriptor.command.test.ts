import {
  compartmentDescriptorSchemaResponseSchema,
  compartmentRoutesSchemaResponseSchema,
  type CompartmentDescriptorSchemaResponse,
  type CompartmentRoutesSchemaResponse,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import {
  type CliCommandResult,
  type CliJsonResult,
  expectCliSuccess,
  readCliStdout,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

describe('compartment descriptor schema command', (): void => {
  it('returns the schema guide in json output', async (): Promise<void> => {
    const result: CliJsonResult<CompartmentDescriptorSchemaResponse> = await runCliJson(
      ['descriptor', 'schema', '--output', 'json'],
      compartmentDescriptorSchemaResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.fileName).toBe('compartment.yml');
    expect(result.payload.defaults.serviceRun.restart.policy).toBe('on-failure');
    expect(result.payload.rules.restartPolicies).toEqual(['no', 'on-failure', 'unless-stopped']);
    expect(result.payload.rules.serviceKinds).toEqual(['web', 'api', 'static', 'worker', 'job', 'cron']);
    expect(result.payload.rules.buildOutputDirectoryRequiredKinds).toEqual(['static']);
    expect(result.payload.rules.projectReservedNames).toEqual(['create']);
    expect(result.payload.rules.releaseFields).toEqual(['command']);
    expect(result.payload.defaults.serviceRelease).toBeNull();
  });

  it('prints a readable compartment.yml guide in text output', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['descriptor', 'schema']);

    expectCliSuccess(result);
    const stdout: string = readCliStdout(result.capture);
    expect(stdout).toContain('compartment.yml schema');
    expect(stdout).toContain('Minimal example:');
    expect(stdout).toContain('name: <project-slug>');
    expect(stdout).toContain('project names reserved by the browser console: create');
    expect(stdout).toContain('services must contain at least one entry');
    expect(stdout).toContain('object form required for kinds: static');
    expect(stdout).toContain('build.outputDirectory required for kinds: static');
    expect(stdout).toContain('build.outputDirectory only allowed for kinds: static');
    expect(stdout).toContain('build.outputDirectory must be a relative path inside the service directory');
    expect(stdout).toContain('service-local Dockerfiles are ignored for kinds: static');
    expect(stdout).toContain('build.strategy is not allowed for kinds: static');
    expect(stdout).toContain('release is not allowed for kinds: static');
    expect(stdout).toContain('release fields: command');
    expect(stdout).toContain('supported restart policies: no, on-failure, unless-stopped');
    expect(stdout).toContain(
      'omitted run -> image default start command, restart on-failure; omitted release -> disabled',
    );
    expect(stdout).toContain('include widens a source build');
    expect(stdout).toContain('workspace files that root build expects');
    expect(stdout).toContain('compartment.routes.yml');
  });

  it('returns the routes schema guide in json output', async (): Promise<void> => {
    const result: CliJsonResult<CompartmentRoutesSchemaResponse> = await runCliJson(
      ['descriptor', 'routes-schema', '--output', 'json'],
      compartmentRoutesSchemaResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.fileName).toBe('compartment.routes.yml');
    expect(result.payload.location).toBe('current directory');
    expect(result.payload.rules.version).toBe(1);
  });

  it('prints a readable compartment.routes.yml guide in text output', async (): Promise<void> => {
    const result: CliCommandResult = await runCliCommand(['descriptor', 'routes-schema']);

    expectCliSuccess(result);
    const stdout: string = readCliStdout(result.capture);
    expect(stdout).toContain('compartment.routes.yml schema');
    expect(stdout).toContain('version: 1');
    expect(stdout).toContain('Validation notes:');
    expect(stdout).toContain('Related files: compartment.yml');
  });
});
