function readTypeName(typeNode) {
  if (typeNode.type === 'Identifier') {
    return typeNode.name;
  }

  if (typeNode.type === 'TSQualifiedName') {
    return `${readTypeName(typeNode.left)}.${typeNode.right.name}`;
  }

  return null;
}

function unwrapNamedBehaviorType(typeNode) {
  if (typeNode == null) {
    return null;
  }

  if (typeNode.type === 'TSParenthesizedType') {
    return unwrapNamedBehaviorType(typeNode.typeAnnotation);
  }

  if (typeNode.type !== 'TSTypeReference') {
    return null;
  }

  const typeName = readTypeName(typeNode.typeName);
  if (typeName === null) {
    return null;
  }

  if ((typeName === 'Promise' || typeName === 'Readonly') && typeNode.typeArguments?.params.length === 1) {
    return unwrapNamedBehaviorType(typeNode.typeArguments.params[0]);
  }

  return typeName;
}

function isFunctionLikeBindingDeclarator(declarator) {
  if (declarator.id.type !== 'Identifier') {
    return false;
  }

  if (declarator.init?.type === 'ArrowFunctionExpression' || declarator.init?.type === 'FunctionExpression') {
    return true;
  }

  return declarator.id.typeAnnotation?.typeAnnotation.type === 'TSFunctionType';
}

function returnsCallableValue(typeNode) {
  if (typeNode == null) {
    return false;
  }

  if (typeNode.type === 'TSParenthesizedType') {
    return returnsCallableValue(typeNode.typeAnnotation);
  }

  return typeNode.type === 'TSFunctionType';
}

function visitChildNodes(node, visitNode) {
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }

    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child != null && typeof child.type === 'string') {
          visitNode(child);
        }
      }
      continue;
    }

    if (value != null && typeof value.type === 'string') {
      visitNode(value);
    }
  }
}

function getProgramNode(node) {
  let currentNode = node;

  while (currentNode.parent != null) {
    currentNode = currentNode.parent;
  }

  return currentNode.type === 'Program' ? currentNode : null;
}

function collectCallableBindings(node, callableBindings, callableFactories) {
  if (node.type === 'FunctionDeclaration' && node.id != null) {
    if (returnsCallableValue(node.returnType?.typeAnnotation ?? null)) {
      callableFactories.add(node.id.name);
      return;
    }

    callableBindings.add(node.id.name);
    return;
  }

  if (node.type === 'VariableDeclarator' && isFunctionLikeBindingDeclarator(node)) {
    callableBindings.add(node.id.name);
    return;
  }

  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression'
  ) {
    return;
  }

  visitChildNodes(node, (childNode) => {
    collectCallableBindings(childNode, callableBindings, callableFactories);
  });
}

function getCallableBindings(scopeNode) {
  const callableBindings = new Set();
  const callableFactories = new Set();
  const programNode = getProgramNode(scopeNode);

  if (programNode !== null) {
    collectCallableBindings(programNode, callableBindings, callableFactories);
  }

  if (scopeNode.type === 'Program') {
    return {
      callableBindings,
      callableFactories,
    };
  }

  if (scopeNode.body.type !== 'BlockStatement') {
    return {
      callableBindings,
      callableFactories,
    };
  }

  collectCallableBindings(scopeNode.body, callableBindings, callableFactories);
  return {
    callableBindings,
    callableFactories,
  };
}

function isCallablePropertyValue(property, callableBindings, callableFactories) {
  if (property.type !== 'Property') {
    return false;
  }

  if (property.method) {
    return true;
  }

  if (property.value.type === 'ArrowFunctionExpression' || property.value.type === 'FunctionExpression') {
    return true;
  }

  if (property.value.type === 'Identifier') {
    return callableBindings.has(property.value.name);
  }

  if (property.value.type === 'CallExpression' && property.value.callee.type === 'Identifier') {
    return callableFactories.has(property.value.callee.name);
  }

  return false;
}

function hasCallableMembers(objectExpression, callableBindings, callableFactories) {
  return objectExpression.properties.some((property) =>
    isCallablePropertyValue(property, callableBindings, callableFactories),
  );
}

