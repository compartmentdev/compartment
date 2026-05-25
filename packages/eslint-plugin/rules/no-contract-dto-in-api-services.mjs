import { isVirtualFilename, normalizeFilename } from './filename-helpers.mjs';

function toProjectRelativeFilename(filename) {
  const normalizedFilename = normalizeFilename(filename);
  const packagesIndex = normalizedFilename.indexOf('/packages/');
  return packagesIndex === -1 ? normalizedFilename : normalizedFilename.slice(packagesIndex + 1);
}

function isApiServiceFilename(filename) {
  return toProjectRelativeFilename(filename).startsWith('packages/api/src/services/');
}

function getImportedName(specifier) {
  if (specifier.imported.type === 'Identifier') {
    return specifier.imported.name;
  }

  return String(specifier.imported.value);
}

function getExportedSourceName(specifier) {
  if (specifier.local.type === 'Identifier') {
    return specifier.local.name;
  }

  return String(specifier.local.value);
}

function getImportTypeSourceValue(node) {
  const source = node.source ?? node.argument;
  if (source?.value === undefined) {
    return undefined;
  }

  return String(source.value);
}

function getImportTypeQualifierName(qualifier) {
  if (qualifier === undefined) {
    return undefined;
  }

  if (qualifier.type === 'Identifier') {
    return qualifier.name;
  }

  if (qualifier.type === 'TSQualifiedName') {
    return getImportTypeQualifierName(qualifier.left);
  }

  return undefined;
}

function getImportEqualsModuleSourceValue(node) {
  const moduleReference = node.moduleReference;
  if (moduleReference.type !== 'TSExternalModuleReference') {
    return undefined;
  }

  if (moduleReference.expression.value === undefined) {
    return undefined;
  }

  return String(moduleReference.expression.value);
}

function isContractModule(source) {
  return source === '@compartment/contracts' || source.startsWith('@compartment/contracts/');
}

function createContractDtoNameMatcher(options) {
  const contractDtoNamePatterns = (options.contractDtoNamePatterns ?? []).map((pattern) => new RegExp(pattern, 'u'));
  const contractDtoNames = new Set(options.contractDtoNames ?? []);

  return (name) => contractDtoNames.has(name) || contractDtoNamePatterns.some((pattern) => pattern.test(name));
}

function createAllowedImportSet(allowedImports) {
  return new Set(
    allowedImports.flatMap((allowedImport) =>
      allowedImport.names.map((name) => `${normalizeFilename(allowedImport.file)}#${name}`),
    ),
  );
}

function isAllowedImport(allowedImports, filename, importedName) {
  return allowedImports.has(`${toProjectRelativeFilename(filename)}#${importedName}`);
}

export const noContractDtoInApiServicesRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow contract output DTO imports from API services',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowed: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'names'],
              properties: {
                file: {
                  type: 'string',
                },
                names: {
                  type: 'array',
                  minItems: 1,
                  uniqueItems: true,
                  items: {
                    type: 'string',
                  },
                },
              },
            },
          },
          contractDtoNamePatterns: {
            type: 'array',
            uniqueItems: true,
            items: {
              type: 'string',
            },
          },
          contractDtoNames: {
            type: 'array',
            uniqueItems: true,
            items: {
              type: 'string',
            },
          },
        },
      },
    ],
    messages: {
      noContractDto:
        'Do not import contract DTO "{{name}}" into API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
      noContractExportAll:
        'Do not re-export contracts from API services. Return a service-owned result type and shape contract DTOs in routes or presenters.',
      noContractNamespace:
        'Do not namespace-import contracts into API services. Use named imports so contract DTOs cannot bypass the service DTO guard.',
    },
  },
  create(context) {
    const filename = normalizeFilename(context.filename ?? context.getFilename());
    const options = context.options[0] ?? {};
    const allowedImports = createAllowedImportSet(options.allowed ?? []);
    const isContractDtoName = createContractDtoNameMatcher(options);

    if (isVirtualFilename(filename) || !isApiServiceFilename(filename)) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (!isContractModule(String(node.source.value))) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            context.report({
              node: specifier,
              messageId: 'noContractNamespace',
            });
            continue;
          }

          if (specifier.type !== 'ImportSpecifier') {
            continue;
          }

          const importedName = getImportedName(specifier);
          if (!isContractDtoName(importedName) || isAllowedImport(allowedImports, filename, importedName)) {
            continue;
          }

          context.report({
            node: specifier,
            messageId: 'noContractDto',
            data: {
              name: importedName,
            },
          });
        }
      },
      TSImportEqualsDeclaration(node) {
        const source = getImportEqualsModuleSourceValue(node);
        if (source === undefined || !isContractModule(source)) {
          return;
        }

        context.report({
          node: node.id,
          messageId: 'noContractNamespace',
        });
      },
      TSImportType(node) {
        const source = getImportTypeSourceValue(node);
        if (source === undefined || !isContractModule(source)) {
          return;
        }

        const importedName = getImportTypeQualifierName(node.qualifier);
        if (importedName === undefined || !isContractDtoName(importedName)) {
          return;
        }

        if (isAllowedImport(allowedImports, filename, importedName)) {
          return;
        }

        context.report({
          node: node.qualifier,
          messageId: 'noContractDto',
          data: {
            name: importedName,
          },
        });
      },
      ExportAllDeclaration(node) {
        if (!isContractModule(String(node.source.value))) {
          return;
        }

        context.report({
          node,
          messageId: 'noContractExportAll',
        });
      },
      ExportNamedDeclaration(node) {
        if (node.source?.value === undefined || !isContractModule(String(node.source.value))) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ExportNamespaceSpecifier') {
            context.report({
              node: specifier,
              messageId: 'noContractNamespace',
            });
            continue;
          }

          if (specifier.type !== 'ExportSpecifier') {
            continue;
          }

          const exportedSourceName = getExportedSourceName(specifier);
          if (!isContractDtoName(exportedSourceName) || isAllowedImport(allowedImports, filename, exportedSourceName)) {
            continue;
          }

          context.report({
            node: specifier,
            messageId: 'noContractDto',
            data: {
              name: exportedSourceName,
            },
          });
        }
      },
    };
  },
};
