apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny, namespace: ns-a}
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny, namespace: ns-b}
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: app-egress, namespace: ns-a}
spec:
  podSelector: {matchLabels: {app: client}}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: {matchLabels: {compartment.test/namespace: ns-a}}
          podSelector: {matchLabels: {app: resource}}
      ports: [{protocol: TCP, port: 8080}]
    - to:
        - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: kube-system}}
          podSelector: {matchLabels: {k8s-app: kube-dns}}
      ports: [{protocol: UDP, port: 53}, {protocol: TCP, port: 53}]
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except: [169.254.0.0/16, __POD_CIDR__, __SERVICE_CIDR__]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: app-ingress, namespace: ns-a}
spec:
  podSelector: {matchLabels: {app: app}}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: {matchLabels: {compartment.test/namespace: platform-ns}}
          podSelector: {matchLabels: {app: caddy}}
      ports: [{protocol: TCP, port: 8080}]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: resource-ingress, namespace: ns-a}
spec:
  podSelector: {matchLabels: {app: resource}}
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: {matchLabels: {app: client}}
      ports: [{protocol: TCP, port: 8080}]
