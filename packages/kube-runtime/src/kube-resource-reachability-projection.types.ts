/**
 * A platform-image container that must succeed before a tenant Pod's own containers start.
 *
 * The caller owns the image and the command because both are properties of the platform image, not of any
 * database row. This package owns only where the container sits in the Pod and what it is allowed to do.
 */
export interface KubeResourceReachabilityProbe {
  command: string[];
  env: Readonly<Record<string, string>>;
  image: string;
}
