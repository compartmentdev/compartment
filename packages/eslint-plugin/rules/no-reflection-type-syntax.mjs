const bannedUtilityTypes = new Set([
  'Awaited',
  'ConstructorParameters',
  'InstanceType',
  'OmitThisParameter',
  'Parameters',
  'ReturnType',
  'ThisParameterType',
]);

function isBannedUtilityType(node) {
  return node.typeName.type === 'Identifier' && bannedUtilityTypes.has(node.typeName.name);
}

export const noReflectionTypeSyntaxRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow reflection-style type syntax that hides explicit type ownership',
    },
    schema: [],
    messages: {
      avoidIndexedAccessType:
        'Indexed access type "{{typeText}}" hides the owning type. Import or declare a named explicit type instead.',
      avoidUtilityType:
        'Type utility "{{typeName}}" hides the owning type. Import or declare a named explicit type instead.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      TSIndexedAccessType(node) {
        context.report({
          node,
          messageId: 'avoidIndexedAccessType',
          data: {
            typeText: sourceCode.getText(node),
          },
        });
      },
      TSTypeReference(node) {
        if (!isBannedUtilityType(node)) {
          return;
        }

        context.report({
          node,
          messageId: 'avoidUtilityType',
          data: {
            typeName: node.typeName.name,
          },
        });
      },
    };
  },
};
