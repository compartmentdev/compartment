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

{{- define "compartment.registryAuthHost" -}}
{{- printf "%s-registry-auth.%s.svc" (include "compartment.fullname" .) .Release.Namespace -}}
{{- end }}

{{- define "compartment.customTlsSecretName" -}}
{{- default (printf "%s-custom-tls" (include "compartment.fullname" .)) .Values.customTls.existingSecret -}}
{{- end }}

{{- define "compartment.installStateSecretName" -}}
{{- $candidate := printf "%s-install-state" .Release.Name -}}
{{- if le (len $candidate) 63 -}}
{{- $candidate -}}
{{- else -}}
{{- printf "%s-%s" ($candidate | trunc 54 | trimSuffix "-") (.Release.Name | sha256sum | trunc 8) -}}
{{- end -}}
{{- end }}

{{- define "compartment.applyRetainedInstallState" -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "compartment.installStateSecretName" .) -}}
{{- if and $existing $existing.data -}}
{{- $platformFields := list
  (dict "secretKey" "installation-id" "valueKey" "installationId")
  (dict "secretKey" "domain-mode" "valueKey" "domainMode")
  (dict "secretKey" "base-domain" "valueKey" "baseDomain")
  (dict "secretKey" "public-ingress-ipv4" "valueKey" "publicIngressIpv4")
  (dict "secretKey" "public-ingress-ipv6" "valueKey" "publicIngressIpv6")
  (dict "secretKey" "acme-email" "valueKey" "acmeEmail")
  (dict "secretKey" "managed-domain-broker-url" "valueKey" "managedDomainBrokerUrl")
  (dict "secretKey" "public-protocol" "valueKey" "publicProtocol")
  (dict "secretKey" "tls-mode" "valueKey" "tlsMode")
-}}
{{- range $field := $platformFields -}}
{{- $encodedValue := get $existing.data $field.secretKey -}}
{{- if not (empty $encodedValue) -}}
{{- $_ := set $.Values.platform $field.valueKey ($encodedValue | b64dec) -}}
{{- end -}}
{{- end -}}
{{- $encodedBrokerToken := get $existing.data "managed-domain-broker-token" -}}
{{- if not (empty $encodedBrokerToken) -}}
{{- $_ := set .Values.secrets "managedDomainBrokerToken" ($encodedBrokerToken | b64dec) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "compartment.validateInstallValues" -}}
{{- if eq .Values.platform.startupStage "full" -}}
{{- $_ := required "platform.installationId is required for a full installation" .Values.platform.installationId -}}
{{- $_ = required "platform.baseDomain is required for a full installation" .Values.platform.baseDomain -}}
{{- if not (or (eq .Values.platform.baseDomain "localhost") (hasSuffix ".localhost" .Values.platform.baseDomain)) -}}
{{- if and (empty .Values.platform.publicIngressIpv4) (empty .Values.platform.publicIngressIpv6) -}}
{{- fail "platform.publicIngressIpv4 or platform.publicIngressIpv6 is required for a public installation" -}}
{{- end -}}
{{- if and (not (empty .Values.platform.publicIngressIpv4)) (regexMatch `^(0|10|127)\.|^100\.(6[4-9]|[789][0-9]|1[01][0-9]|12[0-7])\.|^169\.254\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.(0\.2|168)\.|^198\.(1[89]|51\.100)\.|^203\.0\.113\.|^(22[4-9]|23[0-9]|24[0-9]|25[0-5])\.` .Values.platform.publicIngressIpv4) -}}
{{- fail "platform.publicIngressIpv4 must be a public IPv4 address" -}}
{{- end -}}
{{- $publicIngressIpv6 := lower .Values.platform.publicIngressIpv6 -}}
{{- if and (not (empty $publicIngressIpv6)) (regexMatch `^([0:]+1?$|[0:]+0\.0\.0\.[01]$|[0:]+ffff:|2001:0?db8:|f[cd]|fe[89ab]|ff)` $publicIngressIpv6) -}}
{{- fail "platform.publicIngressIpv6 must be a public IPv6 address" -}}
{{- end -}}
{{- if ne .Values.platform.publicProtocol "https" -}}
{{- fail "platform.publicProtocol must be https for a public installation" -}}
{{- end -}}
{{- if or (ne (int .Values.service.caddy.httpPort) 80) (ne (int .Values.service.caddy.httpsPort) 443) -}}
{{- fail "public Caddy Service ports must be 80 and 443" -}}
{{- end -}}
{{- end -}}
{{- if or (eq .Values.platform.tlsMode "managed") (eq .Values.platform.tlsMode "custom-cert") -}}
{{- if ne .Values.platform.acmeIssuer "acme" -}}
{{- fail "platform.acmeIssuer must be acme for public TLS" -}}
{{- end -}}
{{- $acmeCaUrl := urlParse .Values.platform.acmeCaUrl -}}
{{- if not (and (eq (get $acmeCaUrl "scheme") "https") (not (empty (get $acmeCaUrl "host"))) (empty (get $acmeCaUrl "userinfo")) (empty (get $acmeCaUrl "query")) (empty (get $acmeCaUrl "fragment"))) -}}
{{- fail "platform.acmeCaUrl must be an absolute HTTPS URL without credentials, a query, or a fragment" -}}
{{- end -}}
{{- if not (regexMatch `^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$` .Values.platform.acmeEmail) -}}
{{- fail "platform.acmeEmail must be a valid email address for public TLS" -}}
{{- end -}}
{{- end -}}
{{- if eq .Values.platform.tlsMode "managed" -}}
{{- if ne .Values.platform.domainMode "managed" -}}
{{- fail "platform.domainMode must be managed when platform.tlsMode is managed" -}}
{{- end -}}
{{- $brokerUrl := required "platform.managedDomainBrokerUrl is required for managed TLS" .Values.platform.managedDomainBrokerUrl -}}
{{- $parsedBrokerUrl := urlParse $brokerUrl -}}
{{- if not (and (or (eq (get $parsedBrokerUrl "scheme") "http") (eq (get $parsedBrokerUrl "scheme") "https")) (not (empty (get $parsedBrokerUrl "host"))) (empty (get $parsedBrokerUrl "userinfo")) (or (empty (get $parsedBrokerUrl "path")) (eq (get $parsedBrokerUrl "path") "/")) (empty (get $parsedBrokerUrl "query")) (empty (get $parsedBrokerUrl "fragment"))) -}}
{{- fail "platform.managedDomainBrokerUrl must be an absolute HTTP(S) base URL without credentials, a path, query, or fragment" -}}
{{- end -}}
{{- $secretName := include "compartment.installStateSecretName" . -}}
{{- $existingSecret := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- $existingToken := "" -}}
{{- if and $existingSecret $existingSecret.data -}}
{{- $existingToken = dig "managed-domain-broker-token" "" $existingSecret.data -}}
{{- end -}}
{{- if and (empty .Values.secrets.managedDomainBrokerToken) (empty $existingToken) -}}
{{- fail "secrets.managedDomainBrokerToken is required for managed TLS" -}}
{{- end -}}
{{- end -}}
{{- if and (eq .Values.platform.tlsMode "custom-cert") (empty .Values.customTls.existingSecret) -}}
{{- $customSecretName := include "compartment.customTlsSecretName" . -}}
{{- $existingCustomSecret := lookup "v1" "Secret" .Release.Namespace $customSecretName -}}
{{- $existingCertificate := "" -}}
{{- $existingPrivateKey := "" -}}
{{- if and $existingCustomSecret $existingCustomSecret.data -}}
{{- $existingCertificate = dig "tls.crt" "" $existingCustomSecret.data -}}
{{- $existingPrivateKey = dig "tls.key" "" $existingCustomSecret.data -}}
{{- end -}}
{{- if and (empty .Values.customTls.certificate) (empty $existingCertificate) -}}
{{- fail "customTls.certificate or customTls.existingSecret is required for custom-cert TLS" -}}
{{- end -}}
{{- if and (empty .Values.customTls.privateKey) (empty $existingPrivateKey) -}}
{{- fail "customTls.privateKey or customTls.existingSecret is required for custom-cert TLS" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "compartment.projectProvisioningNamespace" -}}
{{- printf "%s-project-provisioning" (include "compartment.fullname" .) | trunc 63 | trimSuffix "-" -}}
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
