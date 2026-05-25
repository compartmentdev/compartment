import { describe, expect, it } from 'vitest';
import type { CompartmentAuthoredDescriptor, CompartmentRoutesFile } from '@compartment/contracts';
import {
  filterSourceCompartmentRoutes,
  parseSerializedCompartmentRoutes,
  serializeCompartmentRoutes,
  validateDescriptorRoutes,
} from '../src/services/compartment-routes.service';

describe('compartment routes service', (): void => {
  it('filters only source-owned rules for a deployment', (): void => {
    const routes: CompartmentRoutesFile = createRoutesFile();

    expect(filterSourceCompartmentRoutes(routes, 'web')).toEqual(routes.routes);
    expect(filterSourceCompartmentRoutes(routes, 'backoffice')).toEqual([]);
  });

  it('round-trips serialized deployment routes', (): void => {
    const routes: CompartmentRoutesFile = createRoutesFile();

    expect(parseSerializedCompartmentRoutes(serializeCompartmentRoutes(routes.routes))).toEqual(routes.routes);
  });

  it('rejects routes that reference unknown descriptor services', (): void => {
    try {
      validateDescriptorRoutes(createDescriptor(), {
        routes: [
          {
            on: 'web',
            path: '/api/*',
            stripPrefix: '/api',
            to: 'missing',
          },
        ],
        version: 1,
      });
      throw new Error('Expected descriptor route validation to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'descriptor_service_not_found',
      });
    }
  });

  it('rejects routes that target non-routable service kinds', (): void => {
    try {
      validateDescriptorRoutes(
        {
          name: 'smoke-multi-service',
          services: {
            web: '.',
            worker: {
              kind: 'worker',
              path: './services/worker',
            },
          },
        },
        {
          routes: [
            {
              on: 'web',
              path: '/jobs/*',
              stripPrefix: '/jobs',
              to: 'worker',
            },
          ],
          version: 1,
        },
      );
      throw new Error('Expected routable service validation to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unsupported_service_kind',
      });
    }
  });

  it('accepts routes between routable static and api services', (): void => {
    expect((): void =>
      validateDescriptorRoutes(
        {
          name: 'smoke-multi-service',
          services: {
            api: {
              kind: 'api',
              path: './services/api',
            },
            site: {
              build: {
                outputDirectory: 'dist',
              },
              kind: 'static',
              path: './apps/site',
            },
          },
        },
        {
          routes: [
            {
              on: 'site',
              path: '/api/*',
              stripPrefix: '/api',
              to: 'api',
            },
          ],
          version: 1,
        },
      ),
    ).not.toThrow();
  });
});

function createDescriptor(): CompartmentAuthoredDescriptor {
  return {
    name: 'smoke-multi-service',
    services: {
      backoffice: {
        kind: 'api',
        path: './services/backoffice',
      },
      web: '.',
    },
  };
}

function createRoutesFile(): CompartmentRoutesFile {
  return {
    routes: [
      {
        on: 'web',
        path: '/api/*',
        stripPrefix: '/api',
        to: 'backoffice',
      },
    ],
    version: 1,
  };
}
