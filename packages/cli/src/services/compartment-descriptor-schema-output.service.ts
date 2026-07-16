import type { CompartmentDescriptorRelatedFile, CompartmentDescriptorSchemaResponse } from '@compartment/contracts';
import { formatDeploymentReadiness } from './deployment-output-format.service';

export function createCompartmentDescriptorSchemaMessage(response: CompartmentDescriptorSchemaResponse): string {
  return joinSchemaSections(
    createSchemaHeader(response),
    createSchemaRuleSection(response),
    createOwnershipSection(response),
    createUnsupportedConfigSection(response),
    createRelatedFilesSection(response),
  );
}

function createSchemaHeader(response: CompartmentDescriptorSchemaResponse): string {
  return renderSchemaLines([
    `${response.fileName} schema`,
    '',
    `Location: ${response.location}`,
    '',
    'Minimal example:',
    response.minimalExampleYaml,
    '',
    'Expanded example:',
    response.expandedExampleYaml,
    '',
  ]);
}

function createSchemaRuleSection(response: CompartmentDescriptorSchemaResponse): string {
  return renderSchemaLines([
    'Rules:',
    `- project name must match ${response.rules.projectNamePattern}`,
    ...formatOptionalReservedProjectNamesRule(response),
    '- services must contain at least one entry',
    `- service names must match ${response.rules.serviceNamePattern}`,
    `- service values may be ${formatServiceValueForms(response)}`,
    `- service object fields: ${response.rules.serviceConfigFields.join(', ')} (required: ${response.rules.serviceConfigRequiredFields.join(', ')})`,
    `- build fields: ${response.rules.buildFields.join(', ')}`,
    `- supported build strategies: ${response.rules.buildStrategies.join(', ')}`,
    `- supported kinds: ${response.rules.serviceKinds.join(', ')}`,
    ...formatKindSpecificRules(response),
    `- run fields: ${response.rules.runFields.join(', ')}`,
    `- release fields: ${response.rules.releaseFields.join(', ')}`,
    `- readiness fields: ${response.rules.readinessFields.join(', ')}`,
    `- supported readiness types: ${response.rules.readinessTypes.join(', ')}`,
    `- defaults: omitted build -> ${formatBuildDefaults(response)}; omitted kind -> ${response.defaults.serviceKind}; omitted run -> ${formatRunDefaults()}; omitted release -> ${formatReleaseDefaults(response)}; omitted readiness -> ${formatReadinessDefaults(response)}`,
    '',
  ]);
}

function formatOptionalReservedProjectNamesRule(response: CompartmentDescriptorSchemaResponse): string[] {
  return response.rules.projectReservedNames.length === 0
    ? []
    : [`- project names reserved by the browser console: ${response.rules.projectReservedNames.join(', ')}`];
}

function formatServiceValueForms(response: CompartmentDescriptorSchemaResponse): string {
  return response.rules.serviceValueForms
    .map((valueForm: string): string =>
      valueForm === 'string_path' ? 'a string path shorthand' : 'a service config object',
    )
    .join(' or ');
}

function formatReadinessDefaults(response: CompartmentDescriptorSchemaResponse): string {
  if (response.defaults.readiness === null) {
    return 'disabled';
  }

  return formatDeploymentReadiness(response.defaults.readiness);
}

function formatBuildDefaults(response: CompartmentDescriptorSchemaResponse): string {
  const defaults: string[] = [
    `strategy ${response.defaults.serviceBuild.strategy}`,
    `env [${response.defaults.serviceBuild.env.join(', ')}]`,
    `outputDirectory ${response.defaults.serviceBuild.outputDirectory ?? 'unset'}`,
    `build packages [${response.defaults.serviceBuild.packages.build.join(', ')}]`,
    `runtime packages [${response.defaults.serviceBuild.packages.runtime.join(', ')}]`,
  ];

  return defaults.join(', ');
}

function formatRunDefaults(): string {
  return 'image default start command';
}

function formatReleaseDefaults(response: CompartmentDescriptorSchemaResponse): string {
  return response.defaults.serviceRelease === null ? 'disabled' : response.defaults.serviceRelease.command;
}

function formatKindSpecificRules(response: CompartmentDescriptorSchemaResponse): string[] {
  return [
    ...formatOptionalKindRule('object form required for kinds', response.rules.serviceObjectOnlyKinds),
    ...formatOptionalKindRule(
      'build.outputDirectory required for kinds',
      response.rules.buildOutputDirectoryRequiredKinds,
    ),
    ...formatOptionalKindRule(
      'build.outputDirectory only allowed for kinds',
      response.rules.buildOutputDirectoryAllowedKinds,
    ),
    `- ${response.rules.buildOutputDirectoryPathRule}`,
    ...formatOptionalKindRule('service-local Dockerfiles are ignored for kinds', response.rules.dockerfileIgnoredKinds),
    ...formatOptionalKindRule('build.strategy is not allowed for kinds', response.rules.buildStrategyForbiddenKinds),
    ...formatOptionalKindRule('run is not allowed for kinds', response.rules.runForbiddenKinds),
    ...formatOptionalKindRule('release is not allowed for kinds', response.rules.releaseForbiddenKinds),
    ...formatOptionalKindRule('readiness is not allowed for kinds', response.rules.readinessForbiddenKinds),
  ];
}

function formatOptionalKindRule(label: string, kinds: readonly string[]): string[] {
  return kinds.length > 0 ? [`- ${label}: ${kinds.join(', ')}`] : [];
}

function createOwnershipSection(response: CompartmentDescriptorSchemaResponse): string {
  return renderSchemaLines(['Owns:', ...response.owns.map((entry: string): string => `- ${entry}`), '']);
}

function createUnsupportedConfigSection(response: CompartmentDescriptorSchemaResponse): string {
  return renderSchemaLines(['Does not own:', ...response.doesNotOwn.map((entry: string): string => `- ${entry}`), '']);
}

function createRelatedFilesSection(response: CompartmentDescriptorSchemaResponse): string {
  return renderSchemaLines([
    'Related files:',
    ...response.relatedFiles.map(
      (relatedFile: CompartmentDescriptorRelatedFile): string => `- ${relatedFile.fileName}: ${relatedFile.purpose}`,
    ),
  ]);
}

function joinSchemaSections(...sections: readonly string[]): string {
  return sections.join('\n');
}

function renderSchemaLines(lines: readonly string[]): string {
  return lines.join('\n');
}
