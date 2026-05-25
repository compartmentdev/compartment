function getPropertyName(member) {
  if (member.type !== 'TSPropertySignature') {
    return null;
  }

  if (member.key.type === 'Identifier') {
    return member.key.name;
  }

  if (member.key.type === 'Literal' && typeof member.key.value === 'string') {
    return member.key.value;
  }

  return null;
}

function reportSinglePropertyDependency(context, node, typeName, members) {
  if (!typeName.endsWith('Dependencies') || members.length !== 1) {
    return;
  }

  const propertyName = getPropertyName(members[0]);

  if (propertyName === null) {
    return;
  }

  context.report({
    node,
    messageId: 'passPropertyDirectly',
    data: {
      propertyName,
      typeName,
    },
  });
}

export const noSinglePropertyDependencyRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow single-property dependency bags',
    },
    schema: [],
    messages: {
      passPropertyDirectly:
        'Type "{{typeName}}" wraps only "{{propertyName}}". Pass "{{propertyName}}" directly instead of introducing a single-property dependency bag.',
    },
  },
  create(context) {
    return {
      TSInterfaceDeclaration(node) {
        reportSinglePropertyDependency(context, node.id, node.id.name, node.body.body);
      },
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation.type !== 'TSTypeLiteral') {
          return;
        }

        reportSinglePropertyDependency(context, node.id, node.id.name, node.typeAnnotation.members);
      },
    };
  },
};
