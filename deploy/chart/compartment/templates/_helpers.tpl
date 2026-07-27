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

{{- define "compartment.retainedResourceAnnotations" -}}
helm.sh/resource-policy: keep
meta.helm.sh/release-name: {{ .Release.Name | quote }}
meta.helm.sh/release-namespace: {{ .Release.Namespace | quote }}
{{- end }}

{{- define "compartment.customTlsSecretName" -}}
{{- $installState := include "compartment.resolvedInstallState" . | fromYaml -}}
{{- default (printf "%s-custom-tls" (include "compartment.fullname" .)) $installState.effective.customTls.existingSecret -}}
{{- end }}

{{- define "compartment.installStateSecretName" -}}
{{- $candidate := printf "%s-install-state" .Release.Name -}}
{{- if le (len $candidate) 63 -}}
{{- $candidate -}}
{{- else -}}
{{- printf "%s-%s" ($candidate | trunc 54 | trimSuffix "-") (.Release.Name | sha256sum | trunc 8) -}}
{{- end -}}
{{- end }}

{{- define "compartment.installStateFields" -}}
- secretKey: installation-id
  valuesSection: platform
  valueKey: installationId
  policy: stable
- secretKey: domain-mode
  valuesSection: platform
  valueKey: domainMode
  policy: domain
- secretKey: base-domain
  valuesSection: platform
  valueKey: baseDomain
  policy: domain
- secretKey: ingress-class-name
  valuesSection: ingress
  valueKey: className
  policy: stable
- secretKey: ingress-endpoint-type
  valuesSection: ingressEndpoint
  valueKey: type
  policy: stable
- secretKey: ingress-endpoint-value
  valuesSection: ingressEndpoint
  valueKey: value
  policy: stable
- secretKey: public-ingress-ipv4
  valuesSection: platform
  valueKey: publicIngressIpv4
  policy: stable
- secretKey: public-ingress-ipv6
  valuesSection: platform
  valueKey: publicIngressIpv6
  policy: stable
- secretKey: acme-email
  valuesSection: platform
  valueKey: acmeEmail
  policy: stable
- secretKey: managed-domain-broker-url
  valuesSection: platform
  valueKey: managedDomainBrokerUrl
  policy: stable
- secretKey: managed-domain-broker-token
  valuesSection: secrets
  valueKey: managedDomainBrokerToken
  policy: stable
- secretKey: public-protocol
  valuesSection: platform
  valueKey: publicProtocol
  policy: domain
- secretKey: tls-mode
  valuesSection: platform
  valueKey: tlsMode
  policy: domain
- secretKey: active-custom-tls-secret
  valuesSection: customTls
  valueKey: existingSecret
  policy: domain
  allowEmpty: true
- secretKey: operator-custom-tls-secret
  valuesSection: customTls
  valueKey: operatorSecretName
  policy: domain
  allowEmpty: true
{{- end }}

{{- define "compartment.persistedSecretValue" -}}
{{- default (default .fallback (dig .secretKey "" .data | b64dec)) .override -}}
{{- end }}

