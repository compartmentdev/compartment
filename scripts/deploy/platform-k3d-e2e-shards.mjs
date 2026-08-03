export const platformK3dShardDefinitions = Object.freeze({
  'build-matrix-a': Object.freeze({
    index: 1,
    suites: Object.freeze(['install', 'ha', 'network-policy', 'build-matrix-a']),
  }),
  'build-matrix-b': Object.freeze({ index: 2, suites: Object.freeze(['install', 'build-matrix-b']) }),
  'gvisor-build': Object.freeze({ index: 5, suites: Object.freeze(['install', 'gvisor-build']) }),
  'user-flow': Object.freeze({ index: 3, suites: Object.freeze(['install', 'system-user']) }),
  console: Object.freeze({ index: 4, suites: Object.freeze(['install', 'console', 'g1', 'product-log']) }),
  'managed-install': Object.freeze({
    index: 0,
    suites: Object.freeze(['public-operator-install', 'managed-install', 'retained-state']),
  }),
  'system-update': Object.freeze({ index: 6, suites: Object.freeze(['install', 'system-update']) }),
});

export const platformK3dShardNames = Object.freeze(Object.keys(platformK3dShardDefinitions));
