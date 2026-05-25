export function formatDeploymentLabelTag(label: string | null): string {
  return label === null ? '' : ` [label=${JSON.stringify(label)}]`;
}
