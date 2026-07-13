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
checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
compartment.dev/rollout-marker: {{ .Values.platform.rolloutMarker | quote }}
{{- end }}

{{- define "compartment.waiterPodSpec" -}}
serviceAccountName: {{ include "compartment.fullname" . }}-waiter
automountServiceAccountToken: false
{{- end }}

{{- define "compartment.waitForMigrationInit" -}}
- name: wait-for-api-migrate
  image: {{ include "compartment.image" .Values.images.kubectl }}
  imagePullPolicy: {{ .Values.images.kubectl.pullPolicy }}
  command: ["kubectl"]
  args:
    - wait
    - --for=condition=complete
    - job/{{ include "compartment.fullname" . }}-api-migrate-{{ .Release.Revision }}
    - --timeout=6m
  securityContext:
    {{- include "compartment.containerSecurityContext" . | nindent 4 }}
    runAsUser: 1000
    runAsGroup: 1000
  resources:
    {{- toYaml .Values.resources.wait | nindent 4 }}
  env:
    - name: HOME
      value: /tmp
  volumeMounts:
    - {name: tmp, mountPath: /tmp}
    - {name: kube-api-access, mountPath: /var/run/secrets/kubernetes.io/serviceaccount, readOnly: true}
{{- end }}

{{- define "compartment.waitForFoundationInit" -}}
- name: wait-for-foundation
  image: {{ include "compartment.image" .Values.images.kubectl }}
  imagePullPolicy: {{ .Values.images.kubectl.pullPolicy }}
  command: ["kubectl"]
  args:
    - wait
    - --for=condition=available
    - deployment/{{ include "compartment.fullname" . }}-postgres
    - deployment/{{ include "compartment.fullname" . }}-registry
    - --timeout=6m
  securityContext:
    {{- include "compartment.containerSecurityContext" . | nindent 4 }}
    runAsUser: 1000
    runAsGroup: 1000
  resources:
    {{- toYaml .Values.resources.wait | nindent 4 }}
  env:
    - name: HOME
      value: /tmp
  volumeMounts:
    - {name: tmp, mountPath: /tmp}
    - {name: kube-api-access, mountPath: /var/run/secrets/kubernetes.io/serviceaccount, readOnly: true}
{{- end }}

{{- define "compartment.kubeApiAccessVolume" -}}
- name: kube-api-access
  projected:
    defaultMode: 420
    sources:
      - serviceAccountToken:
          path: token
          expirationSeconds: 3600
      - configMap:
          name: kube-root-ca.crt
          items:
            - {key: ca.crt, path: ca.crt}
      - downwardAPI:
          items:
            - path: namespace
              fieldRef:
                apiVersion: v1
                fieldPath: metadata.namespace
{{- end }}
