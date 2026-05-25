import { isVirtualFilename, normalizeFilename } from './filename-helpers.mjs';

function isRouteMapperFilename(filename) {
  return (
    filename.includes('/packages/') &&
    filename.includes('/src/routes/') &&
    !filename.endsWith('.route.ts') &&
    filename.endsWith('response.ts')
  );
}

function isQueryTestFilename(filename) {
  return filename.includes('/packages/') && filename.endsWith('.query.test.ts');
}

export const packageFilePlacementConventionRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'enforce repo-wide package file placement and route presenter naming conventions',
    },
    schema: [],
    messages: {
      noGenericTypesDirectory:
        'Do not add generic src/types buckets. Keep types with the owning layer or package surface such as queries/*.query.types.ts, services/*.service.types.ts, routes/**/.presenter.ts, store/*.types.ts, output/*.types.ts, or client/request support modules.',
      noRoutesSharedDirectory:
        'Do not use routes/shared. Keep feature-local presenters beside the route group or move cross-feature presenters to routes/presenters.',
      usePresenterSuffix:
        'Route-layer DTO mappers must be named *.presenter.ts. Response types belong in contracts, not in runtime package filenames.',
      noQueryTestSuffix:
        'Do not add *.query.test.ts or other thin useless tests. Cover persistence behavior with DB-backed, integration, or higher-layer service/API tests.',
    },
  },
  create(context) {
    const filename = normalizeFilename(context.filename ?? context.getFilename());

    return {
      Program(node) {
        if (isVirtualFilename(filename)) {
          return;
        }

        if (filename.includes('/src/types/')) {
          context.report({
            node,
            messageId: 'noGenericTypesDirectory',
          });
        }

        if (filename.includes('/src/routes/shared/')) {
          context.report({
            node,
            messageId: 'noRoutesSharedDirectory',
          });
        }

        if (isRouteMapperFilename(filename)) {
          context.report({
            node,
            messageId: 'usePresenterSuffix',
          });
        }

        if (isQueryTestFilename(filename)) {
          context.report({
            node,
            messageId: 'noQueryTestSuffix',
          });
        }
      },
    };
  },
};
