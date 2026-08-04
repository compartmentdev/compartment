export interface StoreBuildArtifactSbomInput {
  artifactId: string;
  deploymentId: string;
  digest: string;
  imageDigest: string;
  sbomJson: string;
}
