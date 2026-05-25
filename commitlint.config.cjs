module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'release', 'refactor', 'style', 'test', 'build', 'ci', 'docs', 'chore'],
    ],
    'scope-enum': [
      2,
      'always',
      ['repo', 'tooling', 'contracts', 'api', 'node', 'cli', 'sdk', 'db', 'auth', 'env', 'research', 'public-docs'],
    ],
    'scope-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
  },
};
