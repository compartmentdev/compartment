apiVersion: v1
kind: Service
metadata:
  name: {{ include "compartment.fullname" . }}-api
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "compartment.componentLabels" (dict "root" . "component" "api") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.ports.api }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "compartment.fullname" . }}-api
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
    app.kubernetes.io/component: api
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "compartment.componentLabels" (dict "root" . "component" "api") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "compartment.componentLabels" (dict "root" . "component" "api") | nindent 8 }}
      annotations:
        {{- include "compartment.rolloutAnnotations" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "compartment.fullname" . }}-api
      automountServiceAccountToken: false
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
        fsGroup: 10001
        fsGroupChangePolicy: OnRootMismatch
      initContainers:
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
            {{- include "compartment.containerSecurityContext" . | nindent 12 }}
            runAsUser: 1000
            runAsGroup: 1000
          env:
            - name: HOME
              value: /tmp
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: kube-api-access
              mountPath: /var/run/secrets/kubernetes.io/serviceaccount
              readOnly: true
      containers:
        - name: api
          image: {{ include "compartment.image" .Values.images.api }}
          imagePullPolicy: {{ .Values.images.api.pullPolicy }}
          securityContext:
            {{- include "compartment.containerSecurityContext" . | nindent 12 }}
            runAsUser: 10001
            runAsGroup: 10001
          envFrom:
            - configMapRef:
                name: {{ include "compartment.fullname" . }}
          env:
            - name: COMPARTMENT_DATABASE_URL
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: database-url}
            - name: COMPARTMENT_POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: postgres-password}
            - name: COMPARTMENT_EDGE_TOKEN
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: edge-token}
            - name: COMPARTMENT_RUNTIME_CONTROL_TOKEN
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: runtime-control-token}
            - name: COMPARTMENT_SESSION_SECRET
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: session-secret}
            - name: COMPARTMENT_SYSTEM_TOKEN
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: system-token}
            - name: COMPARTMENT_VARIABLES_MASTER_KEY
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: variables-master-key}
          ports:
            - name: http
              containerPort: {{ .Values.ports.api }}
          readinessProbe:
            httpGet: {path: /readyz, port: http}
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: {path: /healthz, port: http}
            initialDelaySeconds: 10
            periodSeconds: 10
          volumeMounts:
            - {name: data, mountPath: /var/lib/compartment}
            - {name: runtime, mountPath: /var/run/compartment}
            - {name: tls, mountPath: /etc/compartment/tls, readOnly: true}
            - {name: tmp, mountPath: /tmp}
      volumes:
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
        - name: data
          persistentVolumeClaim:
            claimName: {{ include "compartment.fullname" . }}-api
        - {name: runtime, emptyDir: {}}
        - {name: tls, emptyDir: {}}
        - {name: tmp, emptyDir: {}}