function unwrapObjectExpression(node) {
  if (node.type === 'ObjectExpression') {
    return node;
  }

  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'Object' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'freeze' &&
    node.arguments.length >= 1 &&
    node.arguments[0].type === 'ObjectExpression'
  ) {
    return node.arguments[0];
  }

  return null;
}

function inspectObjectExpression(context, objectExpression, typeName, callableBindings, callableFactories) {
  if (!hasCallableMembers(objectExpression, callableBindings, callableFactories)) {
    return;
  }

  context.report({
    node: objectExpression,
    messageId: 'useNamedImplementation',
    data: {
      typeName,
    },
  });
}

function inspectFunction(context, functionNode) {
  if (functionNode.body.type !== 'BlockStatement') {
    return;
  }

  const typeName = unwrapNamedBehaviorType(functionNode.returnType?.typeAnnotation ?? null);
  if (typeName === null) {
    return;
  }

  const { callableBindings, callableFactories } = getCallableBindings(functionNode);

  for (const statement of functionNode.body.body) {
    inspectStatement(context, statement, typeName, callableBindings, callableFactories);
  }
}

function inspectStatement(context, node, typeName, callableBindings, callableFactories) {
  if (node.type === 'ReturnStatement' && node.argument != null) {
    const objectExpression = unwrapObjectExpression(node.argument);
    if (objectExpression !== null) {
      inspectObjectExpression(context, objectExpression, typeName, callableBindings, callableFactories);
    }
    return;
  }

  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression'
  ) {
    return;
  }

  visitChildNodes(node, (childNode) => {
    inspectStatement(context, childNode, typeName, callableBindings, callableFactories);
  });
}

function getNearestScopeNode(node) {
  let currentNode = node.parent;

  while (currentNode != null) {
    if (
      currentNode.type === 'FunctionDeclaration' ||
      currentNode.type === 'FunctionExpression' ||
      currentNode.type === 'ArrowFunctionExpression'
    ) {
      return currentNode;
    }

    currentNode = currentNode.parent;
  }

  return getProgramNode(node);
}

function getScopeCallableBindings(node) {
  const scopeNode = getNearestScopeNode(node);

  if (scopeNode === null) {
    return {
      callableBindings: new Set(),
      callableFactories: new Set(),
    };
  }

  return getCallableBindings(scopeNode);
}

function inspectVariableDeclarator(context, node) {
  if (node.id.type !== 'Identifier' || node.id.typeAnnotation == null || node.init == null) {
    return;
  }

  const typeName = unwrapNamedBehaviorType(node.id.typeAnnotation.typeAnnotation);
  if (typeName === null) {
    return;
  }

  const objectExpression = unwrapObjectExpression(node.init);
  if (objectExpression === null) {
    return;
  }

  const { callableBindings, callableFactories } = getScopeCallableBindings(node);
  inspectObjectExpression(context, objectExpression, typeName, callableBindings, callableFactories);
}

function inspectTypeAssertionLike(context, node) {
  const typeName = unwrapNamedBehaviorType(node.typeAnnotation);
  if (typeName === null) {
    return;
  }

  const objectExpression = unwrapObjectExpression(node.expression);
  if (objectExpression === null) {
    return;
  }

  const { callableBindings, callableFactories } = getScopeCallableBindings(node);
  inspectObjectExpression(context, objectExpression, typeName, callableBindings, callableFactories);
}

export const noAnonymousInterfaceImplementationRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow anonymous object implementations of named behavioral return types',
    },
    schema: [],
    messages: {
      useNamedImplementation:
        'Do not return an anonymous object implementation for "{{typeName}}". Use a named class or another named implementation.',
    },
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        inspectFunction(context, node);
      },
      FunctionExpression(node) {
        inspectFunction(context, node);
      },
      ArrowFunctionExpression(node) {
        inspectFunction(context, node);
      },
      VariableDeclarator(node) {
        inspectVariableDeclarator(context, node);
      },
      TSAsExpression(node) {
        inspectTypeAssertionLike(context, node);
      },
      TSSatisfiesExpression(node) {
        inspectTypeAssertionLike(context, node);
      },
    };
  },
};
