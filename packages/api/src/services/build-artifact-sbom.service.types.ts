export interface PersistBuildArtifactSbomInput {
  artifactId: string;
  deploymentId: string;
  digest: string;
  imageDigest: string;
  sbomJson: string;
}
