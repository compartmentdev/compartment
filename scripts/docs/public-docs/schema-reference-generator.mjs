import { renderFrontmatter, renderGuideLinks, renderMarkdown } from './markdown-output.mjs';
import { writeTextIfChanged } from './public-docs-files.mjs';
import { findPublicDocsAreaByCliRoot } from './public-docs-map.mjs';
import { readRepositoryTypescriptExport } from './repository-typescript-module.mjs';

const GENERATED_SCHEMA_DIRECTORY = 'public-docs/src/content/docs/reference/generated/schema';

export async function generateSchemaReferencePages() {
  const descriptorResponse = await readDescriptorSchemaResponse();
  const routesResponse = await readRoutesSchemaResponse();

  await writeTextIfChanged(
    `${GENERATED_SCHEMA_DIRECTORY}/compartment-yaml.md`,
    renderDescriptorSchemaPage(descriptorResponse),
  );
  await writeTextIfChanged(
    `${GENERATED_SCHEMA_DIRECTORY}/compartment-routes.md`,
    renderRoutesSchemaPage(routesResponse),
  );
}

async function readDescriptorSchemaResponse() {
  return readRepositoryTypescriptExport(
    new URL('../../../packages/contracts/src/contracts/compartment-descriptor-schema.contract.ts', import.meta.url),
    'createCompartmentDescriptorSchemaResponse',
  );
}

async function readRoutesSchemaResponse() {
  return readRepositoryTypescriptExport(
    new URL('../../../packages/contracts/src/contracts/compartment-routes.contract.ts', import.meta.url),
    'createCompartmentRoutesSchemaResponse',
  );
}

