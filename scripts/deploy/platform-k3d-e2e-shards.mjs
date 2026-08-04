const installSuite = 'install';
const buildMatrixSuite = 'build-matrix';

export const platformK3dShardDefinitions = Object.freeze({
  'managed-install': defineShard(0, ['public-operator-install', 'managed-install', 'retained-state']),
  'install-ha-network-policy': defineShard(1, [installSuite, 'ha', 'network-policy'], {
    clusterName: 'compartment-e2e-install-ha-np',
  }),
  'build-matrix-a-1': defineBuildMatrixShard(2, 'a-1'),
  'build-matrix-a-2': defineBuildMatrixShard(3, 'a-2'),
  'build-matrix-b-1': defineBuildMatrixShard(4, 'b-1', 'nginx'),
  'build-matrix-b-2': defineBuildMatrixShard(5, 'b-2', 'nginx'),
  'build-matrix-b-3': defineBuildMatrixShard(6, 'b-3', 'nginx'),
  'gvisor-build': defineShard(7, [installSuite, buildMatrixSuite], {
    buildMatrixPartition: 'gvisor',
    gvisorEnabled: true,
  }),
  'user-flow': defineShard(8, [installSuite, 'system-user']),
  console: defineShard(9, [installSuite, 'console', 'g1', 'product-log']),
  'system-update': defineShard(10, [installSuite, 'system-update']),
  'build-performance': defineShard(11, [installSuite, 'build-performance'], {
    clusterName: 'compartment-e2e-build-perf',
  }),
});

export const platformK3dShardNames = Object.freeze(Object.keys(platformK3dShardDefinitions));

function defineBuildMatrixShard(index, buildMatrixPartition, ingressClass = 'traefik') {
  return defineShard(index, [installSuite, buildMatrixSuite], { buildMatrixPartition, ingressClass });
}

function defineShard(index, suites, options = {}) {
  return Object.freeze({
    buildMatrixPartition: options.buildMatrixPartition,
    clusterName: options.clusterName,
    gvisorEnabled: options.gvisorEnabled ?? false,
    index,
    ingressClass: options.ingressClass ?? 'traefik',
    suites: Object.freeze(suites),
  });
}
