export interface UpsertDeploymentKubeReferenceInput {
  deploymentId: string;
  deploymentName: string;
  id: string;
  namespace: string;
  networkPolicyNames: string[];
  serviceName: string;
}
