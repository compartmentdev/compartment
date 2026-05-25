function getTopLevelFunctionDeclaration(statement) {
  if (statement.type === 'FunctionDeclaration' && statement.id !== null) {
    return statement;
  }

  if (
    (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
    statement.declaration?.type === 'FunctionDeclaration'
  ) {
    return statement.declaration;
  }

  return null;
}

function getTopLevelInterfaceDeclaration(statement) {
  if (statement.type === 'TSInterfaceDeclaration') {
    return statement;
  }

  if (
    (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
    statement.declaration?.type === 'TSInterfaceDeclaration'
  ) {
    return statement.declaration;
  }

  return null;
}

function readFunctionName(functionDeclaration) {
  return functionDeclaration.id?.name ?? 'default export function';
}

export const noInterfacesBelowFunctionsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow top-level interfaces declared below top-level functions',
    },
    schema: [],
    messages: {
      moveInterfaceAboveFunctions:
        'Top-level interface "{{interfaceName}}" is declared below function "{{functionName}}". Move "{{interfaceName}}" above top-level functions.',
    },
  },
  create(context) {
    return {
      Program(programNode) {
        let lastFunctionName = null;

        for (const statement of programNode.body) {
          const functionDeclaration = getTopLevelFunctionDeclaration(statement);
          if (functionDeclaration !== null) {
            lastFunctionName = readFunctionName(functionDeclaration);
            continue;
          }

          const interfaceDeclaration = getTopLevelInterfaceDeclaration(statement);
          if (interfaceDeclaration === null || lastFunctionName === null) {
            continue;
          }

          context.report({
            node: interfaceDeclaration.id,
            messageId: 'moveInterfaceAboveFunctions',
            data: {
              functionName: lastFunctionName,
              interfaceName: interfaceDeclaration.id.name,
            },
          });
        }
      },
    };
  },
};
