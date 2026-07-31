{{- if eq .Values.platform.startupStage "full" }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "compartment.fullname" . }}-registry
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "compartment.componentLabels" (dict "root" . "component" "registry") | nindent 6 }}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              {{- include "compartment.componentLabels" (dict "root" . "component" "registry-auth") | nindent 14 }}
      ports:
        - protocol: TCP
          port: {{ .Values.ports.registry }}
{{- end }}
