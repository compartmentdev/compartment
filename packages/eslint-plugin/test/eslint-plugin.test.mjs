import test from 'node:test';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { noAnonymousInterfaceImplementationRule } from '../rules/no-anonymous-interface-implementation.mjs';
import { noContractDtoInApiServicesRule } from '../rules/no-contract-dto-in-api-services.mjs';
import { packageFilePlacementConventionRule } from '../rules/package-file-placement-convention.mjs';
import { stepDownFunctionOrderRule } from '../rules/step-down-function-order.mjs';

function createTypeScriptRuleTester() {
  return new RuleTester({
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  });
}

function createJavaScriptRuleTester() {
  return new RuleTester({
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  });
}

const contractDtoRulePolicyOptions = {
  contractDtoNamePatterns: ['^[A-Z].*(Summary|Response|ListRow|Option)$'],
  contractDtoNames: ['UserAccessDetail'],
};

function withContractDtoRuleOptions(testCase) {
  return {
    ...testCase,
    options: [
      {
        ...contractDtoRulePolicyOptions,
        ...(testCase.options?.[0] ?? {}),
      },
    ],
  };
}

test('package file placement convention rule', () => {
  const ruleTester = createTypeScriptRuleTester();

  ruleTester.run('package-file-placement-convention', packageFilePlacementConventionRule, {
    valid: [
      {
        code: 'export function buildDeploymentResponse() {}',
        filename: '/repo/packages/api/src/routes/deployments/deployment.presenter.ts',
      },
      {
        code: 'export function buildRuntimeResponse() {}',
        filename: '/repo/packages/node/src/routes/internal/runtime.presenter.ts',
      },
      {
        code: 'export interface LoginRow { id: string; }',
        filename: '/repo/packages/api/src/queries/login.query.types.ts',
      },
      {
        code: 'export interface LoginResult { id: string; }',
        filename: '/repo/packages/api/src/services/login.service.types.ts',
      },
      {
        code: 'export interface CliConfig { path: string; }',
        filename: '/repo/packages/cli/src/store/config.types.ts',
      },
    ],
    invalid: [
      {
        code: 'export interface LoginResult { id: string; }',
        filename: '/repo/packages/api/src/types/login.types.ts',
        errors: [
          {
            message:
              'Do not add generic src/types buckets. Keep types with the owning layer or package surface such as queries/*.query.types.ts, services/*.service.types.ts, routes/**/.presenter.ts, store/*.types.ts, output/*.types.ts, or client/request support modules.',
          },
        ],
      },
      {
        code: 'export function buildDeploymentResponse() {}',
        filename: '/repo/packages/node/src/routes/shared/runtime.presenter.ts',
        errors: [
          {
            message:
              'Do not use routes/shared. Keep feature-local presenters beside the route group or move cross-feature presenters to routes/presenters.',
          },
        ],
      },
      {
        code: 'import { describe, it } from "vitest";',
        filename: '/repo/packages/api/test/variables.query.test.ts',
        errors: [
          {
            message:
              'Do not add *.query.test.ts or other thin useless tests. Cover persistence behavior with DB-backed, integration, or higher-layer service/API tests.',
          },
        ],
      },
    ],
  });
});

test('step-down function order rule', () => {
  const ruleTester = createJavaScriptRuleTester();

  ruleTester.run('step-down-function-order', stepDownFunctionOrderRule, {
    valid: [
      {
        code: `
          export function createNodeApp() {
            registerNodeLifecycle();
            createHeartbeatRunner();
          }

          function registerNodeLifecycle() {}

          function createHeartbeatRunner() {}
        `,
      },
      {
        code: `
          function createNodeApp() {
            const createHeartbeatRunner = () => {};

            createHeartbeatRunner();
          }

          function createHeartbeatRunner() {}
        `,
      },
      {
        code: `
          function createNodeApp() {
            queueMicrotask(() => {
              createHeartbeatRunner();
            });
          }

          function createHeartbeatRunner() {}
        `,
      },
    ],
    invalid: [
      {
        code: `
          function createHeartbeatRunner() {}

          export function createNodeApp() {
            createHeartbeatRunner();
          }
        `,
        errors: [
          {
            message:
              'Top-level function "createHeartbeatRunner" is declared above "createNodeApp". Move "createHeartbeatRunner" below "createNodeApp" to keep step-down order.',
          },
        ],
      },
      {
        code: `
          async function executeInstallCommand() {}

          export function registerInstallCommand(program) {
            program.action(async () => await executeInstallCommand());
          }
        `,
        errors: [
          {
            message:
              'Top-level function "executeInstallCommand" is declared above "registerInstallCommand". Move "executeInstallCommand" below "registerInstallCommand" to keep step-down order.',
          },
        ],
      },
    ],
  });
});

