import importPlugin from 'eslint-plugin-import';
import sonarjs from 'eslint-plugin-sonarjs';
import compartmentPlugin from '@compartment/eslint-plugin';
import baseConfig from './base.mjs';
import examplesConfig from './examples.mjs';
import publicDocsConfig from './public-docs.mjs';
import {
  crossPackagePrivateImportPatterns,
  extendedTestFiles,
  restrictedByPackage,
  runtimeSingletonImportPatterns,
  scriptTypedFiles,
  strictImportFiles,
  testFiles,
} from './shared.mjs';
import typedConfig from './typed.mjs';

function createPackageRestrictionPatterns(packageName) {
  return packageName === undefined
    ? []
    : [
        {
          group: restrictedByPackage[packageName],
        },
      ];
}

function withPackageRestrictedImports(packageName, options) {
  return {
    ...options,
    patterns: [...createPackageRestrictionPatterns(packageName), ...(options.patterns ?? [])],
  };
}

function withCrossPackagePrivateImportBan(options) {
  return {
    ...options,
    patterns: [...crossPackagePrivateImportPatterns, ...(options.patterns ?? [])],
  };
}

function withRuntimeSingletonImportBan(options) {
  return withCrossPackagePrivateImportBan({
    ...options,
    patterns: [...runtimeSingletonImportPatterns, ...(options.patterns ?? [])],
  });
}

function createRestrictedImportsOverride(packageName, options = {}) {
  const { files, ignores, ...restrictedImportsOptions } = options;

  return {
    files: files ?? [`packages/${packageName}/src/**/*.ts`, `packages/${packageName}/src/**/*.tsx`],
    ...(ignores === undefined ? {} : { ignores }),
    rules: {
      'no-restricted-imports': [
        'error',
        withCrossPackagePrivateImportBan(withPackageRestrictedImports(packageName, restrictedImportsOptions)),
      ],
    },
  };
}

function createLayerRestrictedImportsOverride(packageName, files, options) {
  return {
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        withCrossPackagePrivateImportBan(withPackageRestrictedImports(packageName, options)),
      ],
    },
  };
}

function createNonBootstrapRestrictedImportsOverride(packageName, files, options) {
  const { rules, ...restrictedImportsOptions } = options;

  return {
    files,
    ignores: ['packages/*/src/app.ts', 'packages/*/src/server.ts', 'packages/*/src/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        withRuntimeSingletonImportBan(withPackageRestrictedImports(packageName, restrictedImportsOptions)),
      ],
      ...(rules ?? {}),
    },
  };
}

const legacyApiServiceContractDtoImports = [
  {
    file: 'packages/api/src/services/access-roles.service.ts',
    names: ['AccessRoleListRow', 'AccessRoleSummary'],
  },
  {
    file: 'packages/api/src/services/app-access-edge.service.ts',
    names: ['AppAccessStateResponse'],
  },
  {
    file: 'packages/api/src/services/audit-event-export-format.service.ts',
    names: ['AuditEventSummary'],
  },
  {
    file: 'packages/api/src/services/audit-event-file-sink.service.types.ts',
    names: ['AuditEventSummary'],
  },
  {
    file: 'packages/api/src/services/audit-events.service.ts',
    names: ['AuditEventActorSummary', 'AuditEventSummary', 'AuditEventTargetSummary'],
  },
  {
    file: 'packages/api/src/services/audit-events.service.types.ts',
    names: ['AuditEventListResponse', 'AuditEventSummary'],
  },
  {
    file: 'packages/api/src/services/git-source/git-source-descriptor-pr-token.service.ts',
    names: ['GitDescriptorPullRequestResponse'],
  },
  {
    file: 'packages/api/src/services/git-source/git-source-descriptor.service.ts',
    names: ['GitDescriptorPlanResponse', 'GitDescriptorPullRequestResponse', 'GitDescriptorPullRequestStatusResponse'],
  },
  {
    file: 'packages/api/src/services/git-source/git-source-repository-list.service.ts',
    names: ['GitHubInstallationRepositoryListResponse', 'GitHubInstallationRepositorySummary'],
  },
  {
    file: 'packages/api/src/services/git-source/git-source.service.types.ts',
    names: ['GitSourceExclusionSummary'],
  },
  {
    file: 'packages/api/src/services/git-source/github-account-discovery-broker.adapter.ts',
    names: ['GitHubAccountDiscoveryResultResponse', 'GitHubAccountDiscoveryStartResponse'],
  },
  {
    file: 'packages/api/src/services/git-source/github-account-discovery.service.ts',
    names: ['GitHubAccountDiscoveryResultResponse', 'GitHubAccountDiscoveryStartResponse'],
  },
  {
    file: 'packages/api/src/services/onboarding-first-deploy.service.ts',
    names: ['FirstDeployOnboardingStatusResponse'],
  },
  {
    file: 'packages/api/src/services/organization-settings.service.types.ts',
    names: ['OrganizationSettingsSummary'],
  },
  {
    file: 'packages/api/src/services/project-list-overview.service.ts',
    names: ['ProjectRouteTargetSummary'],
  },
  {
    file: 'packages/api/src/services/project-overview-environment.service.ts',
    names: ['ProjectRouteTargetSummary'],
  },
  {
    file: 'packages/api/src/services/project-overview-route.service.ts',
    names: ['ProjectRouteTargetSummary'],
  },
  {
    file: 'packages/api/src/services/projects.service.types.ts',
    names: ['ProjectRouteTargetSummary'],
  },
  {
    file: 'packages/api/src/services/resource-backup-manifest.service.ts',
    names: ['EnvironmentSummary', 'ProjectSummary', 'ResourceSummary', 'ResourceVolumeSummary'],
  },
  {
    file: 'packages/api/src/services/resources-reconcile.validation.ts',
    names: ['ResourceVolumeSummary'],
  },
  {
    file: 'packages/api/src/services/resources.service.helpers.ts',
    names: ['ResourceEnvSourceSummary', 'ResourceReadinessSummary', 'ResourceVolumeSummary'],
  },
  {
    file: 'packages/api/src/services/resources.service.storage.ts',
    names: ['ResourceEnvSourceSummary', 'ResourceReadinessSummary', 'ResourceVolumeSummary'],
  },
  {
    file: 'packages/api/src/services/resources.service.ts',
    names: ['ResourceVolumeSummary'],
  },
  {
    file: 'packages/api/src/services/system-domain-status.mapper.ts',
    names: ['SystemDomainStatusResponse'],
  },
];