function renderDescriptorSchemaPage(response) {
  const area = findPublicDocsAreaByCliRoot('descriptor');

  return renderMarkdown([
    renderFrontmatter('compartment.yml', 'Generated reference for the current compartment.yml contract.'),
    'This page is generated from the current descriptor contract factory in the repository.',
    '',
    ...renderGuideLinks(area),
    '## File',
    '',
    `- Name: \`${response.fileName}\``,
    `- Location: ${response.location}`,
    '',
    '## Minimal Example',
    '',
    '```yaml',
    response.minimalExampleYaml.trimEnd(),
    '```',
    '',
    '## Expanded Example',
    '',
    '```yaml',
    response.expandedExampleYaml.trimEnd(),
    '```',
    '',
    '## Rules',
    '',
    `- Project name must match \`${response.rules.projectNamePattern}\`.`,
    ...renderOptionalProjectReservedNamesRule(response),
    `- Services must contain at least one entry: \`${response.rules.servicesMustNotBeEmpty.toString()}\`.`,
    `- Service names must match \`${response.rules.serviceNamePattern}\`.`,
    `- Service values may be: ${response.rules.serviceValueForms.join(', ')}.`,
    `- Service config fields: ${response.rules.serviceConfigFields.join(', ')}.`,
    `- Required service config fields: ${response.rules.serviceConfigRequiredFields.join(', ')}.`,
    `- Service connections use \`${response.rules.serviceConnectionShape}\`.`,
    `- Service connection env keys must match \`${response.rules.serviceConnectionEnvKeyPattern}\`.`,
    `- Service connection env keys ${response.rules.serviceConnectionEnvKeyReservedPrefixRule}.`,
    `- Service connection output names must match \`${response.rules.serviceConnectionOutputNamePattern}\`.`,
    ...response.rules.serviceConnectionValidationRules.map((rule) => `- Service connection rule: ${rule}.`),
    `- Build fields: ${response.rules.buildFields.join(', ')}.`,
    `- Supported build strategies: ${response.rules.buildStrategies.join(', ')}.`,
    `- Supported kinds: ${response.rules.serviceKinds.join(', ')}.`,
    ...renderDescriptorKindSpecificRules(response),
    `- Run fields: ${response.rules.runFields.join(', ')}.`,
    `- Release fields: ${response.rules.releaseFields.join(', ')}.`,
    `- Readiness fields: ${response.rules.readinessFields.join(', ')}.`,
    `- Readiness types: ${response.rules.readinessTypes.join(', ')}.`,
    `- Resources are optional.`,
    `- Resource names must match \`${response.rules.serviceNamePattern}\` and must not collide with service names.`,
    `- Resource values may be: ${response.rules.resourceValueForms.join(', ')}.`,
    `- Resource config fields: ${response.rules.resourceConfigFields.join(', ')}.`,
    `- Resource config must include one of these field sets: ${formatRequiredFieldSets(response.rules.resourceConfigRequiredFieldSets)}.`,
    `- Resource presets: ${response.rules.resourcePresets.join(', ')}.`,
    `- Resource preset override fields: ${formatResourcePresetRules(response.rules.resourcePresetRules)}.`,
    `- Resource generated variable fields: ${response.rules.resourceGeneratedVariableFields.join(', ')}.`,
    '- Resource generated variable names must start with a letter or underscore, contain only letters, digits, and underscores, and must not start with `COMPARTMENT_`.',
    `- Resource generated variable generators: ${response.rules.resourceGeneratedVariableGenerators.join(', ')}.`,
    `- Resource generated variable encodings: ${response.rules.resourceGeneratedVariableEncodings.join(', ')}.`,
    `- Resource output names must match \`${response.rules.resourceOutputNamePattern}\`.`,
    `- Resource output object fields: ${response.rules.resourceOutputFields.join(', ')}.`,
    `- Resource operation fields: ${response.rules.resourceOperationFields.join(', ')}.`,
    `- Resource operation schedule fields: ${response.rules.resourceOperationScheduleFields.join(', ')}.`,
    `- Resource operation schedule intervals: ${response.rules.resourceOperationScheduleIntervals.join(', ')}.`,
    '- Resource operation cron schedules use standard five-field cron syntax in UTC, for example `*/15 * * * *`, `0 2 * * 1`, or `0 2 1 * *`.',
    `- Resource operation retention fields: ${response.rules.resourceOperationRetentionFields.join(', ')}.`,
    `- Resource readiness fields: ${response.rules.resourceReadinessFields.join(', ')}.`,
    `- Resource readiness types: ${response.rules.resourceReadinessTypes.join(', ')}.`,
    '',
    '## Defaults',
    '',
    `- Service kind: \`${response.defaults.serviceKind}\``,
    `- Build strategy: \`${response.defaults.serviceBuild.strategy}\``,
    `- Build env defaults to ${formatStringArray(response.defaults.serviceBuild.env)}.`,
    `- Build include defaults to ${formatStringArray(response.defaults.serviceBuild.include)}.`,
    `- Build outputDirectory defaults to ${response.defaults.serviceBuild.outputDirectory === undefined ? 'unset' : `\`${response.defaults.serviceBuild.outputDirectory}\``}.`,
    `- Build packages defaults to build=${formatStringArray(response.defaults.serviceBuild.packages.build)} and runtime=${formatStringArray(response.defaults.serviceBuild.packages.runtime)}.`,
    `- Release defaults to ${response.defaults.serviceRelease === null ? 'disabled' : `\`${response.defaults.serviceRelease.command}\``}.`,
    `- Readiness defaults to ${response.defaults.readiness === null ? 'disabled' : `\`${response.defaults.readiness.type}\``}.`,
    `- Resource readiness defaults to ${response.defaults.resourceReadiness === null ? 'disabled' : `\`${response.defaults.resourceReadiness.type}\``}.`,
    '',
    '## Owns',
    '',
    ...response.owns.map((entry) => `- ${entry}`),
    '',
    '## Does Not Own',
    '',
    ...response.doesNotOwn.map((entry) => `- ${entry}`),
    '',
    '## Related Files',
    '',
    ...response.relatedFiles.map((relatedFile) => `- \`${relatedFile.fileName}\`: ${relatedFile.purpose}`),
  ]);
}