test('no anonymous interface implementation rule', () => {
  const ruleTester = createTypeScriptRuleTester();

  ruleTester.run('no-anonymous-interface-implementation', noAnonymousInterfaceImplementationRule, {
    valid: [
      {
        code: `
          interface Runner {
            runNow(): Promise<void>;
            stop(): void;
          }

          class IntervalRunner implements Runner {
            async runNow(): Promise<void> {
              await Promise.resolve();
            }

            stop(): void {}
          }

          function createRunner(): Runner {
            return new IntervalRunner();
          }
        `,
      },
      {
        code: `
          interface Snapshot {
            id: string;
            status: string;
          }

          function buildSnapshot(): Snapshot {
            return {
              id: 'snap_123',
              status: 'ready',
            };
          }
        `,
      },
      {
        code: `
          interface Runner {
            runNow(): Promise<void>;
          }

          function createLoader(): Promise<typeof import('node:fs/promises')> {
            return Promise.resolve({
              access: async (): Promise<void> => {
                await Promise.resolve();
              },
            });
          }
        `,
      },
      {
        code: `
          interface CliIo {
            stderr(value: string): void;
            stdout(value: string): void;
          }

          class ProcessCliIo implements CliIo {
            stderr(value: string): void {}

            stdout(value: string): void {}
          }

          const io: CliIo = new ProcessCliIo();
        `,
      },
    ],
    invalid: [
      {
        code: `
          interface Runner {
            runNow(): Promise<void>;
            stop(): void;
          }

          function createRunner(): Runner {
            return {
              runNow: async (): Promise<void> => {
                await Promise.resolve();
              },
              stop: (): void => {},
            };
          }
        `,
        errors: [
          {
            message:
              'Do not return an anonymous object implementation for "Runner". Use a named class or another named implementation.',
          },
        ],
      },
      {
        code: `
          interface Runner {
            runNow(): Promise<void>;
            stop(): void;
          }

          function buildRunNow(): () => Promise<void> {
            return async (): Promise<void> => {
              await Promise.resolve();
            };
          }

          function createRunner(): Readonly<Runner> {
            const runNow: () => Promise<void> = buildRunNow();

            return {
              runNow,
              stop: (): void => {},
            };
          }
        `,
        errors: [
          {
            message:
              'Do not return an anonymous object implementation for "Runner". Use a named class or another named implementation.',
          },
        ],
      },
      {
        code: `
          interface RunnerHandle {
            stop(): Promise<void>;
          }

          async function startRunner(): Promise<RunnerHandle> {
            return {
              stop: async (): Promise<void> => {
                await Promise.resolve();
              },
            };
          }
        `,
        errors: [
          {
            message:
              'Do not return an anonymous object implementation for "RunnerHandle". Use a named class or another named implementation.',
          },
        ],
      },
    ],
  });
});

test('no contract DTO in API services rule', () => {
  const ruleTester = createTypeScriptRuleTester();

  ruleTester.run('no-contract-dto-in-api-services', noContractDtoInApiServicesRule, {
    valid: [
      {
        code: "import type { PermissionKey } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access.service.ts',
      },
      {
        code: "import type { CreateAccessGroupRequest } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
      },
      {
        code: "type Permission = import('@compartment/contracts').PermissionKey;",
        filename: '/repo/packages/api/src/services/access.service.ts',
      },
      {
        code: "import { readFriendlyAccessSummary } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/organization-users.service.ts',
      },
      {
        code: "import type { AccessGroupSummary } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/routes/groups/group.presenter.ts',
      },
      {
        code: "import type { AccessGroupSummary } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/legacy.service.ts',
        options: [
          {
            allowed: [
              {
                file: 'packages/api/src/services/legacy.service.ts',
                names: ['AccessGroupSummary'],
              },
            ],
          },
        ],
      },
    ].map(withContractDtoRuleOptions),
    invalid: [
      {
        code: "import type { AccessGroupSummary } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "AccessGroupSummary" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "import { type WorkerRunNextScheduledResourceOperationResponse } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/resource-operation-scheduler.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "WorkerRunNextScheduledResourceOperationResponse" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "import type { AccessGroupListRow, PermissionKey } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "AccessGroupListRow" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "import type { AccessAssignmentScopeProjectOption } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-assignment-scope-options.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "AccessAssignmentScopeProjectOption" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "import type { UserAccessDetail } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-assignments.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "UserAccessDetail" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "import type { AccessGroupSummary } from '@compartment/contracts/browser';",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "AccessGroupSummary" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "type Summary = import('@compartment/contracts').AccessGroupSummary;",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "AccessGroupSummary" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "import type * as Contracts from '@compartment/contracts'; type Summary = Contracts.AccessGroupSummary;",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
        errors: [
          {
            message:
              'Do not namespace-import contracts into API services. Use named imports so contract DTOs cannot bypass the service DTO guard.',
          },
        ],
      },
      {
        code: "import Contracts = require('@compartment/contracts'); type Summary = Contracts.AccessGroupSummary;",
        filename: '/repo/packages/api/src/services/access-groups.service.ts',
        errors: [
          {
            message:
              'Do not namespace-import contracts into API services. Use named imports so contract DTOs cannot bypass the service DTO guard.',
          },
        ],
      },
      {
        code: "export type { AccessGroupSummary } from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-groups.service.types.ts',
        errors: [
          {
            message:
              'Do not import contract DTO "AccessGroupSummary" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
      {
        code: "export * from '@compartment/contracts';",
        filename: '/repo/packages/api/src/services/access-groups.service.types.ts',
        errors: [
          {
            message:
              'Do not re-export contracts from API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
          },
        ],
      },
    ].map(withContractDtoRuleOptions),
  });
});
