function isNewlineJoinCall(node) {
  return (
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'join' &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === 'Literal' &&
    node.arguments[0].value === '\n'
  );
}

function isInlineArrayJoin(node) {
  return node.callee.type === 'MemberExpression' && node.callee.object.type === 'ArrayExpression';
}

function hasMultipleItems(arrayExpression) {
  const definedElements = arrayExpression.elements.filter((element) => element !== null);
  return definedElements.length >= 2;
}

export const noInlineMultilineTextJoinRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow inline array.join("\\n") renderers for multiline text',
    },
    schema: [],
    messages: {
      avoidInlineLineArrayJoin:
        'Render multiline text with a template literal or named renderer instead of inline [...].join("\\n").',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isNewlineJoinCall(node) || !isInlineArrayJoin(node) || !hasMultipleItems(node.callee.object)) {
          return;
        }

        context.report({
          node,
          messageId: 'avoidInlineLineArrayJoin',
        });
      },
    };
  },
};
