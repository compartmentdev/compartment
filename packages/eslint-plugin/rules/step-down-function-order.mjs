function getTopLevelFunctionDeclaration(statement) {
  if (statement.type === 'FunctionDeclaration' && statement.id !== null) {
    return statement;
  }

  if (
    (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') &&
    statement.declaration?.type === 'FunctionDeclaration' &&
    statement.declaration.id !== null
  ) {
    return statement.declaration;
  }

  return null;
}

function findVariable(scope, name) {
  let currentScope = scope;

  while (currentScope !== null) {
    const variable = currentScope.set.get(name);

    if (variable !== undefined) {
      return variable;
    }

    currentScope = currentScope.upper;
  }

  return null;
}

function getTopLevelScope(programNode, sourceCode) {
  const programScope = sourceCode.getScope(programNode);
  const moduleScope = programScope.childScopes.find((scope) => scope.type === 'module');

  return moduleScope ?? programScope;
}

function isNestedBoundary(node) {
  return node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
}

function visitDescendants(node, sourceCode, visitor) {
  const childKeys = sourceCode.visitorKeys[node.type] ?? [];

  for (const key of childKeys) {
    const value = node[key];

    if (Array.isArray(value)) {
      for (const child of value) {
        if (child === null || typeof child.type !== 'string') {
          continue;
        }

        if (isNestedBoundary(child)) {
          continue;
        }

        visitor(child);
        visitDescendants(child, sourceCode, visitor);
      }

      continue;
    }

    if (value === null || typeof value?.type !== 'string') {
      continue;
    }

    if (isNestedBoundary(value)) {
      continue;
    }

    visitor(value);
    visitDescendants(value, sourceCode, visitor);
  }
}

function buildTopLevelFunctions(programNode, sourceCode) {
  const moduleScope = getTopLevelScope(programNode, sourceCode);
  const topLevelFunctions = [];

  for (const statement of programNode.body) {
    const declaration = getTopLevelFunctionDeclaration(statement);

    if (declaration === null || declaration.id === null) {
      continue;
    }

    const variable = moduleScope.set.get(declaration.id.name);

    if (variable === undefined) {
      continue;
    }

    topLevelFunctions.push({
      index: topLevelFunctions.length,
      name: declaration.id.name,
      node: declaration,
      variable,
    });
  }

  return topLevelFunctions;
}

export const stepDownFunctionOrderRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'enforce top-level step-down function order',
    },
    schema: [],
    messages: {
      moveCalleeBelowCaller:
        'Top-level function "{{calleeName}}" is declared above "{{callerName}}". Move "{{calleeName}}" below "{{callerName}}" to keep step-down order.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program(programNode) {
        const topLevelFunctions = buildTopLevelFunctions(programNode, sourceCode);
        const topLevelFunctionByVariable = new Map(topLevelFunctions.map((entry) => [entry.variable, entry]));
        const reportedPairs = new Set();

        for (const callerEntry of topLevelFunctions) {
          visitDescendants(callerEntry.node.body, sourceCode, (node) => {
            if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') {
              return;
            }

            const resolvedVariable = findVariable(sourceCode.getScope(node), node.callee.name);

            if (resolvedVariable === null || resolvedVariable === callerEntry.variable) {
              return;
            }

            const calleeEntry = topLevelFunctionByVariable.get(resolvedVariable);

            if (calleeEntry === undefined || calleeEntry.index > callerEntry.index) {
              return;
            }

            const reportKey = `${callerEntry.name}->${calleeEntry.name}`;

            if (reportedPairs.has(reportKey)) {
              return;
            }

            reportedPairs.add(reportKey);
            context.report({
              node: node.callee,
              messageId: 'moveCalleeBelowCaller',
              data: {
                callerName: callerEntry.name,
                calleeName: calleeEntry.name,
              },
            });
          });
        }
      },
    };
  },
};
