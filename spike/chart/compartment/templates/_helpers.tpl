{{- define "compartment.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "compartment.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "compartment.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "compartment.labels" -}}
app.kubernetes.io/name: {{ include "compartment.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{- define "compartment.selectorLabels" -}}
app.kubernetes.io/name: {{ include "compartment.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "compartment.componentLabels" -}}
{{ include "compartment.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "compartment.image" -}}
{{- printf "%s:%s" .repository .tag -}}
{{- end }}

{{- define "compartment.storageClass" -}}
{{- if .Values.storage.storageClass }}
storageClassName: {{ .Values.storage.storageClass | quote }}
{{- end }}
{{- end }}

{{- define "compartment.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
readOnlyRootFilesystem: true
runAsNonRoot: true
{{- end }}

{{- define "compartment.rolloutAnnotations" -}}
checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml.tpl") . | sha256sum }}
checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml.tpl") . | sha256sum }}
compartment.dev/rollout-marker: {{ .Values.platform.rolloutMarker | quote }}
{{- end }}