{{- define "compartment.resolvedInstallState" -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "compartment.installStateSecretName" .) -}}
{{- $data := dict -}}
{{- if and $existing $existing.data -}}
{{- $data = $existing.data -}}
{{- end -}}
{{- $effective := dict "platform" (deepCopy .Values.platform) "customTls" (deepCopy .Values.customTls) "secrets" (deepCopy .Values.secrets) "ingress" (dict "className" .Values.ingress.className) "ingressEndpoint" (deepCopy .Values.ingress.endpoint) -}}
{{- $persisted := deepCopy $effective -}}
{{- $incomingSections := dict "platform" .Values.platform "customTls" .Values.customTls "secrets" .Values.secrets "ingress" .Values.ingress "ingressEndpoint" .Values.ingress.endpoint -}}
{{- $retainedGeneration := int (default "0" (dig "domain-generation" "" $data | b64dec)) -}}
{{- $incomingGeneration := int .Values.platform.domainGeneration -}}
{{- $useRetainedDomain := and (not (get . "compartmentSharedChecksum")) (le $incomingGeneration $retainedGeneration) -}}
{{- $useIncomingPersistedDomain := or (empty $data) (and .Values.platform.domainCommit (gt $incomingGeneration $retainedGeneration)) -}}
{{- range $field := include "compartment.installStateFields" . | fromYamlArray -}}
{{- $incomingValue := get (get $incomingSections $field.valuesSection) $field.valueKey -}}
{{- $encodedRetainedValue := get $data $field.secretKey -}}
{{- $allowEmpty := default false $field.allowEmpty -}}
{{- $hasRetainedValue := and (hasKey $data $field.secretKey) (or $allowEmpty (not (empty $encodedRetainedValue))) -}}
{{- $hasPersistedRetainedValue := and (hasKey $data $field.secretKey) (or (not (empty $encodedRetainedValue)) (and $allowEmpty $useRetainedDomain)) -}}
{{- $retainedValue := $encodedRetainedValue | b64dec -}}
{{- if $hasRetainedValue -}}
{{- if or (eq $field.policy "stable") $useRetainedDomain -}}
{{- $_ := set (get $effective $field.valuesSection) $field.valueKey $retainedValue -}}
{{- end -}}
{{- end -}}
{{- if and (eq $field.policy "domain") (not $useIncomingPersistedDomain) -}}
{{- $_ := set (get $persisted $field.valuesSection) $field.valueKey (ternary $retainedValue $incomingValue $hasPersistedRetainedValue) -}}
{{- else if and (eq $field.policy "stable") $hasRetainedValue -}}
{{- $_ := set (get $persisted $field.valuesSection) $field.valueKey $retainedValue -}}
{{- end -}}
{{- end -}}
{{- if eq (dig "startup-stage" "" $data | b64dec) "full" -}}
{{- $_ := set $effective.platform "startupStage" "full" -}}
{{- $_ = set $persisted.platform "startupStage" "full" -}}
{{- end -}}
{{- if $useRetainedDomain -}}
{{- $_ := set $effective.platform "domainGeneration" $retainedGeneration -}}
{{- end -}}
{{- $_ := set $persisted.platform "domainGeneration" (ternary $incomingGeneration $retainedGeneration $useIncomingPersistedDomain) -}}
{{- $retainedManagedBaseDomain := dig "managed-base-domain" "" $data | b64dec -}}
{{- $managedBaseDomain := ternary $persisted.platform.baseDomain "" (and (empty $retainedManagedBaseDomain) (eq $persisted.platform.domainMode "managed")) -}}
{{- $_ = set $persisted.platform "managedBaseDomain" (default $managedBaseDomain $retainedManagedBaseDomain) -}}
{{- dict "effective" $effective "persisted" $persisted | toYaml -}}
{{- end }}

