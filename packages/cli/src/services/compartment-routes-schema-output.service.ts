import type { CompartmentRoutesSchemaResponse } from '@compartment/contracts';

export function createCompartmentRoutesSchemaMessage(response: CompartmentRoutesSchemaResponse): string {
  return joinSchemaSections(
    createRoutesSchemaHeader(response),
    createRoutesRuleSection(response),
    createRoutesValidationSection(response),
    createRoutesMatchingSection(response),
    createRoutesTransformSection(response),
  );
}

function createRoutesSchemaHeader(response: CompartmentRoutesSchemaResponse): string {
  return renderSchemaLines([
    `${response.fileName} schema`,
    '',
    `Location: ${response.location}`,
    'Optional: yes',
    'Created by compartment init: no',
    '',
    'Example:',
    response.exampleYaml,
    '',
  ]);
}

function createRoutesRuleSection(response: CompartmentRoutesSchemaResponse): string {
  return renderSchemaLines([
    'Rules:',
    `- version must be ${response.rules.version.toString()}`,
    '- routes must contain at least one entry',
    `- route fields: ${response.rules.routeFields.join(', ')} (required: ${response.rules.requiredRouteFields.join(', ')})`,
    `- path forms: ${formatRoutePathForms(response)}`,
    `- supported methods: ${response.rules.supportedHttpMethods.join(', ')}`,
    `- transforms: ${response.rules.routeTransformFields.join(', ')}; max per route: ${response.rules.maxTransformsPerRoute.toString()}`,
    '',
  ]);
}

function formatRoutePathForms(response: CompartmentRoutesSchemaResponse): string {
  return response.rules.routePathForms
    .map((pathForm: string): string => (pathForm === 'exact_path' ? 'exact paths' : 'prefix paths ending with /*'))
    .join(' or ');
}

function createRoutesValidationSection(response: CompartmentRoutesSchemaResponse): string {
  return renderSchemaLines([
    'Validation notes:',
    ...response.currentValidationNotes.map((note: string): string => `- ${note}`),
    '',
  ]);
}

function createRoutesMatchingSection(response: CompartmentRoutesSchemaResponse): string {
  return renderSchemaLines([
    'Matching semantics:',
    ...response.matchingSemantics.map((entry: string): string => `- ${entry}`),
    '',
  ]);
}

function createRoutesTransformSection(response: CompartmentRoutesSchemaResponse): string {
  return renderSchemaLines([
    'Transform semantics:',
    ...response.transformSemantics.map((entry: string): string => `- ${entry}`),
    '',
    `Related files: ${response.relatedFiles.join(', ')}`,
  ]);
}

function joinSchemaSections(...sections: readonly string[]): string {
  return sections.join('\n');
}

function renderSchemaLines(lines: readonly string[]): string {
  return lines.join('\n');
}