function renderRoutesSchemaPage(response) {
  const area = findPublicDocsAreaByCliRoot('descriptor');

  return renderMarkdown([
    renderFrontmatter('compartment.routes.yml', 'Generated reference for the current compartment.routes.yml contract.'),
    'This page is generated from the current routes contract factory in the repository.',
    '',
    ...renderGuideLinks(area),
    '## File',
    '',
    `- Name: \`${response.fileName}\``,
    `- Location: ${response.location}`,
    `- Optional: \`${response.optional.toString()}\``,
    `- Created by \`compartment init\`: \`${response.createdByInit.toString()}\``,
    '',
    '## Example',
    '',
    '```yaml',
    response.exampleYaml.trimEnd(),
    '```',
    '',
    '## Rules',
    '',
    `- Version must be \`${response.rules.version.toString()}\`.`,
    `- Routes must contain at least one entry: \`${response.rules.routesMustNotBeEmpty.toString()}\`.`,
    `- Route fields: ${response.rules.routeFields.join(', ')}.`,
    `- Required route fields: ${response.rules.requiredRouteFields.join(', ')}.`,
    `- Methods are optional: \`${response.rules.methodsOptional.toString()}\`.`,
    `- Path forms: ${response.rules.routePathForms.join(', ')}.`,
    `- Supported methods: ${response.rules.supportedHttpMethods.join(', ')}.`,
    `- Transform fields: ${response.rules.routeTransformFields.join(', ')}.`,
    `- Max transforms per route: ${response.rules.maxTransformsPerRoute.toString()}.`,
    '',
    '## Validation Notes',
    '',
    ...response.currentValidationNotes.map((entry) => `- ${entry}`),
    '',
    '## Matching Semantics',
    '',
    ...response.matchingSemantics.map((entry) => `- ${entry}`),
    '',
    '## Transform Semantics',
    '',
    ...response.transformSemantics.map((entry) => `- ${entry}`),
    '',
    '## Related Files',
    '',
    ...response.relatedFiles.map((entry) => `- \`${entry}\``),
  ]);
}

function formatStringArray(values) {
  return values.length === 0 ? 'an empty list' : `[${values.join(', ')}]`;
}

function formatRequiredFieldSets(fieldSets) {
  return fieldSets.map((fieldSet) => `[${fieldSet.join(', ')}]`).join(' or ');
}

function formatResourcePresetRules(resourcePresetRules) {
  return Object.entries(resourcePresetRules)
    .map(([presetName, presetRule]) => `${presetName} accepts only ${presetRule.overrideFields.join(', ')}`)
    .join('; ');
}

function renderDescriptorKindSpecificRules(response) {
  const lines = [];
  if (response.rules.serviceObjectOnlyKinds.length > 0) {
    lines.push(`- Object form required for kinds: ${response.rules.serviceObjectOnlyKinds.join(', ')}.`);
  }
  if (response.rules.buildOutputDirectoryRequiredKinds.length > 0) {
    lines.push(
      `- build.outputDirectory required for kinds: ${response.rules.buildOutputDirectoryRequiredKinds.join(', ')}.`,
    );
  }
  if (response.rules.buildOutputDirectoryAllowedKinds.length > 0) {
    lines.push(
      `- build.outputDirectory is only supported for kinds: ${response.rules.buildOutputDirectoryAllowedKinds.join(', ')}.`,
    );
  }
  lines.push(`- ${response.rules.buildOutputDirectoryPathRule}`);
  if (response.rules.dockerfileIgnoredKinds.length > 0) {
    lines.push(
      `- service-local Dockerfiles are ignored for kinds: ${response.rules.dockerfileIgnoredKinds.join(', ')}.`,
    );
  }
  if (response.rules.buildStrategyForbiddenKinds.length > 0) {
    lines.push(`- build.strategy is not allowed for kinds: ${response.rules.buildStrategyForbiddenKinds.join(', ')}.`);
  }
  if (response.rules.runForbiddenKinds.length > 0) {
    lines.push(`- Run is not allowed for kinds: ${response.rules.runForbiddenKinds.join(', ')}.`);
  }
  if (response.rules.releaseForbiddenKinds.length > 0) {
    lines.push(`- Release is not allowed for kinds: ${response.rules.releaseForbiddenKinds.join(', ')}.`);
  }
  if (response.rules.readinessForbiddenKinds.length > 0) {
    lines.push(`- Readiness is not allowed for kinds: ${response.rules.readinessForbiddenKinds.join(', ')}.`);
  }

  return lines;
}

function renderOptionalProjectReservedNamesRule(response) {
  return response.rules.projectReservedNames.length === 0
    ? []
    : [
        `- Project names reserved by the browser console: ${response.rules.projectReservedNames
          .map((value) => `\`${value}\``)
          .join(', ')}.`,
      ];
}