const apiServiceContractDtoNamePatterns = ['^[A-Z].*(Summary|Response|ListRow|Option)$'];

const apiServiceContractDtoNames = [
  'CompartmentDescriptorSchemaDefaults',
  'CompartmentDescriptorSchemaRules',
  'LoginOrganizationChoice',
  'ProjectEnvironmentOverview',
  'UserAccessDetail',
];

const consoleSelectionPrimitiveImportMessage =
  'Console feature code must use the public Select, ComboBox, or MultiComboBox primitives from packages/console/src/components/.';

export const repoConfig = [
  ...baseConfig,
  ...typedConfig,
  ...publicDocsConfig,
  ...examplesConfig,
  createLayerRestrictedImportsOverride(
    undefined,
    ['packages/**/*.ts', 'packages/**/*.tsx', 'packages/**/*.mts', ...scriptTypedFiles],
    {},
  ),
  {
    files: testFiles,
    plugins: {
      compartment: compartmentPlugin,
      import: importPlugin,
      sonarjs,
    },
    rules: {
      'boundaries/element-types': 'off',
      'compartment/no-inline-multiline-text-join': 'error',
      'compartment/package-file-placement-convention': 'error',
      'import/first': 'error',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-empty-test-file': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      'sonarjs/void-use': 'off',
    },
  },
  {
    files: ['.husky/**/*.mjs', '.husky/**/*.js', '.husky/**/*.cjs'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: testFiles,
    rules: {
      'max-lines': [
        'error',
        {
          max: 1000,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: extendedTestFiles,
    rules: {
      'max-lines': [
        'error',
        {
          max: 1400,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    rules: {
      'max-lines': [
        'error',
        {
          max: 250,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-lines-per-function': [
        'error',
        {
          max: 25,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-statements': ['error', 12],
    },
  },
  {
    files: ['packages/*/src/routes/**/*.ts'],
    rules: {
      'compartment/no-single-property-dependency': 'error',
    },
  },
  {
    files: ['packages/console/src/features/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          message: consoleSelectionPrimitiveImportMessage,
          selector: 'JSXOpeningElement[name.name="select"]',
        },
      ],
    },
  },
  createRestrictedImportsOverride('contracts'),
  createRestrictedImportsOverride('utils'),
  createRestrictedImportsOverride('api'),
  createRestrictedImportsOverride('console', {
    ignores: ['packages/console/src/components/ui/icons.ts'],
    paths: [
      {
        name: 'lucide-react',
        message: 'Import icons from packages/console/src/components/ui/icons instead of lucide-react directly.',
      },
    ],
  }),
  createLayerRestrictedImportsOverride(
    'console',
    ['packages/console/src/features/**/*.ts', 'packages/console/src/features/**/*.tsx'],
    {
      paths: [
        {
          name: 'lucide-react',
          message: 'Import icons from packages/console/src/components/ui/icons instead of lucide-react directly.',
        },
      ],
      patterns: [
        {
          group: ['**/components/ui/autocomplete-multi-select', '**/components/ui/native-select'],
          message: consoleSelectionPrimitiveImportMessage,
        },
      ],
    },
  ),
  createRestrictedImportsOverride('edge'),
  createRestrictedImportsOverride('docker'),
  createRestrictedImportsOverride('node'),
  createRestrictedImportsOverride('cli'),
  createRestrictedImportsOverride('sdk'),
  createRestrictedImportsOverride('source-archive'),
  createRestrictedImportsOverride('worker'),
  createRestrictedImportsOverride('test-support'),
  createNonBootstrapRestrictedImportsOverride('api', ['packages/api/src/**/*.ts', 'packages/api/src/**/*.tsx'], {}),
  createNonBootstrapRestrictedImportsOverride('edge', ['packages/edge/src/**/*.ts'], {}),
  createNonBootstrapRestrictedImportsOverride('api', ['packages/api/src/routes/**/*.ts'], {
    patterns: [
      {
        group: ['**/db/**'],
        message: 'Routes are boundary-only; use services instead of DB modules.',
      },
      {
        group: ['**/queries/**'],
        message: 'Routes are boundary-only; use services instead of query modules.',
      },
    ],
  }),
  createNonBootstrapRestrictedImportsOverride('api', ['packages/api/src/services/**/*.ts'], {
    paths: [
      {
        name: 'fastify',
        message: 'Services must not depend on Fastify boundary types or runtime.',
      },
    ],
    patterns: [
      {
        group: ['**/db/**'],
        message: 'Services must not access DB modules directly. Move persistence to queries/.',
      },
      {
        group: ['**/routes/**'],
        message: 'Services must not depend on route-layer modules.',
      },
      {
        group: ['**/http/**'],
        message: 'Services must not depend on HTTP-layer modules or throw HTTP-specific errors.',
      },
      {
        group: ['@fastify/*'],
        message: 'Services must not depend on Fastify boundary modules.',
      },
      {
        group: ['**/errors/api-boundary-error'],
        message: 'Services must not throw HTTP-specific boundary errors.',
      },
    ],
    rules: {
      'compartment/no-contract-dto-in-api-services': [
        'error',
        {
          contractDtoNamePatterns: apiServiceContractDtoNamePatterns,
          contractDtoNames: apiServiceContractDtoNames,
          allowed: legacyApiServiceContractDtoImports,
        },
      ],
    },
  }),
  createNonBootstrapRestrictedImportsOverride('api', ['packages/api/src/queries/**/*.ts'], {
    paths: [
      {
        name: 'fastify',
        message: 'Queries must not depend on Fastify boundary types or runtime.',
      },
    ],
    patterns: [
      {
        group: ['**/routes/**'],
        message: 'Queries are persistence-only and must not depend on routes.',
      },
      {
        group: ['**/services/**'],
        message: 'Queries are persistence-only and must not depend on services.',
      },
      {
        group: ['**/http/**'],
        message: 'Queries must not depend on HTTP-layer modules.',
      },
      {
        group: ['@fastify/*'],
        message: 'Queries must not depend on Fastify boundary modules.',
      },
    ],
  }),
  createLayerRestrictedImportsOverride('cli', ['packages/cli/src/commands/**/*.ts'], {
    paths: [
      {
        name: '@compartment/sdk',
        message: 'CLI commands must stay thin and call CLI services instead of SDK clients directly.',
      },
    ],
  }),
  createLayerRestrictedImportsOverride('cli', ['packages/cli/src/services/**/*.ts'], {
    paths: [
      {
        name: 'commander',
        message: 'CLI services must not depend on commander directly.',
      },
    ],
    patterns: [
      {
        group: ['**/commands/**'],
        message: 'CLI services must not depend on command-layer modules.',
      },
      {
        group: ['**/output/**'],
        message: 'CLI services must not depend on stdout/stderr formatting helpers.',
      },
      {
        group: ['**/prompts/**'],
        message: 'CLI services must not depend on prompt boundary modules.',
      },
      {
        group: ['**/*.output', '**/*.output.*'],
        message: 'CLI services must not depend on stdout/stderr formatting helpers.',
      },
    ],
  }),
  createNonBootstrapRestrictedImportsOverride('edge', ['packages/edge/src/routes/**/*.ts'], {
    patterns: [],
  }),
  createNonBootstrapRestrictedImportsOverride('edge', ['packages/edge/src/services/**/*.ts'], {
    paths: [
      {
        name: 'fastify',
        message: 'Edge services must not depend on Fastify boundary types or runtime.',
      },
    ],
    patterns: [
      {
        group: ['**/routes/**'],
        message: 'Edge services must not depend on route-layer modules.',
      },
      {
        group: ['@fastify/*'],
        message: 'Edge services must not depend on Fastify boundary modules.',
      },
    ],
  }),
  {
    files: strictImportFiles,
    rules: {
      'import/no-unassigned-import': [
        'error',
        {
          allow: ['**/*.css', '**/http/request.types'],
        },
      ],
    },
  },
  {
    rules: {
      curly: ['error', 'all'],
    },
  },
];
