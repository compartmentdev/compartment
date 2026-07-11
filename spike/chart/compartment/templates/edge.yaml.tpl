{{- if eq .Values.platform.startupStage "full" }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "compartment.fullname" . }}-edge
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "compartment.componentLabels" (dict "root" . "component" "edge") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.ports.edge }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "compartment.fullname" . }}-edge
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
    app.kubernetes.io/component: edge
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "compartment.componentLabels" (dict "root" . "component" "edge") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "compartment.componentLabels" (dict "root" . "component" "edge") | nindent 8 }}
      annotations:
        {{- include "compartment.rolloutAnnotations" . | nindent 8 }}
    spec:
      {{- include "compartment.waiterPodSpec" . | nindent 6 }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      initContainers:
        {{- include "compartment.waitForMigrationInit" . | nindent 8 }}
      containers:
        - name: edge
          image: {{ include "compartment.image" .Values.images.edge }}
          imagePullPolicy: {{ .Values.images.edge.pullPolicy }}
          securityContext:
            {{- include "compartment.containerSecurityContext" . | nindent 12 }}
            runAsUser: 1000
            runAsGroup: 1000
          resources:
            {{- toYaml .Values.resources.edge | nindent 12 }}
          envFrom:
            - configMapRef:
                name: {{ include "compartment.fullname" . }}
          env:
            - name: COMPARTMENT_EDGE_TOKEN
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: edge-token}
            # SPIKE-T7: prototype-only persisted last-known-good settings.
            - name: COMPARTMENT_EDGE_SNAPSHOT_PATH
              value: /var/lib/compartment-edge/access-state.json
            - name: COMPARTMENT_EDGE_SNAPSHOT_MAX_AGE_MS
              value: {{ .Values.platform.edgeSnapshotMaxAgeMs | quote }}
          ports:
            - name: http
              containerPort: {{ .Values.ports.edge }}
          readinessProbe:
            httpGet: {path: /healthz, port: http}
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: {path: /healthz, port: http}
            initialDelaySeconds: 10
            periodSeconds: 10
          volumeMounts:
            - {name: tmp, mountPath: /tmp}
            # SPIKE-T7: RWO PVC for the persisted authorization snapshot.
            - {name: edge-state, mountPath: /var/lib/compartment-edge}
      volumes:
        {{- include "compartment.kubeApiAccessVolume" . | nindent 8 }}
        - {name: tmp, emptyDir: {}}
        # SPIKE-T7: PVC survives edge pod replacement.
        - name: edge-state
          persistentVolumeClaim:
            claimName: {{ include "compartment.fullname" . }}-edge
{{- end }}
