export interface KubernetesSystemDomainIngressList {
  items: KubernetesSystemDomainIngress[];
}

export interface KubernetesSystemDomainIngress {
  spec?: KubernetesSystemDomainIngressSpec | undefined;
  status?: KubernetesSystemDomainIngressStatus | undefined;
}

export interface KubernetesSystemDomainIngressSpec {
  rules?: KubernetesSystemDomainIngressRule[] | undefined;
  tls?: KubernetesSystemDomainIngressTls[] | undefined;
}

export interface KubernetesSystemDomainIngressRule {
  host?: string | undefined;
}

export interface KubernetesSystemDomainIngressTls {
  hosts?: string[] | undefined;
  secretName?: string | undefined;
}

export interface KubernetesSystemDomainIngressStatus {
  loadBalancer?: { ingress?: KubernetesSystemDomainIngressAddress[] | undefined } | undefined;
}

export interface KubernetesSystemDomainIngressAddress {
  hostname?: string | undefined;
  ip?: string | undefined;
}
