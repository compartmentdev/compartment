{{- $root := . -}}
{{- $claims := dict "api" .Values.storage.api "caddy" .Values.storage.caddy "postgres" .Values.storage.postgres "registry" .Values.storage.registry -}}
{{- if .Values.buildkit.enabled -}}
{{- $_ := set $claims "buildkit" .Values.storage.buildkit -}}
{{- end -}}
{{- range $name, $size := $claims }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "compartment.fullname" $root }}-{{ $name }}
  labels:
    {{- include "compartment.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
spec:
  accessModes:
    - ReadWriteOnce
  {{- include "compartment.storageClass" $root | nindent 2 }}
  resources:
    requests:
      storage: {{ $size }}
{{- end }}
