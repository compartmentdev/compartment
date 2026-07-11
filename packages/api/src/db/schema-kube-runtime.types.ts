import type {
  DefaultTimestampBuilder,
  DefaultIntegerBuilder,
  OptionalTimestampBuilder,
  PgExtraConfigColumnsOf,
  PgTableOf,
  PrimaryTextBuilder,
  RequiredEnumTextBuilder,
  RequiredTextBuilder,
} from './schema.shared.types';

interface DeploymentKubeReferencesColumnBuilders {
  id: PrimaryTextBuilder<'id'>;
  deploymentId: RequiredTextBuilder<'deployment_id'>;
  namespace: RequiredTextBuilder<'namespace'>;
  deploymentName: RequiredTextBuilder<'deployment_name'>;
  serviceName: RequiredTextBuilder<'service_name'>;
  networkPolicyNamesJson: RequiredTextBuilder<'network_policy_names_json'>;
  state: RequiredEnumTextBuilder<'state', ['desired', 'pending', 'active']>;
  revision: DefaultIntegerBuilder<'revision'>;
  observedAt: OptionalTimestampBuilder<'observed_at'>;
  transitionedAt: DefaultTimestampBuilder<'transitioned_at'>;
  createdAt: DefaultTimestampBuilder<'created_at'>;
  updatedAt: DefaultTimestampBuilder<'updated_at'>;
}

export type DeploymentKubeReferencesTable = PgTableOf<
  'deployment_kube_references',
  DeploymentKubeReferencesColumnBuilders
>;
export type DeploymentKubeReferencesExtraConfigColumns = PgExtraConfigColumnsOf<
  'deployment_kube_references',
  DeploymentKubeReferencesColumnBuilders
>;