{{- define "compartment.validateInstallValues" -}}
{{- $installState := include "compartment.resolvedInstallState" . | fromYaml -}}
{{- $effective := $installState.effective -}}
{{- if eq $effective.platform.startupStage "full" -}}
{{- $_ := required "platform.installationId is required for a full installation" $effective.platform.installationId -}}
{{- $_ = required "platform.baseDomain is required for a full installation" $effective.platform.baseDomain -}}
{{- $_ = required "registry.hostname is required for a full installation" .Values.registry.hostname -}}
{{- $_ = required "registry.issuerRef.name is required for a full installation" .Values.registry.issuerRef.name -}}
{{- if and (not (empty $effective.secrets.managedDomainBrokerToken)) (empty $effective.platform.managedDomainBrokerUrl) -}}
{{- fail "platform.managedDomainBrokerUrl is required when secrets.managedDomainBrokerToken is configured" -}}
{{- end -}}
{{- if not (or (eq $effective.platform.baseDomain "localhost") (hasSuffix ".localhost" $effective.platform.baseDomain)) -}}
{{- end -}}
{{- if or (eq $effective.platform.tlsMode "managed") (eq $effective.platform.tlsMode "custom-cert") -}}
{{- if ne .Values.platform.acmeIssuer "acme" -}}
{{- fail "platform.acmeIssuer must be acme for public TLS" -}}
{{- end -}}
{{- $_ := required "platform.acmeCaUrl is required for public TLS" .Values.platform.acmeCaUrl -}}
{{- $_ = required "platform.acmeEmail is required for public TLS" $effective.platform.acmeEmail -}}
{{- end -}}
{{- if eq $effective.platform.tlsMode "managed" -}}
{{- if ne $effective.platform.domainMode "managed" -}}
{{- fail "platform.domainMode must be managed when platform.tlsMode is managed" -}}
{{- end -}}
{{- $_ := required "platform.managedDomainBrokerUrl is required for managed TLS" $effective.platform.managedDomainBrokerUrl -}}
{{- if empty $effective.secrets.managedDomainBrokerToken -}}
{{- fail "secrets.managedDomainBrokerToken is required for managed TLS" -}}
{{- end -}}
{{- end -}}
{{- if and (eq $effective.platform.tlsMode "custom-cert") (empty $effective.customTls.existingSecret) -}}
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
{{- if not (empty $effective.customTls.operatorSecretName) -}}
{{- $operatorSecret := lookup "v1" "Secret" .Release.Namespace $effective.customTls.operatorSecretName -}}
{{- $operatorCertificate := dig "data" "tls.crt" "" $operatorSecret -}}
{{- $operatorPrivateKey := dig "data" "tls.key" "" $operatorSecret -}}
{{- if and (empty .Values.customTls.operatorCertificate) (empty $operatorCertificate) -}}
{{- fail "customTls.operatorCertificate or an existing operator Secret is required with customTls.operatorSecretName" -}}
{{- end -}}
{{- if and (empty .Values.customTls.operatorPrivateKey) (empty $operatorPrivateKey) -}}
{{- fail "customTls.operatorPrivateKey or an existing operator Secret is required with customTls.operatorSecretName" -}}
{{- end -}}
{{- end -}}
{{- if not (empty .Values.customTls.pendingSecretName) -}}
{{- $_ := required "customTls.pendingCertificate is required with customTls.pendingSecretName" .Values.customTls.pendingCertificate -}}
{{- $_ = required "customTls.pendingPrivateKey is required with customTls.pendingSecretName" .Values.customTls.pendingPrivateKey -}}
{{- end -}}
{{- if and (not (empty .Values.customTls.pendingOperationId)) (empty .Values.customTls.pendingSecretName) -}}
{{- fail "customTls.pendingSecretName is required for a pending domain operation" -}}
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
{{- if .digest -}}
{{- printf "%s@%s" .repository .digest -}}
{{- else -}}
{{- printf "%s:%s" .repository .tag -}}
{{- end -}}
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
{{- $sharedContext := deepCopy . -}}
{{- $_ := set $sharedContext "compartmentSharedChecksum" true -}}
{{- $sharedValues := get $sharedContext "Values" -}}
{{- $sharedPlatform := get $sharedValues "platform" -}}
{{- $_ := set $sharedPlatform "baseDomain" "rollout.localhost" -}}
{{- $_ = set $sharedPlatform "domainGeneration" 0 -}}
{{- $_ = set $sharedPlatform "domainMode" "custom" -}}
{{- $_ = set $sharedPlatform "publicProtocol" "https" -}}
{{- $_ = set $sharedPlatform "tlsMode" "custom-http" -}}
{{- $_ = set $sharedValues "customTls" (dict "certificate" "" "existingSecret" "" "operatorCertificate" "" "operatorPrivateKey" "" "operatorSecretName" "" "pendingCertificate" "" "pendingOperationId" "" "pendingPrivateKey" "" "pendingSecretName" "" "privateKey" "") -}}
checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") $sharedContext | sha256sum }}
checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
compartment.dev/rollout-marker: {{ .Values.platform.rolloutMarker | quote }}
{{- end }}

{{- define "compartment.domainRolloutAnnotations" -}}
{{- $installState := include "compartment.resolvedInstallState" . | fromYaml -}}
{{- include "compartment.rolloutAnnotations" . }}
{{ $activeTlsContext := deepCopy . -}}
{{- $activeTlsValues := get (get $activeTlsContext "Values") "customTls" -}}
{{- $_ := set $activeTlsValues "pendingCertificate" "" -}}
{{- $_ = set $activeTlsValues "pendingOperationId" "" -}}
{{- $_ = set $activeTlsValues "pendingPrivateKey" "" -}}
{{- $_ = set $activeTlsValues "pendingSecretName" "" -}}
checksum/domain-config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
checksum/install-state: {{ include (print $.Template.BasePath "/install-state-secret.yaml") . | sha256sum }}
checksum/custom-tls: {{ include (print $.Template.BasePath "/custom-tls-secret.yaml") $activeTlsContext | sha256sum }}
compartment.dev/domain-generation: {{ $installState.effective.platform.domainGeneration | quote }}
{{- end }}

