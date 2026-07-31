{{- $name := include "compartment.fullname" . -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $name -}}
{{- $data := dict -}}
{{- if and $existing $existing.data -}}
{{- $data = $existing.data -}}
{{- end -}}
{{- $postgresPassword := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.postgresPassword) (dig "postgres-password" "" $data | b64dec) -}}
{{- $registryReadPassword := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.registryReadPassword) (dig "registry-read-password" "" $data | b64dec) -}}
{{- $registryWritePassword := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.registryWritePassword) (dig "registry-write-password" "" $data | b64dec) -}}
{{- $edgeToken := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.edgeToken) (dig "edge-token" "" $data | b64dec) -}}
{{- $runtimeControlToken := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.runtimeControlToken) (dig "runtime-control-token" "" $data | b64dec) -}}
{{- $sessionSecret := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.sessionSecret) (dig "session-secret" "" $data | b64dec) -}}
{{- $systemToken := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.systemToken) (dig "system-token" "" $data | b64dec) -}}
{{- $variablesMasterKey := default (default (sha256sum (randAlphaNum 64)) .Values.secrets.variablesMasterKey) (dig "variables-master-key" "" $data | b64dec) -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ $name }}
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
type: Opaque
stringData:
  postgres-password: {{ $postgresPassword | quote }}
  database-url: {{ printf "postgresql://%s:%s@%s-postgres:5432/%s" (.Values.postgres.username | urlquery | replace "+" "%20") ($postgresPassword | urlquery | replace "+" "%20") $name (.Values.postgres.database | urlquery | replace "+" "%20") | quote }}
  registry-read-password: {{ $registryReadPassword | quote }}
  registry-write-password: {{ $registryWritePassword | quote }}
  edge-token: {{ $edgeToken | quote }}
  runtime-control-token: {{ $runtimeControlToken | quote }}
  session-secret: {{ $sessionSecret | quote }}
  system-token: {{ $systemToken | quote }}
  variables-master-key: {{ $variablesMasterKey | quote }}
