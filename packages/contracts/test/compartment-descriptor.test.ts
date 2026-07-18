import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';

import {
  compartmentAuthoredDescriptorSchema,
  compartmentInitResultSchema,
  formatCompartmentAuthoredDescriptor,
  readCompartmentDescriptorCompatibilityWarnings,
  type CompartmentAuthoredDescriptor,
  type CompartmentInitResult,
} from '../src';

describe('compartment descriptor contracts', (): void => {
  it('accepts a minimal authored descriptor', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      services: {
        web: '.',
      },
    });

    expect(descriptor.name).toBe('backoffice');
  });

  it('accepts a service object with kind', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      services: {
        '2fa-api': {
          kind: 'worker',
          path: 'apps/worker',
        },
        admin_ui: 'apps/admin-ui',
      },
    });

    expect(descriptor.services['2fa-api']).toEqual({
      kind: 'worker',
      path: 'apps/worker',
    });
    expect(descriptor.services.admin_ui).toBe('apps/admin-ui');
  });

  it('accepts a service object with readiness config', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      services: {
        web: {
          build: {
            command: 'pnpm build',
            env: ['VITE_PUBLIC_API_URL'],
            include: ['../../package.json', '../../packages/shared-ui'],
            packages: {
              runtime: ['libnss3'],
            },
            strategy: 'railpack',
          },
          path: 'apps/web',
          run: {
            command: 'pnpm start',
          },
          readiness: {
            path: '/ready',
            timeoutMs: 10_000,
            type: 'http',
          },
        },
      },
    });

    expect(descriptor.services.web).toEqual({
      build: {
        command: 'pnpm build',
        env: ['VITE_PUBLIC_API_URL'],
        include: ['../../package.json', '../../packages/shared-ui'],
        packages: {
          runtime: ['libnss3'],
        },
        strategy: 'railpack',
      },
      path: 'apps/web',
      run: {
        command: 'pnpm start',
      },
      readiness: {
        path: '/ready',
        timeoutMs: 10_000,
        type: 'http',
      },
    });
  });

  it('formats authored descriptor fields without dropping nested config', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = {
      name: 'backoffice',
      resources: {
        db: {
          image: 'postgres:16',
          ports: [5432],
        },
      },
      services: {
        web: {
          accessMode: 'public',
          build: {
            command: 'pnpm build',
          },
          path: 'apps/web',
          run: {
            command: 'pnpm start',
          },
        },
      },
    };

    expect(formatCompartmentAuthoredDescriptor(descriptor)).toContain('db: {"image":"postgres:16","ports":[5432]}');
    expect(formatCompartmentAuthoredDescriptor(descriptor)).toContain(
      'web: {"accessMode":"public","build":{"command":"pnpm build"},"path":"apps/web","run":{"command":"pnpm start"}}',
    );
  });

  it('accepts a static service with build.outputDirectory', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'marketing-site',
      services: {
        site: {
          kind: 'static',
          path: 'apps/site',
          build: {
            command: 'pnpm build',
            outputDirectory: 'dist',
          },
        },
      },
    });

    expect(descriptor.services.site).toEqual({
      kind: 'static',
      path: 'apps/site',
      build: {
        command: 'pnpm build',
        outputDirectory: 'dist',
      },
    });
  });

  it('rejects descriptors without a name', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        services: {
          web: '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects service object form that uses type instead of kind', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          worker: {
            path: 'apps/worker',
            type: 'worker',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects descriptors without services', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {},
      });

    expect(result.success).toBe(false);
  });

  it('rejects dockerfile build configs with a build command', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              command: 'pnpm build',
              strategy: 'dockerfile',
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects dockerfile build configs with build packages', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              packages: {
                runtime: ['libnss3'],
              },
              strategy: 'dockerfile',
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects static services without build.outputDirectory', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'marketing-site',
        services: {
          site: {
            kind: 'static',
            path: 'apps/site',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects build.outputDirectory on non-static services', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            path: 'apps/web',
            build: {
              outputDirectory: 'dist',
            },
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it.each(['auto', 'dockerfile', 'railpack'] as const)(
    'rejects static services with build.strategy %s',
    (strategy: 'auto' | 'dockerfile' | 'railpack'): void => {
      const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
        compartmentAuthoredDescriptorSchema.safeParse({
          name: 'marketing-site',
          services: {
            site: {
              kind: 'static',
              path: 'apps/site',
              build: {
                outputDirectory: 'dist',
                strategy,
              },
            },
          },
        });

      expect(result.success).toBe(false);
      if (result.success) {
        return;
      }

      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'kind: static does not support build.strategy.',
          path: ['services', 'site', 'build', 'strategy'],
        }),
      );
    },
  );

  it.each(['/dist', 'C:\\dist', '../dist', 'dist/../../release', '.', './', 'dist/..'])(
    'rejects invalid static build.outputDirectory path %s',
    (outputDirectory: string): void => {
      const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
        compartmentAuthoredDescriptorSchema.safeParse({
          name: 'marketing-site',
          services: {
            site: {
              kind: 'static',
              path: 'apps/site',
              build: {
                command: 'pnpm build',
                outputDirectory,
              },
            },
          },
        });

      expect(result.success).toBe(false);
    },
  );

  it('rejects static services with run, release, or readiness blocks', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'marketing-site',
        services: {
          site: {
            kind: 'static',
            path: 'apps/site',
            build: {
              outputDirectory: 'dist',
            },
            readiness: {
              path: '/ready',
              timeoutMs: 10_000,
              type: 'http',
            },
            run: {
              command: 'pnpm start',
            },
            release: {
              command: 'pnpm db:migrate',
            },
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects empty build packages blocks', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              packages: {},
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('accepts build packages with apt version and arch tokens', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      services: {
        web: {
          build: {
            packages: {
              build: ['ffmpeg=7.1'],
              runtime: ['libnss3:amd64', 'libatk-bridge2.0-0'],
            },
          },
          path: 'apps/web',
        },
      },
    });

    expect(descriptor.services.web).toEqual({
      build: {
        packages: {
          build: ['ffmpeg=7.1'],
          runtime: ['libnss3:amd64', 'libatk-bridge2.0-0'],
        },
      },
      path: 'apps/web',
    });
  });

  it('rejects build packages with shell metacharacters', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              packages: {
                runtime: ['libnss3$(id)'],
              },
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects build include entries with glob syntax', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              include: ['../../packages/*'],
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects absolute build include entries', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              include: ['/tmp/shared'],
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects empty build include entries', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              include: [''],
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects build env keys that use the reserved compartment prefix', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              env: ['COMPARTMENT_API_URL'],
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects empty run commands', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            path: 'apps/web',
            run: {
              command: '',
            },
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects empty run config blocks', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            path: 'apps/web',
            run: {},
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it.each(['no', 'on-failure', 'unless-stopped'] as const)(
    'accepts deprecated service restart policy %s for Docker-line compatibility',
    (policy: 'no' | 'on-failure' | 'unless-stopped'): void => {
      const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
        name: 'backoffice',
        services: {
          web: {
            path: 'apps/web',
            run: {
              restart: {
                ...(policy === 'on-failure' ? { maxRetries: 2 } : {}),
                policy,
              },
            },
          },
        },
      });

      expect(descriptor.services.web).toMatchObject({
        run: {
          restart: {
            policy,
          },
        },
      });
    },
  );

  it('rejects maxRetries outside the deprecated on-failure policy', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            path: 'apps/web',
            run: {
              restart: {
                maxRetries: 2,
                policy: 'unless-stopped',
              },
            },
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('describes deprecated restart settings and actual Kubernetes behavior', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      resources: {
        db: {
          image: 'postgres:16',
          restart: {},
        },
      },
      services: {
        web: {
          path: 'apps/web',
          run: {
            restart: {
              maxRetries: 2,
              policy: 'on-failure',
            },
          },
        },
      },
    });

    expect(readCompartmentDescriptorCompatibilityWarnings(descriptor)).toEqual([
      {
        message:
          'Warning: deprecated services.web.run.restart={"maxRetries":2,"policy":"on-failure"} is accepted for Docker-line compatibility but is not applied on Kubernetes. Kubernetes Deployment Pods use restartPolicy Always while the Deployment is running; compartment project stop scales service Deployments to zero.',
        path: 'services.web.run.restart',
        value: '{"maxRetries":2,"policy":"on-failure"}',
      },
      {
        message:
          'Warning: deprecated resources.db.restart={"policy":"unless-stopped"} is accepted for Docker-line compatibility but is not applied on Kubernetes. Kubernetes Deployment Pods use restartPolicy Always while the Deployment is running; compartment resource stop --resource db scales this resource Deployment to zero.',
        path: 'resources.db.restart',
        value: '{"policy":"unless-stopped"}',
      },
    ]);
  });

  it('does not warn when deprecated restart settings are absent', (): void => {
    const descriptor: CompartmentAuthoredDescriptor = compartmentAuthoredDescriptorSchema.parse({
      name: 'backoffice',
      services: { web: '.' },
    });

    expect(readCompartmentDescriptorCompatibilityWarnings(descriptor)).toEqual([]);
  });

  it('rejects explicit dockerfile services with a run command', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              strategy: 'dockerfile',
            },
            path: 'apps/web',
            run: {
              command: 'pnpm start',
            },
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects build env keys that are not valid environment variable identifiers', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: {
            build: {
              env: ['NEXT_PUBLIC API URL'],
            },
            path: 'apps/web',
          },
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects empty service paths', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          web: '',
        },
      });

    expect(result.success).toBe(false);
  });

  it('rejects invalid service names', (): void => {
    const result: SafeParseReturnType<CompartmentAuthoredDescriptor, CompartmentAuthoredDescriptor> =
      compartmentAuthoredDescriptorSchema.safeParse({
        name: 'backoffice',
        services: {
          'Admin UI': '.',
        },
      });

    expect(result.success).toBe(false);
  });

  it('accepts a valid init result payload', (): void => {
    const result: CompartmentInitResult = compartmentInitResultSchema.parse({
      descriptor: {
        name: 'backoffice',
        services: {
          web: '.',
        },
      },
      file: './compartment.yml',
    });

    expect(result.file).toBe('./compartment.yml');
  });
});