{{- define "compartment.apiDomainRolloutAnnotations" -}}
{{- include "compartment.domainRolloutAnnotations" . }}
checksum/pending-tls: {{ include (print $.Template.BasePath "/custom-tls-secret.yaml") . | sha256sum }}
compartment.dev/pending-domain-operation: {{ .Values.customTls.pendingOperationId | quote }}
{{- end }}

{{- define "compartment.waiterPodSpec" -}}
serviceAccountName: {{ include "compartment.fullname" . }}-waiter
automountServiceAccountToken: false
{{- end }}

{{- define "compartment.kubectlWaitInit" -}}
- name: {{ .name }}
  image: {{ include "compartment.image" .root.Values.images.kubectl }}
  imagePullPolicy: {{ .root.Values.images.kubectl.pullPolicy }}
  command: ["kubectl"]
  args:
    {{- range .args }}
    - {{ . }}
    {{- end }}
  securityContext:
    {{- include "compartment.containerSecurityContext" .root | nindent 4 }}
    runAsUser: 1000
    runAsGroup: 1000
  resources:
    {{- toYaml .root.Values.resources.wait | nindent 4 }}
  env:
    - name: HOME
      value: /tmp
  volumeMounts:
    - {name: tmp, mountPath: /tmp}
    - {name: kube-api-access, mountPath: /var/run/secrets/kubernetes.io/serviceaccount, readOnly: true}
{{- end }}

{{- define "compartment.waitForMigrationInit" -}}
{{- $args := list "wait" "--for=condition=complete" (printf "job/%s-api-migrate-%v" (include "compartment.fullname" .) .Release.Revision) "--timeout=6m" -}}
{{- include "compartment.kubectlWaitInit" (dict "root" . "name" "wait-for-api-migrate" "args" $args) -}}
{{- end }}

{{- define "compartment.waitForApiRolloutInit" -}}
{{- $args := list "rollout" "status" (printf "deployment/%s-api" (include "compartment.fullname" .)) "--timeout=6m" -}}
{{- include "compartment.kubectlWaitInit" (dict "root" . "name" "wait-for-api-rollout" "args" $args) -}}
{{- end }}

{{- define "compartment.waitForApiInit" -}}
- name: wait-for-api
  image: {{ include "compartment.image" .Values.images.worker }}
  imagePullPolicy: {{ .Values.images.worker.pullPolicy }}
  command: ["node", "-e"]
  args:
    - |
      const url = `http://${process.env.COMPARTMENT_API_INTERNAL_HOST}:${process.env.COMPARTMENT_API_PORT}/readyz`;
      const deadline = Date.now() + 360000;
      const wait = async () => {
        try {
          const response = await fetch(url, {signal: AbortSignal.timeout(2000)});
          if (response.ok) process.exit(0);
        } catch {}
        if (Date.now() >= deadline) {
          console.error(`Timed out waiting for ${url}`);
          process.exit(1);
        }
        setTimeout(wait, 1000);
      };
      void wait();
  securityContext:
    {{- include "compartment.containerSecurityContext" . | nindent 4 }}
    runAsUser: 10001
    runAsGroup: 10001
  resources:
    {{- toYaml .Values.resources.wait | nindent 4 }}
  envFrom:
    - configMapRef:
        name: {{ include "compartment.fullname" . }}
  env:
    - name: HOME
      value: /tmp
  volumeMounts:
    - {name: tmp, mountPath: /tmp}
{{- end }}

{{- define "compartment.waitForFoundationInit" -}}
{{- $args := list "wait" "--for=condition=available" (printf "deployment/%s-postgres" (include "compartment.fullname" .)) (printf "deployment/%s-registry" (include "compartment.fullname" .)) "--timeout=6m" -}}
{{- include "compartment.kubectlWaitInit" (dict "root" . "name" "wait-for-foundation" "args" $args) -}}
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
