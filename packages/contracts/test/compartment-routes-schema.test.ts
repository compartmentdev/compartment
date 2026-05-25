import { describe, expect, it } from 'vitest';
import {
  compartmentRoutesFileName,
  createCompartmentRoutesSchemaResponse,
  compartmentRoutesSchemaResponseSchema,
  type CompartmentRoutesSchemaResponse,
} from '../src';
import { compartmentRouteMethodValues } from '../src/contracts/compartment-route-rule.contract';
import {
  compartmentRoutesLocation,
  compartmentRoutesMatchingSemantics,
  compartmentRoutesTransformSemantics,
  compartmentRoutesValidationNotes,
} from '../src/contracts/compartment-routes-guide.contract';

describe('compartment routes schema contract', (): void => {
  it('returns parseable route-guide metadata and validation anchors', (): void => {
    const response: CompartmentRoutesSchemaResponse = createCompartmentRoutesSchemaResponse();

    expect(compartmentRoutesSchemaResponseSchema.parse(response)).toEqual(response);
    expect(response.fileName).toBe(compartmentRoutesFileName);
    expect(response.location).toBe(compartmentRoutesLocation);
    expect(response.optional).toBe(true);
    expect(response.rules.requiredRouteFields).toEqual(expect.arrayContaining(['on', 'path', 'to']));
    expect(response.rules.routeFields).toEqual(expect.arrayContaining(['methods', 'stripPrefix', 'rewrite']));
    expect(response.rules.supportedHttpMethods).toEqual(compartmentRouteMethodValues);
    expect(response.rules.routeTransformFields).toEqual(
      expect.arrayContaining(['replacePrefix', 'rewrite', 'stripPrefix']),
    );
    expect(response.currentValidationNotes).toEqual(compartmentRoutesValidationNotes);
    expect(response.matchingSemantics).toEqual(compartmentRoutesMatchingSemantics);
    expect(response.transformSemantics).toEqual(compartmentRoutesTransformSemantics);
    expect(response.exampleYaml).toContain('path: /api/*');
    expect(response.exampleYaml).toContain('stripPrefix: /api');
    expect(response.exampleYaml).toContain('rewrite: /ready');
  });
});
