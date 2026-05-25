const ignoredNamePattern = /^(is|serialize)[A-Z]/u;

function getFunctionName(node) {
  if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
    return node.id.name;
  }

  const parent = node.parent;
  if (
    (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
    parent?.type === 'VariableDeclarator' &&
    parent.id.type === 'Identifier'
  ) {
    return parent.id.name;
  }

  return null;
}

function getParameterName(parameter) {
  if (parameter.type === 'Identifier') {
    return parameter.name;
  }

  if (parameter.type === 'RestElement' && parameter.argument.type === 'Identifier') {
    return `...${parameter.argument.name}`;
  }

  return null;
}

function getDirectReturnCall(node) {
  if (node.body.type === 'CallExpression') {
    return node.body;
  }

  if (node.body.type !== 'BlockStatement' || node.body.body.length !== 1) {
    return null;
  }

  const statement = node.body.body[0];
  if (statement.type !== 'ReturnStatement' || statement.argument?.type !== 'CallExpression') {
    return null;
  }

  return statement.argument;
}

function isPassThroughWrapper(node) {
  if (node.async || node.generator) {
    return false;
  }

  const functionName = getFunctionName(node);
  if (functionName === null || ignoredNamePattern.test(functionName)) {
    return false;
  }

  const call = getDirectReturnCall(node);
  if (call === null || call.callee.type !== 'Identifier' || call.arguments.length !== node.params.length) {
    return false;
  }

  return node.params.every((parameter, index) => {
    const parameterName = getParameterName(parameter);
    const argument = call.arguments[index];
    if (parameterName === null || argument === undefined) {
      return false;
    }

    if (parameterName.startsWith('...')) {
      return (
        argument.type === 'SpreadElement' &&
        argument.argument.type === 'Identifier' &&
        argument.argument.name === parameterName.slice(3)
      );
    }

    return argument.type === 'Identifier' && argument.name === parameterName;
  });
}

export const noTrivialPassThroughWrapperRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow direct pass-through function wrappers',
    },
    schema: [],
    messages: {
      noTrivialPassThroughWrapper:
        'Remove this direct pass-through wrapper and call "{{calleeName}}" from the caller instead.',
    },
  },
  create(context) {
    function reportIfNeeded(node) {
      if (!isPassThroughWrapper(node)) {
        return;
      }

      const functionName = getFunctionName(node);
      const call = getDirectReturnCall(node);
      if (functionName === null || call === null || call.callee.type !== 'Identifier') {
        return;
      }

      context.report({
        node: node.body,
        messageId: 'noTrivialPassThroughWrapper',
        data: {
          calleeName: call.callee.name,
          functionName,
        },
      });
    }

    return {
      ArrowFunctionExpression: reportIfNeeded,
      FunctionDeclaration: reportIfNeeded,
      FunctionExpression: reportIfNeeded,
    };
  },
};
